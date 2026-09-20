import json

import pytest
from httpx import AsyncClient, ASGITransport

from app.database import Database


@pytest.fixture
async def db(tmp_path):
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    yield database
    await database.close()


@pytest.fixture
async def app(tmp_path):
    from app.main import create_app
    application = create_app(db_path=str(tmp_path / "test.db"), testing=True)
    db = Database(str(tmp_path / "test.db"))
    await db.init()
    application.state.db = db
    yield application
    await db.close()


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# --- Database tests ---

@pytest.mark.asyncio
async def test_find_job_by_url(db):
    job_id = await db.insert_job(
        title="Engineer", company="Acme", location="Remote",
        salary_min=None, salary_max=None, description="A job",
        url="https://example.com/job/123", posted_date=None,
        application_method="url", contact_email=None,
    )
    found = await db.find_job_by_url("https://example.com/job/123")
    assert found is not None
    assert found["id"] == job_id

    not_found = await db.find_job_by_url("https://example.com/nonexistent")
    assert not_found is None


# --- API tests ---

@pytest.mark.asyncio
async def test_save_external_job(client):
    resp = await client.post("/api/jobs/save-external", json={
        "title": "Data Scientist",
        "company": "BigCo",
        "url": "https://bigco.com/jobs/42",
        "description": "ML role",
        "source": "linkedin",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["job_id"] is not None


@pytest.mark.asyncio
async def test_boss_resave_enriches_existing_job(client, app):
    listing = {
        "title": "工程师", "company": "测试公司", "location": "北京",
        "url": "https://www.zhipin.com/job_detail/abc123.html", "source": "boss",
    }
    first = await client.post("/api/jobs/save-external", json=listing)
    assert first.status_code == 200
    job_id = first.json()["job_id"]

    detail = {
        **listing,
        "description": "负责 Python 后端开发",
        "salary_min": 25000,
        "salary_max": 40000,
    }
    second = await client.post("/api/jobs/save-external", json=detail)
    assert second.status_code == 200
    assert second.json()["job_id"] == job_id

    db = app.state.db
    job = await db.get_job(job_id)
    assert job["description"] == "负责 Python 后端开发"
    assert job["salary_min"] == 25000
    assert job["salary_max"] == 40000
    assert len(await db.list_jobs()) == 1


@pytest.mark.asyncio
async def test_boss_resave_accepts_the_name_the_extension_sends(client, app):
    """扩展回传的 source 是展示名 BOSS直聘，平台判定必须认得它。"""
    listing = {
        "title": "工程师", "company": "测试公司", "location": "北京",
        "url": "https://www.zhipin.com/job_detail/def456.html", "source": "BOSS直聘",
    }
    first = await client.post("/api/jobs/save-external", json=listing)
    assert first.status_code == 200
    job_id = first.json()["job_id"]

    detail = {
        **listing,
        "description": "负责 Python 后端开发",
        "salary_min": 25000,
        "salary_max": 40000,
    }
    second = await client.post("/api/jobs/save-external", json=detail)
    assert second.status_code == 200
    assert second.json()["job_id"] == job_id

    db = app.state.db
    job = await db.get_job(job_id)
    assert job["description"] == "负责 Python 后端开发"
    assert job["salary_min"] == 25000
    assert len(await db.list_jobs()) == 1

    sources = await db.get_sources(job_id)
    assert sources[0]["source_name"] == "BOSS直聘"


@pytest.mark.asyncio
async def test_boss_resave_matches_url_with_session_params(client, app):
    """BOSS 的卡片链接带 lid/securityId，详情页链接不带，两者必须落到同一条。"""
    listing = {
        "title": "工程师", "company": "测试公司",
        "url": "https://www.zhipin.com/job_detail/ghi789.html?lid=7ahpEMXxaQZ&securityId=abc",
        "source": "BOSS直聘",
    }
    first = await client.post("/api/jobs/save-external", json=listing)
    job_id = first.json()["job_id"]

    detail = {
        "title": "工程师", "company": "测试公司",
        "url": "https://www.zhipin.com/job_detail/ghi789.html",
        "description": "岗位职责：负责服务端开发",
        "source": "BOSS直聘",
    }
    second = await client.post("/api/jobs/save-external", json=detail)
    assert second.json()["job_id"] == job_id

    db = app.state.db
    job = await db.get_job(job_id)
    assert job["description"] == "岗位职责：负责服务端开发"
    assert job["url"] == "https://www.zhipin.com/job_detail/ghi789.html"
    assert len(await db.list_jobs()) == 1


@pytest.mark.asyncio
async def test_boss_capture_persists_job_facts(client, app):
    payload = {
        "title": "资深后端开发工程师", "company": "某某科技", "location": "深圳·南山区",
        "url": "https://www.zhipin.com/job_detail/facts1.html", "source": "BOSS直聘",
        "experience_req": "5-10年", "education_req": "本科",
        "company_size": "1000-9999", "company_stage": "已上市",
        "job_labels": ["五险一金", "弹性工作"],
    }
    first = await client.post("/api/jobs/save-external", json=payload)
    assert first.status_code == 200
    job_id = first.json()["job_id"]

    db = app.state.db
    job = await db.get_job(job_id)
    assert job["experience_req"] == "5-10年"
    assert job["education_req"] == "本科"
    assert job["company_size"] == "1000-9999"
    assert job["company_stage"] == "已上市"
    assert json.loads(job["job_labels"]) == ["五险一金", "弹性工作"]

    # 详情页二次回传：补 JD，同时保留卡片刻采到的属性（空值/空列表不覆盖）
    second = await client.post("/api/jobs/save-external", json={
        "url": payload["url"], "source": "BOSS直聘",
        "description": "岗位职责：负责核心交易链路的架构设计与开发",
        "experience_req": "", "education_req": "",
        "company_size": "", "company_stage": "", "job_labels": [],
    })
    assert second.json()["job_id"] == job_id
    job = await db.get_job(job_id)
    assert job["description"] == "岗位职责：负责核心交易链路的架构设计与开发"
    assert job["experience_req"] == "5-10年"
    assert job["education_req"] == "本科"
    assert job["company_size"] == "1000-9999"
    assert job["company_stage"] == "已上市"
    assert json.loads(job["job_labels"]) == ["五险一金", "弹性工作"]

    # 详情页采集到更全的福利标签时替换
    third = await client.post("/api/jobs/save-external", json={
        "url": payload["url"], "source": "BOSS直聘",
        "job_labels": ["五险一金", "补充医疗保险", "年终奖"],
    })
    assert third.json()["job_id"] == job_id
    job = await db.get_job(job_id)
    assert json.loads(job["job_labels"]) == ["五险一金", "补充医疗保险", "年终奖"]

    # 前端读的是详情接口，字段必须一并返回
    app.state.embedding_client = None
    resp = await client.get(f"/api/jobs/{job_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["experience_req"] == "5-10年"
    assert body["job_labels"] == "[\"五险一金\", \"补充医疗保险\", \"年终奖\"]"


@pytest.mark.asyncio
async def test_boss_card_capture_without_company_is_accepted(client, app):
    """卡片阶段偶尔采不到公司名；不能因此让「保存到 CareerPulse」直接报错。

    先落库，公司名由详情页那次回传补齐。
    """
    url = "https://www.zhipin.com/job_detail/nocompany.html"
    listing = {
        "title": "资深后端开发工程师", "company": "",
        "url": url, "source": "BOSS直聘", "location": "深圳·南山区",
    }
    first = await client.post("/api/jobs/save-external", json=listing)
    assert first.status_code == 200
    job_id = first.json()["job_id"]
    assert job_id is not None

    job = await app.state.db.get_job(job_id)
    assert job["company"] == ""
    assert job["title"] == "资深后端开发工程师"

    # 详情页那次回传补上公司名与 JD
    detail = {**listing, "company": "某某科技有限公司", "description": "岗位职责：负责后端服务"}
    second = await client.post("/api/jobs/save-external", json=detail)
    assert second.json()["job_id"] == job_id

    job = await app.state.db.get_job(job_id)
    assert job["company"] == "某某科技有限公司"
    assert job["description"] == "岗位职责：负责后端服务"
    assert len(await app.state.db.list_jobs()) == 1


@pytest.mark.asyncio
async def test_non_platform_capture_still_requires_company(client):
    resp = await client.post("/api/jobs/save-external", json={
        "title": "Engineer", "company": "",
        "url": "https://example.com/jobs/9", "source": "external",
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_boss_job_facts_are_sanitized(client, app):
    resp = await client.post("/api/jobs/save-external", json={
        "title": "工程师", "company": "某某科技",
        "url": "https://www.zhipin.com/job_detail/facts2.html", "source": "BOSS直聘",
        "experience_req": "  5-10年  ",
        "company_size": "x" * 200,
        "education_req": 123,
        "job_labels": ["五险一金", "五险一金", "", None, "弹性工作"],
    })
    job = await app.state.db.get_job(resp.json()["job_id"])
    assert job["experience_req"] == "5-10年"
    assert len(job["company_size"]) == 40          # 超长值被截断
    assert job["education_req"] is None            # 非字符串被忽略
    assert json.loads(job["job_labels"]) == ["五险一金", "弹性工作"]


@pytest.mark.asyncio
async def test_lookup_ignores_session_params(client, app):
    job_id = await app.state.db.insert_job(
        title="工程师", company="测试公司", location="北京",
        salary_min=None, salary_max=None, description="JD",
        url="https://www.zhipin.com/job_detail/lookup1.html", posted_date=None,
        application_method="url", contact_email=None,
    )
    resp = await client.get(
        "/api/jobs/lookup",
        params={"url": "https://www.zhipin.com/job_detail/lookup1.html?lid=x&sessionId=y"},
    )
    assert resp.status_code == 200
    assert resp.json()["found"] is True
    assert resp.json()["job_id"] == job_id


@pytest.mark.asyncio
async def test_mark_applied_by_url_ignores_session_params(client, app):
    job_id = await app.state.db.insert_job(
        title="工程师", company="测试公司", location="北京",
        salary_min=None, salary_max=None, description="JD",
        url="https://www.zhipin.com/job_detail/applied1.html", posted_date=None,
        application_method="url", contact_email=None,
    )
    resp = await client.post("/api/jobs/mark-applied-by-url", json={
        "url": "https://www.zhipin.com/job_detail/applied1.html?lid=x&sessionId=y#top",
    })
    assert resp.status_code == 200
    assert resp.json()["found"] is True
    assert resp.json()["job_id"] == job_id


@pytest.mark.asyncio
async def test_boss_resave_empty_fields_do_not_overwrite(client, app):
    listing = {
        "title": "工程师", "company": "测试公司", "location": "北京",
        "description": "原始 JD", "salary_min": 25000, "salary_max": 40000,
        "url": "https://www.zhipin.com/job_detail/abc123.html", "source": "boss",
    }
    first = await client.post("/api/jobs/save-external", json=listing)
    assert first.status_code == 200
    job_id = first.json()["job_id"]

    second = await client.post("/api/jobs/save-external", json={
        "url": listing["url"], "source": "boss",
        "title": "", "company": "", "description": "",
    })
    assert second.status_code == 200
    assert second.json()["job_id"] == job_id

    job = await app.state.db.get_job(job_id)
    assert job["title"] == "工程师"
    assert job["description"] == "原始 JD"
    assert job["salary_min"] == 25000
    assert job["salary_max"] == 40000
    assert len(await app.state.db.list_jobs()) == 1


@pytest.mark.asyncio
async def test_non_boss_resave_keeps_insert_ignore(client, app):
    job_data = {
        "title": "Engineer", "company": "TestCo",
        "url": "https://example.com/jobs/1", "source": "external",
        "description": "Original",
    }
    first = await client.post("/api/jobs/save-external", json=job_data)
    job_id = first.json()["job_id"]
    second = await client.post("/api/jobs/save-external", json={
        **job_data, "description": "Updated",
    })
    assert second.json()["job_id"] == job_id
    job = await app.state.db.get_job(job_id)
    assert job["description"] == "Original"


@pytest.mark.asyncio
async def test_save_external_job_missing_fields(client):
    resp = await client.post("/api/jobs/save-external", json={
        "title": "Engineer",
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_lookup_job_found(client, app):
    db = app.state.db
    job_id = await db.insert_job(
        title="Engineer", company="TestCo", location="Remote",
        salary_min=100000, salary_max=150000, description="A job",
        url="https://testco.com/jobs/1", posted_date=None,
        application_method="url", contact_email=None,
    )
    resp = await client.get("/api/jobs/lookup", params={"url": "https://testco.com/jobs/1"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["found"] is True
    assert data["job_id"] == job_id
    assert data["title"] == "Engineer"


@pytest.mark.asyncio
async def test_lookup_job_not_found(client):
    resp = await client.get("/api/jobs/lookup", params={"url": "https://nowhere.com/job/999"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["found"] is False
