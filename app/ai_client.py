import asyncio
import json
import logging
import os
import re

import httpx
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential_jitter,
    before_sleep_log,
)

from app.circuit_breaker import CircuitBreaker

logger = logging.getLogger(__name__)

_ai_breaker = CircuitBreaker(failure_threshold=5, cooldown_seconds=300.0)

RETRYABLE_STATUS_CODES = {429, 500, 502, 503}


def _extract_retry_after(exc: BaseException) -> float | None:
    """Extract retry-after seconds from a rate limit error's response headers."""
    response = getattr(exc, "response", None)
    if response is None:
        return None
    headers = getattr(response, "headers", {})
    raw = headers.get("retry-after")
    if raw is None:
        return None
    try:
        return float(raw)
    except (ValueError, TypeError):
        return None


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in RETRYABLE_STATUS_CODES
    if isinstance(exc, httpx.TransportError):
        return True
    try:
        import anthropic
        if isinstance(exc, anthropic.RateLimitError):
            return True
        if isinstance(exc, anthropic.InternalServerError):
            return True
    except ImportError:
        pass
    try:
        import openai
        if isinstance(exc, openai.RateLimitError):
            return True
        if isinstance(exc, openai.InternalServerError):
            return True
    except ImportError:
        pass
    return False


def _rate_limit_aware_wait(retry_state) -> float:
    """Use retry-after header when available, otherwise exponential backoff."""
    exc = retry_state.outcome.exception()
    if exc is not None:
        retry_after = _extract_retry_after(exc)
        if retry_after is not None and retry_after > 0:
            # Cap at 120s to avoid infinite waits from buggy headers
            return min(retry_after, 120.0)
    # Fall back to exponential jitter for non-rate-limit errors
    return wait_exponential_jitter(initial=2, max=30)(retry_state)


_ai_retry = retry(
    retry=retry_if_exception(_is_retryable),
    stop=stop_after_attempt(4),  # 1 initial + 3 retries
    wait=_rate_limit_aware_wait,
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True,
)


def _resolve_ollama_url(url: str) -> str:
    """Rewrite localhost URLs to host.docker.internal when running in Docker."""
    if os.path.exists("/.dockerenv"):
        return url.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal")
    return url


# 国内 provider 复用 OpenAI 兼容协议（PRD M3）：中文能力强、国内网络可达。
# 它们与 openai/google/openrouter 共用同一条请求路径，无需额外依赖。
OPENAI_COMPAT_PROVIDERS = {
    "deepseek": {
        "base_url": "https://api.deepseek.com/v1",
        "default_model": "deepseek-chat",
    },
    "qwen": {
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "default_model": "qwen-plus",
    },
    "kimi": {
        "base_url": "https://api.moonshot.cn/v1",
        "default_model": "moonshot-v1-32k",
    },
    "zhipu": {
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "default_model": "glm-4-plus",
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o",
    },
    "google": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "default_model": "gemini-2.0-flash",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "default_model": "anthropic/claude-sonnet-4",
    },
}

# 国内 provider 排在前面：设置页的选项顺序即新用户的默认选择（DeepSeek 优先）
ALL_PROVIDERS = [
    "deepseek", "qwen", "kimi", "zhipu", "ollama",
    "anthropic", "openai", "google", "openrouter", "bedrock",
]

# 申请密钥入口（PRD M3：设置页每个 provider 提供申请入口链接）
PROVIDER_APPLY_URLS = {
    "deepseek": "https://platform.deepseek.com/api_keys",
    "qwen": "https://bailian.console.aliyun.com/",
    "kimi": "https://platform.moonshot.cn/console/api-keys",
    "zhipu": "https://open.bigmodel.cn/usercenter/apikeys",
    "openai": "https://platform.openai.com/api-keys",
    "anthropic": "https://console.anthropic.com/settings/keys",
    "google": "https://aistudio.google.com/app/apikey",
    "openrouter": "https://openrouter.ai/keys",
    "ollama": "https://ollama.com/download",
}


def provider_defaults() -> dict[str, dict[str, str]]:
    """设置页预填数据：Base URL、默认模型名与申请密钥入口（单一数据源）。"""
    defaults: dict[str, dict[str, str]] = {
        key: {
            "base_url": cfg["base_url"],
            "default_model": cfg["default_model"],
            "apply_url": PROVIDER_APPLY_URLS.get(key, ""),
        }
        for key, cfg in OPENAI_COMPAT_PROVIDERS.items()
    }
    defaults["ollama"] = {
        "base_url": "http://localhost:11434",
        "default_model": "qwen2.5:14b",
        "apply_url": PROVIDER_APPLY_URLS["ollama"],
    }
    defaults["anthropic"] = {
        "base_url": "",
        "default_model": "claude-sonnet-4-20250514",
        "apply_url": PROVIDER_APPLY_URLS["anthropic"],
    }
    defaults["bedrock"] = {
        "base_url": "",
        "default_model": "us.anthropic.claude-sonnet-4-6",
        "apply_url": "",
    }
    return defaults


# 连通性测试失败原因码（PRD M3）：前端按 reason 映射为中文原因
AI_ERROR_REASONS = ("invalid_key", "quota_exceeded", "model_not_found", "unreachable", "unknown")


def classify_ai_error(exc: BaseException) -> str:
    """把各 provider 的原始报错归类为可翻译的稳定原因码。"""
    status = getattr(exc, "status_code", None)  # openai/anthropic 异常自带 status_code
    if status is None:
        status = getattr(getattr(exc, "response", None), "status_code", None)
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
    text = f"{exc}".lower()
    invalid_key_markers = (
        "invalid_api_key", "invalid api key", "incorrect api key", "api key not valid",
        "authentication", "unauthorized", "permission denied",
    )
    if status in (401, 403) or any(marker in text for marker in invalid_key_markers):
        return "invalid_key"
    if status == 402 or "insufficient" in text or "quota" in text or "balance" in text:
        return "quota_exceeded"
    if status == 404 or "model_not_found" in text or "does not exist" in text or "unknown model" in text:
        return "model_not_found"
    if isinstance(exc, httpx.TransportError) or "connection" in text or "timeout" in text or "unreachable" in text:
        return "unreachable"
    return "unknown"


AI_PROBE_TIMEOUT_SEC = 5.0


async def check_ai_reachable(client: "AIClient",
                             timeout: float = AI_PROBE_TIMEOUT_SEC) -> tuple[bool, str]:
    """Quick connectivity check for the configured AI provider. Returns (reachable, detail).

    必须有超时：这里调的是各家 SDK，而 OpenAI 兼容 SDK（国内四家都走这条路）默认
    超时 600 秒、默认重试 2 次 —— 供应商网络不顺时，一个 `/api/health` 就会挂着近
    半小时。健康检查在**请求路径**上（`GET /api/health`，扩展的弹窗也在调），
    探测卡住会让用户以为整个服务死了。
    """
    try:
        return await asyncio.wait_for(_check_ai_reachable(client), timeout=timeout)
    except asyncio.TimeoutError:
        return False, f"{client.provider} timed out after {timeout:.0f}s"


async def _check_ai_reachable(client: "AIClient") -> tuple[bool, str]:
    try:
        if client.provider == "ollama":
            url = f"{_resolve_ollama_url(client.base_url).rstrip('/')}/api/tags"
            async with httpx.AsyncClient(timeout=5.0) as http:
                resp = await http.get(url)
                resp.raise_for_status()
            return True, "ok"
        elif client.provider == "anthropic":
            import anthropic
            c = anthropic.AsyncAnthropic(api_key=client.api_key)
            await c.messages.create(
                model=client.model, max_tokens=1,
                messages=[{"role": "user", "content": "hi"}],
            )
            return True, "ok"
        elif client.provider == "bedrock":
            c = client._bedrock_client()
            await c.messages.create(
                model=client.model, max_tokens=1,
                messages=[{"role": "user", "content": "hi"}],
            )
            return True, "ok"
        elif client.provider in OPENAI_COMPAT_PROVIDERS:
            from openai import AsyncOpenAI
            c = AsyncOpenAI(api_key=client.api_key, base_url=client.base_url)
            await c.models.list()
            return True, "ok"
        return False, f"Unknown provider: {client.provider}"
    except httpx.ConnectError:
        return False, f"{client.provider} unreachable at {client.base_url}"
    except httpx.HTTPStatusError as e:
        return False, f"{client.provider} returned HTTP {e.response.status_code}"
    except Exception as e:
        logger.debug("AI health check failed: %s", e)
        return False, f"{client.provider} error: {type(e).__name__}"


class AIClient:
    """Unified async AI client supporting Anthropic, Ollama, OpenAI, Google, and OpenRouter."""

    def __init__(self, provider: str, api_key: str = "", model: str = "",
                 base_url: str = "", region: str = ""):
        self.provider = provider
        self.api_key = api_key
        self.region = region
        self.model = model or self._default_model()
        self.base_url = base_url or self._default_base_url()

    def _default_model(self):
        if self.provider == "anthropic":
            return "claude-sonnet-4-20250514"
        if self.provider == "bedrock":
            return "us.anthropic.claude-sonnet-4-6"
        if self.provider == "ollama":
            return "qwen2.5:14b"
        if self.provider in OPENAI_COMPAT_PROVIDERS:
            return OPENAI_COMPAT_PROVIDERS[self.provider]["default_model"]
        return ""

    def _default_base_url(self):
        if self.provider == "ollama":
            return "http://localhost:11434"
        if self.provider in OPENAI_COMPAT_PROVIDERS:
            return OPENAI_COMPAT_PROVIDERS[self.provider]["base_url"]
        return ""

    async def chat(self, prompt: str, max_tokens: int = 1024, timeout: float = 300.0) -> str:
        service = f"ai:{self.provider}"
        if _ai_breaker.is_open(service):
            raise RuntimeError(f"Circuit breaker open for {service}")
        try:
            result = await asyncio.wait_for(
                self._chat_with_retry(prompt, max_tokens),
                timeout=timeout,
            )
            _ai_breaker.record_success(service)
            return result
        except asyncio.TimeoutError:
            _ai_breaker.record_failure(service)
            raise RuntimeError(f"AI request timed out after {timeout}s for {service}")
        except ValueError:
            raise
        except RuntimeError:
            raise
        except Exception:
            _ai_breaker.record_failure(service)
            raise

    @_ai_retry
    async def _chat_with_retry(self, prompt: str, max_tokens: int) -> str:
        if self.provider == "anthropic":
            return await self._anthropic_chat(prompt, max_tokens)
        elif self.provider == "bedrock":
            return await self._bedrock_chat(prompt, max_tokens)
        elif self.provider == "ollama":
            return await self._ollama_chat(prompt, max_tokens)
        elif self.provider in OPENAI_COMPAT_PROVIDERS:
            return await self._openai_chat(prompt, max_tokens)
        else:
            raise ValueError(f"Unknown provider: {self.provider}")

    async def _anthropic_chat(self, prompt: str, max_tokens: int) -> str:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=self.api_key)
        message = await client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text

    def _bedrock_client(self):
        import anthropic
        kwargs = {"aws_region": self.region or "us-east-1"}
        if self.api_key:
            kwargs["aws_access_key"] = self.api_key
        if self.base_url:
            kwargs["aws_secret_key"] = self.base_url
        return anthropic.AsyncAnthropicBedrock(**kwargs)

    async def _bedrock_chat(self, prompt: str, max_tokens: int) -> str:
        client = self._bedrock_client()
        message = await client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text

    async def _openai_chat(self, prompt: str, max_tokens: int) -> str:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)
        response = await client.chat.completions.create(
            model=self.model,
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.choices[0].message.content or ""

    async def _ollama_chat(self, prompt: str, max_tokens: int) -> str:
        url = f"{_resolve_ollama_url(self.base_url).rstrip('/')}/api/chat"
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "options": {"num_predict": max_tokens},
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            if "error" in data:
                raise RuntimeError(f"Ollama error: {data['error']}")
            try:
                return data["message"]["content"]
            except (KeyError, TypeError) as e:
                raise RuntimeError(f"Unexpected Ollama response structure: {e}") from e


def parse_json_response(raw: str) -> dict:
    """Extract and parse JSON from an AI response.

    Handles markdown code fences, leading/trailing prose, and (as a last
    resort) truncated responses from a max_tokens cut-off by finding the
    outermost balanced ``{...}`` and trimming any unterminated trailing
    string/array before attempting to load.
    """
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        raw = raw.rsplit("```", 1)[0]
        raw = raw.strip()

    # Find the first top-level container — either an object or an array.
    obj_start = raw.find("{")
    arr_start = raw.find("[")
    if obj_start == -1 and arr_start == -1:
        raise json.JSONDecodeError("no JSON object or array found", raw, 0)
    if obj_start == -1:
        start = arr_start
    elif arr_start == -1:
        start = obj_start
    else:
        start = min(obj_start, arr_start)
    top_level = raw[start]  # '{' or '['

    stack: list[str] = []  # open '{' and '[' in order
    in_string = False
    escape = False
    end = -1
    for i in range(start, len(raw)):
        ch = raw[i]
        if escape:
            escape = False
            continue
        if ch == "\\" and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{" or ch == "[":
            stack.append(ch)
        elif ch == "}" and stack and stack[-1] == "{":
            stack.pop()
            if not stack:
                end = i + 1
                break
        elif ch == "]" and stack and stack[-1] == "[":
            stack.pop()
            if not stack:
                end = i + 1
                break

    if end != -1:
        candidate = raw[start:end]
    else:
        # Truncated mid-object — best-effort repair: close any open string,
        # drop the trailing incomplete token, and close open containers.
        candidate = raw[start:]
        if in_string:
            candidate += '"'
        # Drop a trailing partial key/value/number (anything after the last
        # delimiter that might be incomplete)
        candidate = re.sub(r",\s*[^,{}\[\]]*$", "", candidate.rstrip())
        candidate = candidate.rstrip().rstrip(",")
        for opener in reversed(stack):
            candidate += "}" if opener == "{" else "]"

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        # Aggressive second-chance: strip the last incomplete field before
        # the closing braces and retry.
        trimmed = re.sub(r',\s*"[^"]*"\s*:\s*[^,}\]]*(?=[}\]]+$)', "", candidate)
        return json.loads(trimmed)
