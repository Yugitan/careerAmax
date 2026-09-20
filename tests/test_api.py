import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient, ASGITransport

from app.database import Database


@pytest.fixture
async def app(tmp_path):
    from app.main import create_app
    application = create_app(db_path=str(tmp_path / "test.db"), testing=True)
    db = Database(str(tmp_path / "test.db"))
    await db.init()
    application.state.db = db
    application.state.embedding_client = None
    yield application
    await db.close()


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_static_assets_must_revalidate(tmp_path):
    """前端脚本必须每次回源校验。

    没有 Cache-Control 时，浏览器会按启发式规则自行缓存 JS，升级后就会出现
    「新的 app.js + 旧的 api.js」的错配（用户看到 `api.xxx is not a function`，
    而服务端文件其实是新的）。
    """
    from starlette.applications import Starlette

    from app.main import NoCacheStaticFiles

    static_dir = tmp_path / "static"
    (static_dir / "js").mkdir(parents=True)
    (static_dir / "js" / "api.js").write_text("const api = {};\n", encoding="utf-8")

    mounted = Starlette()
    mounted.mount("/static", NoCacheStaticFiles(directory=str(static_dir)), name="static")
    transport = ASGITransport(app=mounted)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/static/js/api.js")

    assert resp.status_code == 200
    assert "no-cache" in resp.headers["cache-control"]
    # 回源校验依然会命中 ETag（304），所以这不增加流量
    assert resp.headers.get("etag")


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert data["db"] == "ok"
    assert data["scheduler"] in ("running", "stopped", "not_configured")
    assert "ai_provider" in data
    assert "ai_configured" in data
    assert "last_scrape" in data
    assert "uptime_seconds" in data


@pytest.mark.asyncio
async def test_list_jobs_empty(client):
    resp = await client.get("/api/jobs")
    assert resp.status_code == 200
    assert resp.json()["jobs"] == []


@pytest.mark.asyncio
async def test_get_stats(client):
    resp = await client.get("/api/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "total_jobs" in data
    assert "total_scored" in data
    assert "total_applied" in data


@pytest.mark.asyncio
async def test_get_job_not_found(client):
    resp = await client.get("/api/jobs/999")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_trigger_scrape(client, monkeypatch):
    # 中国版 ALL_SCRAPERS 为空，trigger_scrape 返回可翻译的 409 错误码
    # （流水线状态机的行为由 test_scrape_robust.py 用假爬虫覆盖）。
    from app.routers import scraping as scraping_router

    class _FakeScraper:
        source_name = "fake"

        def __init__(self, *args, **kwargs):
            pass

        async def scrape(self):
            return []

    monkeypatch.setattr(scraping_router, "ALL_SCRAPERS", [_FakeScraper], raising=True)
    resp = await client.post("/api/scrape")
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "started"
    assert isinstance(body["task_id"], str) and body["task_id"]


@pytest.mark.asyncio
async def test_dismiss_job_not_found(client):
    resp = await client.post("/api/jobs/999/dismiss")
    assert resp.status_code in [200, 404]


@pytest.mark.asyncio
async def test_prepare_not_found(client):
    resp = await client.post("/api/jobs/999/prepare")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_prepare_no_tailor(client, app):
    db = app.state.db
    job_id = await db.insert_job(
        title="Engineer", company="Acme", location="Remote",
        salary_min=150000, salary_max=200000,
        description="Build things", url="https://example.com/job1",
        posted_date="2026-01-01", application_method="url",
        contact_email=None,
    )
    app.state.tailor = None
    resp = await client.post(f"/api/jobs/{job_id}/prepare")
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_prepare_with_mock_tailor(client, app):
    db = app.state.db
    job_id = await db.insert_job(
        title="Engineer", company="Acme", location="Remote",
        salary_min=150000, salary_max=200000,
        description="Build things", url="https://example.com/job2",
        posted_date="2026-01-01", application_method="url",
        contact_email=None,
    )
    await db.insert_score(
        job_id, 85, ["Good skills match"], ["No concerns"], ["Python", "AWS"],
    )

    mock_tailor = MagicMock()
    mock_tailor.prepare = AsyncMock(return_value={
        "tailored_resume": "Tailored resume text",
        "cover_letter": "Dear hiring manager...",
    })
    app.state.tailor = mock_tailor

    resp = await client.post(f"/api/jobs/{job_id}/prepare")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "prepared"
    assert data["tailored_resume"] == "Tailored resume text"
    assert data["cover_letter"] == "Dear hiring manager..."

    mock_tailor.prepare.assert_called_once_with(
        job_description="Build things",
        match_reasons=["Good skills match"],
        suggested_keywords=["Python", "AWS"],
        resume_text=None,
    )

    application = await db.get_application(job_id)
    assert application is not None
    assert application["status"] == "prepared"
    assert application["tailored_resume"] == "Tailored resume text"


@pytest.mark.asyncio
async def test_email_no_job(client):
    resp = await client.post("/api/jobs/999/email")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_email_no_cover_letter(client, app):
    db = app.state.db
    job_id = await db.insert_job(
        title="Engineer", company="Acme", location="Remote",
        salary_min=150000, salary_max=200000,
        description="Build things", url="https://example.com/job3",
        posted_date="2026-01-01", application_method="url",
        contact_email="hr@acme.com",
    )
    resp = await client.post(f"/api/jobs/{job_id}/email")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_email_success(client, app):
    db = app.state.db
    job_id = await db.insert_job(
        title="Engineer", company="Acme", location="Remote",
        salary_min=150000, salary_max=200000,
        description="Build things", url="https://example.com/job4",
        posted_date="2026-01-01", application_method="email",
        contact_email="hr@acme.com",
    )
    app_id = await db.insert_application(job_id, "prepared")
    await db.update_application(app_id, cover_letter="Dear hiring manager...")

    resp = await client.post(f"/api/jobs/{job_id}/email")
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"]["to"] == "hr@acme.com"
    assert "Engineer" in data["email"]["subject"]


@pytest.mark.asyncio
async def test_email_no_contact(client, app):
    db = app.state.db
    job_id = await db.insert_job(
        title="Engineer", company="Acme", location="Remote",
        salary_min=150000, salary_max=200000,
        description="Build things", url="https://example.com/job5",
        posted_date="2026-01-01", application_method="url",
        contact_email=None,
    )
    app_id = await db.insert_application(job_id, "prepared")
    await db.update_application(app_id, cover_letter="Dear hiring manager...")

    resp = await client.post(f"/api/jobs/{job_id}/email")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_get_search_config_empty(client):
    resp = await client.get("/api/search-config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["search_terms"] == []
    assert data["resume_text"] == ""


@pytest.mark.asyncio
async def test_update_search_terms(client, app):
    db = app.state.db
    await db.save_search_config("resume", ["old"])
    resp = await client.post("/api/search-config/terms", json={"search_terms": ["devops remote", "SRE"]})
    assert resp.status_code == 200
    assert resp.json()["search_terms"] == ["devops remote", "SRE"]

    config = await db.get_search_config()
    assert config["search_terms"] == ["devops remote", "SRE"]


@pytest.mark.asyncio
async def test_add_event(client, app):
    db = app.state.db
    job_id = await db.insert_job(
        title="Engineer", company="Acme", location="Remote",
        salary_min=150000, salary_max=200000,
        description="Build things", url="https://example.com/job-event",
        posted_date="2026-01-01", application_method="url",
        contact_email=None,
    )
    resp = await client.post(f"/api/jobs/{job_id}/events", json={"detail": "Looks great"})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    resp = await client.get(f"/api/jobs/{job_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert "events" in data
    assert len(data["events"]) == 1
    assert data["events"][0]["event_type"] == "note"
    assert data["events"][0]["detail"] == "Looks great"


@pytest.mark.asyncio
async def test_add_event_with_type(client, app):
    db = app.state.db
    job_id = await db.insert_job(
        title="Engineer", company="Acme", location="Remote",
        salary_min=150000, salary_max=200000,
        description="Build things", url="https://example.com/job-event-type",
        posted_date="2026-01-01", application_method="url",
        contact_email=None,
    )
    call_detail = '{"who": "Jane", "duration": "15 min", "notes": "Discussed role"}'
    resp = await client.post(f"/api/jobs/{job_id}/events", json={"detail": call_detail, "event_type": "call"})
    assert resp.status_code == 200

    resp = await client.get(f"/api/jobs/{job_id}")
    data = resp.json()
    assert data["events"][0]["event_type"] == "call"
    assert "Jane" in data["events"][0]["detail"]


@pytest.mark.asyncio
async def test_add_event_invalid_type(client, app):
    db = app.state.db
    job_id = await db.insert_job(
        title="Engineer", company="Acme", location="Remote",
        salary_min=150000, salary_max=200000,
        description="Build things", url="https://example.com/job-event-bad-type",
        posted_date="2026-01-01", application_method="url",
        contact_email=None,
    )
    resp = await client.post(f"/api/jobs/{job_id}/events", json={"detail": "test", "event_type": "invalid"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_add_event_empty_detail(client, app):
    db = app.state.db
    job_id = await db.insert_job(
        title="Engineer", company="Acme", location="Remote",
        salary_min=150000, salary_max=200000,
        description="Build things", url="https://example.com/job-event-empty",
        posted_date="2026-01-01", application_method="url",
        contact_email=None,
    )
    resp = await client.post(f"/api/jobs/{job_id}/events", json={"detail": ""})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_status_change_creates_event(client, app):
    db = app.state.db
    job_id = await db.insert_job(
        title="Engineer", company="Acme", location="Remote",
        salary_min=150000, salary_max=200000,
        description="Build things", url="https://example.com/job-status-event",
        posted_date="2026-01-01", application_method="url",
        contact_email=None,
    )
    resp = await client.post(f"/api/jobs/{job_id}/application?status=applied")
    assert resp.status_code == 200

    events = await db.get_events(job_id)
    assert len(events) == 1
    assert events[0]["event_type"] == "status_change"
    assert "applied" in events[0]["detail"]


@pytest.mark.asyncio
async def test_profile_crud(client):
    # GET should return empty profile
    resp = await client.get("/api/profile")
    assert resp.status_code == 200
    data = resp.json()
    assert data["full_name"] == ""

    # POST to save
    resp = await client.post("/api/profile", json={"full_name": "Test User", "email": "test@x.com"})
    assert resp.status_code == 200

    # GET to verify
    resp = await client.get("/api/profile")
    data = resp.json()
    assert data["full_name"] == "Test User"
    assert data["email"] == "test@x.com"


@pytest.mark.asyncio
async def test_export_csv(client, app):
    from app.database import make_dedup_hash
    db = app.state.db
    dedup = make_dedup_hash("Dev", "Co", "http://x")
    await db.db.execute(
        """INSERT INTO jobs (title, company, location, url, dedup_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        ("Dev", "Co", "Remote", "http://x", dedup, "2026-01-01")
    )
    await db.db.commit()

    resp = await client.get("/api/export/csv")
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
    content = resp.text
    assert "Title" in content
    assert "Dev" in content


@pytest.mark.asyncio
async def test_upload_resume_no_client(client, app):
    app.state._anthropic_client = None
    app.state.testing = True
    import io
    files = {"file": ("resume.txt", io.BytesIO(b"My resume content"), "text/plain")}
    resp = await client.post("/api/resume/upload", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["resume_length"] == len("My resume content")
    assert data["search_terms"] == []


@pytest.mark.asyncio
async def test_upload_resume_pdf(client, app):
    app.state._anthropic_client = None
    app.state.testing = True
    import fitz
    import io
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Senior DevOps Engineer Resume")
    pdf_bytes = doc.tobytes()
    doc.close()
    files = {"file": ("resume.pdf", io.BytesIO(pdf_bytes), "application/pdf")}
    resp = await client.post("/api/resume/upload", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["resume_length"] > 0


@pytest.mark.asyncio
async def test_upload_resume_docx_extracts_paragraphs_and_tables(client, app):
    """中文简历常用 DOCX（含表格排版），必须真解析出文字而不是二进制乱码。"""
    app.state._anthropic_client = None
    app.state.testing = True
    import io
    from docx import Document

    document = Document()
    document.add_paragraph("张三 后端工程师")
    table = document.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "手机"
    table.rows[0].cells[1].text = "13800138000"
    buffer = io.BytesIO()
    document.save(buffer)

    files = {
        "file": (
            "resume.docx",
            buffer.getvalue(),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    }
    resp = await client.post("/api/resume/upload", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["resume_length"] == len("张三 后端工程师\n手机\t13800138000")


@pytest.mark.asyncio
async def test_upload_resume_rejects_legacy_doc(client, app):
    app.state._anthropic_client = None
    app.state.testing = True
    import io

    files = {"file": ("resume.doc", io.BytesIO(b"\xd0\xcf\x11\xe0binary"), "application/msword")}
    resp = await client.post("/api/resume/upload", files=files)
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == "resume.legacy_format"
    assert body["params"] == {"ext": ".doc"}


@pytest.mark.asyncio
async def test_upload_resume_rejects_image_only_pdf(client, app):
    app.state._anthropic_client = None
    app.state.testing = True
    import fitz
    import io

    doc = fitz.open()
    doc.new_page()  # 空白页 = 无文本层（扫描件）
    pdf_bytes = doc.tobytes()
    doc.close()
    files = {"file": ("scan.pdf", io.BytesIO(pdf_bytes), "application/pdf")}
    resp = await client.post("/api/resume/upload", files=files)
    assert resp.status_code == 400
    assert resp.json()["code"] == "resume.no_text_layer"
