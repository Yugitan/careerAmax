"""Stable, non-localized application errors.

User-visible backend errors must not depend on English strings: the client
translates a stable `code` and interpolates `params`. The English `detail` is
kept as a fallback for logs, curl and clients that do not translate.

Response body produced by the handler registered in `app.main`:

    {
      "code": "resume.not_found",
      "params": {},
      "detail": "Resume not found"
    }

Usage:

    from app.errors import AppError

    raise AppError("job.not_found", status_code=404)
    raise AppError("ai.generation_failed", status_code=502,
                   params={"error": str(exc)},
                   detail=f"AI generation failed: {exc}")

Codes and their English fallback text live in `ERROR_MESSAGES`. The frontend
derives its translation key from the code (`ai.not_configured` ->
`errors.aiNotConfigured`); see docs/i18n.md.
"""

from __future__ import annotations

from typing import Any

# Canonical English fallback text per error code. `{placeholders}` are filled
# from `params`; when a placeholder is missing the literal placeholder is kept
# so a mistake is visible instead of silently swallowed.
ERROR_MESSAGES: dict[str, str] = {
    # --- jobs ---
    "job.not_found": "Job not found",
    "job.title_and_company_required": "title and company are required",
    "job.detail_required": "Detail is required",
    "job.invalid_event_type": "Invalid event_type: {event_type}",
    "job.url_required": "url is required",
    "job.invalid_transition": "{error}",

    # --- AI providers ---
    "ai.not_configured": "No AI provider configured. Go to Settings → AI to set one up.",
    "ai.generation_failed": "AI generation failed: {error}",
    "ai.analysis_failed": "AI analysis failed: {error}",
    "ai.invalid_provider": "Provider must be one of: {providers}",
    "ai.provider_unsupported": "Provider must be 'openai' or 'ollama'",
    "ai.embeddings_not_configured": "Embeddings not configured",
    "ai.models_failed": "Could not fetch models: {error}",
    "ai.connection_failed": "Connection test failed: {error}",

    # --- autofill (payload-level codes; the raw text stays in `error`) ---
    "autofill.ai_unavailable": "No AI provider for remaining fields",
    "autofill.analysis_timeout": "AI analysis timed out after {seconds}s",
    "autofill.parse_failed": "Failed to parse AI response",

    # --- resumes ---
    "resume.not_found": "Resume not found",
    "resume.missing": "No resume uploaded. Go to Settings → Resume to upload one.",
    "resume.name_required": "Resume name is required",
    "resume.name_empty": "Resume name cannot be empty",
    "resume.unsupported_file_type": "Unsupported file type: {ext}. Allowed: {allowed}",
    "resume.file_too_large": "File too large ({size} bytes). Maximum: {max_mb}MB",

    # --- tailoring / generated documents ---
    "tailoring.resume_missing": "No tailored resume prepared for this job",
    "tailoring.cover_letter_missing": "No cover letter prepared for this job",
    "tailoring.email_draft_missing": "No email draft for this job",
    "tailoring.interview_prep_missing": "No interview prep found",
    "tailoring.analysis_failed": "Analysis failed: {error}",
    "tailoring.no_contact_email": "No contact email available for this job",
    "tailoring.invalid_response_type": "response_type must be one of: {types}",

    # --- pipeline / applications ---
    "pipeline.remind_at_required": "remind_at is required",
    "pipeline.template_name_required": "Template name is required",
    "template.not_found": "Template not found",
    "suggestion.not_found": "Suggestion not found",
    "offer.not_found": "Offer not found",
    "link.not_found": "Link not found",

    # --- autofill queue ---
    "queue.item_not_found": "Queue item not found",
    "queue.job_id_required": "job_id is required",

    # --- contacts ---
    "contact.not_found": "Contact not found",
    "contact.name_required": "Contact name is required",
    "contact.id_required": "contact_id is required",

    # --- analytics ---
    "analytics.digest_failed": "Digest not sent — check email settings and digest configuration",

    # --- settings ---
    "view.not_found": "View not found",
    "view.name_required": "View name is required",
    "view.name_empty": "View name cannot be empty",
    "settings.search_terms_invalid": "search_terms must be a list",
    "settings.exclude_terms_invalid": "exclude_terms must be a list",
    "settings.allowed_regions_invalid": "allowed_regions must be a list",
    "settings.remote_only_invalid": "remote_only must be a boolean",
    "settings.source_config_required": "source_name and interval_hours required",

    # --- email ---
    "email.smtp_not_configured": "SMTP not configured",
    "email.from_required": "From address required for test",
    "email.send_failed": "Failed to send email",
    "email.test_failed": "Failed to send test email — check SMTP settings",

    # --- alerts ---
    "alert.not_found": "Alert not found",
    "alert.name_required": "Alert name is required",

    # --- interviews ---
    "interview.round_not_found": "Interview round not found",
    "interview.interviewer_name_required": "No interviewer name to promote",

    # --- calendar ---
    "calendar.token_required": "Token required",
    "calendar.invalid_token": "Invalid token",

    # --- generic validation ---
    "validation.no_fields_to_update": "No fields to update",
}


def render_detail(code: str, params: dict[str, Any] | None = None) -> str:
    """English fallback text for `code`, with `params` interpolated."""
    template = ERROR_MESSAGES.get(code)
    if template is None:
        return code
    if not params:
        return template
    rendered = template
    for key, value in params.items():
        rendered = rendered.replace("{" + key + "}", str(value))
    return rendered


class AppError(Exception):
    """Application error carrying a stable code plus interpolation params."""

    def __init__(
        self,
        code: str,
        status_code: int = 400,
        params: dict[str, Any] | None = None,
        detail: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.code = code
        self.status_code = status_code
        self.params = params or {}
        self.detail = detail if detail is not None else render_detail(code, self.params)
        self.headers = headers
        super().__init__(self.detail)

    def to_payload(self) -> dict[str, Any]:
        return {"code": self.code, "params": self.params, "detail": self.detail}
