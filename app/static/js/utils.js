// === Shared Utilities ===
//
// User-visible copy must go through `t(key, params)` (see app/static/js/i18n.js
// and docs/i18n.md). Business content (job titles, company names, AI output,
// email bodies) is rendered verbatim and never translated.

/** Translate via the i18n module; degrade to the key when i18n is not loaded. */
function tr(key, params) {
    return typeof t === 'function' ? t(key, params) : key;
}

// 金额一律以人民币（元）计价，按月薪口径展示，不做任何币种换算。
// Money is always CNY (yuan) and is shown as a monthly salary. Amounts are
// never converted to another currency.
const SALARY_SYMBOL = '¥';

/** 去掉小数末尾多余的 0：1.50 → 1.5，2.00 → 2。 */
function trimTrailingZero(n) {
    return String(Number(Number(n).toFixed(1)));
}

/** 金额（元）→ `¥12,345`；空值或非法值返回 `-`。 */
function formatCurrency(val) {
    if (!val && val !== 0) return '-';
    const num = Number(val);
    if (!isFinite(num)) return '-';
    const formatted = typeof i18n !== 'undefined' ? i18n.formatNumber(num) : num.toLocaleString();
    return SALARY_SYMBOL + formatted;
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('toast-dismiss');
        toast.addEventListener('animationend', () => toast.remove());
    }, 3000);
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast(tr('toast.copied'), 'info');
    } catch {
        showToast(tr('toast.copyFailed'), 'error');
    }
}

/** Language-aware date label: Today / Yesterday / 3d ago / Mar 5. */
function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = typeof i18n !== 'undefined' ? i18n.toDate(dateStr) : new Date(dateStr);
    if (!d || isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const diff = now - d;
    const days = Math.floor(diff / 86400000);
    if (days === 0) return tr('time.today');
    if (days === 1) return tr('time.yesterday');
    if (days < 7) return tr('time.daysAgo', { count: days, n: days });
    if (days < 30) return tr('time.weeksAgo', { count: Math.floor(days / 7), n: Math.floor(days / 7) });
    // No i18n module available (rare): fall back to a locale-neutral date.
    return typeof i18n !== 'undefined' ? i18n.formatDate(d) : d.toISOString().slice(0, 10);
}

// 月薪金额一律为人民币元，不做任何币种换算。
// Salary amounts are CNY yuan per month and are never converted.
function formatSalary(min, max, estMin, estMax) {
    const lo = min || estMin;
    const hi = max || estMax;
    if (!lo && !hi) return null;
    // 满 1 万按「万」，满 1 千按「K」（千元），其余原样 —— 与国内招聘平台一致。
    const fmt = (n) => {
        const v = Number(n);
        if (!isFinite(v) || v <= 0) return '';
        if (v >= 10000) return `${trimTrailingZero(v / 10000)}万`;
        if (v >= 1000) return `${trimTrailingZero(v / 1000)}K`;
        return String(Math.round(v));
    };
    if (lo && hi) return tr('common.salary.range', { min: fmt(lo), max: fmt(hi) });
    if (lo) return tr('common.salary.from', { amount: fmt(lo) });
    return tr('common.salary.upTo', { amount: fmt(hi) });
}

function getScoreClass(score) {
    if (score === null || score === undefined) return 'score-badge-none';
    if (score >= 80) return 'score-badge-green';
    if (score >= 60) return 'score-badge-amber';
    return 'score-badge-gray';
}

// === 申请状态枚举（铁律） ===
//
// 状态的「值」永远是稳定英文枚举，「标签」永远通过 t() 翻译，两者绝不混用：
// 下拉框 `<option value>` 只放枚举，任何比较都基于枚举，界面文案只用于显示。
// 若把翻译结果写进 value，中文界面会把「已申请」这类中文串直接落库。
//
// The enum is the only thing persisted or compared; the label is presentation only.
const APPLICATION_STATUSES = ['interested', 'prepared', 'applied', 'interviewing', 'offered', 'rejected'];

/** 状态枚举 → 界面文案（与求职流程看板共用同一套标签）。 */
function applicationStatusLabel(status) {
    return tr(`pipeline.stage.${status}`);
}

function escapeHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sanitizeHtml(html) {
    const ALLOWED_TAGS = new Set([
        'p', 'br', 'b', 'i', 'em', 'strong', 'u', 'ul', 'ol', 'li', 'a',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'table', 'thead',
        'tbody', 'tr', 'th', 'td', 'pre', 'code', 'blockquote', 'hr', 'dl',
        'dt', 'dd', 'sub', 'sup',
    ]);
    const ALLOWED_ATTRS = new Set(['href', 'target', 'rel']);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    function clean(node) {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toLowerCase();
                if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' || tag === 'embed') {
                    node.removeChild(child);
                    continue;
                }
                if (!ALLOWED_TAGS.has(tag)) {
                    while (child.firstChild) node.insertBefore(child.firstChild, child);
                    node.removeChild(child);
                    continue;
                }
                for (const attr of Array.from(child.attributes)) {
                    if (!ALLOWED_ATTRS.has(attr.name)) {
                        child.removeAttribute(attr.name);
                    }
                }
                if (child.hasAttribute('href')) {
                    const href = child.getAttribute('href').trim().toLowerCase();
                    if (href.startsWith('javascript:') || href.startsWith('data:') || href.startsWith('vbscript:')) {
                        child.removeAttribute('href');
                    }
                }
                if (tag === 'a') {
                    child.setAttribute('target', '_blank');
                    child.setAttribute('rel', 'noopener noreferrer');
                }
                clean(child);
            }
        }
    }
    clean(doc.body);
    return doc.body.innerHTML;
}

function sanitizeUrl(url) {
    if (!url) return '';
    const trimmed = url.trim();
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('mailto:')) {
        return trimmed;
    }
    return '';
}

function parseJsonField(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try { return JSON.parse(val); } catch { return []; }
}

function isNew(createdAt) {
    const lastVisit = localStorage.getItem('jf_last_visit');
    if (!lastVisit) return false;
    return new Date(createdAt) > new Date(lastVisit);
}

function getFreshness(job) {
    const date = job.last_seen_at || job.posted_date || job.created_at;
    if (!date) return null;
    const days = Math.floor((Date.now() - new Date(date)) / 86400000);
    if (days <= 1) return { label: tr('common.freshness.fresh'), class: "freshness-hot", days };
    if (days <= 3) return { label: tr('common.freshness.new'), class: "freshness-new", days };
    if (days <= 7) return { label: tr('time.daysAgo', { count: days, n: days }), class: "freshness-recent", days };
    if (days <= 14) return { label: tr('time.daysAgo', { count: days, n: days }), class: "freshness-aging", days };
    if (days <= 30) return { label: tr('time.daysAgo', { count: days, n: days }), class: "freshness-old", days };
    return { label: tr('common.freshness.stale'), class: "freshness-stale", days };
}

// === In-App Modal (replaces native prompt/confirm) ===
function showModal({ title, message, input, confirmText, cancelText, danger }) {
    return new Promise((resolve) => {
        const existing = document.getElementById('app-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'app-modal';
        modal.innerHTML = `
            <div class="modal-overlay">
                <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="app-modal-title">
                    <h3 id="app-modal-title" class="modal-title">${escapeHtml(title)}</h3>
                    ${message ? `<p class="modal-message">${escapeHtml(message)}</p>` : ''}
                    ${input ? `<input type="text" class="search-input modal-input" id="modal-input" placeholder="${escapeHtml(input.placeholder || '')}" value="${escapeHtml(input.value || '')}">` : ''}
                    <div class="modal-actions">
                        <button class="btn btn-secondary btn-sm" id="modal-cancel">${escapeHtml(cancelText || tr('modal.cancel'))}</button>
                        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm" id="modal-confirm">${escapeHtml(confirmText || tr('modal.ok'))}</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const inputEl = modal.querySelector('#modal-input');
        const confirmBtn = modal.querySelector('#modal-confirm');
        const cancelBtn = modal.querySelector('#modal-cancel');

        if (inputEl) { inputEl.focus(); inputEl.select(); }
        else confirmBtn.focus();

        function close(result) {
            modal.remove();
            resolve(result);
        }

        confirmBtn.addEventListener('click', () => close(input ? (inputEl.value || null) : true));
        cancelBtn.addEventListener('click', () => close(input ? null : false));
        modal.querySelector('.modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) close(input ? null : false);
        });
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); close(input ? null : false); }
            if (e.key === 'Enter' && input && document.activeElement === inputEl) { e.preventDefault(); close(inputEl.value || null); }
            if (e.key === 'Enter' && !input) { e.preventDefault(); close(true); }
            // Focus trap
            if (e.key === 'Tab') {
                const focusable = modal.querySelectorAll('input, button');
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        });
    });
}

// === Setup Guards ===
let _cachedSetupStatus = null;
let _setupStatusExpiry = 0;

async function getSetupStatus() {
    if (_cachedSetupStatus && Date.now() < _setupStatusExpiry) return _cachedSetupStatus;
    try {
        const [resumesData, aiSettings] = await Promise.all([
            api.request('GET', '/api/resumes'),
            api.getAISettings(),
        ]);
        _cachedSetupStatus = {
            hasResume: (resumesData.resumes || []).length > 0,
            hasAI: !!(aiSettings.provider && (aiSettings.api_key || aiSettings.provider === 'ollama')),
        };
        _setupStatusExpiry = Date.now() + 30000;
    } catch {
        _cachedSetupStatus = { hasResume: false, hasAI: false };
        _setupStatusExpiry = Date.now() + 5000;
    }
    return _cachedSetupStatus;
}

function invalidateSetupStatus() {
    _cachedSetupStatus = null;
    _setupStatusExpiry = 0;
}

async function requireAI() {
    const status = await getSetupStatus();
    if (!status.hasAI) {
        showToast(tr('errors.aiNotConfigured'), 'error');
        return false;
    }
    return true;
}

async function requireResume() {
    const status = await getSetupStatus();
    if (!status.hasResume) {
        showToast(tr('errors.resumeMissing'), 'error');
        return false;
    }
    return true;
}

async function requireAIAndResume() {
    const status = await getSetupStatus();
    if (!status.hasAI) {
        showToast(tr('errors.aiNotConfigured'), 'error');
        return false;
    }
    if (!status.hasResume) {
        showToast(tr('errors.resumeMissing'), 'error');
        return false;
    }
    return true;
}

// === Unsaved Form Change Tracking ===
//
// Two layers, per the i18n design:
//   1. Explicit checks a view registers while it is mounted (most accurate).
//   2. A generic snapshot of form controls inside `#app`, compared on demand.
// Views that fill inputs programmatically after their async load must call
// `refreshFormBaseline()` when the programmatic fill is done, otherwise the
// snapshot looks like user input.
const _dirtyChecks = [];
let _formBaseline = null;

const DIRTY_SKIP_SELECTOR = '[data-dirty-ignore],[type="hidden"],[type="file"],[type="range"],[type="color"],[type="submit"],[type="button"],[disabled]';

function registerDirtyCheck(fn) {
    if (typeof fn === 'function') _dirtyChecks.push(fn);
}

function clearDirtyChecks() {
    _dirtyChecks.length = 0;
    _formBaseline = null;
}

function _isContentEditable(el) {
    // jsdom does not implement isContentEditable, so check the attribute too.
    return el.isContentEditable === true || el.getAttribute('contenteditable') === 'true';
}

function _dirtyFieldValue(el) {
    if (_isContentEditable(el)) return el.textContent;
    if (el.type === 'checkbox' || el.type === 'radio') return String(el.checked);
    return el.value === undefined ? '' : String(el.value);
}

function _isDirtySkipped(el) {
    return !!(el.closest && el.closest(DIRTY_SKIP_SELECTOR)) || (el.matches && el.matches(DIRTY_SKIP_SELECTOR));
}

/**
 * Snapshot every form control currently rendered so later comparisons can tell
 * user edits apart from programmatic fills.
 */
function refreshFormBaseline(root) {
    const scope = root || document.getElementById('app') || document.body;
    if (!scope || !scope.querySelectorAll) { _formBaseline = null; return; }
    const records = [];
    scope.querySelectorAll('input, textarea, select, [contenteditable="true"]').forEach((el) => {
        if (_isDirtySkipped(el)) return;
        records.push({ el, value: _dirtyFieldValue(el) });
    });
    _formBaseline = { records };
}

/** True when the mounted view holds edits the user has not saved yet. */
function hasUnsavedChanges() {
    for (const check of _dirtyChecks) {
        try {
            if (check()) return true;
        } catch { /* a broken check must not block language switching */ }
    }
    if (!_formBaseline) return false;
    for (const record of _formBaseline.records) {
        const el = record.el;
        if (!el.isConnected) continue;
        if (_isDirtySkipped(el)) continue;
        if (_dirtyFieldValue(el) !== record.value) return true;
    }
    return false;
}

/** Ask the user before throwing away unsaved edits. Returns true to continue. */
async function confirmDiscardUnsavedChanges(options = {}) {
    if (!hasUnsavedChanges()) return true;
    const result = await showModal({
        title: options.title || tr('modal.unsavedTitle'),
        message: options.message || tr('modal.unsavedMessage'),
        confirmText: options.confirmText || tr('modal.discardAndContinue'),
        cancelText: options.cancelText || tr('modal.keepEditing'),
        danger: true,
    });
    return result === true;
}
