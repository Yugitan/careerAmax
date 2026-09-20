import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Query, Request
from app.errors import AppError
from fastapi.responses import Response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.post("/jobs/{job_id}/prepare")
async def prepare_application(request: Request, job_id: int):
    db = request.app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    tailor = request.app.state.tailor
    if not tailor:
        if not getattr(request.app.state, "ai_client", None):
            raise AppError("ai.not_configured", status_code=503)
        raise AppError("resume.missing", status_code=503)
    resume_text_override = None
    try:
        body = await request.json()
        resume_id = body.get("resume_id")
        if resume_id:
            resume = await db.get_resume(resume_id)
            if not resume:
                raise AppError("resume.not_found", status_code=404)
            resume_text_override = resume["resume_text"]
    except Exception:
        pass
    score = await db.get_score(job_id)
    match_reasons = score["match_reasons"] if score else []
    suggested_keywords = score["suggested_keywords"] if score else []
    result = await tailor.prepare(
        job_description=job["description"] or "",
        match_reasons=match_reasons,
        suggested_keywords=suggested_keywords,
        resume_text=resume_text_override,
    )
    application = await db.get_application(job_id)
    if not application:
        app_id = await db.insert_application(job_id, "prepared")
    else:
        app_id = application["id"]
    await db.update_application(
        app_id, status="prepared",
        tailored_resume=result.get("tailored_resume", ""),
        cover_letter=result.get("cover_letter", ""),
    )
    await db.add_event(job_id, "prepared", "Application prepared")
    return {
        "job_id": job_id, "status": "prepared",
        "tailored_resume": result.get("tailored_resume", ""),
        "cover_letter": result.get("cover_letter", ""),
    }


@router.get("/jobs/{job_id}/resume.pdf")
async def download_resume_pdf(request: Request, job_id: int):
    from app.pdf_generator import generate_resume_pdf
    db = request.app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    application = await db.get_application(job_id)
    if not application or not application.get("tailored_resume"):
        raise AppError("tailoring.resume_missing", status_code=404)
    pdf_bytes = generate_resume_pdf(application["tailored_resume"])
    await db.add_event(job_id, "pdf_downloaded", "Resume PDF downloaded")
    # Sanitize filename — ASCII only, limit length
    safe_company = re.sub(r'[^\w\s-]', '', job.get('company', '')).strip()[:40]
    safe_title = re.sub(r'[^\w\s-]', '', job.get('title', '')).strip()[:40]
    filename = f"Resume - {safe_company} - {safe_title}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/jobs/{job_id}/cover-letter.pdf")
async def download_cover_letter_pdf(request: Request, job_id: int):
    from app.pdf_generator import generate_cover_letter_pdf
    db = request.app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    application = await db.get_application(job_id)
    if not application or not application.get("cover_letter"):
        raise AppError("tailoring.cover_letter_missing", status_code=404)
    pdf_bytes = generate_cover_letter_pdf(
        application["cover_letter"],
        company=job.get("company", ""),
        position=job.get("title", ""),
    )
    await db.add_event(job_id, "pdf_downloaded", "Cover letter PDF downloaded")
    safe_company = re.sub(r'[^\w\s-]', '', job.get('company', '')).strip()[:40]
    safe_title = re.sub(r'[^\w\s-]', '', job.get('title', '')).strip()[:40]
    filename = f"Cover Letter - {safe_company} - {safe_title}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/jobs/{job_id}/resume.docx")
async def download_resume_docx(request: Request, job_id: int):
    from app.docx_generator import generate_resume_docx
    db = request.app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    application = await db.get_application(job_id)
    if not application or not application.get("tailored_resume"):
        raise AppError("tailoring.resume_missing", status_code=404)
    docx_bytes = generate_resume_docx(application["tailored_resume"])
    await db.add_event(job_id, "docx_downloaded", "Resume DOCX downloaded")
    safe_company = re.sub(r'[^\w\s-]', '', job.get('company', '')).strip()[:40]
    safe_title = re.sub(r'[^\w\s-]', '', job.get('title', '')).strip()[:40]
    filename = f"Resume - {safe_company} - {safe_title}.docx"
    return Response(content=docx_bytes,
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/jobs/{job_id}/cover-letter.docx")
async def download_cover_letter_docx(request: Request, job_id: int):
    from app.docx_generator import generate_cover_letter_docx
    db = request.app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    application = await db.get_application(job_id)
    if not application or not application.get("cover_letter"):
        raise AppError("tailoring.cover_letter_missing", status_code=404)
    docx_bytes = generate_cover_letter_docx(
        application["cover_letter"],
        company=job.get("company", ""),
        position=job.get("title", ""),
    )
    await db.add_event(job_id, "docx_downloaded", "Cover letter DOCX downloaded")
    safe_company = re.sub(r'[^\w\s-]', '', job.get('company', '')).strip()[:40]
    safe_title = re.sub(r'[^\w\s-]', '', job.get('title', '')).strip()[:40]
    filename = f"Cover Letter - {safe_company} - {safe_title}.docx"
    return Response(content=docx_bytes,
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/jobs/{job_id}/generate-cover-letter")
async def generate_cover_letter_endpoint(request: Request, job_id: int):
    db = request.app.state.db
    client = getattr(request.app.state, "ai_client", None)
    if not client:
        raise AppError("ai.not_configured", status_code=503)
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    config = await db.get_search_config()
    resume_text = config["resume_text"] if config else ""
    if not resume_text:
        raise AppError("resume.missing", status_code=503)
    profile = await db.get_user_profile() or {}
    score = await db.get_score(job_id)
    match_reasons = score["match_reasons"] if score else []
    from app.cover_letter import generate_cover_letter
    result = await generate_cover_letter(
        client=client, job_title=job["title"], company=job["company"],
        job_description=job.get("description") or "", resume_text=resume_text,
        profile=profile, match_reasons=match_reasons,
    )
    app_record = await db.get_application(job_id)
    if app_record:
        await db.update_application(app_record["id"], cover_letter=result["cover_letter"])
    else:
        app_id = await db.insert_application(job_id, status="interested")
        await db.update_application(app_id, cover_letter=result["cover_letter"])
    return result


@router.put("/jobs/{job_id}/cover-letter")
async def save_cover_letter(request: Request, job_id: int):
    db = request.app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    body = await request.json()
    cover_letter = body.get("cover_letter", "")
    app_record = await db.get_application(job_id)
    if app_record:
        await db.update_application(app_record["id"], cover_letter=cover_letter)
    else:
        app_id = await db.insert_application(job_id, status="interested")
        await db.update_application(app_id, cover_letter=cover_letter)
    return {"ok": True}


@router.post("/jobs/{job_id}/interview-prep")
async def generate_interview_prep(request: Request, job_id: int):
    db = request.app.state.db
    client = getattr(request.app.state, "ai_client", None)
    if not client:
        raise AppError("ai.not_configured", status_code=503)
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    score = await db.get_score(job_id)
    company = await db.get_company(job["company"])
    work_history = await db.get_work_history()
    config = await db.get_search_config()
    resume_text = config["resume_text"] if config else ""

    company_context = ""
    if company:
        parts = []
        if company.get("description"):
            parts.append(f"About: {company['description']}")
        if company.get("glassdoor_rating"):
            parts.append(f"Glassdoor: {company['glassdoor_rating']}")
        company_context = "\n".join(parts)

    work_context = ""
    if work_history:
        entries = []
        for w in work_history[:5]:
            entry = f"- {w.get('job_title', '')} at {w.get('company', '')}"
            if w.get("description"):
                entry += f": {w['description'][:200]}"
            entries.append(entry)
        work_context = "\n".join(entries)

    match_context = ""
    if score:
        reasons = score.get("match_reasons", [])
        concerns = score.get("concerns", [])
        if reasons:
            match_context += "Match strengths: " + "; ".join(reasons) + "\n"
        if concerns:
            match_context += "Concerns: " + "; ".join(concerns)

    rag_context = ""
    emb_client = getattr(request.app.state, "embedding_client", None)
    if emb_client and getattr(db, "_vec_loaded", False):
        from app.embeddings import retrieve_relevant_context
        query = f"{job['title']} at {job['company']} {(job.get('description') or '')[:500]}"
        context_items = await retrieve_relevant_context(db.db, emb_client, query, limit=5)
        if context_items:
            rag_context = "\n".join(f"- [{c['type']}] {c['text'][:300]}" for c in context_items)

    # M9：生成四类中文题库（基础八股 / 项目深挖 / 场景设计 / HR 面）
    from app.interview_prep import generate_questions, progress_for, merge_existing_drafts
    try:
        questions = await generate_questions(
            client,
            title=job["title"],
            company=job["company"],
            description=job.get("description") or "",
            company_type=(company or {}).get("company_type", ""),
            seniority=config.get("seniority", "") if config else "",
            match_context=match_context,
            work_context=work_context + ("\n" + rag_context if rag_context else ""),
            resume_text=resume_text,
        )
        if not questions:
            raise ValueError("AI returned no questions")
    except Exception as e:
        logger.error(f"Interview prep generation failed for job {job_id}: {e}")
        raise AppError("ai.generation_failed", status_code=502, params={"error": str(e)})

    # 重新生成时按题干保留已写草稿与熟练状态
    previous = await db.get_interview_prep(job_id)
    questions = merge_existing_drafts(questions, (previous or {}).get("questions"))
    prep = {**(previous or {}), "questions": questions}
    await db.save_interview_prep(job_id, prep)
    await db.add_event(job_id, "interview_prep", f"Interview prep generated ({len(questions)} questions)")
    return {"job_id": job_id, "prep": prep, "progress": progress_for(questions)}


@router.get("/jobs/{job_id}/interview-prep")
async def get_interview_prep(request: Request, job_id: int):
    from app.interview_prep import progress_for
    prep = await request.app.state.db.get_interview_prep(job_id)
    if not prep:
        raise AppError("tailoring.interview_prep_missing", status_code=404)
    return {"prep": prep, "progress": progress_for(prep.get("questions"))}


@router.put("/jobs/{job_id}/interview-prep/questions/{index}")
async def update_interview_prep_question(request: Request, job_id: int, index: int):
    """保存单题的作答草稿 / 熟练状态 / 要点。"""
    from app.interview_prep import progress_for
    db = request.app.state.db
    body = await request.json()
    question = await db.update_interview_question(job_id, index, body or {})
    if question is None:
        prep = await db.get_interview_prep(job_id)
        if not prep:
            raise AppError("tailoring.interview_prep_missing", status_code=404)
        raise AppError("interview.question_not_found", status_code=404, params={"index": index})
    prep = await db.get_interview_prep(job_id)
    return {"ok": True, "question": question, "progress": progress_for(prep.get("questions"))}


@router.post("/jobs/{job_id}/interview-prep/questions/{index}/expand")
async def expand_interview_prep_question(request: Request, job_id: int, index: int):
    """AI 帮我补充要点（只引用简历里出现过的事实）。"""
    from app.interview_prep import expand_key_points, progress_for
    db = request.app.state.db
    client = getattr(request.app.state, "ai_client", None)
    if not client:
        raise AppError("ai.not_configured", status_code=503)
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    prep = await db.get_interview_prep(job_id)
    questions = (prep or {}).get("questions") or []
    if index < 0 or index >= len(questions):
        if not prep:
            raise AppError("tailoring.interview_prep_missing", status_code=404)
        raise AppError("interview.question_not_found", status_code=404, params={"index": index})
    config = await db.get_search_config()
    resume_text = config["resume_text"] if config else ""
    try:
        expanded = await expand_key_points(
            client,
            question=questions[index],
            title=job["title"],
            company=job["company"],
            description=job.get("description") or "",
            resume_text=resume_text,
        )
    except Exception as e:
        logger.error(f"Interview question expand failed for job {job_id} #{index}: {e}")
        raise AppError("ai.generation_failed", status_code=502, params={"error": str(e)})
    updated = await db.update_interview_question(job_id, index, expanded)
    prep = await db.get_interview_prep(job_id)
    return {"ok": True, "question": updated, "progress": progress_for(prep.get("questions"))}


@router.get("/interview-prep/sources")
async def list_interview_prep_sources(request: Request):
    """已有题库的职位列表，供「复制题库」选择来源（M9）。"""
    return {"sources": await request.app.state.db.list_interview_prep_sources()}


@router.post("/jobs/{job_id}/interview-prep/copy")
async def copy_interview_prep(request: Request, job_id: int):
    """把另一职位的题库复制到本职位（同类岗位复用）。"""
    from app.interview_prep import progress_for
    db = request.app.state.db
    body = await request.json()
    source_job_id = body.get("source_job_id")
    if not source_job_id:
        raise AppError("interview.source_required", status_code=400)
    if not await db.get_job(job_id):
        raise AppError("job.not_found", status_code=404)
    source = await db.get_interview_prep(int(source_job_id))
    questions = (source or {}).get("questions") or []
    if not questions:
        raise AppError("interview.source_empty", status_code=404)
    existing = await db.get_interview_prep(job_id)
    await db.save_interview_prep(job_id, {**(existing or {}), "questions": questions})
    await db.add_event(job_id, "interview_prep", f"Copied {len(questions)} questions from job {source_job_id}")
    return {"ok": True, "questions": questions, "progress": progress_for(questions)}
