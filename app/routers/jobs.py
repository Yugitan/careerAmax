import asyncio
import json
import logging

from fastapi import APIRouter, Query, Request
from app.errors import AppError
from app.database import stable_job_url
from fastapi.responses import Response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


# BOSS 直聘在扩展里用的是展示名（source='BOSS直聘'，专有名词，两种语言都不翻译），
# 而历史数据与后端测试用平台 id 'boss'。平台判定必须收敛，否则"先存列表卡片、
# 再补详情页 JD"的二次回传会落进新建分支，JD 被静默丢弃。
BOSS_SOURCE_ALIASES = {"boss", "boss直聘", "zhipin", "zhipin.com", "www.zhipin.com"}


def _is_boss_source(*values: str | None) -> bool:
    return any((v or "").strip().lower() in BOSS_SOURCE_ALIASES for v in values)


# 扩展从页面/接口采集来的岗位属性（经验、学历、公司规模、融资阶段、福利标签）。
# 值是招聘平台的原始词汇（如「3-5年」「本科」「100-499人」），属业务内容，
# 不做翻译，因此这里只做长度与形状校验，不做枚举翻译。
JOB_FACT_FIELDS = ("experience_req", "education_req", "company_size", "company_stage")
MAX_JOB_FACTS = 20
MAX_FACT_LENGTH = 40


def _clean_facts(body: dict) -> tuple[dict, list[str]]:
    """Return the validated job facts and welfare labels from a capture payload."""
    facts = {}
    for field in JOB_FACT_FIELDS:
        value = body.get(field)
        if isinstance(value, str) and value.strip():
            facts[field] = value.strip()[:MAX_FACT_LENGTH]

    labels = []
    raw_labels = body.get("job_labels")
    if isinstance(raw_labels, list):
        for item in raw_labels:
            if not isinstance(item, str):
                continue
            label = item.strip()[:MAX_FACT_LENGTH]
            if label and label not in labels:
                labels.append(label)
            if len(labels) >= MAX_JOB_FACTS:
                break
    return facts, labels


@router.get("/jobs")
async def list_jobs(
    request: Request,
    sort: str = Query("score"),
    limit: int = Query(50),
    offset: int = Query(0),
    min_score: int | None = Query(None),
    search: str | None = Query(None),
    source: str | None = Query(None),
    work_type: str | None = Query(None),
    employment_type: str | None = Query(None),
    location: str | None = Query(None),
    region: str | None = Query(None),
    clearance: str | None = Query(None),
    posted_within: str | None = Query(None),
    include_stale: bool = Query(False),
):
    db = request.app.state.db
    config = await db.get_search_config()
    exclude_terms = config.get("exclude_terms", []) if config else []
    # Default to 30 days if no filter specified and not explicitly requesting stale
    effective_posted_within = posted_within if posted_within or include_stale else "30d"
    jobs = await db.list_jobs(
        sort_by=sort, limit=limit, offset=offset,
        min_score=min_score, search=search, source=source,
        work_type=work_type, employment_type=employment_type,
        location=location, exclude_terms=exclude_terms,
        region=region, clearance=clearance,
        posted_within=effective_posted_within,
    )
    return {"jobs": jobs}


@router.post("/jobs/save-external")
async def save_external_job(request: Request):
    db = request.app.state.db
    body = await request.json()
    title = (body.get("title") or "").strip()
    company = (body.get("company") or "").strip()
    url = stable_job_url(body.get("url", ""))

    # 中国版：职位详情（JD）由浏览器扩展在页面上直接抓取后回传，服务端不再
    # 代为抓取 —— 原实现依赖 LinkedIn 等美国站点，国内不可用。
    description = body.get("description", "")
    source = (body.get("source") or "external").strip() or "external"
    source_name = (body.get("source_name") or source).strip() or source

    # BOSS 直聘的二次回传（先列表卡片、后详情页 JD）：按 URL 找到已存在的
    # 记录后做增量更新，而不是另建一条重复职位。
    existing = (
        await db.find_job_by_url_variants(url)
        if url and _is_boss_source(source, source_name)
        else None
    )
    facts, labels = _clean_facts(body)

    if existing:
        job_id = existing["id"]
        fields = {}
        for field, value in (
            ("title", title), ("company", company),
            ("location", body.get("location")), ("description", description),
        ):
            if isinstance(value, str) and value.strip():
                fields[field] = value.strip()
        for field in ("salary_min", "salary_max"):
            if body.get(field) is not None:
                fields[field] = body[field]
        # 空值不覆盖：列表卡片那次采集没有福利标签，不能把详情页采到的抹掉
        fields.update(facts)
        if labels:
            fields["job_labels"] = json.dumps(labels, ensure_ascii=False)
        if fields:
            await db.update_job_contact(job_id, **fields)
        await db.update_last_seen(job_id)
        if not url.startswith("external://"):
            await db.insert_source(job_id, source_name, url)
        matcher = getattr(request.app.state, "matcher", None)
        if matcher and description:
            async def _score_enriched_job():
                try:
                    result = await matcher.score_job(description)
                    if result:
                        await db.insert_score(
                            job_id, result.get("score", 0),
                            result.get("reasons", []),
                            result.get("concerns", []),
                            result.get("keywords", []),
                            role_match=result.get("role_match", True),
                        )
                        logger.info(f"Scored enriched job {job_id}: {result.get('score', 0)}")
                except Exception:
                    logger.exception(f"Failed to score enriched job {job_id}")
            asyncio.create_task(_score_enriched_job())
        # created=false 让扩展的一键抓取能区分「新增」与「已在库里」
        return {"ok": True, "job_id": job_id, "created": False}

    # 卡片阶段只要求标题：公司名偶尔采不到（选择器命不中），而 PRD 的采集流程本来就是
    # 「先存卡片、再补详情页 JD」，详情页那次回传会把公司名等字段补上。
    # 这里直接拒绝的话，用户点「保存到 CareerPulse」就只会得到一个无信息量的错误。
    platform_capture = bool(url) and _is_boss_source(source, source_name)
    if not title or (not company and not platform_capture):
        raise AppError("job.title_and_company_required", status_code=400)

    # Generate a placeholder URL if none provided (DB requires unique URL)
    if not url:
        import uuid
        url = f"external://{uuid.uuid4().hex}"

    job_id = await db.insert_job(
        title=title, company=company, location=body.get("location", ""),
        salary_min=body.get("salary_min"), salary_max=body.get("salary_max"),
        description=description, url=url, posted_date=body.get("posted_date"),
        application_method=body.get("application_method", "url"),
        contact_email=body.get("contact_email"),
        job_labels=labels, **facts,
    )
    if job_id:
        if not url.startswith("external://"):
            await db.insert_source(job_id, source_name, url)
        await db.add_event(job_id, "saved_external", f"Saved from {source_name}")
        # Set initial pipeline status if provided
        initial_status = body.get("initial_status")
        if initial_status:
            await db.upsert_application(job_id, status=initial_status)
        # Score the job in the background if AI is configured
        matcher = getattr(request.app.state, "matcher", None)
        if matcher and description:
            async def _score_added_job():
                try:
                    result = await matcher.score_job(description)
                    if result:
                        await db.insert_score(
                            job_id, result.get("score", 0),
                            result.get("reasons", []),
                            result.get("concerns", []),
                            result.get("keywords", []),
                            role_match=result.get("role_match", True),
                        )
                        logger.info(f"Scored added job {job_id}: {result.get('score', 0)}")
                except Exception:
                    logger.exception(f"Failed to score added job {job_id}")
            asyncio.create_task(_score_added_job())
    return {"ok": True, "job_id": job_id, "created": bool(job_id)}


@router.get("/jobs/lookup")
async def lookup_job_by_url(request: Request, url: str = Query(...)):
    db = request.app.state.db
    job = await db.find_job_by_url_variants(url)
    if not job:
        return {"found": False}
    score = await db.get_score(job["id"])
    application = await db.get_application(job["id"])
    return {
        "found": True,
        "job_id": job["id"],
        "title": job["title"],
        "company": job["company"],
        "score": score["match_score"] if score else None,
        "status": application["status"] if application else None,
    }


@router.get("/jobs/{job_id}")
async def get_job(request: Request, job_id: int):
    db = request.app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    score = await db.get_score(job_id)
    sources = await db.get_sources(job_id)
    application = await db.get_application(job_id)
    events = await db.get_events(job_id)
    similar = await db.find_similar_jobs(
        job["title"], job["company"], exclude_id=job_id,
        embedding_client=request.app.state.embedding_client,
    )
    interview_prep = await db.get_interview_prep(job_id)
    from app.interview_prep import progress_for
    return {**job, "score": score, "sources": sources, "application": application,
            "events": events, "similar": similar, "interview_prep": interview_prep,
            "interview_prep_progress": progress_for((interview_prep or {}).get("questions"))}


@router.get("/jobs/{job_id}/similar")
async def get_similar_jobs(request: Request, job_id: int):
    db = request.app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    similar = await db.find_similar_jobs(
        job["title"], job["company"], exclude_id=job_id,
        embedding_client=request.app.state.embedding_client,
    )
    return {"similar": similar}


@router.post("/jobs/{job_id}/dismiss")
async def dismiss_job(request: Request, job_id: int):
    await request.app.state.db.dismiss_job(job_id)
    return {"ok": True}


@router.post("/jobs/{job_id}/events")
async def add_event(request: Request, job_id: int):
    db = request.app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    body = await request.json()
    detail = body.get("detail", "")
    if not detail.strip():
        raise AppError("job.detail_required", status_code=400)
    allowed_types = {"note", "call", "email_log", "status_change", "prepared", "email_drafted", "pdf_downloaded"}
    event_type = body.get("event_type", "note")
    if event_type not in allowed_types:
        raise AppError("job.invalid_event_type", status_code=400, params={"event_type": event_type})
    await db.add_event(job_id, event_type, detail)
    return {"ok": True}


@router.post("/jobs/mark-applied-by-url")
async def mark_applied_by_url(request: Request):
    body = await request.json()
    url = body.get("url", "").strip()
    if not url:
        raise AppError("job.url_required", status_code=400)
    db = request.app.state.db
    job = await db.find_job_by_url_variants(url)
    if not job:
        return {"found": False, "message": "Job not tracked"}
    await db.upsert_application(job["id"], "applied")
    await db.add_event(job["id"], "auto_applied", "Auto-tracked as applied")
    return {"found": True, "job_id": job["id"], "status": "applied"}


@router.get("/companies/{company_name:path}")
async def get_company_info(request: Request, company_name: str):
    """返回本地缓存的雇主信息。

    中国版不再联网做雇主调研（原实现依赖 DuckDuckGo 与 Glassdoor，国内不可用），
    因此这里只读取本地已缓存的公司记录；没有记录就返回一个空壳，前端据此
    隐藏相应区块。
    """
    db = request.app.state.db
    cached = await db.get_company(company_name)
    return cached or {"name": company_name, "description": "", "website": ""}
