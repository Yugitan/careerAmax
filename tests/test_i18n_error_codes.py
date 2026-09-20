"""Contract tests for the i18n error codes (docs/i18n.md).

User-visible backend errors must not depend on English strings: an endpoint
returns a stable `code` plus `params` so any client can translate it, and keeps
a non-localized `detail` for logs and older clients.
"""

import re
from pathlib import Path

import pytest

from app.errors import ERROR_MESSAGES, AppError, render_detail

ROUTERS_DIR = Path(__file__).resolve().parent.parent / "app" / "routers"


def _router_sources() -> dict[str, str]:
    return {path.name: path.read_text(encoding="utf-8") for path in ROUTERS_DIR.glob("*.py")}


def _app_error_codes() -> set[str]:
    codes: set[str] = set()
    for source in _router_sources().values():
        codes.update(re.findall(r'AppError\(\s*"([a-z0-9_.]+)"', source))
    return codes


class TestErrorPayload:
    def test_payload_shape(self):
        error = AppError("resume.not_found", status_code=404)
        assert error.to_payload() == {
            "code": "resume.not_found",
            "params": {},
            "detail": "Resume not found",
        }

    def test_params_are_interpolated_into_the_english_fallback(self):
        error = AppError("job.invalid_event_type", status_code=400, params={"event_type": "nope"})
        assert error.params == {"event_type": "nope"}
        assert error.detail == "Invalid event_type: nope"

    def test_explicit_detail_is_kept_for_dynamic_messages(self):
        error = AppError("ai.generation_failed", status_code=502,
                         params={"error": "upstream 502"}, detail="upstream 502 boom")
        assert error.detail == "upstream 502 boom"

    def test_unknown_code_falls_back_to_the_code_itself(self):
        assert render_detail("totally.unknown") == "totally.unknown"
        assert AppError("totally.unknown").detail == "totally.unknown"

    def test_missing_placeholder_is_left_visible(self):
        assert render_detail("job.invalid_event_type") == "Invalid event_type: {event_type}"

    def test_every_code_is_namespaced_and_lowercase(self):
        bad = [code for code in ERROR_MESSAGES if not re.fullmatch(r"[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+", code)]
        assert bad == []

    def test_codes_are_unique(self):
        source = (Path(__file__).resolve().parent.parent / "app" / "errors.py").read_text(encoding="utf-8")
        codes = re.findall(r'^\s{4}"([a-z0-9_.]+)":', source, flags=re.M)
        assert len(codes) == len(set(codes))


class TestRouterMigration:
    def test_no_user_visible_http_exception_strings_remain(self):
        offenders = []
        for name, source in _router_sources().items():
            for match in re.finditer(r"HTTPException\(", source):
                line_no = source[: match.start()].count("\n") + 1
                offenders.append(f"{name}:{line_no}")
        assert offenders == []

    def test_neutral_exception_class_is_no_longer_used_by_routers(self):
        for name, source in _router_sources().items():
            assert "raise HTTPException" not in source, name

    def test_every_raised_code_exists_in_the_catalog(self):
        unknown = sorted(code for code in _app_error_codes() if code not in ERROR_MESSAGES)
        assert unknown == []

    def test_no_catalog_entry_is_dead(self):
        # Codes may be raised from app modules other than routers (payload-level
        # codes such as autofill.*), so only require that catalog entries are used
        # somewhere in app/.
        app_dir = Path(__file__).resolve().parent.parent / "app"
        used: set[str] = set()
        for path in app_dir.rglob("*.py"):
            used.update(re.findall(r'"([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)"', path.read_text(encoding="utf-8")))
        dead = sorted(code for code in ERROR_MESSAGES if code not in used)
        assert dead == []


@pytest.mark.asyncio
class TestEndpointContract:
    async def test_missing_job_returns_a_code(self, client):
        resp = await client.get("/api/jobs/999999")
        assert resp.status_code == 404
        body = resp.json()
        assert body["code"] == "job.not_found"
        assert body["params"] == {}
        # Non-localized fallback stays available for logs and curl.
        assert body["detail"] == "Job not found"

    async def test_validation_error_returns_params(self, client):
        resp = await client.post("/api/jobs/1/events", json={"detail": "hi", "event_type": "nope"})
        assert resp.status_code in (400, 404)
        body = resp.json()
        assert body["code"] in {"job.invalid_event_type", "job.not_found"}
        if body["code"] == "job.invalid_event_type":
            assert body["params"] == {"event_type": "nope"}
            assert body["detail"] == "Invalid event_type: nope"

    async def test_missing_resume_returns_a_code(self, client):
        resp = await client.delete("/api/resumes/999999")
        assert resp.status_code == 404
        assert resp.json()["code"] == "resume.not_found"

    async def test_ai_dependent_endpoint_reports_a_missing_provider(self, client):
        resp = await client.post("/api/jobs/999999/prepare")
        body = resp.json()
        # Either the job or the AI provider is missing first — both are coded.
        assert body["code"] in {"job.not_found", "ai.not_configured", "resume.missing"}

    async def test_scrape_conflict_keeps_its_machine_readable_payload(self, client, app):
        app.state.scrape_progress = {"active": True, "phase": "scraping", "task_id": "t1"}
        try:
            resp = await client.post("/api/scrape")
            assert resp.status_code == 409
            assert resp.json()["error"] == "scrape_already_running"
        finally:
            app.state.scrape_progress = None

    async def test_scrape_without_server_scrapers_returns_coded_error(self, client):
        # 中国版没有服务端爬虫，「立即抓取」必须返回可翻译错误码，
        # 而不是空转一次后报告抓到 0 条。
        resp = await client.post("/api/scrape")
        assert resp.status_code == 409
        body = resp.json()
        assert body["code"] == "scrape.no_server_scrapers"
        assert body["params"] == {}

    async def test_translated_application_status_is_rejected(self, client):
        """状态值必须是稳定英文枚举；中文界面把翻译结果当 value 提交时，
        必须返回可翻译的错误码而不是把「已申请」静默写进数据库。"""
        resp = await client.post("/api/jobs/1/application", params={"status": "已申请"})
        assert resp.status_code == 400
        body = resp.json()
        assert body["code"] == "job.invalid_status"
        assert body["params"]["status"] == "已申请"
