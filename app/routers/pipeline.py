import json
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Query, Request
from app.database import APPLICATION_STATUSES
from app.errors import AppError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


async def _create_follow_up_reminder(db, job_id: int, days: int = 7):
    existing = await db.get_reminders_for_job(job_id)
    pending = [r for r in existing if r["status"] == "pending"]
    if not pending:
        remind_at = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
        await db.create_reminder(job_id, remind_at, "follow_up")
        logger.info(f"Created follow-up reminder for job {job_id} in {days} days")


@router.post("/jobs/{job_id}/apply")
async def apply_to_job(request: Request, job_id: int):
    db = request.app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    apply_url = job.get("apply_url") or job["url"]
    await db.upsert_application(job_id, status="applied")
    await db.add_event(job_id, "applied", "Applied via CareerPulse")
    await _create_follow_up_reminder(db, job_id)
    return {"url": apply_url, "status": "applied"}


@router.post("/jobs/{job_id}/application")
async def update_application(request: Request, job_id: int, status: str = Query(...), notes: str = Query("")):
    db = request.app.state.db
    # 状态必须是稳定英文枚举：界面把翻译结果当 value 提交时（中文下会传「已申请」），
    # 在这里直接拒绝，避免脏数据静默落库。
    if status not in APPLICATION_STATUSES:
        raise AppError(
            "job.invalid_status",
            status_code=400,
            params={"status": status, "allowed": ", ".join(APPLICATION_STATUSES)},
        )
    app_row = await db.get_application(job_id)
    if not app_row:
        await db.insert_application(job_id, status)
    else:
        await db.update_application(app_row["id"], status=status, notes=notes)
    if status == "applied":
        now = datetime.now(timezone.utc).isoformat()
        app_row = await db.get_application(job_id)
        if app_row and not app_row.get("applied_at"):
            await db.update_application(app_row["id"], applied_at=now)
        await _create_follow_up_reminder(db, job_id)
    await db.add_event(job_id, "status_change", f"Status changed to {status}")
    return {"ok": True}


@router.post("/jobs/{job_id}/response")
async def record_job_response(request: Request, job_id: int):
    body = await request.json()
    response_type = body.get("response_type", "").strip()
    valid_types = ("interview_invite", "rejection", "ghosted", "callback")
    if response_type not in valid_types:
        raise AppError("tailoring.invalid_response_type", status_code=400, params={"types": ", ".join(valid_types)})
    db = request.app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    try:
        result = await db.record_response(job_id, response_type)
    except ValueError as e:
        raise AppError("job.invalid_transition", status_code=404, params={"error": str(e)})
    return {"ok": True, **result}


@router.get("/analytics/response-rates")
async def get_response_rates(request: Request):
    return await request.app.state.db.get_response_analytics()


@router.get("/pipeline")
async def get_pipeline(request: Request):
    stats = await request.app.state.db.get_pipeline_stats()
    return {"stats": stats}


@router.get("/pipeline/{status}")
async def get_pipeline_jobs(request: Request, status: str):
    jobs = await request.app.state.db.get_pipeline_jobs(status)
    return {"jobs": jobs, "count": len(jobs)}


@router.post("/jobs/{job_id}/email")
async def draft_email(request: Request, job_id: int):
    from app.emailer import draft_application_email
    db = request.app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    application = await db.get_application(job_id)
    cover_letter = application.get("cover_letter", "") if application else ""
    if not cover_letter:
        raise AppError("tailoring.cover_letter_missing", status_code=400)
    email = draft_application_email(
        to=job.get("hiring_manager_email") or job.get("contact_email"),
        company=job["company"], position=job["title"],
        cover_letter=cover_letter, sender_name="Job Seeker", sender_email="",
    )
    if not email:
        raise AppError("tailoring.no_contact_email", status_code=400)
    if application:
        await db.update_application(application["id"], email_draft=json.dumps(email))
    await db.add_event(job_id, "email_drafted", "Email drafted")
    return {"job_id": job_id, "email": email}


@router.post("/jobs/{job_id}/send-email")
async def send_job_email(request: Request, job_id: int):
    from app.emailer import send_application_email
    db = request.app.state.db
    email_settings = await db.get_email_settings()
    if not email_settings or not email_settings.get("smtp_host"):
        raise AppError("email.smtp_not_configured", status_code=400)
    application = await db.get_application(job_id)
    if not application or not application.get("email_draft"):
        raise AppError("tailoring.email_draft_missing", status_code=400)
    email_draft = json.loads(application["email_draft"])
    success = await send_application_email(email_settings, email_draft)
    if not success:
        raise AppError("email.send_failed", status_code=500)
    await db.add_event(job_id, "email_sent", f"Email sent to {email_draft.get('to', '')}")
    return {"ok": True, "message": "Email sent"}


@router.get("/reminders")
async def get_reminders(request: Request, status: str = Query(None)):
    reminders = await request.app.state.db.get_reminders(status=status, include_job=True)
    return {"reminders": reminders}


@router.get("/reminders/due")
async def get_due_reminders(request: Request):
    due = await request.app.state.db.get_due_reminders()
    return {"reminders": due}


@router.post("/jobs/{job_id}/reminders")
async def create_reminder(request: Request, job_id: int):
    db = request.app.state.db
    job = await db.get_job(job_id)
    if not job:
        raise AppError("job.not_found", status_code=404)
    body = await request.json()
    remind_at = body.get("remind_at")
    reminder_type = body.get("type", "follow_up")
    if not remind_at:
        raise AppError("pipeline.remind_at_required", status_code=400)
    rid = await db.create_reminder(job_id, remind_at, reminder_type)
    return {"ok": True, "reminder_id": rid}


@router.post("/reminders/{reminder_id}/complete")
async def complete_reminder(request: Request, reminder_id: int):
    await request.app.state.db.complete_reminder(reminder_id)
    return {"ok": True}


@router.post("/reminders/{reminder_id}/dismiss")
async def dismiss_reminder(request: Request, reminder_id: int):
    await request.app.state.db.dismiss_reminder(reminder_id)
    return {"ok": True}


@router.get("/follow-up-templates")
async def list_follow_up_templates(request: Request):
    templates = await request.app.state.db.get_follow_up_templates()
    return {"templates": templates}


@router.post("/follow-up-templates")
async def create_follow_up_template(request: Request):
    body = await request.json()
    name = body.get("name", "").strip()
    if not name:
        raise AppError("pipeline.template_name_required", status_code=400)
    db = request.app.state.db
    template_id = await db.create_follow_up_template(
        name=name, days_after=body.get("days_after", 7),
        template_text=body.get("template_text", ""),
        is_default=body.get("is_default", False),
    )
    template = await db.get_follow_up_template(template_id)
    return {"ok": True, "template": template}


@router.put("/follow-up-templates/{template_id}")
async def update_follow_up_template(request: Request, template_id: int):
    body = await request.json()
    fields = {}
    for key in ("name", "days_after", "template_text", "is_default"):
        if key in body:
            fields[key] = body[key]
    if not fields:
        raise AppError("validation.no_fields_to_update", status_code=400)
    db = request.app.state.db
    updated = await db.update_follow_up_template(template_id, **fields)
    if not updated:
        raise AppError("template.not_found", status_code=404)
    template = await db.get_follow_up_template(template_id)
    return {"ok": True, "template": template}


@router.delete("/follow-up-templates/{template_id}")
async def delete_follow_up_template(request: Request, template_id: int):
    deleted = await request.app.state.db.delete_follow_up_template(template_id)
    if not deleted:
        raise AppError("template.not_found", status_code=404)
    return {"ok": True}
