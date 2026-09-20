import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanDOM } from './helpers.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// 一键抓取：网页端「立即抓取」→ 服务端建采集请求 → 扩展轮询认领 → 在用户打开的
// 页面上把**已渲染**的卡片整体回传（app/routers/capture.py + content.js）。
//
// 这里固定住三件事：只抓眼前看得到的（不翻页、不滚屏、不发平台请求）、
// 已在库里的职位不重复回传、以及结果统计与按钮状态一致。

function loadScript() {
  window.__cpAutofillLoaded = false;
  window.__cpAutofillTest = true;
  window.__cpAutofillTestAPI = undefined;
  const code = readFileSync(join(import.meta.dirname, '..', 'content.js'), 'utf-8');
  eval(code.replace(
    /chrome\.runtime\.onMessage\.addListener/g,
    'globalThis.chrome.runtime.onMessage.addListener'
  ));
  return window.__cpAutofillTestAPI;
}

function createBossCard({ id = 'abc123def', title = '资深后端开发工程师', company = '某某科技有限公司' } = {}) {
  const li = document.createElement('li');
  li.className = 'job-card-wrapper';
  li.innerHTML = `
    <div class="job-card-body">
      <h3 class="job-name"><a href="/job_detail/${id}.html?lid=x">${title}</a></h3>
      <span class="job-area">深圳·南山区</span>
      <span class="salary">35-60K·15薪</span>
      <ul class="tag-list"><li>3-5年</li><li>本科</li><li>五险一金</li></ul>
    </div>
    <div class="job-card-footer">
      <div class="company-info"><h3 class="company-name"><a href="/gongsi/abc.html">${company}</a></h3></div>
      <div class="company-tag-list"><span>1000-9999人</span><span>已上市</span></div>
    </div>
    <a class="job-card-left" href="/job_detail/${id}.html?lid=x"></a>
  `;
  document.body.appendChild(li);
  return li;
}

let api;
let config;
let sentMessages;

beforeEach(() => {
  cleanDOM();
  globalThis.chrome.runtime.id = 'test-extension-id';
  sentMessages = [];
  globalThis.chrome.runtime.sendMessage = vi.fn(async (message) => {
    sentMessages.push(message);
    if (message.type === 'saveJob') return { ok: true, data: { job_id: 1, created: true } };
    if (message.type === 'claimCaptureRequest') return { ok: true, data: { pending: false } };
    return { ok: true, data: { found: false } };
  });
  api = loadScript();
  config = api.JOB_BOARD_CONFIGS['zhipin.com'];
});

afterEach(() => {
  api?.stopCaptureRequestPolling();
  cleanDOM();
  globalThis.chrome.runtime.id = 'test-extension-id';
});

function saves() {
  return sentMessages.filter((m) => m.type === 'saveJob');
}

function toastText() {
  return document.getElementById('cp-autofill-toast')?.textContent || '';
}

// 常驻悬浮面板（复用自动填表浮层元素）
function panel() {
  return document.getElementById('cp-autofill-overlay');
}

function captureBtn() {
  return document.getElementById(api.PANEL_CAPTURE_BTN_ID);
}

function openPanel(cfg = config) {
  return api.showJobBoardPanel(cfg);
}

// 面板上的抓取按钮走的是「当前页面」这条路（captureCurrentPage 自己认站点）
function useJobBoard(hostname = 'www.zhipin.com') {
  Object.defineProperty(window, 'location', {
    value: {
      hostname,
      href: `https://${hostname}/web/geek/job`,
      origin: `https://${hostname}`,
      pathname: '/web/geek/job',
    },
    writable: true,
    configurable: true,
  });
}

// 页面上真的出现了一张申请表（简历上传 + 联系方式）：detectApplicationForm 判 'high'
function appendApplicationForm() {
  const form = document.createElement('form');
  form.innerHTML = '<input name="first_name"><input name="email"><input type="file" name="resume_upload">';
  document.body.appendChild(form);
  return form;
}

describe('collectVisibleJobCards', () => {
  it('collects every rendered card with the platform vocabulary', () => {
    createBossCard({ id: 'aaa111' });
    createBossCard({ id: 'bbb222', title: '数据分析师' });

    const entries = api.collectVisibleJobCards(config);
    expect(entries).toHaveLength(2);
    expect(entries[0].jobData.url).toContain('/job_detail/aaa111.html');
    // 会话参数被剥掉：同一个职位在卡片与详情页两次回传中是同一个 URL
    expect(entries[0].jobData.url).not.toContain('lid=');
    expect(entries[0].jobData.title).toBe('资深后端开发工程师'); // raw business content
    expect(entries[0].jobData.experience_req).toBe('3-5年');
    expect(entries[0].jobData.education_req).toBe('本科');
    expect(entries[0].jobData.company_size).toBe('1000-9999');
    expect(entries[0].jobData.company_stage).toBe('已上市');
    expect(entries[0].jobData.job_labels).toContain('五险一金');
  });

  it('dedupes repeated links to the same job', () => {
    const card = createBossCard({ id: 'dup000' });
    // BOSS 列表里同一个职位会有多个指向详情的链接（标题 + 整卡热区）
    const extra = document.createElement('a');
    extra.href = '/job_detail/dup000.html?lid=y';
    card.appendChild(extra);

    expect(api.collectVisibleJobCards(config)).toHaveLength(1);
  });

  it('caps a single run (PRD §5.2: 100 jobs per session)', () => {
    for (let i = 0; i < 5; i++) createBossCard({ id: `many${i}` });
    expect(api.collectVisibleJobCards(config, 3)).toHaveLength(3);
    expect(api.BULK_CAPTURE_LIMIT).toBe(100);
  });

  it('returns nothing on a page without cards', () => {
    expect(api.collectVisibleJobCards(config)).toEqual([]);
  });
});

describe('captureVisibleJobs', () => {
  it('saves every card and reports the summary', async () => {
    createBossCard({ id: 'one111' });
    createBossCard({ id: 'two222' });
    createBossCard({ id: 'three33' });

    const summary = await api.captureVisibleJobs(config);

    expect(summary).toEqual({ total: 3, saved: 3, skipped: 0, failed: 0, reason: null });
    expect(saves()).toHaveLength(3);
    expect(saves()[0].jobData.url).toContain('/job_detail/one111.html');
    // 每张卡片都变成「已保存」，用户看到的和统计口径一致
    document.querySelectorAll('.cp-overlay-save-btn').forEach((btn) => {
      expect(btn.classList.contains('cp-overlay-saved')).toBe(true);
      expect(btn.disabled).toBe(true);
    });
  });

  it('skips jobs already marked as tracked on the page', async () => {
    const saved = createBossCard({ id: 'known11' });
    createBossCard({ id: 'fresh22' });
    // 扫描阶段查到库里已经有这个职位
    await api.processJobCards(config);
    saved.querySelector('.cp-overlay-save-btn').classList.add('cp-overlay-saved');

    sentMessages.length = 0;
    const summary = await api.captureVisibleJobs(config);

    expect(summary).toEqual({ total: 2, saved: 1, skipped: 1, failed: 0, reason: null });
    expect(saves()).toHaveLength(1);
    expect(saves()[0].jobData.url).toContain('fresh22');
  });

  it('counts a backend "already tracked" as skipped, not saved', async () => {
    createBossCard({ id: 'dupe99' });
    globalThis.chrome.runtime.sendMessage = vi.fn(async (message) => {
      sentMessages.push(message);
      if (message.type === 'saveJob') return { ok: true, data: { job_id: 4, created: false } };
      return { ok: true, data: { found: false } };
    });

    const summary = await api.captureVisibleJobs(config);
    expect(summary).toEqual({ total: 1, saved: 0, skipped: 1, failed: 0, reason: null });
  });

  it('keeps going when one job fails and reports the failure', async () => {
    createBossCard({ id: 'bad111' });
    createBossCard({ id: 'ok2222' });
    let first = true;
    globalThis.chrome.runtime.sendMessage = vi.fn(async (message) => {
      sentMessages.push(message);
      if (message.type !== 'saveJob') return { ok: true, data: { found: false } };
      if (first) {
        first = false;
        return { ok: false, code: 'job.title_and_company_required', params: {}, error: 'nope' };
      }
      return { ok: true, data: { job_id: 2, created: true } };
    });

    const summary = await api.captureVisibleJobs(config);
    expect(summary).toEqual({ total: 2, saved: 1, skipped: 0, failed: 1, reason: null });
  });

  it('stops early once the content script lost its extension context', async () => {
    createBossCard({ id: 'a00001' });
    createBossCard({ id: 'b00002' });
    createBossCard({ id: 'c00003' });
    globalThis.chrome.runtime.id = undefined;

    const summary = await api.captureVisibleJobs(config);
    expect(summary.saved).toBe(0);
    expect(summary.failed).toBe(3);
    expect(saves()).toHaveLength(0);
    expect(toastText()).toContain('refresh this page');
  });
});

describe('runVisibleCapture', () => {
  it('shows a summary toast and leaves the final pace on the panel', async () => {
    createBossCard({ id: 'x11111' });
    createBossCard({ id: 'y22222' });
    openPanel(config);

    await api.runVisibleCapture(config);

    expect(toastText()).toContain('Saved 2 jobs');
    expect(toastText()).toContain('0 already tracked');
    expect(api.bulkCaptureInFlight).toBe(false);
    expect(captureBtn().textContent).toBe('Uploaded 2/2');
  });

  it('explains an empty page instead of claiming success', async () => {
    const summary = await api.runVisibleCapture(config);
    expect(summary.total).toBe(0);
    expect(toastText()).toContain('No new jobs on this page');
  });

  it('ignores a second click while a capture is running', async () => {
    createBossCard({ id: 'z33333' });
    let release;
    globalThis.chrome.runtime.sendMessage = vi.fn((message) => {
      sentMessages.push(message);
      if (message.type === 'saveJob') {
        return new Promise((resolve) => { release = () => resolve({ ok: true, data: { created: true } }); });
      }
      return Promise.resolve({ ok: true, data: { found: false } });
    });

    const first = api.runVisibleCapture(config);
    await new Promise((r) => setTimeout(r, 5));
    expect(await api.runVisibleCapture(config)).toBeNull();  // 第二次不重复提交
    release();
    await first;
    expect(saves()).toHaveLength(1);
  });
});

// 常驻悬浮面板：进入支持的招聘站点就自己浮出来 —— 用户不必再点扩展图标才看到面板。
// 面板里就是弹窗那一套（连接状态 / 填写申请表 / 一键抓取 / 打开设置）。
describe('job board panel', () => {
  it('appears on its own once a supported job board loads', () => {
    useJobBoard('www.zhipin.com');
    createBossCard({ id: 'panel1' });

    api.initJobBoardOverlay();  // content script 进入页面时走的就是这里

    expect(panel()).not.toBeNull();
    expect(panel().querySelector('.cp-autofill-panel-status')).not.toBeNull();
    expect(panel().querySelector('.cp-autofill-panel-fill')).not.toBeNull();
    expect(captureBtn().textContent).toContain('Capture all 1 jobs');
    expect(panel().querySelector('.cp-autofill-panel-settings')).not.toBeNull();
  });

  it('reports the connection state and links to the server settings', async () => {
    createBossCard({ id: 'panel2' });
    openPanel(config);
    await new Promise((r) => setTimeout(r, 0));

    // 连接状态与弹窗同源（background 的 checkConnection）
    expect(panel().querySelector('.cp-autofill-panel-status-text').textContent)
      .toBe('Connected to CareerPulse');
    expect(panel().querySelector('.cp-autofill-panel-dot').className).toContain('connected');
    expect(panel().querySelector('.cp-autofill-panel-settings').href)
      .toBe('http://localhost:8085/#/settings');
  });

  it('explains a disconnected server instead of pretending everything is fine', async () => {
    globalThis.chrome.runtime.sendMessage = vi.fn(async (message) => {
      if (message.type === 'checkConnection') return { ok: false, error: 'unreachable' };
      return { ok: true, data: { found: false } };
    });
    createBossCard({ id: 'panel3' });
    openPanel(config);
    await new Promise((r) => setTimeout(r, 0));

    expect(panel().querySelector('.cp-autofill-panel-dot').className).toContain('disconnected');
    expect(panel().querySelector('.cp-autofill-panel-fill').disabled).toBe(true);
    expect(captureBtn().disabled).toBe(true);
  });

  it('keeps the capture row as an idle control when there is no job list', () => {
    const overlay = openPanel(config);

    expect(overlay).not.toBeNull();
    expect(captureBtn().textContent).toBe('No jobs to capture on this page');
    expect(captureBtn().disabled).toBe(true);
    expect(captureBtn().title).toContain('Open a job list on this site');
  });

  it('goes idle again when the list is gone', () => {
    createBossCard({ id: 'panel4' });
    openPanel(config);
    expect(captureBtn().textContent).toContain('Capture all 1 jobs');

    document.querySelector('.job-card-wrapper').remove();
    api.syncPanelCapture(config);

    expect(captureBtn().textContent).toBe('No jobs to capture on this page');
    expect(captureBtn().disabled).toBe(true);
  });

  it('only enables the fill button when the page really has an application form', async () => {
    useJobBoard('www.zhipin.com');
    openPanel(config);
    await new Promise((r) => setTimeout(r, 0));
    const fill = () => panel().querySelector('.cp-autofill-panel-fill');

    // 招聘列表页没有申请表：按钮留着但置灰，并说明为什么
    expect(fill().disabled).toBe(true);
    expect(fill().title).toBe('No application form on this page');

    // 表单晚于面板出现（Easy Apply 弹层、SPA 路由）：页面扫描就该把按钮点亮，
    // 不需要用户重开页面、切语言或者重新渲染面板
    appendApplicationForm();
    api.syncPanelCapture(config);

    expect(fill().disabled).toBe(false);
    expect(fill().title).toBe('');
  });

  it('hands an embedded ATS form over to the iframe instead of filling nothing', async () => {
    // 表单在 Greenhouse 的 iframe 里：顶层文档探不到任何字段，但 iframe 里的内容
    // 脚本能填。弹窗（tabs.sendMessage 会送到所有 frame）与页面角标都能用，
    // 面板之前会在顶层静默退出
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'www.zhipin.com',
        href: 'https://www.zhipin.com/web/geek/job?gh_jid=123',
        origin: 'https://www.zhipin.com',
        pathname: '/web/geek/job',
        search: '?gh_jid=123',
      },
      writable: true,
      configurable: true,
    });
    openPanel(config);
    await new Promise((r) => setTimeout(r, 0));

    const fill = panel().querySelector('.cp-autofill-panel-fill');
    expect(fill.disabled).toBe(false);

    sentMessages.length = 0;
    fill.click();

    expect(sentMessages.map((m) => m.type)).toContain('broadcastStartFill');
  });

  it('re-checks a dead connection on the next scan instead of staying grey forever', async () => {
    globalThis.chrome.runtime.sendMessage = vi.fn(async (message) => {
      if (message.type === 'checkConnection') return { ok: false, error: 'unreachable' };
      return { ok: true, data: { found: false } };
    });
    useJobBoard('www.zhipin.com');
    openPanel(config);
    await new Promise((r) => setTimeout(r, 0));
    expect(panel().querySelector('.cp-autofill-panel-dot').className).toContain('disconnected');

    // 用户把服务启起来了：下一次页面扫描（过了 15s 节流）应自己变回已连接
    globalThis.chrome.runtime.sendMessage = vi.fn(async (message) => {
      if (message.type === 'checkConnection') return { ok: true };
      return { ok: true, data: { found: false } };
    });
    const realNow = Date.now;
    Date.now = () => realNow() + 20000;
    try {
      api.syncPanelCapture(config);
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      Date.now = realNow;
    }

    const dotClass = panel().querySelector('.cp-autofill-panel-dot').className;
    expect(dotClass).not.toContain('disconnected');
    expect(panel().querySelector('.cp-autofill-panel-status-text').textContent)
      .toBe('Connected to CareerPulse');
  });

  it('comes back after a fill flow that left nothing on screen', async () => {
    useJobBoard('www.zhipin.com');
    createBossCard({ id: 'panel6' });
    openPanel(config);

    // 假装在 ATS 内嵌 iframe 里、又没有可填字段：填表流程会直接把浮层清掉
    Object.defineProperty(window, 'self', { value: {}, configurable: true });
    await api.startFillFlow();
    Object.defineProperty(window, 'self', { value: window, configurable: true });

    // 常驻面板不应该因此消失
    expect(panel()).not.toBeNull();
    expect(captureBtn()).not.toBeNull();
  });

  it('captures the page from its capture row', async () => {
    useJobBoard('www.zhipin.com');
    createBossCard({ id: 'panel5' });
    openPanel(config);
    await new Promise((r) => setTimeout(r, 0));

    captureBtn().click();
    await new Promise((r) => setTimeout(r, 30));

    expect(saves()).toHaveLength(1);
    expect(toastText()).toContain('Saved 1 jobs');
    expect(captureBtn().textContent).toBe('Uploaded 1/1');
    expect(captureBtn().disabled).toBe(false);
  });
});

// 面板是浮层：拖动表头就能挪走，位置与收起状态都写进 chrome.storage.local，
// 刷新/换页面后仍然待在原地。
describe('floating panel position', () => {
  function dragHeader(el, from, to) {
    el.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, clientX: from.x, clientY: from.y,
    }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: to.x, clientY: to.y }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }

  function header() {
    return panel().querySelector('.cp-autofill-overlay-header');
  }

  it('starts pinned to the right-bottom corner', () => {
    createBossCard({ id: 'pos001' });
    const overlay = openPanel(config);

    // jsdom 里没有布局：默认位置由 styles.css 的 right/bottom 决定
    expect(overlay.style.left).toBe('');
    expect(overlay.style.bottom).toBe('');
  });

  it('can be dragged by its header and remembers where it was left', () => {
    createBossCard({ id: 'pos002' });
    const overlay = openPanel(config);
    globalThis.chrome.storage.local.set.mockClear();

    dragHeader(header(), { x: 100, y: 100 }, { x: 500, y: 400 });

    expect(overlay.style.left).toBe('400px');
    expect(overlay.style.top).toBe('300px');
    expect(overlay.style.right).toBe('auto');
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith({
      [api.PANEL_POSITION_KEY]: { left: 400, top: 300 },
    });
  });

  it('keeps itself inside the viewport', () => {
    createBossCard({ id: 'pos003' });
    const overlay = openPanel(config);

    // 往屏幕外拖：必须留在视口里（否则面板就再也抓不到了）
    dragHeader(header(), { x: 10, y: 10 }, { x: -3000, y: -3000 });
    expect(parseFloat(overlay.style.left)).toBeGreaterThanOrEqual(12);
    expect(parseFloat(overlay.style.top)).toBeGreaterThanOrEqual(12);

    dragHeader(header(), { x: 10, y: 10 }, { x: 9000, y: 9000 });
    expect(parseFloat(overlay.style.left)).toBeLessThan(window.innerWidth);
    expect(parseFloat(overlay.style.top)).toBeLessThan(window.innerHeight);
  });

  it('restores a remembered position on the next page load', async () => {
    globalThis.chrome.storage.local.get = vi.fn(async () => ({
      [api.PANEL_POSITION_KEY]: { left: 60, top: 80 },
    }));
    createBossCard({ id: 'pos004' });

    const overlay = openPanel(config);
    await new Promise((r) => setTimeout(r, 0));

    expect(overlay.style.left).toBe('60px');
    expect(overlay.style.top).toBe('80px');
  });

  it('remembers a collapsed panel across pages', async () => {
    globalThis.chrome.storage.local.get = vi.fn(async () => ({
      [api.PANEL_COLLAPSED_KEY]: true,
    }));
    createBossCard({ id: 'pos005' });

    const overlay = openPanel(config);
    await new Promise((r) => setTimeout(r, 0));

    expect(overlay.querySelector('.cp-autofill-overlay-body').style.display).toBe('none');
    expect(overlay.classList.contains('cp-autofill-overlay-collapsed')).toBe(true);
  });

  it('collapses — and remembers — when the user clicks minimize', () => {
    createBossCard({ id: 'pos006' });
    const overlay = openPanel(config);
    globalThis.chrome.storage.local.set.mockClear();

    overlay.querySelector('.cp-autofill-overlay-minimize').click();

    expect(overlay.querySelector('.cp-autofill-overlay-body').style.display).toBe('none');
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith({
      [api.PANEL_COLLAPSED_KEY]: true,
    });
  });
});

// 抓取进度就在面板那一行上：抓取途中是「已回传 X/N」，而不是等结束了才给一个结果。
describe('capture progress on the panel', () => {
  it('turns into a progress badge while capturing, not just a result at the end', async () => {
    createBossCard({ id: 'prog11' });
    createBossCard({ id: 'prog22' });
    openPanel(config);
    const btn = captureBtn();
    expect(btn.textContent).toContain('Capture all 2 jobs');

    const releases = [];
    globalThis.chrome.runtime.sendMessage = vi.fn((message) => {
      sentMessages.push(message);
      if (message.type === 'saveJob') {
        return new Promise((resolve) => {
          releases.push(() => resolve({ ok: true, data: { created: true } }));
        });
      }
      return Promise.resolve({ ok: true, data: { found: false } });
    });

    const capture = api.runVisibleCapture(config);
    await new Promise((r) => setTimeout(r, 5));

    // 一条都还没回传：先说明「在抓」，不再停在原来的计数上
    expect(releases).toHaveLength(2);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Capturing…');

    // 回传完第一张就能看到进度，而不用等整批结束才知道跑到哪儿了
    releases[0]();
    await new Promise((r) => setTimeout(r, 5));
    expect(btn.textContent).toBe('Uploaded 1/2');

    releases[1]();
    await capture;

    // 结束先把最终进度停在面板上（几秒后才退回「抓取本页 N 个岗位」）
    expect(btn.textContent).toBe('Uploaded 2/2');
    expect(btn.classList.contains('cp-autofill-panel-busy')).toBe(true);
    expect(toastText()).toContain('Saved 2 jobs');
  });

  it('falls back to the page count after the result has been on screen for a while', async () => {
    vi.useFakeTimers();
    try {
      createBossCard({ id: 'linger1' });
      openPanel(config);
      const btn = captureBtn();

      const capture = api.runVisibleCapture(config);
      await vi.advanceTimersByTimeAsync(1000);
      expect(btn.textContent).toBe('Uploaded 1/1');

      await vi.advanceTimersByTimeAsync(5000);
      expect(btn.textContent).toContain('Capture all 1 jobs');
      expect(btn.disabled).toBe(false);
      expect(btn.classList.contains('cp-autofill-panel-busy')).toBe(false);
      await capture;
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the same progress while the capture was started from the popup', async () => {
    useJobBoard('www.zhipin.com');
    createBossCard({ id: 'popup1' });
    openPanel(config);
    await new Promise((r) => setTimeout(r, 0));

    await api.captureCurrentPage();

    // 入口不同，页面面板上看到的进度一样
    expect(captureBtn().textContent).toBe('Uploaded 1/1');
  });
});

describe('capture request polling', () => {
  it('claims a pending request, captures the page and reports back', async () => {
    createBossCard({ id: 'claim1' });
    const completions = [];
    globalThis.chrome.runtime.sendMessage = vi.fn(async (message) => {
      sentMessages.push(message);
      if (message.type === 'claimCaptureRequest') {
        return { ok: true, data: { pending: true, request_id: 'req-42' } };
      }
      if (message.type === 'completeCaptureRequest') {
        completions.push(message);
        return { ok: true, data: {} };
      }
      if (message.type === 'saveJob') return { ok: true, data: { job_id: 1, created: true } };
      return { ok: true, data: { found: false } };
    });

    await api.pollCaptureRequest(config);

    expect(saves()).toHaveLength(1);
    expect(completions).toHaveLength(1);
    expect(completions[0].requestId).toBe('req-42');
    expect(completions[0].summary).toEqual({ total: 1, saved: 1, skipped: 0, failed: 0, reason: null });
    expect(typeof completions[0].pageUrl).toBe('string');
    expect(completions[0].pageUrl).not.toBe('');
  });

  it('does nothing when there is no pending request', async () => {
    createBossCard({ id: 'noop01' });
    await api.pollCaptureRequest(config);
    expect(saves()).toHaveLength(0);
    expect(sentMessages.filter((m) => m.type === 'completeCaptureRequest')).toHaveLength(0);
  });

  it('lets the other tab keep the request it already claimed', async () => {
    createBossCard({ id: 'tab002' });
    // 另一个标签已经认走了：这里会拿到 pending=false + status=capturing（心跳式轮询）
    globalThis.chrome.runtime.sendMessage = vi.fn(async (message) => {
      sentMessages.push(message);
      if (message.type === 'claimCaptureRequest') {
        return { ok: true, data: { pending: false, status: 'capturing', request_id: 'req-1' } };
      }
      return { ok: true, data: { found: false } };
    });

    await api.pollCaptureRequest(config);

    expect(saves()).toHaveLength(0);
    expect(sentMessages.filter((m) => m.type === 'completeCaptureRequest')).toHaveLength(0);
  });

  it('reports an empty capture so the web app is not left waiting', async () => {
    const completions = [];
    globalThis.chrome.runtime.sendMessage = vi.fn(async (message) => {
      if (message.type === 'claimCaptureRequest') {
        return { ok: true, data: { pending: true, request_id: 'req-7' } };
      }
      if (message.type === 'completeCaptureRequest') {
        completions.push(message);
        return { ok: true, data: {} };
      }
      return { ok: true, data: { found: false } };
    });

    await api.pollCaptureRequest(config);

    // 空手而归必须带原因：网页据此提示「当前页面不是职位列表页」
    expect(completions[0].summary).toEqual({
      total: 0, saved: 0, skipped: 0, failed: 0, reason: 'no_listing',
    });
  });

  it('stops polling when the extension was reloaded', async () => {
    api.startCaptureRequestPolling(config);
    expect(api.capturePolling).toBe(true);

    globalThis.chrome.runtime.sendMessage = vi.fn()
      .mockRejectedValue(new Error('Extension context invalidated.'));

    await expect(api.pollCaptureRequest(config)).resolves.toBeUndefined();
    expect(api.capturePolling).toBe(false);
  });

  it('runs at most one capture at a time', async () => {
    createBossCard({ id: 'once01' });
    api.startCaptureRequestPolling(config);
    let release;
    globalThis.chrome.runtime.sendMessage = vi.fn((message) => {
      sentMessages.push(message);
      if (message.type === 'claimCaptureRequest') {
        return Promise.resolve({ ok: true, data: { pending: true, request_id: 'req-1' } });
      }
      if (message.type === 'saveJob') {
        return new Promise((resolve) => { release = () => resolve({ ok: true, data: { created: true } }); });
      }
      return Promise.resolve({ ok: true, data: {} });
    });

    const first = api.pollCaptureRequest(config);
    await new Promise((r) => setTimeout(r, 5));
    await api.pollCaptureRequest(config);  // 上一次还没结束 → 直接跳过
    release();
    await first;
    expect(saves()).toHaveLength(1);
  });

  it('sends progress heartbeats so the web page is not left guessing', async () => {
    for (let i = 0; i < 3; i++) createBossCard({ id: `hb00${i}` });
    const progress = [];
    globalThis.chrome.runtime.sendMessage = vi.fn(async (message) => {
      sentMessages.push(message);
      if (message.type === 'claimCaptureRequest') {
        return { ok: true, data: { pending: true, request_id: 'req-9' } };
      }
      if (message.type === 'reportCaptureProgress') {
        progress.push(message);
        return { ok: true, data: {} };
      }
      if (message.type === 'saveJob') return { ok: true, data: { job_id: 1, created: true } };
      return { ok: true, data: {} };
    });

    await api.pollCaptureRequest(config);

    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0].requestId).toBe('req-9');
    expect(progress[progress.length - 1].summary.total).toBe(3);
    expect(progress[progress.length - 1].summary.saved).toBe(3);
  });

  it('tells the server whether this page actually has job cards', async () => {
    await api.pollCaptureRequest(config);
    const empty = sentMessages.find((m) => m.type === 'claimCaptureRequest');
    // 详情页也在轮询：明确说「这里没有列表」，服务端才不会把活派给它
    expect(empty.hasListing).toBe(false);

    sentMessages.length = 0;
    createBossCard({ id: 'ready1' });
    await api.pollCaptureRequest(config);
    expect(sentMessages.find((m) => m.type === 'claimCaptureRequest').hasListing).toBe(true);
  });

  it('hasVisibleCards only checks for cards, it does not parse them', () => {
    expect(api.hasVisibleCards(config)).toBe(false);
    createBossCard({ id: 'cheap1' });
    expect(api.hasVisibleCards(config)).toBe(true);
  });
});

// 扩展弹窗里的「立即抓取」按钮（popup.js → content.js 的 startCapture）：
// 和页面上的按钮共用同一个执行体，区别只是把结果回传给弹窗。
describe('captureCurrentPage (popup button)', () => {
  function useBoard(hostname) {
    Object.defineProperty(window, 'location', {
      value: {
        hostname,
        href: `https://${hostname}/web/geek/job`,
        origin: `https://${hostname}`,
        pathname: '/web/geek/job',
      },
      writable: true,
      configurable: true,
    });
  }

  it('captures the visible cards and reports the summary', async () => {
    useBoard('www.zhipin.com');
    createBossCard({ id: 'pop001' });
    createBossCard({ id: 'pop002' });

    const result = await api.captureCurrentPage();

    expect(result).toEqual({
      ok: true,
      summary: { total: 2, saved: 2, skipped: 0, failed: 0, reason: null },
    });
    expect(saves()).toHaveLength(2);
    expect(toastText()).toContain('Saved 2 jobs');
  });

  it('reports an empty listing page instead of a silent success', async () => {
    useBoard('www.zhipin.com');
    const result = await api.captureCurrentPage();

    expect(result.ok).toBe(true);
    expect(result.summary.reason).toBe('no_listing');
    expect(saves()).toHaveLength(0);
  });

  it('refuses to double-submit while a capture is running', async () => {
    useBoard('www.zhipin.com');
    createBossCard({ id: 'busy01' });
    let release;
    globalThis.chrome.runtime.sendMessage = vi.fn((message) => {
      sentMessages.push(message);
      if (message.type === 'saveJob') {
        return new Promise((resolve) => { release = () => resolve({ ok: true, data: { created: true } }); });
      }
      return Promise.resolve({ ok: true, data: { found: false } });
    });

    const first = api.captureCurrentPage();
    await new Promise((r) => setTimeout(r, 5));

    expect(await api.captureCurrentPage()).toEqual({ ok: false, code: 'capture.busy' });
    release();
    expect((await first).ok).toBe(true);
    expect(saves()).toHaveLength(1);
  });

  it('tells the popup when the page is not a supported job board', async () => {
    useBoard('example.com');
    createBossCard({ id: 'nope01' });  // 卡片长得像职位也不能抓：站点不在支持列表里

    expect(await api.captureCurrentPage()).toEqual({ ok: false, code: 'capture.unsupported_site' });
    expect(saves()).toHaveLength(0);
  });

});

// 隐藏标签页里 Chrome 会把定时器降到 1 秒一次：一键抓取必须**完全不依赖定时器**，
// 否则用户点完「立即抓取」，45 张卡片就会从几秒变成几十秒（网页端只会看到超时）。
describe('bulk capture is not paced by timers', () => {
  it('saves cards concurrently instead of one timer-paced save at a time', async () => {
    for (let i = 0; i < 6; i++) createBossCard({ id: `conc0${i}` });

    let inFlight = 0;
    let maxInFlight = 0;
    const realSetTimeout = globalThis.setTimeout;

    globalThis.chrome.runtime.sendMessage = vi.fn((message) => {
      sentMessages.push(message);
      if (message.type !== 'saveJob') {
        return Promise.resolve({ ok: true, data: { found: false } });
      }
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) => realSetTimeout(() => {
        inFlight -= 1;
        resolve({ ok: true, data: { created: true } });
      }, 5));
    });

    const startedAt = Date.now();
    const summary = await api.captureVisibleJobs(config);
    const elapsed = Date.now() - startedAt;

    expect(summary.saved).toBe(6);
    expect(saves()).toHaveLength(6);
    // 同时在飞的不止一个（不是串行排队），也没有超出并发上限
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(api.BULK_CAPTURE_CONCURRENCY);
    // 原实现每张卡片之间要等 120ms 定时器（隐藏标签页里更会被拉到 1 秒），
    // 6 张卡片至少要 600ms；现在不应该有这种卡片间等待。
    expect(elapsed).toBeLessThan(120);
  });

  it('reports the running snapshot through onProgress', async () => {
    for (let i = 0; i < 4; i++) createBossCard({ id: `prog0${i}` });
    const snapshots = [];

    const summary = await api.captureVisibleJobs(config, {
      concurrency: 1,
      onProgress: (progress) => snapshots.push({ ...progress }),
    });

    expect(summary.saved).toBe(4);
    expect(snapshots.length).toBeGreaterThan(0);
    // 最后一次一定是完整快照，网页端据此显示「采集中 4/4」
    expect(snapshots[snapshots.length - 1]).toEqual(summary);
    expect(snapshots[0].total).toBe(4);
  });

  it('marks an empty page with a reason the web app can explain', async () => {
    const summary = await api.captureVisibleJobs(config);
    expect(summary.total).toBe(0);
    expect(summary.reason).toBe('no_listing');
  });
});
