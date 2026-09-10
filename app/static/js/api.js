// === Error Localization ===
//
// The backend returns stable, non-localized errors:
//     { "code": "resume.not_found", "params": {}, "detail": "Resume not found" }
// `code` is the contract; `detail` is an English fallback for logs and for
// clients that do not translate. Dynamic text coming from AI providers, job
// boards or other third parties is never translated: it is shown with a
// localized prefix instead.

/** `resume.not_found` -> `errors.resumeNotFound` */
function errorKeyFromCode(code) {
    if (!code || typeof code !== 'string') return null;
    const camel = code
        .split(/[.\-_]/)
        .filter(Boolean)
        .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
        .join('');
    return `errors.${camel}`;
}

function hasTranslation(key) {
    return typeof i18n !== 'undefined' && i18n.has(key);
}

function t18n(key, params) {
    return typeof t === 'function' ? t(key, params) : key;
}

/**
 * Build a user-facing message for a failed API call.
 * Returns a localized message whenever the backend supplied a known code.
 */
function localizeApiError(payload, status) {
    const code = payload && payload.code;
    const params = (payload && payload.params) || {};
    const detail = (payload && (payload.detail || payload.error)) || '';
    const key = errorKeyFromCode(code);
    if (key && hasTranslation(key)) return t18n(key, params);
    if (code && detail) return t18n('errors.dynamic', { detail });
    if (detail) return detail;
    return t18n('errors.requestFailed', { status: status || '' });
}

/** Turn a failed response into an Error carrying code/params/detail. */
function createApiError(payload, status) {
    const error = new Error(localizeApiError(payload, status));
    error.code = (payload && payload.code) || null;
    error.params = (payload && payload.params) || {};
    error.detail = (payload && (payload.detail || payload.error)) || '';
    error.status = status || 0;
    error.localized = true;
    return error;
}

/**
 * Message for any error thrown from a view. API errors are already localized;
 * transport failures get a localized network message.
 */
function apiErrorMessage(err) {
    if (!err) return t18n('errors.unknownError');
    if (err.localized && err.message) return err.message;
    const raw = err.message || String(err);
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
        return t18n('errors.network');
    }
    if (err.code) {
        const key = errorKeyFromCode(err.code);
        if (hasTranslation(key)) return t18n(key, err.params || {});
    }
    return raw || t18n('errors.unknownError');
}

// === API Client ===
const api = {
    async request(method, path, body = null) {
        const opts = { method, headers: {} };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(path, opts);
        if (!res.ok) {
            // Non-JSON error bodies fall back to the HTTP status text, which is
            // raw server text and intentionally not translated.
            const payload = await res.json().catch(() => ({ detail: res.statusText }));
            throw createApiError(payload, res.status);
        }
        return res.json();
    },

    getJobs(params = {}) {
        const qs = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
            if (v !== null && v !== undefined && v !== '') qs.set(k, v);
        });
        return this.request('GET', `/api/jobs?${qs}`);
    },

    getJob(id) {
        return this.request('GET', `/api/jobs/${id}`);
    },

    getStats() {
        return this.request('GET', '/api/stats');
    },

    dismissJob(id) {
        return this.request('POST', `/api/jobs/${id}/dismiss`);
    },

    getNotifications(unread = false) {
        return this.request('GET', `/api/notifications?unread=${unread}`);
    },

    markNotificationRead(id) {
        return this.request('POST', `/api/notifications/${id}/read`);
    },

    markAllNotificationsRead() {
        return this.request('POST', '/api/notifications/read-all');
    },

    prepareApplication(id, resumeId = null) {
        const body = resumeId ? { resume_id: resumeId } : null;
        return this.request('POST', `/api/jobs/${id}/prepare`, body);
    },

    updateApplication(id, status, notes = '') {
        const qs = new URLSearchParams({ status, notes });
        return this.request('POST', `/api/jobs/${id}/application?${qs}`);
    },

    async triggerScrape() {
        const res = await fetch('/api/scrape', { method: 'POST' });
        const body = await res.json().catch(() => ({}));
        if (res.status === 202 || res.status === 409) {
            return {
                task_id: body.task_id || null,
                status: res.status === 409 ? 'already_running' : (body.status || 'started'),
            };
        }
        throw createApiError(body, res.status);
    },

    getScrapeProgress() {
        return this.request('GET', '/api/scrape/progress');
    },

    cancelScrape() {
        return this.request('POST', '/api/scrape/cancel');
    },

    draftEmail(id) {
        return this.request('POST', `/api/jobs/${id}/email`);
    },

    generateCoverLetter(id) {
        return this.request('POST', `/api/jobs/${id}/generate-cover-letter`);
    },

    addEvent(id, detail, eventType = 'note') {
        return this.request('POST', `/api/jobs/${id}/events`, { detail, event_type: eventType });
    },

    getSearchConfig() {
        return this.request('GET', '/api/search-config');
    },

    updateSearchTerms(terms) {
        return this.request('POST', '/api/search-config/terms', { search_terms: terms });
    },

    async uploadResume(file) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/resume/upload', { method: 'POST', body: formData });
        if (!res.ok) {
            const payload = await res.json().catch(() => ({ detail: res.statusText }));
            throw createApiError(payload, res.status);
        }
        return res.json();
    },

    getAISettings() {
        return this.request('GET', '/api/ai-settings');
    },

    updateAISettings(settings) {
        return this.request('POST', '/api/ai-settings', settings);
    },

    testAIConnection(settings) {
        return this.request('POST', '/api/ai-settings/test', settings);
    },

    getOllamaModels(baseUrl) {
        const qs = new URLSearchParams({ base_url: baseUrl || 'http://localhost:11434' });
        return this.request('GET', `/api/ai-settings/models?${qs}`);
    },

    // === Interview Rounds ===

    getInterviews(jobId) {
        return this.request('GET', `/api/jobs/${jobId}/interviews`);
    },

    createInterview(jobId, data) {
        return this.request('POST', `/api/jobs/${jobId}/interviews`, data);
    },

    updateInterview(id, data) {
        return this.request('PUT', `/api/interviews/${id}`, data);
    },

    deleteInterview(id) {
        return this.request('DELETE', `/api/interviews/${id}`);
    },

    promoteInterviewer(interviewId, contactData) {
        return this.request('POST', `/api/interviews/${interviewId}/promote-interviewer`, contactData);
    },

    // === Calendar ===

    getCalendarEvents(params = {}) {
        const qs = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
            if (v !== null && v !== undefined && v !== '') qs.set(k, v);
        });
        return this.request('GET', `/api/calendar?${qs}`);
    },

    getIcalToken() {
        return this.request('GET', '/api/calendar/ical-token');
    },

    regenerateIcalToken() {
        return this.request('POST', '/api/calendar/ical-token');
    },

    // === External Jobs ===

    saveExternalJob(data) {
        return this.request('POST', '/api/jobs/save-external', data);
    },
};
