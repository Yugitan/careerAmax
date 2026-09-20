import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadScripts } from './setup.js';

beforeAll(() => {
    document.body.innerHTML = `
        <div id="toast-container"></div>
        <div class="nav-links">
            <a class="nav-link" data-route="feed">Jobs</a>
            <a class="nav-link" data-route="stats">Dashboard</a>
            <a class="nav-link" data-route="pipeline">Pipeline</a>
            <a class="nav-link" data-route="calendar">Calendar</a>
            <a class="nav-link" data-route="queue">Queue</a>
            <a class="nav-link" data-route="network">Network</a>
            <a class="nav-link" data-route="calculator">Calculator</a>
            <a class="nav-link" data-route="settings">Settings</a>
        </div>
        <div id="app"></div>
        <div id="nav-wrapper">
            <button id="scrape-btn">Scrape Now</button>
        </div>
    `;

    loadScripts('utils.js', 'api.js');

    globalThis.renderFeed = async () => {};
    globalThis.renderJobDetail = async () => {};
    globalThis.renderStats = async () => {};
    globalThis.renderPipeline = async () => {};
    globalThis.renderQueue = async () => {};
    globalThis.renderNetwork = async () => {};
    globalThis.renderSettings = async () => {};
    globalThis.renderCalendar = async () => {};
    globalThis.renderSalaryCalculator = async () => {};
    globalThis.enterTriageMode = () => {};
    globalThis.exitTriageMode = () => {};
    globalThis.triageActive = false;
    globalThis.triageJobs = [];
    globalThis.triageIndex = 0;
    globalThis.triageUndoStack = [];

    loadScripts('app.js');
});

beforeEach(() => {
    window.location.hash = '#/';
    stopScrapePoll();
    currentScrapeTaskId = null;
    stallToastShownForTaskId = null;
    lastScrapeState = null;

    document.getElementById('toast-container').innerHTML = '';
    document.getElementById('app-modal')?.remove();
    document.querySelectorAll('.scrape-cancel-link').forEach(el => el.remove());
    stopCapturePoll();
    activeCancelHandler = null;

    const btn = document.getElementById('scrape-btn');
    btn.disabled = false;
    btn.textContent = 'Scrape Now';
    btn.className = '';
});

afterEach(() => {
    stopScrapePoll();
    delete globalThis.fetch;
    vi.restoreAllMocks();
});

describe('phaseLabel', () => {
    it('renders scraper name and progress for scraping phase', () => {
        expect(phaseLabel({ phase: 'scraping', current: 'wellfound', completed: 7, total: 14 }))
            .toBe('Scraping: wellfound (7/14)');
    });

    it('falls back to progress-only when no current scraper', () => {
        expect(phaseLabel({ phase: 'scraping', completed: 0, total: 12 }))
            .toBe('Scraping 0/12');
    });

    it('renders enrichment phase label', () => {
        expect(phaseLabel({ phase: 'enriching' })).toBe('Enriching job details\u2026');
    });

    it('renders classification phase label', () => {
        expect(phaseLabel({ phase: 'classifying' })).toBe('Classifying locations\u2026');
    });

    it('renders scoring progress', () => {
        expect(phaseLabel({ phase: 'scoring', scoring: { scored: 42, total: 120 } }))
            .toBe('Scoring: 42/120');
    });

    it('handles missing scoring object on scoring phase', () => {
        expect(phaseLabel({ phase: 'scoring' })).toBe('Scoring: 0/0');
    });

    it('renders done and error phases', () => {
        expect(phaseLabel({ phase: 'done' })).toBe('Done');
        expect(phaseLabel({ phase: 'error' })).toBe('Error');
    });
});

describe('computeStallSec', () => {
    it('returns 0 when server_now or last_updated_at are missing', () => {
        expect(computeStallSec({})).toBe(0);
        expect(computeStallSec({ server_now: 10 })).toBe(0);
        expect(computeStallSec({ last_updated_at: 10 })).toBe(0);
        expect(computeStallSec(null)).toBe(0);
    });

    it('computes server_now - last_updated_at', () => {
        expect(computeStallSec({ server_now: 100, last_updated_at: 75 })).toBe(25);
    });

    it('clamps negative values to 0', () => {
        expect(computeStallSec({ server_now: 50, last_updated_at: 60 })).toBe(0);
    });

    it('uses server monotonic clock only, ignoring client Date.now', () => {
        const realNow = Date.now();
        // Even if client clock is wildly ahead, stall math must be purely server-based
        expect(computeStallSec({ server_now: 1000, last_updated_at: 990 })).toBe(10);
        expect(Date.now()).toBeGreaterThanOrEqual(realNow);
    });
});

describe('renderScrapeButtonState', () => {
    it('shows phase label without warn/critical class when fresh', () => {
        renderScrapeButtonState({
            active: true, phase: 'scraping', current: 'wellfound',
            completed: 3, total: 10,
            server_now: 100, last_updated_at: 95,
            task_id: 't1',
        });
        const btn = document.getElementById('scrape-btn');
        expect(btn.disabled).toBe(true);
        expect(btn.innerHTML).toContain('Scraping: wellfound (3/10)');
        expect(btn.classList.contains('scrape-btn-warn')).toBe(false);
        expect(btn.classList.contains('scrape-btn-critical')).toBe(false);
        expect(document.querySelector('.scrape-cancel-link')).toBeNull();
    });

    it('adds warn class and cancel link above 30s stall', () => {
        renderScrapeButtonState({
            active: true, phase: 'scraping', current: 'wellfound',
            completed: 3, total: 10,
            server_now: 100, last_updated_at: 60,
            task_id: 't2',
        });
        const btn = document.getElementById('scrape-btn');
        expect(btn.classList.contains('scrape-btn-warn')).toBe(true);
        expect(btn.classList.contains('scrape-btn-critical')).toBe(false);
        expect(btn.innerHTML).toContain('Stalled');
        expect(document.querySelector('.scrape-cancel-link')).not.toBeNull();
    });

    it('adds critical class above 120s stall', () => {
        renderScrapeButtonState({
            active: true, phase: 'scraping', current: 'dice',
            completed: 5, total: 10,
            server_now: 200, last_updated_at: 60,
            task_id: 't3',
        });
        const btn = document.getElementById('scrape-btn');
        expect(btn.classList.contains('scrape-btn-critical')).toBe(true);
        expect(document.querySelector('.scrape-cancel-link')).not.toBeNull();
    });
});

// 一键抓取：网页只负责发起请求，真正的采集在用户浏览器里由扩展执行（PRD D1）。
describe('handleScrape — extension capture', () => {
    const captureState = (overrides = {}) => ({
        request_id: 'req-1',
        status: 'waiting',
        active: true,
        total: 0, saved: 0, skipped: 0, failed: 0,
        extension_seen: false,
        server_now: 0,
        ...overrides,
    });

    function mockFetch(handler) {
        globalThis.fetch = vi.fn(async (url, opts) => {
            const result = handler(url, opts);
            if (result) return result;
            return { ok: false, status: 404, json: async () => ({}) };
        });
    }

    beforeEach(() => {
        vi.useFakeTimers();
        stopCapturePoll();
        activeCancelHandler = null;
    });

    afterEach(() => {
        stopCapturePoll();
        vi.useRealTimers();
    });

    it('asks the server for a capture request and waits for the extension', async () => {
        let requestCalls = 0;
        mockFetch((url, opts) => {
            if (url === '/api/capture/request') {
                if (opts?.method === 'POST') requestCalls += 1;
                return { ok: true, status: 200, json: async () => captureState() };
            }
            return null;
        });

        await handleScrape();
        expect(requestCalls).toBe(1);
        expect(capturePollInterval).not.toBeNull();
        await vi.advanceTimersByTimeAsync(0);  // 第一次轮询落地

        const btn = document.getElementById('scrape-btn');
        expect(btn.disabled).toBe(true);
        expect(btn.textContent).toContain('Waiting for the extension');
        expect(btn.querySelector('.spinner')).not.toBeNull();
        // 等待阶段可以取消，按钮不会永远转圈
        expect(document.querySelector('.scrape-cancel-link')).not.toBeNull();
        expect(document.querySelectorAll('.toast-error').length).toBe(0);
    });

    it('surfaces a no-extension hint and resets the button when nobody claims the request', async () => {
        const cancelled = [];
        mockFetch((url, opts) => {
            if (url === '/api/capture/request' && opts?.method === 'POST') {
                return { ok: true, status: 200, json: async () => captureState() };
            }
            if (url === '/api/capture/cancel') {
                cancelled.push(true);
                return { ok: true, status: 200, json: async () => captureState({ status: 'cancelled' }) };
            }
            if (url === '/api/capture/request') {
                return { ok: true, status: 200, json: async () => captureState() };
            }
            return null;
        });

        await handleScrape();
        await vi.advanceTimersByTimeAsync(16000);

        expect(cancelled.length).toBe(1);
        const errorToasts = document.querySelectorAll('.toast-error');
        expect(errorToasts.length).toBe(1);
        expect(errorToasts[0].textContent).toContain('extension');
        const btn = document.getElementById('scrape-btn');
        expect(btn.disabled).toBe(false);
        expect(btn.textContent).toBe('Scrape Now');
        expect(capturePollInterval).toBeNull();
    });

    it('reports the capture result once the extension completes', async () => {
        let phase = 'capturing';
        mockFetch((url) => {
            if (url.startsWith('/api/capture/request')) {
                const body = phase === 'done'
                    ? captureState({ status: 'done', active: false, total: 12, saved: 9, skipped: 3 })
                    : captureState({ status: 'capturing' });
                return { ok: true, status: 200, json: async () => body };
            }
            return null;
        });

        await handleScrape();
        await vi.advanceTimersByTimeAsync(0);
        const btn = document.getElementById('scrape-btn');
        expect(btn.textContent).toContain('Capturing');

        phase = 'done';
        await vi.advanceTimersByTimeAsync(1000);

        const toasts = document.querySelectorAll('.toast-success');
        expect(toasts.length).toBe(1);
        expect(toasts[0].textContent).toContain('9 new jobs');
        expect(toasts[0].textContent).toContain('3 already tracked');
        expect(btn.disabled).toBe(false);
        expect(btn.textContent).toBe('Scrape Now');
        expect(capturePollInterval).toBeNull();
    });

    it('explains an empty capture instead of claiming jobs were found', async () => {
        mockFetch((url) => {
            if (url.startsWith('/api/capture/request')) {
                return {
                    ok: true, status: 200,
                    json: async () => captureState({ status: 'done', active: false, total: 0 }),
                };
            }
            return null;
        });

        await handleScrape();
        await vi.advanceTimersByTimeAsync(1000);

        const toasts = document.querySelectorAll('.toast-info');
        expect(toasts.length).toBe(1);
        expect(toasts[0].textContent).toContain('No new jobs on the open page');
    });

    it('points at the missing job list when the extension is alive but not on a list page', async () => {
        const cancelled = [];
        mockFetch((url) => {
            if (url === '/api/capture/request') {
                // 扩展在轮询（extension_seen），但它打开的页面没有职位卡片
                return {
                    ok: true, status: 200,
                    json: async () => captureState({ extension_seen: true, listing_seen: false }),
                };
            }
            if (url === '/api/capture/cancel') {
                cancelled.push(true);
                return { ok: true, status: 200, json: async () => captureState({ status: 'cancelled', active: false }) };
            }
            return null;
        });

        await handleScrape();
        await vi.advanceTimersByTimeAsync(16000);

        expect(cancelled.length).toBe(1);
        const errorToasts = document.querySelectorAll('.toast-error');
        expect(errorToasts.length).toBe(1);
        // 提示具体该怎么做，而不是笼统的「没等到扩展」
        expect(errorToasts[0].textContent).toContain('No job list found');
    });

    it('shows how far along a capture is instead of a bare spinner', async () => {
        mockFetch((url) => {
            if (url.startsWith('/api/capture/request')) {
                return {
                    ok: true, status: 200,
                    json: async () => captureState({
                        status: 'capturing', claimed_at: 0, progress_at: 0, server_now: 1,
                        total: 45, saved: 12, skipped: 3, failed: 0,
                    }),
                };
            }
            return null;
        });

        await handleScrape();
        await vi.advanceTimersByTimeAsync(0);

        expect(document.querySelector('.scrape-btn-label').textContent).toContain('15/45');
    });

    it('keeps waiting while the capture is actually making progress', async () => {
        const cancelled = [];
        let clock = 0;
        let saved = 0;
        mockFetch((url) => {
            if (url.startsWith('/api/capture/request')) {
                clock += 10;
                saved += 5;
                return {
                    ok: true, status: 200,
                    json: async () => captureState({
                        status: 'capturing',
                        claimed_at: 0,
                        progress_at: clock,  // 进度一直在前进
                        server_now: clock,
                        total: 60, saved, skipped: 0, failed: 0,
                    }),
                };
            }
            if (url === '/api/capture/cancel') {
                cancelled.push(true);
                return { ok: true, status: 200, json: async () => captureState({ status: 'cancelled', active: false }) };
            }
            return null;
        });

        await handleScrape();
        await vi.advanceTimersByTimeAsync(120000);  // 两分钟，远超旧的 60 秒硬上限

        // 采集慢不是错误：只要还在前进就不能杀掉它
        expect(cancelled.length).toBe(0);
        expect(capturePollInterval).not.toBeNull();
        expect(document.querySelectorAll('.toast-error').length).toBe(0);
        expect(document.getElementById('scrape-btn').querySelector('.spinner')).not.toBeNull();
    });

    it('gives up only when a claimed capture stops making progress', async () => {
        const cancelled = [];
        mockFetch((url, opts) => {
            if (url === '/api/capture/request') {
                // 认领后 900 秒没有任何进度前进（页面被关掉、采集卡死）
                return {
                    ok: true, status: 200,
                    json: async () => captureState({
                        status: 'capturing', claimed_at: 100, progress_at: 100, server_now: 1000,
                        total: 60,
                    }),
                };
            }
            if (url === '/api/capture/cancel') {
                cancelled.push(true);
                return { ok: true, status: 200, json: async () => captureState({ status: 'cancelled', active: false }) };
            }
            return null;
        });

        await handleScrape();
        await vi.advanceTimersByTimeAsync(1000);

        expect(cancelled.length).toBe(1);
        const errorToasts = document.querySelectorAll('.toast-error');
        expect(errorToasts.length).toBe(1);
        expect(errorToasts[0].textContent).toContain('stopped responding');
        expect(capturePollInterval).toBeNull();
    });

    it('explains a capture that found no job list, from the extension result', async () => {
        mockFetch((url) => {
            if (url.startsWith('/api/capture/request')) {
                return {
                    ok: true, status: 200,
                    json: async () => captureState({ status: 'done', active: false, total: 0, reason: 'no_listing' }),
                };
            }
            return null;
        });

        await handleScrape();
        await vi.advanceTimersByTimeAsync(1000);

        const toasts = document.querySelectorAll('.toast-info');
        expect(toasts.length).toBe(1);
        expect(toasts[0].textContent).toContain('No job list found');
    });

    it('shows an error toast and resets the button when the request fails', async () => {
        mockFetch((url, opts) => {
            if (url === '/api/capture/request' && opts?.method === 'POST') {
                return {
                    ok: false, status: 500,
                    json: async () => ({ detail: 'Internal error' }),
                };
            }
            return null;
        });

        await handleScrape();
        expect(capturePollInterval).toBeNull();
        const errorToasts = document.querySelectorAll('.toast-error');
        expect(errorToasts.length).toBe(1);
        const btn = document.getElementById('scrape-btn');
        expect(btn.disabled).toBe(false);
        expect(btn.textContent).toBe('Scrape Now');
    });

    it('tells the user to hard-refresh when a cached api.js predates the page', async () => {
        // 浏览器缓存了旧版 api.js：与其抛 `api.requestCapture is not a function`
        // 这种看不懂的 TypeError，不如直接让他刷新
        const original = api.requestCapture;
        delete api.requestCapture;
        try {
            await handleScrape();
        } finally {
            api.requestCapture = original;
        }

        const errorToasts = document.querySelectorAll('.toast-error');
        expect(errorToasts.length).toBe(1);
        expect(errorToasts[0].textContent).toContain('Hard refresh');
        const btn = document.getElementById('scrape-btn');
        expect(btn.disabled).toBe(false);
        expect(capturePollInterval).toBeNull();
    });

    it('lets the user cancel a pending capture request', async () => {
        let cancelCalls = 0;
        mockFetch((url, opts) => {
            if (url === '/api/capture/request' && opts?.method === 'POST') {
                return { ok: true, status: 200, json: async () => captureState() };
            }
            if (url === '/api/capture/cancel') {
                cancelCalls += 1;
                return { ok: true, status: 200, json: async () => captureState({ status: 'cancelled', active: false }) };
            }
            if (url.startsWith('/api/capture/request')) {
                return { ok: true, status: 200, json: async () => captureState() };
            }
            return null;
        });

        await handleScrape();
        await vi.advanceTimersByTimeAsync(0);
        document.querySelector('.scrape-cancel-link').dispatchEvent(new MouseEvent('click'));
        await vi.advanceTimersByTimeAsync(0);

        expect(cancelCalls).toBe(1);
        expect(capturePollInterval).toBeNull();
        const btn = document.getElementById('scrape-btn');
        expect(btn.disabled).toBe(false);
        expect(btn.textContent).toBe('Scrape Now');
    });
});

describe('initScrapeResume', () => {
    it('binds polling when an active scrape is already in progress', async () => {
        globalThis.fetch = vi.fn(async (url) => {
            if (url === '/api/scrape/progress') {
                return {
                    ok: true, status: 200,
                    json: async () => ({
                        active: true, phase: 'scoring', task_id: 'resume-1',
                        completed: 5, total: 5,
                        server_now: 100, last_updated_at: 100,
                        sources: [], scoring: { scored: 3, total: 10 },
                        errors: [],
                    }),
                };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        });

        await initScrapeResume();
        expect(currentScrapeTaskId).toBe('resume-1');
        expect(scrapePollInterval).not.toBeNull();
        stopScrapePoll();
    });

    it('is a no-op when no active scrape', async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: true, status: 200,
            json: async () => ({ active: false, phase: 'done' }),
        }));

        await initScrapeResume();
        expect(currentScrapeTaskId).toBeNull();
        expect(scrapePollInterval).toBeNull();
    });

    it('swallows network errors quietly', async () => {
        globalThis.fetch = vi.fn(async () => { throw new Error('network down'); });
        await initScrapeResume();
        expect(currentScrapeTaskId).toBeNull();
    });
});

describe('showScrapeSummaryToast', () => {
    it('renders summary with source counts and a View details action', () => {
        showScrapeSummaryToast({
            phase: 'done', new_jobs: 4, total: 3,
            sources: [
                { name: 'a', status: 'ok' },
                { name: 'b', status: 'ok' },
                { name: 'c', status: 'timeout' },
            ],
        });
        const toast = document.querySelector('.toast');
        expect(toast).not.toBeNull();
        expect(toast.textContent).toContain('Scrape complete');
        expect(toast.textContent).toContain('4 new jobs');
        expect(toast.textContent).toContain('2/3 sources ok');
        expect(toast.textContent).toContain('1 timeout');
        const action = toast.querySelector('.toast-action-btn');
        expect(action).not.toBeNull();
        expect(action.textContent).toBe('View details');
    });

    it('clicking View details opens the scrape modal', () => {
        showScrapeSummaryToast({
            phase: 'done', new_jobs: 2, total: 1,
            sources: [{ name: 'a', status: 'ok' }],
        });
        document.querySelector('.toast-action-btn').click();
        expect(document.getElementById('app-modal')).not.toBeNull();
    });
});

describe('showScrapeErrorToast', () => {
    it('renders an error toast with first error message', () => {
        showScrapeErrorToast({
            phase: 'error',
            errors: ['Cancelled by user'],
            sources: [],
        });
        const toast = document.querySelector('.toast-error');
        expect(toast).not.toBeNull();
        expect(toast.textContent).toContain('Scrape failed');
        expect(toast.textContent).toContain('Cancelled by user');
    });
});

describe('showScrapeDetailsModal', () => {
    it('renders a row per source with status, duration and error', () => {
        showScrapeDetailsModal({
            phase: 'done', new_jobs: 2,
            sources: [
                { name: 'dice', status: 'ok', duration_ms: 1234, listings_found: 50, new_jobs: 2, error: null },
                { name: 'wellfound', status: 'timeout', duration_ms: 120000, listings_found: 0, new_jobs: 0, error: 'exceeded 120s' },
            ],
            errors: [],
            scoring: { scored: 2, total: 2, skipped_reason: null },
        });
        const modal = document.getElementById('app-modal');
        expect(modal).not.toBeNull();
        const rows = modal.querySelectorAll('tbody tr');
        expect(rows.length).toBe(2);
        expect(rows[0].textContent).toContain('dice');
        expect(rows[0].textContent).toContain('1.2s');
        expect(rows[1].textContent).toContain('wellfound');
        expect(rows[1].textContent).toContain('exceeded 120s');
        expect(modal.textContent).toContain('Scrape Details');
    });

    it('shows pipeline errors block when errors are present', () => {
        showScrapeDetailsModal({
            phase: 'error', new_jobs: 0,
            sources: [],
            errors: ['scraping phase timed out'],
            scoring: {},
        });
        const modal = document.getElementById('app-modal');
        expect(modal.querySelector('.scrape-modal-errors')).not.toBeNull();
        expect(modal.textContent).toContain('scraping phase timed out');
    });

    it('close button removes the modal', () => {
        showScrapeDetailsModal({ phase: 'done', new_jobs: 0, sources: [], errors: [], scoring: {} });
        document.getElementById('scrape-modal-close').click();
        expect(document.getElementById('app-modal')).toBeNull();
    });
});

describe('stall toast dedupe', () => {
    it('shows the stall toast at most once per task_id', async () => {
        const state = {
            active: true, phase: 'scraping', task_id: 'stuck-1',
            completed: 1, total: 5, current: 'dice',
            server_now: 200, last_updated_at: 60,
            sources: [], scoring: {}, errors: [],
        };
        globalThis.fetch = vi.fn(async () => ({
            ok: true, status: 200, json: async () => state,
        }));

        await pollScrapeOnce();
        await pollScrapeOnce();
        await pollScrapeOnce();

        const toasts = document.querySelectorAll('.toast');
        expect(toasts.length).toBe(1);
        expect(toasts[0].textContent).toContain('Scrape appears stuck');
    });
});
