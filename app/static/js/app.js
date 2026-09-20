// === State ===
let currentJobs = [];
let currentOffset = 0;
const PAGE_SIZE = 50;
let selectedJobIds = new Set();
let selectMode = false;

// === View Cleanup Registry ===
const _viewCleanups = [];

function registerViewCleanup(fn) {
    _viewCleanups.push(fn);
}

function cleanupCurrentView() {
    while (_viewCleanups.length) _viewCleanups.pop()();
    if (typeof queueEventSource !== 'undefined' && queueEventSource) {
        queueEventSource.close();
        queueEventSource = null;
    }
    if (typeof clearDirtyChecks === 'function') clearDirtyChecks();
}

// === Router ===
function getRoute() {
    const hash = window.location.hash || '#/';
    if (hash.startsWith('#/job/')) {
        const id = hash.slice(6);
        return { view: 'detail', id: parseInt(id, 10) };
    }
    if (hash === '#/stats') return { view: 'stats' };
    if (hash === '#/calendar') return { view: 'calendar' };
    if (hash === '#/pipeline') return { view: 'pipeline' };
    if (hash === '#/queue') return { view: 'queue' };
    if (hash === '#/network') return { view: 'network' };
    if (hash === '#/settings') return { view: 'settings' };
    if (hash === '#/calculator') return { view: 'calculator' };
    return { view: 'feed' };
}

function navigate(hash) {
    window.location.hash = hash;
}

function updateActiveNav() {
    const route = getRoute();
    document.querySelectorAll('.nav-link').forEach(link => {
        const r = link.dataset.route;
        link.classList.toggle('active',
            (r === 'feed' && route.view === 'feed') ||
            (r === 'stats' && route.view === 'stats') ||
            (r === 'calendar' && route.view === 'calendar') ||
            (r === 'pipeline' && route.view === 'pipeline') ||
            (r === 'queue' && route.view === 'queue') ||
            (r === 'network' && route.view === 'network') ||
            (r === 'calculator' && route.view === 'calculator') ||
            (r === 'settings' && route.view === 'settings')
        );
    });
}

async function handleRoute() {
    cleanupCurrentView();
    const route = getRoute();
    updateActiveNav();
    const app = document.getElementById('app');

    if (route.view === 'detail') {
        await renderJobDetail(app, route.id);
    } else if (route.view === 'stats') {
        await renderStats(app);
    } else if (route.view === 'calendar') {
        await renderCalendar(app);
    } else if (route.view === 'pipeline') {
        await renderPipeline(app);
    } else if (route.view === 'queue') {
        await renderQueue(app);
    } else if (route.view === 'network') {
        await renderNetwork(app);
    } else if (route.view === 'settings') {
        await renderSettings(app);
    } else if (route.view === 'calculator') {
        await renderSalaryCalculator(app);
    } else {
        await renderFeed(app);
    }

    app.setAttribute('tabindex', '-1');
    app.focus({ preventScroll: true });
    updateDocumentTitle();
    // Baseline for unsaved-change detection: anything the view has already
    // filled programmatically counts as the starting point, not as user input.
    if (typeof refreshFormBaseline === 'function') refreshFormBaseline(app);
}

// === Filter Persistence & Smart Views ===
const FILTER_IDS = ['filter-search', 'filter-exclude', 'filter-score', 'filter-sort', 'filter-work-type', 'filter-employment', 'filter-location', 'filter-region', 'filter-posted-within', 'filter-clearance'];
const FILTER_STORAGE_KEY = 'careerpulse_filters';
const SMART_VIEWS_KEY = 'careerpulse_saved_views';

function getFilterState() {
    const state = {};
    FILTER_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) state[id] = el.value;
    });
    const showStale = document.getElementById('filter-show-stale');
    if (showStale) state['filter-show-stale'] = showStale.checked;
    return state;
}

function applyFilterState(state) {
    FILTER_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el && state[id] !== undefined) el.value = state[id];
    });
    const showStale = document.getElementById('filter-show-stale');
    if (showStale && state['filter-show-stale'] !== undefined) showStale.checked = state['filter-show-stale'];
}

function saveFilterState() {
    try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(getFilterState())); } catch {}
}

function loadSavedFilterState() {
    try {
        const raw = localStorage.getItem(FILTER_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

let _cachedViews = null;
let _viewsMigrating = false;

async function getSmartViews() {
    if (_cachedViews) return _cachedViews;
    try {
        const data = await api.request('GET', '/api/saved-views');
        _cachedViews = data.views || [];
        if (!_viewsMigrating) {
            try {
                const raw = localStorage.getItem(SMART_VIEWS_KEY);
                if (raw) {
                    _viewsMigrating = true;
                    const localViews = JSON.parse(raw);
                    if (localViews.length > 0) {
                        const existingNames = new Set(_cachedViews.map(v => v.name));
                        for (const lv of localViews) {
                            if (!existingNames.has(lv.name)) {
                                await api.request('POST', '/api/saved-views', { name: lv.name, filters: lv.filters });
                            }
                        }
                        localStorage.removeItem(SMART_VIEWS_KEY);
                        _cachedViews = null;
                        _viewsMigrating = false;
                        return getSmartViews();
                    }
                    _viewsMigrating = false;
                }
            } catch { _viewsMigrating = false; }
        }
        return _cachedViews;
    } catch {
        return [];
    }
}

function invalidateViewsCache() {
    _cachedViews = null;
}

async function renderSmartViewChips(reloadFn) {
    const container = document.getElementById('smart-views');
    if (!container) return;
    const views = await getSmartViews();
    container.innerHTML = views.map(v => `
        <button class="smart-view-chip" data-view-id="${v.id}" title="${escapeHtml(t('shell.smartViews.apply', { name: v.name }))}">
            ${escapeHtml(v.name)}
            <span class="smart-view-delete" data-view-id="${v.id}">&times;</span>
        </button>
    `).join('');

    container.querySelectorAll('.smart-view-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            if (e.target.classList.contains('smart-view-delete')) return;
            const viewId = parseInt(chip.dataset.viewId);
            const view = views.find(v => v.id === viewId);
            if (view) {
                applyFilterState(view.filters);
                saveFilterState();
                container.querySelectorAll('.smart-view-chip').forEach(c => c.classList.remove('smart-view-chip-active'));
                chip.classList.add('smart-view-chip-active');
                reloadFn();
            }
        });
    });

    container.querySelectorAll('.smart-view-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const viewId = parseInt(btn.dataset.viewId);
            try {
                await api.request('DELETE', `/api/saved-views/${viewId}`);
                invalidateViewsCache();
                renderSmartViewChips(reloadFn);
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
            }
        });
    });
}

// === Scrape Handler ===
let scrapePollInterval = null;
let currentScrapeTaskId = null;
let stallToastShownForTaskId = null;
let lastScrapeState = null;

const SCRAPE_POLL_MS = 1500;
const STALL_WARN_SEC = 30;
const STALL_CRITICAL_SEC = 120;

function stopScrapePoll() {
    if (scrapePollInterval) { clearInterval(scrapePollInterval); scrapePollInterval = null; }
}

function getScrapeButtons() {
    return [
        document.getElementById('scrape-btn'),
        document.getElementById('stats-scrape-btn'),
    ].filter(Boolean);
}

function phaseLabel(p) {
    const phase = p && p.phase;
    if (phase === 'scraping') {
        const name = p.current || '';
        const progress = t('shell.scrape.progress', { completed: p.completed || 0, total: p.total || 0 });
        return name
            ? t('shell.scrape.scraping', { source: name, completed: p.completed || 0, total: p.total || 0 })
            : t('shell.scrape.scrapingProgress', { progress });
    }
    if (phase === 'enriching') return t('shell.scrape.enriching');
    if (phase === 'classifying') return t('shell.scrape.classifying');
    if (phase === 'scoring') {
        const s = (p && p.scoring) || {};
        return t('shell.scrape.scoring', { scored: s.scored || 0, total: s.total || 0 });
    }
    if (phase === 'done') return t('shell.scrape.done');
    if (phase === 'error') return t('shell.scrape.error');
    return t('shell.scrape.working');
}

function computeStallSec(p) {
    if (!p || typeof p.server_now !== 'number' || typeof p.last_updated_at !== 'number') return 0;
    return Math.max(0, p.server_now - p.last_updated_at);
}

// 取消链接有两种用途：服务端抓取流水线（历史路径）与「一键抓取」的采集请求。
// 正在进行的那个流程决定点击取消时该停哪一个。
let activeCancelHandler = null;

function setCancelLinkVisible(visible, btn) {
    const parent = btn.parentElement;
    if (!parent) return;
    let link = parent.querySelector('.scrape-cancel-link');
    if (!visible) {
        if (link) link.remove();
        return;
    }
    if (link) return;
    link = document.createElement('a');
    link.className = 'scrape-cancel-link';
    link.href = '#';
    link.textContent = t('actions.cancel');
    link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        (activeCancelHandler || cancelScrape)();
    });
    btn.insertAdjacentElement('afterend', link);
}

function renderScrapeButtonState(p) {
    const btns = getScrapeButtons();
    if (!btns.length) return;

    const stallSec = computeStallSec(p);
    const critical = stallSec > STALL_CRITICAL_SEC;
    const warn = stallSec > STALL_WARN_SEC;

    let label = phaseLabel(p);
    if (warn) {
        const secs = Math.round(stallSec);
        const phaseKey = `shell.scrape.phaseNames.${p.phase || ''}`;
        const current = p.current || (typeof i18n !== 'undefined' && i18n.has(phaseKey) ? t(phaseKey) : t('shell.scrape.working'));
        label = t('shell.scrape.stalled', { current, seconds: secs });
    }

    btns.forEach(btn => {
        btn.disabled = true;
        btn.classList.remove('scrape-btn-warn', 'scrape-btn-critical');
        if (critical) btn.classList.add('scrape-btn-critical');
        else if (warn) btn.classList.add('scrape-btn-warn');
        btn.innerHTML = `<span class="spinner"></span> ${escapeHtml(label)}`;
        setCancelLinkVisible(warn, btn);
    });
}

function resetScrapeButtons() {
    activeCancelHandler = null;
    captureLabelKey = null;
    getScrapeButtons().forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('scrape-btn-warn', 'scrape-btn-critical');
        btn.textContent = t('nav.scrapeNow');
        setCancelLinkVisible(false, btn);
    });
}

async function pollScrapeOnce() {
    let p;
    try {
        p = await api.getScrapeProgress();
    } catch {
        return;
    }
    lastScrapeState = p;

    if (!p || !p.active) {
        stopScrapePoll();
        resetScrapeButtons();
        currentScrapeTaskId = null;
        if (p && p.phase === 'done') {
            showScrapeSummaryToast(p);
            handleRoute();
        } else if (p && p.phase === 'error') {
            showScrapeErrorToast(p);
        }
        return;
    }

    renderScrapeButtonState(p);

    const stallSec = computeStallSec(p);
    if (stallSec > STALL_CRITICAL_SEC && stallToastShownForTaskId !== p.task_id) {
        stallToastShownForTaskId = p.task_id;
        showToast(t('shell.scrape.stuckToast'), 'error');
    }
}

function startScrapePoll(taskId) {
    stopScrapePoll();
    currentScrapeTaskId = taskId || null;
    stallToastShownForTaskId = null;
    pollScrapeOnce();
    scrapePollInterval = setInterval(pollScrapeOnce, SCRAPE_POLL_MS);
}

// === 一键抓取：把请求交给浏览器扩展执行 ===
// 中国版没有服务端爬虫（PRD D1）：网页端只能请求用户浏览器里已打开的招聘页面
// 采集（app/routers/capture.py）。所以这里的状态是「等待扩展认领 → 采集中 → 完成」。
let capturePollInterval = null;
let captureStartedAt = 0;
// 按钮上当前显示的文案：只有真的变了才重绘，免得每秒重建按钮把转圈动画打断
let captureLabelKey = null;

const CAPTURE_POLL_MS = 1000;
// 扩展在招聘页面上每 3s 轮询一次；超过这个时间没人认领就是「没打开招聘页面
// 或扩展没装/没重载」，继续等下去只会让按钮转圈。
const CAPTURE_CLAIM_TIMEOUT_MS = 15000;
// 认领之后**不再用墙钟判超时**：一次采集要回传几十张卡片（每张一个请求），
// 慢是正常的 —— 之前 60 秒的硬上限会把一次正在正常推进的采集杀掉，用户只看到
// 「超时」，职位却已经进库了。改为看**进度有没有前进**。
const CAPTURE_IDLE_LIMIT_SEC = 45;

function stopCapturePoll() {
    if (capturePollInterval) { clearInterval(capturePollInterval); capturePollInterval = null; }
    captureLabelKey = null;
}

// 只改文案、不重建按钮：进度每秒都在变，重建会让转圈动画不断重头开始。
function renderCaptureButtonState(text) {
    if (captureLabelKey === text) return;
    captureLabelKey = text;
    getScrapeButtons().forEach(btn => {
        btn.disabled = true;
        btn.classList.remove('scrape-btn-warn', 'scrape-btn-critical');
        let label = btn.querySelector('.scrape-btn-label');
        if (!label) {
            btn.textContent = '';
            const spinner = document.createElement('span');
            spinner.className = 'spinner';
            btn.appendChild(spinner);
            btn.appendChild(document.createTextNode(' '));
            label = document.createElement('span');
            label.className = 'scrape-btn-label';
            btn.appendChild(label);
        }
        label.textContent = text;
        setCancelLinkVisible(true, btn);
    });
}

// 进度文案：已处理的张数 / 总数（服务端每次进度心跳都会带来快照）
function captureProgressText(state) {
    if (!state.total) return t('shell.capture.capturing');
    const done = (state.saved || 0) + (state.skipped || 0) + (state.failed || 0);
    return t('shell.capture.capturingProgress', { done, total: state.total });
}

// 距离上一次「有动静」过了多久（秒）：认领那一刻算一次动静，之后靠进度心跳。
function captureIdleSec(state) {
    if (typeof state.server_now !== 'number') return 0;
    const last = typeof state.progress_at === 'number'
        ? state.progress_at
        : (typeof state.claimed_at === 'number' ? state.claimed_at : null);
    if (last === null) return 0;
    return Math.max(0, state.server_now - last);
}

function showCaptureResultToast(state) {
    if (!(state.total || 0)) {
        // 扩展告诉了我们原因（比如它开着的不是职位列表页），就别让用户猜
        showToast(t(state.reason === 'no_listing'
            ? 'shell.capture.noListing'
            : 'shell.capture.resultEmpty'), 'info');
        return;
    }
    let message = t('shell.capture.result', {
        saved: state.saved || 0,
        skipped: state.skipped || 0,
    });
    if (state.failed) message += t('shell.capture.resultFailed', { count: state.failed });
    showToast(message, state.saved ? 'success' : 'info');
}

async function cancelCapture() {
    stopCapturePoll();
    resetScrapeButtons();
    try {
        await api.cancelCapture();
    } catch { /* 已经没有进行中的请求 */ }
}

async function pollCaptureOnce() {
    let state;
    try {
        state = await api.getCaptureState();
    } catch {
        return;
    }

    if (state.status === 'capturing') {
        renderCaptureButtonState(captureProgressText(state));
        // 只要进度还在前进就继续等；一动不动超过上限才算卡住
        if (captureIdleSec(state) > CAPTURE_IDLE_LIMIT_SEC) {
            await cancelCapture();
            showToast(t('shell.capture.timedOut'), 'error');
        }
        return;
    }

    if (state.status === 'waiting') {
        renderCaptureButtonState(t('shell.capture.waiting'));
        if (Date.now() - captureStartedAt > CAPTURE_CLAIM_TIMEOUT_MS) {
            await cancelCapture();
            // 区分两种「等不到」：扩展根本没响应，还是它开着但不是职位列表页。
            // 这两种情况用户要做的事完全不同，以前都只得到一句「没等到扩展」。
            const stuckOnWrongPage = state.extension_seen && !state.listing_seen;
            showToast(t(stuckOnWrongPage
                ? 'shell.capture.noListing'
                : 'shell.capture.noExtension'), 'error');
        }
        return;
    }

    if (state.status === 'done') {
        stopCapturePoll();
        resetScrapeButtons();
        showCaptureResultToast(state);
        handleRoute();
        return;
    }

    // idle / cancelled：我们自己取消的（或服务重启过），静默复位
    stopCapturePoll();
    resetScrapeButtons();
}

function startCapturePoll() {
    stopCapturePoll();
    captureStartedAt = Date.now();
    captureLabelKey = t('shell.capture.requesting');
    activeCancelHandler = cancelCapture;
    pollCaptureOnce();
    capturePollInterval = setInterval(pollCaptureOnce, CAPTURE_POLL_MS);
}

async function handleScrape() {
    const btns = getScrapeButtons();
    if (!btns.length) return;
    // 浏览器可能缓存着旧版 api.js：与其抛一个 `api.requestCapture is not a function`
    // 的 TypeError（用户完全看不懂），不如直接告诉他刷新页面。
    if (typeof api.requestCapture !== 'function') {
        showToast(t('shell.capture.staleAssets'), 'error');
        resetScrapeButtons();
        return;
    }
    btns.forEach(btn => {
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span> ${escapeHtml(t('shell.capture.requesting'))}`;
        setCancelLinkVisible(false, btn);
    });
    try {
        await api.requestCapture();
        startCapturePoll();
    } catch (err) {
        showToast(apiErrorMessage(err), 'error');
        resetScrapeButtons();
    }
}

async function cancelScrape() {
    try {
        await api.cancelScrape();
        getScrapeButtons().forEach(btn => {
            btn.innerHTML = `<span class="spinner"></span> ${escapeHtml(t('shell.scrape.cancelling'))}`;
        });
    } catch (err) {
        showToast(apiErrorMessage(err), 'error');
    }
}

function showToastWithAction(message, type, actionText, onAction) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type} toast-with-action`;
    const msg = document.createElement('span');
    msg.textContent = message;
    const action = document.createElement('button');
    action.className = 'toast-action-btn';
    action.type = 'button';
    action.textContent = actionText;
    action.addEventListener('click', () => {
        toast.remove();
        try { onAction(); } catch {}
    });
    toast.appendChild(msg);
    toast.appendChild(document.createTextNode(' '));
    toast.appendChild(action);
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('toast-dismiss');
        toast.addEventListener('animationend', () => toast.remove());
    }, 8000);
}

function showScrapeSummaryToast(p) {
    const sources = p.sources || [];
    const ok = sources.filter(s => s.status === 'ok').length;
    const timeout = sources.filter(s => s.status === 'timeout').length;
    const failed = sources.filter(s => s.status === 'failed').length;
    const total = p.total || sources.length;

    let summary = t('shell.scrape.complete', {
        newJobs: p.new_jobs || 0, ok, total,
    });
    if (timeout) summary += t('shell.scrape.timeoutSuffix', { count: timeout });
    if (failed) summary += t('shell.scrape.failedSuffix', { count: failed });

    showToastWithAction(summary, 'success', t('shell.scrape.viewDetails'), () => showScrapeDetailsModal(p));
}

function showScrapeErrorToast(p) {
    const first = (p.errors && p.errors[0]) || t('errors.unknownError');
    showToastWithAction(t('shell.scrape.failedWithReason', { reason: first }), 'error',
        t('shell.scrape.viewDetails'), () => showScrapeDetailsModal(p));
}

function sourceStatusBadgeHTML(status) {
    const map = {
        ok: 'score-badge-green',
        failed: 'score-badge-red',
        timeout: 'score-badge-amber',
        skipped: 'score-badge-gray',
        running: 'score-badge-gray',
        pending: 'score-badge-gray',
    };
    const cls = map[status] || 'score-badge-gray';
    const key = `shell.scrape.sourceStatus.${status || ''}`;
    const label = status ? t(key) : '';
    return `<span class="score-badge ${cls}">${escapeHtml(label)}</span>`;
}

function showScrapeDetailsModal(p) {
    const existing = document.getElementById('app-modal');
    if (existing) existing.remove();

    const sources = p.sources || [];
    const rows = sources.map(s => `
        <tr>
            <td>${escapeHtml(s.name || '')}</td>
            <td>${sourceStatusBadgeHTML(s.status)}</td>
            <td>${s.duration_ms != null ? (s.duration_ms / 1000).toFixed(1) + 's' : '\u2014'}</td>
            <td>${s.listings_found || 0}</td>
            <td>${s.new_jobs || 0}</td>
            <td>${s.error ? escapeHtml(s.error) : '\u2014'}</td>
        </tr>
    `).join('');

    const errorsHtml = (p.errors && p.errors.length)
        ? `<div class="scrape-modal-errors"><strong>${escapeHtml(t('shell.scrape.pipelineErrors'))}</strong><ul>${p.errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`
        : '';

    const scoring = p.scoring || {};
    const scoringHtml = (scoring.total || scoring.scored || scoring.skipped_reason)
        ? `<div class="scrape-modal-scoring"><strong>${escapeHtml(t('shell.scrape.scoringLabel'))}</strong> ${scoring.skipped_reason
            ? escapeHtml(t('shell.scrape.scoringSkipped', { reason: scoring.skipped_reason }))
            : `${scoring.scored || 0}/${scoring.total || 0}`}</div>`
        : '';

    const phaseKey = `shell.scrape.phaseNames.${p.phase || ''}`;
    const phaseText = p.phase && i18n.has(phaseKey) ? t(phaseKey) : (p.phase || t('shell.scrape.phaseless'));

    const modal = document.createElement('div');
    modal.id = 'app-modal';
    modal.innerHTML = `
        <div class="modal-overlay">
            <div class="modal-content modal-wide" role="dialog" aria-modal="true" aria-labelledby="scrape-modal-title">
                <div class="scrape-modal-header">
                    <h3 id="scrape-modal-title" class="modal-title">${escapeHtml(t('shell.scrape.detailsTitle'))}</h3>
                    <button class="btn btn-ghost btn-sm" id="scrape-modal-close" type="button">${escapeHtml(t('actions.close'))}</button>
                </div>
                <div class="scrape-modal-summary">
                    ${escapeHtml(t('shell.scrape.phaseSummary', { phase: phaseText, newJobs: p.new_jobs || 0 }))}
                </div>
                ${scoringHtml}
                <table class="scrape-sources-table">
                    <thead>
                        <tr><th>${escapeHtml(t('shell.scrape.columns.source'))}</th><th>${escapeHtml(t('shell.scrape.columns.status'))}</th><th>${escapeHtml(t('shell.scrape.columns.duration'))}</th><th>${escapeHtml(t('shell.scrape.columns.listings'))}</th><th>${escapeHtml(t('shell.scrape.columns.newJobs'))}</th><th>${escapeHtml(t('shell.scrape.columns.error'))}</th></tr>
                    </thead>
                    <tbody>${rows || `<tr><td colspan="6">${escapeHtml(t('shell.scrape.noSources'))}</td></tr>`}</tbody>
                </table>
                ${errorsHtml}
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#scrape-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('.modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) modal.remove();
    });
    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); modal.remove(); }
    });
}

async function initScrapeResume() {
    try {
        const p = await api.getScrapeProgress();
        if (p && p.active) {
            startScrapePoll(p.task_id);
        }
    } catch {}
}

// === Theme Toggle ===
function initTheme() {
    const saved = localStorage.getItem('jf_theme');
    if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('jf_theme', next);
}

// === Keyboard Shortcuts ===
let focusedJobIndex = -1;

// `desc` values are translation keys, resolved at render time so that the
// shortcuts help follows the current interface language.
const SHORTCUTS = {
    'j': { desc: 'shell.shortcuts.nextJob', action: () => navigateJob(1) },
    'k': { desc: 'shell.shortcuts.previousJob', action: () => navigateJob(-1) },
    'o': { desc: 'shell.shortcuts.openListing', action: openCurrentJob },
    'd': { desc: 'shell.shortcuts.dismissJob', action: dismissCurrentJob },
    'p': { desc: 'shell.shortcuts.prepareApplication', action: prepareCurrentJob },
    's': { desc: 'shell.shortcuts.scrapeNow', action: handleScrape },
    '/': { desc: 'shell.shortcuts.focusSearch', action: focusSearch },
    't': { desc: 'shell.shortcuts.triageMode', action: enterTriageMode },
    '?': { desc: 'shell.shortcuts.showHelp', action: toggleShortcutsHelp },
    'Escape': { desc: 'shell.shortcuts.closeOrBack', action: goBack },
};

document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    // Triage mode key bindings
    if (triageActive) {
        if (e.key === 'ArrowRight') { e.preventDefault(); triageKeep(); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); triageDismiss(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); triageSkip(); return; }
        if (e.key === 'z') { e.preventDefault(); triageUndo(); return; }
        if (e.key === 'Enter') {
            e.preventDefault();
            const job = triageJobs[triageIndex];
            if (job) navigate(`#/job/${job.id}`);
            return;
        }
        if (e.key === 'Escape') { e.preventDefault(); exitTriageMode(); return; }
        return;
    }

    if (e.key === 'Enter' && focusedJobIndex >= 0) {
        const cards = document.querySelectorAll('.job-card');
        if (cards[focusedJobIndex]) cards[focusedJobIndex].click();
        return;
    }

    const key = e.key;
    const shortcut = SHORTCUTS[key];
    if (shortcut) {
        e.preventDefault();
        shortcut.action();
    }
});

function navigateJob(delta) {
    const cards = document.querySelectorAll('.job-card');
    if (!cards.length) return;
    cards.forEach(c => c.classList.remove('job-card-focused'));
    focusedJobIndex = Math.max(0, Math.min(cards.length - 1, focusedJobIndex + delta));
    const card = cards[focusedJobIndex];
    card.classList.add('job-card-focused');
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function openCurrentJob() {
    const openLink = document.querySelector('a[target="_blank"][href^="http"]');
    if (openLink) window.open(openLink.href, '_blank');
}

function dismissCurrentJob() {
    const cards = document.querySelectorAll('.job-card');
    if (focusedJobIndex >= 0 && focusedJobIndex < cards.length) {
        const dismissBtn = cards[focusedJobIndex].querySelector('.dismiss-btn');
        if (dismissBtn) dismissBtn.click();
    }
}

function prepareCurrentJob() {
    const prepareBtn = document.getElementById('prepare-btn');
    if (prepareBtn && !prepareBtn.disabled) prepareBtn.click();
}

function focusSearch() {
    const searchInput = document.querySelector('.search-input');
    if (searchInput) searchInput.focus();
}

function goBack() {
    const modal = document.getElementById('shortcuts-modal');
    if (modal) { modal.remove(); return; }

    const appModal = document.getElementById('app-modal');
    if (appModal) { appModal.remove(); return; }

    if (notifDropdownOpen) {
        closeNotifDropdown();
        return;
    }

    if (window.location.hash.startsWith('#/job/')) {
        window.location.hash = '#/';
    }
}

function toggleShortcutsHelp() {
    let modal = document.getElementById('shortcuts-modal');
    if (modal) { modal.remove(); return; }
    modal = document.createElement('div');
    modal.id = 'shortcuts-modal';
    modal.innerHTML = `
        <div class="modal-overlay" onclick="document.getElementById('shortcuts-modal').remove()">
            <div class="modal-content" onclick="event.stopPropagation()">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h2 style="font-size:1.125rem;font-weight:700;margin:0">${escapeHtml(t('shell.shortcuts.title'))}</h2>
                    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('shortcuts-modal').remove()">${escapeHtml(t('actions.close'))}</button>
                </div>
                <div class="shortcuts-grid">
                    ${Object.entries(SHORTCUTS).map(([key, {desc}]) =>
                        `<div class="shortcut-key"><kbd>${key === ' ' ? escapeHtml(t('shell.shortcuts.space')) : escapeHtml(key)}</kbd></div><div class="shortcut-desc">${escapeHtml(t(desc))}</div>`
                    ).join('')}
                    <div class="shortcut-key"><kbd>Enter</kbd></div><div class="shortcut-desc">${escapeHtml(t('shell.shortcuts.openFocusedJob'))}</div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// === Init ===
// === Reminder Actions (global for onclick handlers) ===
window.completeReminder = async function(id) {
    try {
        await api.request('POST', `/api/reminders/${id}/complete`);
        showToast(t('shell.reminder.completed'), 'success');
        handleRoute();
    } catch (err) { showToast(apiErrorMessage(err), 'error'); }
};
window.dismissReminder = async function(id) {
    try {
        await api.request('POST', `/api/reminders/${id}/dismiss`);
        showToast(t('shell.reminder.dismissed'), 'success');
        handleRoute();
    } catch (err) { showToast(apiErrorMessage(err), 'error'); }
};

// === Notifications ===
let notifDropdownOpen = false;

async function updateNotifBadge() {
    try {
        const data = await api.getNotifications();
        const badge = document.getElementById('notif-badge');
        if (badge) {
            badge.textContent = data.unread_count;
            badge.style.display = data.unread_count > 0 ? '' : 'none';
        }
    } catch {}
}

function renderNotifDropdown(notifications) {
    const dropdown = document.getElementById('notif-dropdown');
    if (!dropdown) return;

    if (notifications.length === 0) {
        dropdown.innerHTML = `<div class="notif-empty">${escapeHtml(t('shell.notifications.empty'))}</div>`;
        return;
    }

    dropdown.innerHTML = `
        <div class="notif-header">
            <span style="font-weight:600;font-size:0.875rem">${escapeHtml(t('nav.notifications'))}</span>
            <button class="btn btn-ghost btn-sm" id="notif-read-all">${escapeHtml(t('shell.notifications.markAllRead'))}</button>
        </div>
        <div class="notif-list">
            ${notifications.slice(0, 20).map(n => `
                <div class="notif-item ${n.read ? '' : 'notif-unread'}" data-notif-id="${n.id}" data-job-id="${n.job_id}">
                    <div class="notif-item-title">${escapeHtml(n.title)}</div>
                    <div class="notif-item-message">${escapeHtml(n.message)}</div>
                </div>
            `).join('')}
        </div>
    `;

    document.getElementById('notif-read-all')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await api.markAllNotificationsRead();
        updateNotifBadge();
        dropdown.querySelectorAll('.notif-unread').forEach(el => el.classList.remove('notif-unread'));
    });

    dropdown.querySelectorAll('.notif-item').forEach(item => {
        item.addEventListener('click', async () => {
            const notifId = item.dataset.notifId;
            const jobId = item.dataset.jobId;
            await api.markNotificationRead(notifId);
            item.classList.remove('notif-unread');
            updateNotifBadge();
            dropdown.style.display = 'none';
            notifDropdownOpen = false;
            navigate(`#/job/${jobId}`);
        });
    });
}

async function toggleNotifDropdown() {
    const dropdown = document.getElementById('notif-dropdown');
    const btn = document.getElementById('notif-btn');
    if (!dropdown) return;
    notifDropdownOpen = !notifDropdownOpen;
    btn?.setAttribute('aria-expanded', String(notifDropdownOpen));
    if (notifDropdownOpen) {
        dropdown.style.display = 'block';
        try {
            const data = await api.getNotifications();
            renderNotifDropdown(data.notifications);
        } catch {}
    } else {
        dropdown.style.display = 'none';
    }
}

function closeNotifDropdown() {
    if (!notifDropdownOpen) return;
    document.getElementById('notif-dropdown').style.display = 'none';
    notifDropdownOpen = false;
    const btn = document.getElementById('notif-btn');
    btn?.setAttribute('aria-expanded', 'false');
    btn?.focus();
}

let _notifEventSource = null;
let _notifSSERetries = 0;
const _NOTIF_SSE_MAX_RETRIES = 5;

function initNotificationSSE() {
    if (_notifEventSource) { _notifEventSource.close(); _notifEventSource = null; }
    _notifEventSource = new EventSource('/api/notifications/stream');
    _notifEventSource.onmessage = (event) => {
        try {
            _notifSSERetries = 0;
            const notif = JSON.parse(event.data);
            showToast(`${notif.title}: ${notif.message}`, 'info');
            updateNotifBadge();
        } catch {}
    };
    _notifEventSource.onerror = () => {
        _notifEventSource.close();
        _notifEventSource = null;
        _notifSSERetries++;
        if (_notifSSERetries <= _NOTIF_SSE_MAX_RETRIES) {
            const delay = Math.min(30000 * Math.pow(2, _notifSSERetries - 1), 300000);
            setTimeout(initNotificationSSE, delay);
        }
    };
}

// === Language Switching ===
// The interface language lives in localStorage (`careerpulse_lang`), defaults
// to Simplified Chinese, and never follows the browser locale.
const PAGE_TITLE_KEYS = {
    feed: 'shell.pageTitle.jobs',
    stats: 'shell.pageTitle.stats',
    pipeline: 'shell.pageTitle.pipeline',
    calendar: 'shell.pageTitle.calendar',
    queue: 'shell.pageTitle.queue',
    network: 'shell.pageTitle.network',
    calculator: 'shell.pageTitle.calculator',
    settings: 'shell.pageTitle.settings',
    detail: 'shell.pageTitle.jobDetail',
};

function languageName(lang) {
    return t(`lang.${lang}`);
}

function updateLanguageButtons() {
    const lang = i18n.getLanguage();
    document.querySelectorAll('#lang-switch .lang-option').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang));
    });
}

function updateDocumentTitle() {
    const route = getRoute();
    const key = PAGE_TITLE_KEYS[route.view] || PAGE_TITLE_KEYS.feed;
    document.title = t(key);
}

/** Re-render the mounted page in the new language. */
async function rerenderForLanguage() {
    i18n.applyStatic(document);
    updateLanguageButtons();
    updateDocumentTitle();
    if (typeof updateSetupIndicator === 'function') updateSetupIndicator();
    if (typeof rerenderOnboarding === 'function' && document.getElementById('onboarding-wizard')) rerenderOnboarding();
    document.querySelectorAll('#lang-switch .lang-option').forEach((btn) => {
        btn.setAttribute('aria-label', t(btn.dataset.lang === 'zh-CN' ? 'nav.languageZhLabel' : 'nav.languageEnLabel'));
    });
    if (notifDropdownOpen) {
        try {
            const data = await api.getNotifications();
            renderNotifDropdown(data.notifications);
        } catch { /* keep the previous dropdown contents */ }
    }
    await handleRoute();
    if (lastScrapeState && lastScrapeState.active) renderScrapeButtonState(lastScrapeState);
}

async function applyLanguage(lang) {
    i18n.setLanguage(lang);
    await rerenderForLanguage();
    showToast(t('i18n.switched', { language: languageName(i18n.getLanguage()) }), 'info');
}

/**
 * Entry point for the nav language buttons: asks for confirmation before
 * discarding unsaved edits, then switches and re-renders.
 */
async function requestLanguageChange(lang) {
    const target = i18n.normalizeLanguage(lang);
    if (!target || target === i18n.getLanguage()) {
        updateLanguageButtons();
        return;
    }
    const proceed = await confirmDiscardUnsavedChanges({
        title: t('i18n.switchTitle', { language: languageName(target) }),
        message: t('i18n.unsavedWarning'),
        confirmText: t('i18n.switchConfirm'),
        cancelText: t('i18n.switchCancel'),
    });
    if (!proceed) {
        updateLanguageButtons();
        return;
    }
    await applyLanguage(target);
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    if (!isOnboardingDone()) {
        showOnboardingWizard();
    }
    updateSetupIndicator();
    // Static markup (nav, buttons, aria labels) is bound through data-i18n.
    i18n.applyStatic(document);
    updateLanguageButtons();
    updateDocumentTitle();
    handleRoute();

    window.addEventListener('hashchange', handleRoute);
    document.getElementById('scrape-btn').addEventListener('click', handleScrape);
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    document.getElementById('notif-btn').addEventListener('click', toggleNotifDropdown);
    document.querySelectorAll('#lang-switch .lang-option').forEach((btn) => {
        btn.addEventListener('click', () => requestLanguageChange(btn.dataset.lang));
    });

    // === Hamburger Menu ===
    const hamburger = document.getElementById('nav-hamburger');
    const navLinks = document.querySelector('.nav-links');
    const drawerOverlay = document.getElementById('nav-drawer-overlay');

    function openDrawer() {
        navLinks.classList.add('nav-drawer-open');
        drawerOverlay.classList.add('active');
        hamburger.setAttribute('aria-expanded', 'true');
    }

    function closeDrawer() {
        navLinks.classList.remove('nav-drawer-open');
        drawerOverlay.classList.remove('active');
        hamburger.setAttribute('aria-expanded', 'false');
    }

    function toggleDrawer() {
        if (navLinks.classList.contains('nav-drawer-open')) {
            closeDrawer();
        } else {
            openDrawer();
        }
    }

    hamburger.addEventListener('click', toggleDrawer);
    drawerOverlay.addEventListener('click', closeDrawer);
    window.matchMedia('(max-width: 1280px)').addEventListener('change', closeDrawer);

    navLinks.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', closeDrawer);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && navLinks.classList.contains('nav-drawer-open')) {
            closeDrawer();
            hamburger.focus();
        }
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (notifDropdownOpen && !e.target.closest('.notif-btn') && !e.target.closest('.notif-dropdown')) {
            closeNotifDropdown();
        }
    });

    updateNotifBadge();
    initNotificationSSE();
    initScrapeResume();
});
