"""一键抓取桥：网页发起采集请求 → 扩展认领执行 → 结果回传。

中国版职位数据只能来自浏览器扩展（PRD D1）：服务端没有爬虫，网页上的
「立即抓取」过去只会空转一次流水线（`scrape.no_server_scrapers`），用户看到的是
「0 数据」的假完成。这里把一次采集请求交给用户浏览器里**已经打开**的招聘页面执行：

    POST /api/capture/request    网页：发起（或复用）一次采集请求
    GET  /api/capture/request    网页：轮询状态（等待扩展 / 采集中 / 完成）
    POST /api/capture/cancel     网页：取消（例如超时没等到扩展）
    POST /api/capture/claim      扩展：认领待处理请求（同时是扩展存活心跳）
    POST /api/capture/progress   扩展：采集过程中的进度心跳（网页据此区分「在跑」与「卡住」）
    POST /api/capture/complete   扩展：回传本次采集结果

请求状态放在 `app.state.capture_request`（与 `scrape_progress` 同样的内存态），因为
它天然是短生命周期的交互状态：一次点击一次采集，进程重启即失效。

网页端需要能区分三种「什么都没有发生」的原因，否则用户只知道「采集不了」：

* 扩展根本没响应        → `extension_seen` 为假（没装 / 没重载 / 服务没起）
* 扩展在，但页面不是列表页 → `listing_seen` 为假（认领请求会带着 `has_listing: false` 心跳）
* 认领了却在原地不动    → `progress_at` 长时间不前进（页面被关闭、采集卡住）
"""

import time
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/capture")

# 扩展在招聘页面上的轮询间隔是 3s（content.js CAPTURE_POLL_MS）。
# 超过这个时间还没人来认领，就是「没有打开招聘页面 / 扩展没装或没重载」。
EXTENSION_FRESH_SEC = 12
# 一次请求的重放窗口：这段时间内重复点击复用同一个请求，避免扩展认领了旧的、
# 网页却在等新的。
REQUEST_REUSE_SEC = 120

ACTIVE_STATUSES = ("waiting", "capturing")


def _empty_state() -> dict:
    return {
        "request_id": None,
        "status": "idle",
        "requested_at": None,
        "claimed_at": None,
        "completed_at": None,
        "extension_last_seen": None,
        # 扩展曾经在**职位列表页**上认领过吗？只看「扩展活着」是不够的：
        # 详情页上的内容脚本也在轮询，但它一个卡片都采不到。
        "extension_listing_seen": False,
        # 最近一次进度心跳（扩展每采几条就报一次）：网页据此判断是否真的在前进
        "progress_at": None,
        # 采集了 0 条时的原因码（如 no_listing：当前页面不是职位列表页）
        "reason": None,
        "page_url": None,
        "total": 0,
        "saved": 0,
        "skipped": 0,
        "failed": 0,
    }


def _is_active(state: dict | None) -> bool:
    return bool(state) and state.get("status") in ACTIVE_STATUSES


def _public_state(state: dict | None, now: float) -> dict:
    """补上网页轮询需要的派生字段（active / 扩展是否还活着 / server_now）。"""
    if not state:
        return {**_empty_state(), "active": False, "extension_seen": False, "server_now": now}

    return {
        **state,
        "active": _is_active(state),
        "extension_seen": _seen_recently(state.get("extension_last_seen"), now),
        "listing_seen": bool(state.get("extension_listing_seen")),
        "server_now": now,
    }


def _seen_recently(stamp, now: float) -> bool:
    return bool(stamp) and (now - stamp) <= EXTENSION_FRESH_SEC


def _clamped_count(payload: dict, key: str) -> int:
    try:
        return max(0, int(payload.get(key) or 0))
    except (TypeError, ValueError):
        return 0


@router.post("/request")
async def request_capture(request: Request):
    """网页发起一次采集。重复点击复用进行中的请求（幂等），不排队、不批量遍历。"""
    app = request.app
    now = time.monotonic()
    current = getattr(app.state, "capture_request", None)

    if _is_active(current) and (now - (current.get("requested_at") or now)) < REQUEST_REUSE_SEC:
        return _public_state(current, now)

    app.state.capture_request = {
        **_empty_state(),
        "request_id": uuid.uuid4().hex,
        "status": "waiting",
        "requested_at": now,
    }
    return _public_state(app.state.capture_request, now)


@router.get("/request")
async def capture_state(request: Request):
    return _public_state(getattr(request.app.state, "capture_request", None), time.monotonic())


@router.post("/cancel")
async def cancel_capture(request: Request):
    app = request.app
    now = time.monotonic()
    state = getattr(app.state, "capture_request", None)
    if not _is_active(state):
        return JSONResponse({"error": "no_active_capture"}, status_code=404)
    state["status"] = "cancelled"
    state["completed_at"] = now
    return _public_state(state, now)


@router.post("/claim")
async def claim_capture(request: Request):
    """扩展轮询：有活（`pending: true`）就领走（waiting → capturing），没活也回一次心跳。

    每次调用都刷新 `extension_last_seen` —— 网页据此区分「扩展没响应」和
    「扩展正在采集但这一步慢」。`has_listing: false`（当前页面没有职位卡片）的
    标签**不会**领走请求：把活留给真正开着列表页的那个标签，网页则能据此说出
    「扩展在，但打开的不是职位列表页」。
    """
    app = request.app
    now = time.monotonic()
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    # 老版本内容脚本不发 body：默认按「有列表」处理，行为与之前一致
    has_listing = body.get("has_listing", True) is not False

    state = getattr(app.state, "capture_request", None)
    if state is None:
        state = _empty_state()
        app.state.capture_request = state
    state["extension_last_seen"] = now
    if has_listing:
        state["extension_listing_seen"] = True

    pending = has_listing and state.get("status") == "waiting"
    if pending:
        state["status"] = "capturing"
        state["claimed_at"] = now
        state["progress_at"] = now

    return {**_public_state(state, now), "pending": pending}


@router.post("/progress")
async def capture_progress(request: Request):
    """扩展在采集过程中汇报进度：一次采集可能要几十秒，网页不能靠死等。

    计数是**快照**而不是增量（重传也安全），迟到的旧请求回执会被丢弃。
    """
    app = request.app
    now = time.monotonic()
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    state = getattr(app.state, "capture_request", None)
    if not _is_active(state):
        return JSONResponse({"error": "no_active_capture"}, status_code=404)
    if payload.get("request_id") and payload.get("request_id") != state.get("request_id"):
        return {**_public_state(state, now), "ignored": True}

    state["extension_last_seen"] = now
    state["progress_at"] = now
    # 快照语义：扩展每次都发完整计数。缺字段不动原值，避免把已统计的数字清零。
    for key in ("total", "saved", "skipped", "failed"):
        if key in payload:
            state[key] = _clamped_count(payload, key)
    return _public_state(state, now)


@router.post("/complete")
async def complete_capture(request: Request):
    """扩展回传本次采集结果：{request_id, saved, skipped, failed, total, page_url}。"""
    app = request.app
    now = time.monotonic()
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    state = getattr(app.state, "capture_request", None)
    state = state if state else _empty_state()
    app.state.capture_request = state
    state["extension_last_seen"] = now

    # 已被取消 / 换了新请求的结果直接丢弃，避免旧页面的回执污染当前状态，
    # 也避免用户在超时后收到一个「迟到」的完成提示。
    if not _is_active(state):
        return {**_public_state(state, now), "ignored": True}
    if payload.get("request_id") and payload.get("request_id") != state.get("request_id"):
        return {**_public_state(state, now), "ignored": True}

    state["total"] = _clamped_count(payload, "total")
    state["saved"] = _clamped_count(payload, "saved")
    state["skipped"] = _clamped_count(payload, "skipped")
    state["failed"] = _clamped_count(payload, "failed")
    state["status"] = "done"
    state["completed_at"] = now
    state["progress_at"] = now
    page_url = payload.get("page_url")
    if isinstance(page_url, str) and page_url:
        state["page_url"] = page_url[:500]  # raw business content (页面地址)
    reason = payload.get("reason")
    if isinstance(reason, str) and reason:
        state["reason"] = reason
    return _public_state(state, now)
