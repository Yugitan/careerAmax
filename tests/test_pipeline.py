import pytest
from app.database import Database


@pytest.fixture
async def db(tmp_path):
    database = Database(str(tmp_path / "test.db"))
    await database.init()
    yield database
    await database.close()


@pytest.mark.asyncio
async def test_upsert_application_sets_timestamps(db):
    jid = await db.insert_job(
        title="Test Job", company="Co", location="Remote",
        salary_min=None, salary_max=None, description="desc",
        url="https://example.com/1", posted_date=None,
        application_method="url", contact_email=None,
    )
    await db.upsert_application(jid, status="interested")
    app = await db.get_application(jid)
    assert app["status"] == "interested"
    assert app["applied_at"] is None

    await db.upsert_application(jid, status="applied")
    app = await db.get_application(jid)
    assert app["status"] == "applied"
    assert app["applied_at"] is not None

    await db.upsert_application(jid, status="rejected")
    app = await db.get_application(jid)
    assert app["status"] == "rejected"
    assert app["rejected_at"] is not None


@pytest.mark.asyncio
async def test_get_pipeline_jobs(db):
    statuses = ["interested", "prepared", "applied", "interviewing", "offered", "rejected"]
    for i, status in enumerate(statuses):
        jid = await db.insert_job(
            title=f"Job {i}", company="Co", location="Remote",
            salary_min=None, salary_max=None, description="d",
            url=f"https://example.com/{i}", posted_date=None,
            application_method="url", contact_email=None,
        )
        await db.upsert_application(jid, status=status)

    for status in statuses:
        jobs = await db.get_pipeline_jobs(status)
        assert len(jobs) == 1
        assert jobs[0]["app_status"] == status


@pytest.mark.asyncio
async def test_get_pipeline_stats(db):
    for i, status in enumerate(["interested", "applied", "applied", "rejected"]):
        jid = await db.insert_job(
            title=f"Job {i}", company="Co", location="Remote",
            salary_min=None, salary_max=None, description="d",
            url=f"https://example.com/{i}", posted_date=None,
            application_method="url", contact_email=None,
        )
        await db.upsert_application(jid, status=status)

    stats = await db.get_pipeline_stats()
    assert stats["interested"] == 1
    assert stats["applied"] == 2
    assert stats["rejected"] == 1


# === 状态枚举白名单（铁律） ===
#
# 界面文案只用于显示，落库的值必须是稳定英文枚举。中文界面下若把翻译结果
# 当 value 提交（例如「已申请」），必须在数据层就被拒绝。

@pytest.mark.asyncio
async def test_upsert_application_rejects_translated_status(db):
    jid = await db.insert_job(
        title="Job", company="Co", location="Remote",
        salary_min=None, salary_max=None, description="d",
        url="https://example.com/x", posted_date=None,
        application_method="url", contact_email=None,
    )
    with pytest.raises(ValueError):
        await db.upsert_application(jid, status="已申请")


@pytest.mark.asyncio
async def test_insert_application_rejects_unknown_status(db):
    jid = await db.insert_job(
        title="Job", company="Co", location="Remote",
        salary_min=None, salary_max=None, description="d",
        url="https://example.com/y", posted_date=None,
        application_method="url", contact_email=None,
    )
    with pytest.raises(ValueError):
        await db.insert_application(jid, status="not_a_status")


@pytest.mark.asyncio
async def test_update_application_rejects_unknown_status(db):
    jid = await db.insert_job(
        title="Job", company="Co", location="Remote",
        salary_min=None, salary_max=None, description="d",
        url="https://example.com/z", posted_date=None,
        application_method="url", contact_email=None,
    )
    app_id = await db.insert_application(jid, status="interested")
    with pytest.raises(ValueError):
        await db.update_application(app_id, status="面试中")
    # 白名单内的枚举仍然可用，且不会污染已有状态。
    await db.update_application(app_id, status="applied")
    app = await db.get_application(jid)
    assert app["status"] == "applied"
