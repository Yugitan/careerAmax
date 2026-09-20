// === CareerPulse i18n Core (Web) ===
//
// Single entry point for all user-visible interface copy in the web app.
//
// Rules (see docs/i18n.md):
//   * No user-visible string may be hardcoded in templates or view scripts.
//     Every string goes through `t(key, params)`.
//   * Business content (job titles, company names, AI generated text, email
//     bodies) is NOT translated — it is rendered verbatim as raw content.
//   * Money is always CNY (yuan) and is presented as a monthly salary.
//     `formatCurrency()` keeps its existing rules — amounts are never converted.
//
// Translation catalogs live in `app/static/js/locales/*.js` and are registered
// through `i18n.register(namespace, { en: {...}, 'zh-CN': {...} })`.
//
// Language resolution: stored value in localStorage -> default `zh-CN`.
// There is deliberately NO browser-language auto detection.

(function (global) {
    'use strict';

    const SUPPORTED_LANGUAGES = ['zh-CN', 'en'];
    const DEFAULT_LANGUAGE = 'zh-CN';
    const FALLBACK_LANGUAGE = 'en';
    const STORAGE_KEY = 'careerpulse_lang';
    const DEBUG_FLAG = '__CP_I18N_DEBUG__';

    // catalogs[lang][flatKey] = string
    const _catalogs = {};
    SUPPORTED_LANGUAGES.forEach((lang) => { _catalogs[lang] = {}; });

    const _listeners = [];
    const _missingKeys = new Set();     // keys that could not be resolved at all
    const _fallbackKeys = new Set();    // keys resolved through the English fallback
    const _warned = new Set();
    let _current = DEFAULT_LANGUAGE;

    // ---------------------------------------------------------------------
    // Language helpers
    // ---------------------------------------------------------------------

    /** Normalize arbitrary locale input to a supported language code. */
    function normalizeLanguage(value) {
        if (!value || typeof value !== 'string') return null;
        const raw = value.trim();
        if (!raw) return null;
        const lower = raw.toLowerCase().replace(/_/g, '-');
        if (lower === 'zh' || lower.startsWith('zh-')) return 'zh-CN';
        if (lower === 'en' || lower.startsWith('en-')) return 'en';
        return null;
    }

    function isDevMode() {
        if (global[DEBUG_FLAG] === true) return true;
        if (global[DEBUG_FLAG] === false) return false;
        try {
            const host = global.location && global.location.hostname;
            if (host && /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(host)) return true;
            const search = global.location && global.location.search;
            if (search && /[?&]i18n_debug=1/.test(search)) return true;
        } catch { /* ignore */ }
        return false;
    }

    function warn(message, detail) {
        if (!isDevMode()) return;
        const signature = `${message}:${JSON.stringify(detail || {})}`;
        if (_warned.has(signature)) return;
        _warned.add(signature);
        try { console.warn(`[i18n] ${message}`, detail || ''); } catch { /* ignore */ }
    }

    function readStoredLanguage() {
        try {
            const stored = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
            const normalized = normalizeLanguage(stored);
            if (normalized) return normalized;
            if (stored) warn('Unsupported stored language, falling back to default', { stored, fallback: DEFAULT_LANGUAGE });
        } catch { /* localStorage unavailable */ }
        return DEFAULT_LANGUAGE;
    }

    function persistLanguage(lang) {
        try {
            if (global.localStorage) global.localStorage.setItem(STORAGE_KEY, lang);
        } catch { /* ignore (private mode / disabled storage) */ }
    }

    function syncDocumentLanguage() {
        try {
            if (global.document && global.document.documentElement) {
                global.document.documentElement.setAttribute('lang', _current);
            }
        } catch { /* ignore */ }
    }

    function getLanguage() { return _current; }

    function isSupportedLanguage(value) { return SUPPORTED_LANGUAGES.includes(value); }

    /**
     * Switch the interface language.
     * Persists the choice and notifies listeners. Rendering is the caller's job
     * (the web app re-renders the active view after the user confirms).
     */
    function setLanguage(lang, options = {}) {
        const normalized = normalizeLanguage(lang);
        if (!normalized) {
            warn('Ignoring unsupported language', { lang });
            return _current;
        }
        if (normalized === _current && !options.force) return _current;
        _current = normalized;
        persistLanguage(normalized);
        syncDocumentLanguage();
        _listeners.forEach((fn) => {
            try { fn(normalized); } catch (err) { warn('Language listener threw', { error: String(err) }); }
        });
        return _current;
    }

    function onChange(fn) {
        if (typeof fn === 'function') _listeners.push(fn);
        return () => {
            const idx = _listeners.indexOf(fn);
            if (idx >= 0) _listeners.splice(idx, 1);
        };
    }

    /** Initialize from storage (call once at startup). */
    function init(options = {}) {
        _current = normalizeLanguage(options.language) || readStoredLanguage();
        syncDocumentLanguage();
        return _current;
    }

    // ---------------------------------------------------------------------
    // Catalog registration
    // ---------------------------------------------------------------------

    function flatten(source, prefix, out) {
        Object.keys(source).forEach((key) => {
            const value = source[key];
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                flatten(value, fullKey, out);
            } else if (typeof value === 'string') {
                out.push([fullKey, value]);
            } else if (value !== undefined && value !== null) {
                warn('Ignoring non-string translation value', { key: fullKey });
            }
        });
        return out;
    }

    /**
     * Register a catalog slice.
     * i18n.register('nav', { en: { jobs: 'Jobs' }, 'zh-CN': { jobs: '职位' } })
     * -> keys `nav.jobs` for both languages.
     * Nested objects are flattened: { profile: { title: 'x' } } -> `ns.profile.title`.
     */
    function register(namespace, catalog) {
        if (!namespace || typeof namespace !== 'string') {
            warn('register() requires a namespace', { namespace });
            return;
        }
        if (!catalog || typeof catalog !== 'object') {
            warn('register() requires a catalog object', { namespace });
            return;
        }
        Object.keys(catalog).forEach((rawLang) => {
            const lang = normalizeLanguage(rawLang);
            if (!lang) {
                warn('Ignoring catalog for unsupported language', { namespace, lang: rawLang });
                return;
            }
            const entries = flatten(catalog[rawLang], namespace, []);
            entries.forEach(([key, value]) => {
                const bucket = _catalogs[lang];
                if (bucket[key] !== undefined && bucket[key] !== value) {
                    warn('Duplicate translation key definition', { key, lang });
                }
                bucket[key] = value;
            });
        });
    }

    // ---------------------------------------------------------------------
    // Translation lookup
    // ---------------------------------------------------------------------

    function lookup(lang, key) {
        const bucket = _catalogs[lang];
        if (!bucket) return undefined;
        return Object.prototype.hasOwnProperty.call(bucket, key) ? bucket[key] : undefined;
    }

    function interpolate(template, params) {
        if (!params) return template;
        return template.replace(/\{(\w+)\}/g, (match, name) => {
            if (Object.prototype.hasOwnProperty.call(params, name) && params[name] !== undefined && params[name] !== null) {
                return String(params[name]);
            }
            warn('Missing interpolation parameter', { placeholder: name, template });
            return match;
        });
    }

    /** Plural convention: "1 job|{count} jobs" (English), Chinese has no "|". */
    function applyPlural(template, params) {
        if (template.indexOf('|') === -1) return template;
        const forms = template.split('|');
        if (!params || params.count === undefined) {
            warn('Plural translation used without a `count` parameter', { template });
            return forms[forms.length - 1];
        }
        const count = Number(params.count);
        return count === 1 ? forms[0] : forms[forms.length - 1];
    }

    /**
     * Translate `key` using the current language, falling back to English and
     * finally to the key itself (recording the miss).
     */
    function t(key, params) {
        if (!key || typeof key !== 'string') {
            warn('t() called without a translation key', { key });
            return '';
        }
        let value = lookup(_current, key);
        if (value === undefined && _current !== FALLBACK_LANGUAGE) {
            const fallback = lookup(FALLBACK_LANGUAGE, key);
            if (fallback !== undefined) {
                _fallbackKeys.add(key);
                warn('Missing translation, falling back to English', { key, lang: _current });
                value = fallback;
            }
        }
        if (value === undefined) {
            _missingKeys.add(key);
            warn('Missing translation key', { key, lang: _current });
            return key;
        }
        return interpolate(applyPlural(value, params), params);
    }

    function has(key) {
        return lookup(_current, key) !== undefined || lookup(FALLBACK_LANGUAGE, key) !== undefined;
    }

    function getMissingKeys() { return Array.from(_missingKeys); }
    function getFallbackKeys() { return Array.from(_fallbackKeys); }
    function resetMissingKeys() { _missingKeys.clear(); _fallbackKeys.clear(); _warned.clear(); }

    /** All keys defined for a language (used by parity/audit tests). */
    function keys(lang) {
        const target = normalizeLanguage(lang) || _current;
        return Object.keys(_catalogs[target] || {}).sort();
    }

    function catalog(lang) {
        const target = normalizeLanguage(lang) || _current;
        return Object.assign({}, _catalogs[target] || {});
    }

    // ---------------------------------------------------------------------
    // Static DOM binding
    // ---------------------------------------------------------------------

    /**
     * Apply translations to `[data-i18n*]` elements inside `root`.
     * Supported attributes:
     *   data-i18n               -> textContent
     *   data-i18n-placeholder   -> placeholder
     *   data-i18n-title         -> title
     *   data-i18n-aria-label    -> aria-label
     *   data-i18n-html          -> innerHTML (only for catalogs we control)
     */
    function applyStatic(root) {
        const scope = root || global.document;
        if (!scope || !scope.querySelectorAll) return;
        scope.querySelectorAll('[data-i18n]').forEach((el) => {
            el.textContent = t(el.getAttribute('data-i18n'));
        });
        scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
            el.innerHTML = t(el.getAttribute('data-i18n-html'));
        });
        scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
        });
        scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
            el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
        });
        scope.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
            el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
        });
    }

    // ---------------------------------------------------------------------
    // Date / time / number formatting (language aware)
    // ---------------------------------------------------------------------

    function intlLocale() { return _current === 'zh-CN' ? 'zh-CN' : 'en-US'; }

    function toDate(value) {
        if (value === null || value === undefined || value === '') return null;
        if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
        if (typeof value === 'number') {
            const fromNumber = new Date(value);
            return isNaN(fromNumber.getTime()) ? null : fromNumber;
        }
        const raw = String(value).trim();
        // `YYYY-MM-DD` / `YYYY-MM-DD HH:MM(:SS)` (SQLite style) are calendar
        // dates without a timezone: parse them as local wall-clock time.
        const local = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
        if (local) {
            return new Date(
                Number(local[1]), Number(local[2]) - 1, Number(local[3]),
                Number(local[4] || 0), Number(local[5] || 0), Number(local[6] || 0),
            );
        }
        const parsed = new Date(raw);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    function formatWith(value, options, fallback = '') {
        const date = toDate(value);
        if (!date) return typeof value === 'string' ? value : fallback;
        try {
            return new Intl.DateTimeFormat(intlLocale(), options).format(date);
        } catch {
            return date.toISOString();
        }
    }

    /** Short calendar date: "Mar 5" / "3月5日". */
    function formatDate(value) { return formatWith(value, { month: 'short', day: 'numeric' }); }

    /** Long calendar date: "Mar 5, 2026" / "2026年3月5日". */
    function formatDateLong(value) { return formatWith(value, { year: 'numeric', month: 'short', day: 'numeric' }); }

    /** Date + time: "Mar 5, 2026, 2:30 PM" / "2026年3月5日 14:30". */
    function formatDateTime(value) {
        return formatWith(value, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    /** Time only: "2:30 PM" / "14:30". */
    function formatTime(value) { return formatWith(value, { hour: 'numeric', minute: '2-digit' }); }

    /** Month + year, e.g. calendar header: "March 2026" / "2026年3月". */
    function formatMonthYear(value) { return formatWith(value, { year: 'numeric', month: 'long' }); }

    /** Weekday + date, no year: "Wed, Mar 5" / "3月5日周三". */
    function formatWeekdayDate(value) { return formatWith(value, { weekday: 'short', month: 'short', day: 'numeric' }); }

    /** Full date with weekday: "Thursday, March 5, 2026". */
    function formatWeekdayDateLong(value) {
        return formatWith(value, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }

    /** Short weekday name for calendar headers: "Mon" / "周一". */
    function formatWeekday(value) {
        const date = toDate(value) || (value instanceof Date ? value : null);
        if (!date) return '';
        try {
            return new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(date);
        } catch { return ''; }
    }

    /** Weekday names for a full week starting on `start` (default: Sunday). */
    function weekdayNames(startDate) {
        const start = startDate ? toDate(startDate) : new Date(2024, 0, 7); // a Sunday
        if (!start) return [];
        return Array.from({ length: 7 }, (_, i) => formatWeekday(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
    }

    /**
     * Relative time label: "just now", "5m ago", "3d ago", "2w ago" (en)
     * / "刚刚", "5 分钟前", "3 天前", "2 周前" (zh).
     * Falls back to a short date for anything older than 30 days.
     */
    function formatRelativeTime(value, options = {}) {
        const date = toDate(value);
        if (!date) return typeof value === 'string' ? value : '';
        const diffMs = Date.now() - date.getTime();
        const minutes = Math.floor(diffMs / 60000);
        if (minutes < 1) return t('time.justNow');
        if (minutes < 60) return t('time.minutesAgo', { count: minutes, n: minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return t('time.hoursAgo', { count: hours, n: hours });
        const days = Math.floor(hours / 24);
        if (days === 0) return t('time.today');
        if (days === 1) return t('time.yesterday');
        if (days < 7) return t('time.daysAgo', { count: days, n: days });
        if (days < 30) return t('time.weeksAgo', { count: Math.floor(days / 7), n: Math.floor(days / 7) });
        if (options.absolute) return formatDate(date);
        return formatDate(date);
    }

    /** Number formatting (never used for money — money stays CNY). */
    function formatNumber(value, options) {
        const num = Number(value);
        if (!isFinite(num)) return String(value);
        try {
            return new Intl.NumberFormat(intlLocale(), options).format(num);
        } catch { return String(num); }
    }

    function formatPercent(value, fractionDigits = 0) {
        const num = Number(value);
        if (!isFinite(num)) return String(value);
        try {
            return new Intl.NumberFormat(intlLocale(), {
                style: 'percent', minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits,
            }).format(num);
        } catch { return `${num}%`; }
    }

    const i18n = {
        SUPPORTED_LANGUAGES,
        DEFAULT_LANGUAGE,
        FALLBACK_LANGUAGE,
        STORAGE_KEY,
        t,
        register,
        init,
        getLanguage,
        setLanguage,
        onChange,
        normalizeLanguage,
        isSupportedLanguage,
        has,
        keys,
        catalog,
        getMissingKeys,
        getFallbackKeys,
        resetMissingKeys,
        isDevMode,
        applyStatic,
        toDate,
        locale: intlLocale,
        formatDate,
        formatDateLong,
        formatDateTime,
        formatTime,
        formatMonthYear,
        formatWeekday,
        formatWeekdayDate,
        formatWeekdayDateLong,
        weekdayNames,
        formatRelativeTime,
        formatNumber,
        formatPercent,
    };

    global.i18n = i18n;
    // Ergonomic global alias. Scripts with a local `t` must rename it.
    global.t = t;

    // Start from storage immediately so early scripts can render right away.
    init();
}(typeof globalThis !== 'undefined' ? globalThis : this));
