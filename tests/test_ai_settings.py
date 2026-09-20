import asyncio
import time

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.database import Database


@pytest_asyncio.fixture
async def db(tmp_path):
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    yield database
    await database.close()


@pytest_asyncio.fixture
async def client(tmp_path):
    from app.main import create_app
    app = create_app(db_path=str(tmp_path / "test_settings.db"), testing=True)
    database = Database(str(tmp_path / "test_settings.db"))
    await database.init()
    app.state.db = database
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await database.close()


@pytest.mark.asyncio
async def test_ai_settings_default_none(db):
    result = await db.get_ai_settings()
    assert result is None


@pytest.mark.asyncio
async def test_save_and_get_ai_settings(db):
    await db.save_ai_settings("anthropic", "sk-test-key", "claude-sonnet-4-20250514", "")
    result = await db.get_ai_settings()
    assert result["provider"] == "anthropic"
    assert result["api_key"] == "sk-test-key"
    assert result["model"] == "claude-sonnet-4-20250514"
    assert result["base_url"] == ""


@pytest.mark.asyncio
async def test_save_ollama_settings(db):
    await db.save_ai_settings("ollama", "", "llama3", "http://localhost:11434")
    result = await db.get_ai_settings()
    assert result["provider"] == "ollama"
    assert result["api_key"] == ""
    assert result["model"] == "llama3"
    assert result["base_url"] == "http://localhost:11434"


@pytest.mark.asyncio
async def test_update_ai_settings(db):
    await db.save_ai_settings("anthropic", "key1", "model1", "")
    await db.save_ai_settings("ollama", "", "llama3", "http://localhost:11434")
    result = await db.get_ai_settings()
    assert result["provider"] == "ollama"
    assert result["model"] == "llama3"


@pytest.mark.asyncio
async def test_save_bedrock_settings(db):
    await db.save_ai_settings(
        "bedrock", "AKIAIOSFODNN7EXAMPLE",
        "us.anthropic.claude-sonnet-4-6", "",
        region="us-west-2",
    )
    result = await db.get_ai_settings()
    assert result["provider"] == "bedrock"
    assert result["api_key"] == "AKIAIOSFODNN7EXAMPLE"
    assert result["model"] == "us.anthropic.claude-sonnet-4-6"
    assert result["region"] == "us-west-2"


@pytest.mark.asyncio
async def test_bedrock_region_default_empty(db):
    await db.save_ai_settings("bedrock", "", "us.anthropic.claude-sonnet-4-6", "")
    result = await db.get_ai_settings()
    assert result["region"] == ""


@pytest.mark.asyncio
async def test_update_region_preserves_on_overwrite(db):
    await db.save_ai_settings("bedrock", "key1", "model1", "", region="us-east-1")
    await db.save_ai_settings("bedrock", "key2", "model2", "", region="eu-west-1")
    result = await db.get_ai_settings()
    assert result["region"] == "eu-west-1"
    assert result["api_key"] == "key2"


@pytest.mark.asyncio
async def test_region_column_exists_after_migration(db):
    """Verify the region column exists in ai_settings table."""
    await db.save_ai_settings("anthropic", "key", "model", "")
    result = await db.get_ai_settings()
    assert "region" in result


@pytest.mark.asyncio
async def test_bedrock_secret_key_stored_in_base_url(db):
    """Bedrock stores AWS secret key in base_url column — verify it persists."""
    await db.save_ai_settings(
        "bedrock", "AKIAIOSFODNN7EXAMPLE",
        "us.anthropic.claude-sonnet-4-6",
        "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        region="us-east-1",
    )
    result = await db.get_ai_settings()
    assert result["api_key"] == "AKIAIOSFODNN7EXAMPLE"
    assert result["base_url"] == "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"


# --- API-level secret masking tests ---

@pytest.mark.asyncio
async def test_bedrock_secrets_masked_in_get_response(client):
    """GET /api/ai-settings must not expose AWS secret key for Bedrock."""
    secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    access_key = "AKIAIOSFODNN7EXAMPLE"
    await client.post("/api/ai-settings", json={
        "provider": "bedrock",
        "api_key": access_key,
        "base_url": secret,
        "model": "us.anthropic.claude-sonnet-4-6",
        "region": "us-east-1",
    })
    resp = await client.get("/api/ai-settings")
    data = resp.json()
    assert data["provider"] == "bedrock"
    # Access key must be masked
    assert access_key not in data["api_key"]
    assert data["api_key"].startswith("****")
    # Secret key must be masked (stored in base_url)
    assert secret not in data["base_url"]
    assert data["base_url"].startswith("****")
    assert data["has_secret"] is True


@pytest.mark.asyncio
async def test_non_bedrock_base_url_not_masked(client):
    """GET /api/ai-settings must NOT mask base_url for non-Bedrock providers."""
    await client.post("/api/ai-settings", json={
        "provider": "ollama",
        "api_key": "",
        "base_url": "http://localhost:11434",
        "model": "llama3",
    })
    resp = await client.get("/api/ai-settings")
    data = resp.json()
    assert data["base_url"] == "http://localhost:11434"
    assert data.get("has_secret") is None


@pytest.mark.asyncio
async def test_bedrock_masked_credentials_retained_on_save(client):
    """POST with masked credentials should retain existing secrets."""
    await client.post("/api/ai-settings", json={
        "provider": "bedrock",
        "api_key": "AKIAIOSFODNN7EXAMPLE",
        "base_url": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        "model": "us.anthropic.claude-sonnet-4-6",
        "region": "us-east-1",
    })
    # Re-save with masked values (as UI would send)
    await client.post("/api/ai-settings", json={
        "provider": "bedrock",
        "api_key": "****MPLE",
        "base_url": "****EKEY",
        "model": "us.anthropic.claude-sonnet-4-6",
        "region": "us-west-2",
    })
    # Verify secrets were retained, not overwritten with masked values
    resp = await client.get("/api/ai-settings")
    data = resp.json()
    assert data["region"] == "us-west-2"
    assert data["has_key"] is True
    assert data["has_secret"] is True


@pytest.mark.asyncio
async def test_ai_probe_has_a_timeout(monkeypatch):
    """连通性探测必须有超时：它在请求路径上（/api/health），而各家 SDK 的默认
    超时是 600 秒（OpenAI 兼容还带 2 次重试）—— 探测一挂，用户看到的就是
    「服务死了」。"""
    from app import ai_client as mod

    async def never_returns(_client):
        await asyncio.sleep(3600)
        return True, "ok"

    monkeypatch.setattr(mod, "_check_ai_reachable", never_returns)

    started = time.monotonic()
    reachable, detail = await mod.check_ai_reachable(
        mod.AIClient("deepseek", api_key="k"), timeout=0.05
    )
    elapsed = time.monotonic() - started

    assert reachable is False
    assert "timed out" in detail
    assert elapsed < 2


@pytest.mark.asyncio
async def test_health_reports_a_hung_provider_without_hanging(monkeypatch, tmp_path):
    """健康检查要给出结论（unreachable），而不是挂着不返回。"""
    from app import ai_client as mod
    from app.main import create_app

    async def never_returns(_client):
        await asyncio.sleep(3600)
        return True, "ok"

    monkeypatch.setattr(mod, "_check_ai_reachable", never_returns)
    monkeypatch.setattr(mod, "AI_PROBE_TIMEOUT_SEC", 0.05)

    db_path = str(tmp_path / "probe.db")
    app = create_app(db_path=db_path, testing=True)
    database = Database(db_path)
    await database.init()
    app.state.db = database
    try:
        app.state.ai_client = mod.AIClient("deepseek", api_key="k")
        app.state.start_time = time.monotonic()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get("/api/health")
        body = resp.json()
        assert body["ai_status"] == "unreachable"
        assert "timed out" in body["ai_detail"]
    finally:
        await database.close()
