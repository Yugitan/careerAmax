// === CareerPulse i18n Core (Chrome extension) ===
//
// Same API as the web module (app/static/js/i18n.js) so the two sides share one
// translation key and terminology scheme (see docs/i18n.md):
//
//   t(key, params)            translate + interpolate {placeholders}
//   i18n.init()               read the stored language (async)
//   i18n.getLanguage()        current language code
//   i18n.setLanguage(lang)    persist to chrome.storage.local and notify
//   i18n.onChange(fn)         react to language changes
//   i18n.formatDate(...)      language aware date/time/number helpers
//
// The extension keeps its OWN language setting (chrome.storage.local.language),
// independent from the web app's localStorage. The default is Simplified
// Chinese; the browser language is never used to pick a language.
//
// `t()` works synchronously before `init()` resolves, using the default
// language, so rendering code does not need to be async.

(function (global) {
    'use strict';

    const SUPPORTED_LANGUAGES = ['zh-CN', 'en'];
    const DEFAULT_LANGUAGE = 'zh-CN';
    const FALLBACK_LANGUAGE = 'en';
    const STORAGE_KEY = 'language';
    const DEBUG_FLAG = '__CP_I18N_DEBUG__';

    const _catalogs = {};
    SUPPORTED_LANGUAGES.forEach((lang) => { _catalogs[lang] = {}; });

    const _listeners = [];
    const _missingKeys = new Set();
    const _fallbackKeys = new Set();
    const _warned = new Set();
    let _current = DEFAULT_LANGUAGE;
    let _storageWatcherAttached = false;

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
            const params = new URLSearchParams(global.location && global.location.search);
            if (params.get('i18n_debug') === '1') return true;
        } catch { /* ignore */ }
        // Unpacked extensions load from a chrome-extension:// URL; treat that as
        // development so missing keys are visible while building the extension.
        try {
            if (global.location && String(global.location.protocol) === 'chrome-extension:') return true;
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

    function storageArea() {
        try {
            if (global.chrome && global.chrome.storage && global.chrome.storage.local) {
                return global.chrome.storage.local;
            }
        } catch { /* ignore */ }
        return null;
    }

    function persistLanguage(lang) {
        const area = storageArea();
        if (!area) { warn('chrome.storage.local unavailable, language not persisted', { lang }); return; }
        try {
            const result = area.set({ [STORAGE_KEY]: lang });
            if (result && typeof result.catch === 'function') result.catch(() => {});
        } catch { /* ignore */ }
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

    /** Read the stored language (async, chrome.storage.local). */
    function init(options = {}) {
        const explicit = normalizeLanguage(options.language);
        if (explicit) {
            _current = explicit;
            syncDocumentLanguage();
            return Promise.resolve(_current);
        }
        const area = storageArea();
        if (!area) {
            syncDocumentLanguage();
            return Promise.resolve(_current);
        }
        return new Promise((resolve) => {
            try {
                area.get({ [STORAGE_KEY]: DEFAULT_LANGUAGE }, (stored) => {
                    const value = stored && stored[STORAGE_KEY];
                    const normalized = normalizeLanguage(value);
                    if (!normalized) {
                        if (value) warn('Unsupported stored language, using default', { stored: value });
                        _current = DEFAULT_LANGUAGE;
                    } else {
                        _current = normalized;
                    }
                    syncDocumentLanguage();
                    resolve(_current);
                });
            } catch (err) {
                warn('Failed to read stored language', { error: String(err) });
                resolve(_current);
            }
        });
    }

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

    /** Follow language changes made by another extension context (popup <-> overlay). */
    function watchStorage() {
        if (_storageWatcherAttached) return;
        try {
            if (!global.chrome || !global.chrome.storage || !global.chrome.storage.onChanged) return;
            _storageWatcherAttached = true;
            global.chrome.storage.onChanged.addListener((changes, areaName) => {
                if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
                const next = normalizeLanguage(changes[STORAGE_KEY].newValue);
                if (!next || next === _current) return;
                _current = next;
                syncDocumentLanguage();
                _listeners.forEach((fn) => {
                    try { fn(next); } catch { /* ignore */ }
                });
            });
        } catch { /* ignore */ }
    }

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
            flatten(catalog[rawLang], namespace, []).forEach(([key, value]) => {
                const bucket = _catalogs[lang];
                if (bucket[key] !== undefined && bucket[key] !== value) {
                    warn('Duplicate translation key definition', { key, lang });
                }
                bucket[key] = value;
            });
        });
    }

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

    function applyPlural(template, params) {
        if (template.indexOf('|') === -1) return template;
        const forms = template.split('|');
        if (!params || params.count === undefined) {
            warn('Plural translation used without a `count` parameter', { template });
            return forms[forms.length - 1];
        }
        return Number(params.count) === 1 ? forms[0] : forms[forms.length - 1];
    }

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

    function keys(lang) {
        const target = normalizeLanguage(lang) || _current;
        return Object.keys(_catalogs[target] || {}).sort();
    }

    function catalog(lang) {
        const target = normalizeLanguage(lang) || _current;
        return Object.assign({}, _catalogs[target] || {});
    }

    function applyStatic(root) {
        const scope = root || global.document;
        if (!scope || !scope.querySelectorAll) return;
        scope.querySelectorAll('[data-i18n]').forEach((el) => {
            el.textContent = t(el.getAttribute('data-i18n'));
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

    // --- date / time / number helpers (identical behaviour to the web module) ---

    function intlLocale() { return _current === 'zh-CN' ? 'zh-CN' : 'en-US'; }

    function toDate(value) {
        if (value === null || value === undefined || value === '') return null;
        if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
        if (typeof value === 'number') {
            const fromNumber = new Date(value);
            return isNaN(fromNumber.getTime()) ? null : fromNumber;
        }
        const raw = String(value).trim();
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

    function formatWith(value, options) {
        const date = toDate(value);
        if (!date) return typeof value === 'string' ? value : '';
        try {
            return new Intl.DateTimeFormat(intlLocale(), options).format(date);
        } catch { return date.toISOString(); }
    }

    function formatDate(value) { return formatWith(value, { month: 'short', day: 'numeric' }); }
    function formatDateLong(value) { return formatWith(value, { year: 'numeric', month: 'short', day: 'numeric' }); }
    function formatDateTime(value) {
        return formatWith(value, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    function formatTime(value) { return formatWith(value, { hour: 'numeric', minute: '2-digit' }); }
    function formatMonthYear(value) { return formatWith(value, { year: 'numeric', month: 'long' }); }
    function formatWeekdayDate(value) { return formatWith(value, { weekday: 'short', month: 'short', day: 'numeric' }); }
    function formatWeekdayDateLong(value) {
        return formatWith(value, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
    function formatWeekday(value) {
        const date = toDate(value) || (value instanceof Date ? value : null);
        if (!date) return '';
        try {
            return new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(date);
        } catch { return ''; }
    }
    function weekdayNames(startDate) {
        const start = startDate ? toDate(startDate) : new Date(2024, 0, 7);
        if (!start) return [];
        return Array.from({ length: 7 }, (_, i) =>
            formatWeekday(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
    }
    function formatRelativeTime(value) {
        const date = toDate(value);
        if (!date) return typeof value === 'string' ? value : '';
        const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
        if (minutes < 1) return t('time.justNow');
        if (minutes < 60) return t('time.minutesAgo', { count: minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return t('time.hoursAgo', { count: hours });
        const days = Math.floor(hours / 24);
        if (days === 0) return t('time.today');
        if (days === 1) return t('time.yesterday');
        if (days < 7) return t('time.daysAgo', { count: days });
        if (days < 30) return t('time.weeksAgo', { count: Math.floor(days / 7) });
        return formatDate(date);
    }
    function formatNumber(value, options) {
        const num = Number(value);
        if (!isFinite(num)) return String(value);
        try { return new Intl.NumberFormat(intlLocale(), options).format(num); } catch { return String(num); }
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
        watchStorage,
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
    global.t = t;
}(typeof globalThis !== 'undefined' ? globalThis : this));
