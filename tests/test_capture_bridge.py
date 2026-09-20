"""一键抓取桥：网页发起采集请求 → 扩展认领执行 → 结果回传（app/routers/capture.py）。

中国版没有服务端爬虫（PRD D1），职位只能由扩展在用户打开的页面上采集。这组测试固定住
两侧的契约：网页轮询看到的状态、扩展认领的语义，以及「没扩展时不会假装抓到了东西」。
"""

import pytest
from httpx import AsyncClient, ASGITransport

from app.routers import capture as capture_router


@pytest.fixture
async def app(tmp_path):
    from app.database import Database
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


@pytest.mark.asyncio
async def test_request_creates_waiting_request(client):
    resp = await client.post("/api/capture/request")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "waiting"
    assert body["active"] is True
    assert body["request_id"]
    assert body["extension_seen"] is False
    assert (body["saved"], body["skipped"], body["failed"], body["total"]) == (0, 0, 0, 0)


@pytest.mark.asyncio
async def test_repeat_click_reuses_the_running_request(client):
    first = (await client.post("/api/capture/request")).json()
    second = (await client.post("/api/capture/request")).json()
    assert first["request_id"] == second["request_id"]


@pytest.mark.asyncio
async def test_claim_transitions_waiting_to_capturing(client):
    request_id = (await client.post("/api/capture/request")).json()["request_id"]

    claimed = (await client.post("/api/capture/claim")).json()
    assert claimed["pending"] is True
    assert claimed["status"] == "capturing"
    assert claimed["request_id"] == request_id
    assert claimed["extension_seen"] is True
    assert claimed["claimed_at"] is not None

    # 第二个页面（另一个标签）不会再领到同一个请求
    second = (await client.post("/api/capture/claim")).json()
    assert second["pending"] is False
    assert second["request_id"] == request_id
    state = (await client.get("/api/capture/request")).json()
    assert state["status"] == "capturing"


@pytest.mark.asyncio
async def test_claim_without_request_is_a_heartbeat_only(client):
    body = (await client.post("/api/capture/claim")).json()
    assert body["status"] == "idle"
    assert body["pending"] is False
    assert body["extension_seen"] is True
    assert (await client.get("/api/capture/request")).json()["active"] is False


@pytest.mark.asyncio
async def test_complete_reports_counts(client):
    request_id = (await client.post("/api/capture/request")).json()["request_id"]
    await client.post("/api/capture/claim")

    body = (await client.post("/api/capture/complete", json={
        "request_id": request_id,
        "total": 12,
        "saved": 9,
        "skipped": 3,
        "failed": 0,
        "page_url": "https://www.zhipin.com/web/geek/job?query=python",
    })).json()

    assert body["status"] == "done"
    assert body["active"] is False
    assert (body["total"], body["saved"], body["skipped"], body["failed"]) == (12, 9, 3, 0)
    assert body["page_url"].startswith("https://www.zhipin.com/")

    state = (await client.get("/api/capture/request")).json()
    assert state["status"] == "done"
    assert state["saved"] == 9


@pytest.mark.asyncio
async def test_stale_completion_is_ignored(client):
    """超时取消后到达的迟到回执不能把界面从「已取消」翻回「完成」。"""
    old = (await client.post("/api/capture/request")).json()["request_id"]
    await client.post("/api/capture/cancel")

    resp = await client.post("/api/capture/complete", json={
        "request_id": old, "total": 5, "saved": 5,
    })
    body = resp.json()
    assert body["ignored"] is True
    assert body["status"] == "cancelled"
    assert body["saved"] == 0


@pytest.mark.asyncio
async def test_new_request_after_cancel(client):
    (await client.post("/api/capture/request"))
    await client.post("/api/capture/cancel")

    fresh = (await client.post("/api/capture/request")).json()
    assert fresh["status"] == "waiting"
    assert fresh["active"] is True


@pytest.mark.asyncio
async def test_cancel_without_active_request(client):
    resp = await client.post("/api/capture/cancel")
    assert resp.status_code == 404
    assert resp.json()["error"] == "no_active_capture"


@pytest.mark.asyncio
async def test_state_without_any_request(client):
    body = (await client.get("/api/capture/request")).json()
    assert body["status"] == "idle"
    assert body["active"] is False
    assert body["extension_seen"] is False


@pytest.mark.asyncio
async def test_extension_freshness_expires(client, app, monkeypatch):
    await client.post("/api/capture/claim")
    assert (await client.get("/api/capture/request")).json()["extension_seen"] is True

    # 扩展长时间不再轮询（页面关了 / 扩展被禁用）
    from app.routers import capture

    real_monotonic = capture.time.monotonic
    monkeypatch.setattr(
        capture.time, "monotonic",
        lambda: real_monotonic() + capture_router.EXTENSION_FRESH_SEC + 1,
    )
    assert (await client.get("/api/capture/request")).json()["extension_seen"] is False


@pytest.mark.asyncio
async def test_complete_sanitizes_counts(client):
    request_id = (await client.post("/api/capture/request")).json()["request_id"]
    body = (await client.post("/api/capture/complete", json={
        "request_id": request_id,
        "total": "12", "saved": -3, "skipped": None, "failed": "abc",
    })).json()
    assert (body["total"], body["saved"], body["skipped"], body["failed"]) == (12, 0, 0, 0)


@pytest.mark.asyncio
async def test_complete_without_body_is_ignored(client):
    await client.post("/api/capture/request")
    body = (await client.post("/api/capture/complete")).json()
    assert body["status"] == "done"
    assert body["total"] == 0


@pytest.mark.asyncio
async def test_claim_from_a_page_without_a_list_keeps_the_request_waiting(client):
    """详情页的内容脚本也在轮询：它不能把活领走，网页据此知道「页面不对」。"""
    await client.post("/api/capture/request")

    wrong_page = (await client.post("/api/capture/claim", json={"has_listing": False})).json()
    assert wrong_page["pending"] is False
    assert wrong_page["status"] == "waiting"
    # 扩展是活的（心跳），只是眼前的页面没有职位卡片
    assert wrong_page["extension_seen"] is True
    assert wrong_page["listing_seen"] is False

    # 真正开着列表页的标签随后领到了这个请求
    list_page = (await client.post("/api/capture/claim", json={"has_listing": True})).json()
    assert list_page["pending"] is True
    assert list_page["status"] == "capturing"
    assert list_page["listing_seen"] is True


@pytest.mark.asyncio
async def test_claim_without_body_still_claims(client):
    """老版本内容脚本不发 body：行为要跟以前一致，不能被当成「没有列表」。"""
    await client.post("/api/capture/request")
    body = (await client.post("/api/capture/claim")).json()
    assert body["pending"] is True


@pytest.mark.asyncio
async def test_progress_heartbeat_reports_snapshot(client):
    request_id = (await client.post("/api/capture/request")).json()["request_id"]
    await client.post("/api/capture/claim")

    body = (await client.post("/api/capture/progress", json={
        "request_id": request_id,
        "total": 45, "saved": 12, "skipped": 3, "failed": 0,
    })).json()
    assert body["status"] == "capturing"
    assert (body["total"], body["saved"], body["skipped"]) == (45, 12, 3)
    # 网页用这个时间戳判断「在前进」还是「卡住了」
    assert body["progress_at"] is not None
    assert body["active"] is True

    # 只报部分字段时不清零其它计数（快照语义）
    partial = (await client.post("/api/capture/progress", json={
        "request_id": request_id, "saved": 20,
    })).json()
    assert partial["saved"] == 20
    assert partial["total"] == 45
    assert partial["skipped"] == 3


@pytest.mark.asyncio
async def test_progress_from_a_stale_request_is_ignored(client):
    await client.post("/api/capture/request")
    await client.post("/api/capture/claim")

    body = (await client.post("/api/capture/progress", json={
        "request_id": "someone-elses-request", "total": 99, "saved": 99,
    })).json()
    assert body["ignored"] is True
    assert body["saved"] == 0


@pytest.mark.asyncio
async def test_progress_without_an_active_request(client):
    resp = await client.post("/api/capture/progress", json={"total": 1})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_complete_keeps_the_reason_for_an_empty_capture(client):
    """扩展必须能说清楚「为什么一条都没采到」，否则用户只看到「没采到」。"""
    await client.post("/api/capture/request")
    await client.post("/api/capture/claim", json={"has_listing": True})

    body = (await client.post("/api/capture/complete", json={
        "request_id": (await client.get("/api/capture/request")).json()["request_id"],
        "total": 0, "saved": 0, "skipped": 0, "failed": 0,
        "reason": "no_listing",
    })).json()
    assert body["status"] == "done"
    assert body["reason"] == "no_listing"


@pytest.mark.asyncio
async def test_new_request_clears_the_previous_listing_state(client):
    await client.post("/api/capture/request")
    await client.post("/api/capture/claim", json={"has_listing": True})
    await client.post("/api/capture/cancel")

    fresh = (await client.post("/api/capture/request")).json()
    assert fresh["listing_seen"] is False
    assert fresh["reason"] is None
    assert fresh["progress_at"] is None
