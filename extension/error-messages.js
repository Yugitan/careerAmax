// === Extension error localization ===
//
// The CareerPulse backend returns stable, non-localized errors:
//     { "code": "resume.not_found", "params": {}, "detail": "Resume not found" }
// `code` is the contract; `detail`/`error` is a non-localized fallback. Messages
// coming from third parties (AI providers, job boards, the extension API) keep
// their original text behind a localized prefix.
//
// Mirrors `errorKeyFromCode`/`apiErrorMessage` in app/static/js/api.js so both
// sides resolve the same codes to the same translations.

// eslint-disable-next-line -- example code, not interface copy
/** `resume.not_found` -> `errors.resumeNotFound` */ // i18n-audit-ignore: doc example
function errorKeyFromCode(code) {
    if (!code || typeof code !== 'string') return null;
    return 'errors.' + code
        .split(/[.\-_]/)
        .filter(Boolean)
        .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
        .join('');
}

function extHasTranslation(key) {
    return typeof i18n !== 'undefined' && i18n.has(key);
}

/**
 * Message for an error payload/Error coming from the API or the background
 * worker. Known codes become localized text; unknown ones keep their raw text
 * behind the localized `errors.dynamic` prefix.
 */
function extErrorMessage(err) {
    if (!err) return typeof t === 'function' ? t('errors.unknownError') : 'Unknown error'; // i18n-audit-ignore: fallback when the i18n module is absent
    const payload = (err && typeof err === 'object') ? err : {};
    const code = payload.code;
    const params = payload.params || {};
    const raw = payload.detail || payload.error || (typeof err === 'string' ? err : err.message) || '';
    if (code) {
        const key = errorKeyFromCode(code);
        if (extHasTranslation(key)) return t(key, params);
    }
    if (raw) {
        if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
            return t('errors.network');
        }
        if (code) return t('errors.dynamic', { detail: raw });
        return raw;
    }
    return t('errors.unknownError');
}

// Expose on the global scope: popup.js and content.js run as classic scripts
// (and are eval'd in tests), so top-level declarations must be reachable.
(function (global) {
    global.errorKeyFromCode = errorKeyFromCode;
    global.extHasTranslation = extHasTranslation;
    global.extErrorMessage = extErrorMessage;
}(typeof globalThis !== 'undefined' ? globalThis : this));
