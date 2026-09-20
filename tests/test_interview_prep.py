import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.database import Database
from app.interview_prep import (
    merge_existing_drafts,
    normalize_questions,
    progress_for,
)


@pytest.fixture
async def db(tmp_path):
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    yield database
    await database.close()


@pytest.fixture
async def job_id(db):
    return await db.insert_job(
        title="Senior Engineer", company="TestCo", location="Remote",
        description="Build scalable systems with Python and Kubernetes",
        url="https://example.com/test",
        salary_min=None, salary_max=None, posted_date=None,
        application_method=None, contact_email=None,
    )


SAMPLE_PREP = {
    "behavioral_questions": [
        "Tell me about a time you led a technical initiative",
        "Describe a conflict with a teammate",
    ],
    "technical_questions": [
        "Explain Kubernetes pod scheduling",
        "How would you design a rate limiter?",
    ],
    "star_stories": [
        "Led migration from monolith to microservices — reduced deploy time 80%",
    ],
    "talking_points": [
        "Deep Python expertise with FastAPI",
        "Experience scaling distributed systems",
    ],
}


@pytest.mark.asyncio
async def test_save_and_get_interview_prep(db, job_id):
    await db.save_interview_prep(job_id, SAMPLE_PREP)
    prep = await db.get_interview_prep(job_id)
    assert prep is not None
    assert prep["behavioral_questions"] == SAMPLE_PREP["behavioral_questions"]
    assert prep["technical_questions"] == SAMPLE_PREP["technical_questions"]
    assert prep["star_stories"] == SAMPLE_PREP["star_stories"]
    assert prep["talking_points"] == SAMPLE_PREP["talking_points"]


@pytest.mark.asyncio
async def test_get_interview_prep_not_found(db, job_id):
    prep = await db.get_interview_prep(job_id)
    assert prep is None


@pytest.mark.asyncio
async def test_save_interview_prep_upsert(db, job_id):
    await db.save_interview_prep(job_id, SAMPLE_PREP)
    updated = {**SAMPLE_PREP, "talking_points": ["Updated point"]}
    await db.save_interview_prep(job_id, updated)
    prep = await db.get_interview_prep(job_id)
    assert prep["talking_points"] == ["Updated point"]
    assert prep["behavioral_questions"] == SAMPLE_PREP["behavioral_questions"]


@pytest.mark.asyncio
async def test_interview_prep_api(db, job_id):
    """Test the API endpoint returns prep data."""
    await db.save_interview_prep(job_id, SAMPLE_PREP)
    prep = await db.get_interview_prep(job_id)
    assert len(prep["behavioral_questions"]) == 2
    assert len(prep["technical_questions"]) == 2
    assert len(prep["star_stories"]) == 1
    assert len(prep["talking_points"]) == 2


# === M9: 结构化题库（questions[]）===

QUESTIONS_JSON = json.dumps({
    "questions": [
        {"category": "基础八股", "difficulty": "easy", "question": "Go 的 GMP 调度模型？",
         "key_points": ["G/M/P 三角色"], "star_hint": "先讲模型再讲取舍"},
        {"category": "项目深挖", "difficulty": "hard", "question": "你简历里的订单系统为什么分库？",
         "key_points": ["单表 8 亿行"], "star_hint": "STAR"},
        {"category": "场景设计", "question": "设计一个秒杀库存扣减", "key_points": []},
        {"category": "HR面", "question": "为什么离职？", "key_points": ["不要贬低前东家"]},
    ]
}, ensure_ascii=False)


def test_normalize_questions_maps_chinese_categories():
    questions = normalize_questions(json.loads(QUESTIONS_JSON))
    assert [q["category"] for q in questions] == ["basics", "project", "design", "hr"]
    # 缺失的 difficulty 回落到 medium，缺失的 status 回落到 todo
    assert questions[2]["difficulty"] == "medium"
    assert all(q["status"] == "todo" for q in questions)
    assert all(q["user_draft"] == "" for q in questions)


def test_normalize_questions_drops_entries_without_a_question():
    assert normalize_questions([{"category": "basics"}, "nope", None]) == []
    assert normalize_questions(None) == []


def test_progress_for_counts_drafts_and_mastered():
    questions = [
        {"status": "mastered"}, {"status": "drafted"},
        {"status": "drafted"}, {"status": "todo"},
    ]
    progress = progress_for(questions)
    assert progress == {"total": 4, "drafted": 2, "mastered": 1, "percent": 50}
    assert progress_for([]) == {"total": 0, "drafted": 0, "mastered": 0, "percent": 0}


def test_merge_existing_drafts_keeps_user_work():
    regenerated = normalize_questions(json.loads(QUESTIONS_JSON))
    previous = [{
        "question": "Go 的 GMP 调度模型？",
        "user_draft": "我答了 G/M/P",
        "status": "mastered",
        "key_points": ["旧要点"],
    }]
    merged = merge_existing_drafts(regenerated, previous)
    first = merged[0]
    assert first["user_draft"] == "我答了 G/M/P"
    assert first["status"] == "mastered"
    assert first["key_points"] == ["G/M/P 三角色"]  # 新要点不被覆盖
    assert merged[1]["status"] == "todo"


@pytest.mark.asyncio
async def test_update_interview_question_persists_draft(db, job_id):
    questions = normalize_questions(json.loads(QUESTIONS_JSON))
    await db.save_interview_prep(job_id, {"questions": questions})

    updated = await db.update_interview_question(job_id, 1, {
        "user_draft": "分库因为单表过大", "status": "drafted",
    })
    assert updated["user_draft"] == "分库因为单表过大"
    assert updated["status"] == "drafted"

    prep = await db.get_interview_prep(job_id)
    assert prep["questions"][1]["user_draft"] == "分库因为单表过大"
    assert prep["questions"][0]["status"] == "todo"


@pytest.mark.asyncio
async def test_update_interview_question_rejects_bad_index_and_status(db, job_id):
    questions = normalize_questions(json.loads(QUESTIONS_JSON))
    await db.save_interview_prep(job_id, {"questions": questions})
    assert await db.update_interview_question(job_id, 99, {"user_draft": "x"}) is None
    assert await db.update_interview_question(job_id, -1, {"user_draft": "x"}) is None

    updated = await db.update_interview_question(job_id, 0, {"status": "已熟练"})
    assert updated["status"] == "todo"  # 只接受稳定英文枚举


@pytest.mark.asyncio
async def test_update_interview_question_without_prep(db, job_id):
    assert await db.update_interview_question(job_id, 0, {"user_draft": "x"}) is None


@pytest.fixture
def mock_ai(monkeypatch):
    ai = MagicMock()
    ai.chat = AsyncMock(return_value=QUESTIONS_JSON)
    ai.provider = "deepseek"
    return ai


@pytest.mark.asyncio
async def test_generate_interview_prep_endpoint(client, app, db, job_id, mock_ai):
    app.state.ai_client = mock_ai
    resp = await client.post(f"/api/jobs/{job_id}/interview-prep")
    assert resp.status_code == 200
    body = resp.json()
    questions = body["prep"]["questions"]
    assert len(questions) == 4
    assert {q["category"] for q in questions} == {"basics", "project", "design", "hr"}
    assert body["progress"]["percent"] == 0

    # 重新生成时保留已写草稿
    await db.update_interview_question(job_id, 0, {"user_draft": "我的答案", "status": "mastered"})
    resp = await client.post(f"/api/jobs/{job_id}/interview-prep")
    assert resp.json()["prep"]["questions"][0]["user_draft"] == "我的答案"
    assert resp.json()["progress"]["percent"] == 25


@pytest.mark.asyncio
async def test_get_interview_prep_endpoint_returns_progress(client, db, job_id):
    resp = await client.get(f"/api/jobs/{job_id}/interview-prep")
    assert resp.status_code == 404
    assert resp.json()["code"] == "tailoring.interview_prep_missing"

    questions = normalize_questions(json.loads(QUESTIONS_JSON))
    await db.save_interview_prep(job_id, {"questions": questions})
    resp = await client.get(f"/api/jobs/{job_id}/interview-prep")
    assert resp.status_code == 200
    assert resp.json()["progress"]["total"] == 4


@pytest.mark.asyncio
async def test_update_question_endpoint_and_errors(client, db, job_id):
    questions = normalize_questions(json.loads(QUESTIONS_JSON))
    await db.save_interview_prep(job_id, {"questions": questions})

    resp = await client.put(f"/api/jobs/{job_id}/interview-prep/questions/0",
                            json={"user_draft": "要点 A", "status": "drafted"})
    assert resp.status_code == 200
    assert resp.json()["question"]["status"] == "drafted"
    assert resp.json()["progress"]["percent"] == 12

    resp = await client.put(f"/api/jobs/{job_id}/interview-prep/questions/42", json={"user_draft": "x"})
    assert resp.status_code == 404
    assert resp.json()["code"] == "interview.question_not_found"
    assert resp.json()["params"] == {"index": 42}


@pytest.mark.asyncio
async def test_expand_question_endpoint(client, app, db, job_id, mock_ai):
    app.state.ai_client = mock_ai
    questions = normalize_questions(json.loads(QUESTIONS_JSON))
    await db.save_interview_prep(job_id, {"questions": questions})
    mock_ai.chat = AsyncMock(return_value='{"key_points": ["补充要点"], "star_hint": "STAR 结构"}')

    resp = await client.post(f"/api/jobs/{job_id}/interview-prep/questions/2/expand")
    assert resp.status_code == 200
    question = resp.json()["question"]
    assert question["key_points"] == ["补充要点"]
    assert question["star_hint"] == "STAR 结构"

    resp = await client.post(f"/api/jobs/{job_id}/interview-prep/questions/9/expand")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_expand_question_requires_ai(client, db, job_id):
    questions = normalize_questions(json.loads(QUESTIONS_JSON))
    await db.save_interview_prep(job_id, {"questions": questions})
    resp = await client.post(f"/api/jobs/{job_id}/interview-prep/questions/0/expand")
    assert resp.status_code == 503
    assert resp.json()["code"] == "ai.not_configured"


@pytest.mark.asyncio
async def test_copy_interview_prep_endpoint(client, db, job_id):
    source = normalize_questions(json.loads(QUESTIONS_JSON))
    await db.save_interview_prep(job_id, {"questions": source})
    target = await db.insert_job(
        title="Backend Engineer", company="OtherCo", location="上海",
        description="Go 后端", url="https://example.com/target",
        salary_min=None, salary_max=None, posted_date=None,
        application_method=None, contact_email=None,
    )

    resp = await client.post(f"/api/jobs/{target}/interview-prep/copy", json={"source_job_id": job_id})
    assert resp.status_code == 200
    assert resp.json()["progress"]["total"] == 4

    resp = await client.post(f"/api/jobs/{target}/interview-prep/copy", json={})
    assert resp.status_code == 400
    assert resp.json()["code"] == "interview.source_required"

    # 来源列表只列出真正有题库的职位（按生成时间倒序）
    sources = (await client.get("/api/interview-prep/sources")).json()["sources"]
    assert sorted(source["job_id"] for source in sources) == sorted([job_id, target])
    assert sources[0]["job_id"] == target


@pytest.mark.asyncio
async def test_copy_interview_prep_empty_source(client, db, job_id):
    target = await db.insert_job(
        title="Backend Engineer", company="OtherCo", location="上海",
        description="Go 后端", url="https://example.com/target2",
        salary_min=None, salary_max=None, posted_date=None,
        application_method=None, contact_email=None,
    )
    resp = await client.post(f"/api/jobs/{target}/interview-prep/copy", json={"source_job_id": job_id})
    assert resp.status_code == 404
    assert resp.json()["code"] == "interview.source_empty"
