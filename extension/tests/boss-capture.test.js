import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanDOM } from './helpers.js';
import { readFileSync } from 'fs';
import { join } from 'path';

function loadScript() {
  window.__cpAutofillLoaded = false;
  window.__cpAutofillTest = true;
  window.__cpAutofillTestAPI = undefined;

  const code = readFileSync(join(__dirname, '..', 'content.js'), 'utf-8');
  const safeCode = code.replace(
    /chrome\.runtime\.onMessage\.addListener/g,
    'globalThis.chrome.runtime.onMessage.addListener'
  );
  eval(safeCode);
  return window.__cpAutofillTestAPI;
}

let api;

beforeEach(() => {
  cleanDOM();
  globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false });
  api = loadScript();
});

afterEach(() => {
  cleanDOM();
});

// Real BOSS Zhipin listing card structure. The anchor href is relative
// (/job_detail/<id>.html?lid=...&sessionId=...); in tests jsdom resolves it
// against the test-page origin, so expectations use relative-path URLs with
// volatile query params stripped, mirroring real-site behavior where origin is
// https://www.zhipin.com.
function createBossCard() {
  const li = document.createElement('li');
  li.className = 'job-card-wrapper clearfix';
  li.innerHTML = `
    <div class="job-card-left">
      <div class="job-title">
        <span class="job-name">Python开发工程师</span>
        <span class="job-area-wrapper"><span class="job-area">北京·朝阳区</span></span>
      </div>
      <div class="job-info">
        <span class="tag-list">3-5年</span>
        <span class="tag-list">本科</span>
        <span class="job-info-section">
          <span class="job-salary">25-40K·13薪</span>
        </span>
      </div>
      <div class="job-card-footer">
        <div class="company-info">
          <p class="company-name"><a href="/gongsi/abc123.html">字节跳动</a></p>
          <div class="company-tag-list">不需要融资</div>
        </div>
      </div>
    </div>
    <a class="job-card-left" href="/job_detail/abc123def.html?lid=7ahpEMXxaQZ&sessionId=1" ka="search_list_j_1" target="_blank"></a>
  `;
  document.body.appendChild(li);
  return li;
}

describe('BOSS Zhipin board', () => {
  it('is detected on zhipin.com', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.zhipin.com', href: 'https://www.zhipin.com/web/geek/job?query=python', origin: 'https://www.zhipin.com' },
      writable: true,
      configurable: true,
    });
    const config = api.detectJobBoard();
    expect(config).not.toBeNull();
    expect(config.name).toBe('BOSS直聘');
  });

  it('parses a listing card', () => {
    const card = createBossCard();
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    const job = api.parseJobCard(card, config);
    expect(job).not.toBeNull();
    expect(job.title).toBe('Python开发工程师'); // raw business content
    expect(job.company).toBe('字节跳动'); // raw business content
    expect(job.location).toBe('北京·朝阳区'); // raw business content
    expect(job.url).toBe(`${window.location.origin}/job_detail/abc123def.html`);
    expect(job.source).toBe('BOSS直聘');
    expect(job.salary_min).toBe(25000);
    expect(job.salary_max).toBe(40000);
  });

  it('parses salary ranges without months', () => {
    const card = createBossCard();
    card.querySelector('.job-salary').textContent = '15-25K';
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    const job = api.parseJobCard(card, config);
    expect(job.salary_min).toBe(15000);
    expect(job.salary_max).toBe(25000);
  });

  it('handles missing salary gracefully', () => {
    const card = createBossCard();
    card.querySelector('.job-salary').remove();
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    const job = api.parseJobCard(card, config);
    expect(job.salary_min).toBeUndefined();
    expect(job.salary_max).toBeUndefined();
  });

  it('returns null when no link present', () => {
    const card = createBossCard();
    card.querySelector('a[href*="/job_detail/"]').remove();
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    const job = api.parseJobCard(card, config);
    expect(job).toBeNull();
  });

  it('processes cards and requests save', async () => {
    createBossCard();
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false });
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    await api.processJobCards(config);
    const buttons = document.querySelectorAll('.cp-overlay-save-btn');
    expect(buttons.length).toBe(1);
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'getScoreForUrl',
      url: `${window.location.origin}/job_detail/abc123def.html`,
    });
  });

  it('keeps the save button actionable for a job that is not tracked yet', async () => {
    createBossCard();
    // 后端对未收录职位返回 200 + {found:false}，不能当成"已保存"。
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { found: false },
    });
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    await api.processJobCards(config);

    const btn = document.querySelector('.cp-overlay-save-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('Save to CareerPulse');
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains('cp-overlay-saved')).toBe(false);
    expect(document.querySelector('.cp-overlay-score-badge')).toBeNull();
  });

  it('marks tracked jobs as saved and shows the match score', async () => {
    createBossCard();
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { found: true, job_id: 7, score: 86 },
    });
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    await api.processJobCards(config);

    const btn = document.querySelector('.cp-overlay-save-btn');
    expect(btn.textContent).toBe('Saved');
    expect(btn.disabled).toBe(true);
    expect(document.querySelector('.cp-overlay-score-badge').textContent).toBe('86%');
  });

  it('re-processes a recycled list node for the job it now shows', async () => {
    const card = createBossCard();
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];

    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { found: true, job_id: 7, score: 90 },
    });
    await api.processJobCards(config);
    expect(document.querySelector('.cp-overlay-score-badge')).not.toBeNull();

    // 虚拟滚动把同一个 <li> 回收给了另一个职位
    card.querySelector('a[href*="/job_detail/"]').setAttribute('href', '/job_detail/zzz999.html');
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { found: false },
    });
    await api.processJobCards(config);

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'getScoreForUrl',
      url: `${window.location.origin}/job_detail/zzz999.html`,
    });
    expect(document.querySelector('.cp-overlay-score-badge')).toBeNull();
    expect(card.querySelector('.cp-overlay-save-btn').disabled).toBe(false);
  });

  it('reads the salary from a card that only uses .salary', async () => {
    const card = createBossCard();
    const salary = card.querySelector('.job-salary');
    salary.className = 'salary';
    salary.textContent = '15-25K';
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    const job = api.parseJobCard(card, config);
    expect(job.salary_min).toBe(15000);
    expect(job.salary_max).toBe(25000);
  });

  it('finds cards when the wrapper uses the newer class name', async () => {
    const card = createBossCard();
    card.className = 'job-card-box';
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { found: false },
    });
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    await api.processJobCards(config);

    expect(document.querySelectorAll('.cp-overlay-save-btn').length).toBe(1);
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'getScoreForUrl',
      url: `${window.location.origin}/job_detail/abc123def.html`,
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Field cleanup (BOSS 直聘的文本形态)
// ═══════════════════════════════════════════════════════════════

describe('BOSS field cleanup', () => {
  it('parses monthly salary ranges and the 万 form', () => {
    expect(api.parseSalaryText('25-40K·13薪')).toEqual({ salary_min: 25000, salary_max: 40000 });
    expect(api.parseSalaryText('15-25K')).toEqual({ salary_min: 15000, salary_max: 25000 });
    expect(api.parseSalaryText('30-60万')).toEqual({ salary_min: 300000, salary_max: 600000 });
  });

  it('returns no salary for 面议 and for empty text', () => {
    expect(api.parseSalaryText('面议')).toEqual({});
    expect(api.parseSalaryText('')).toEqual({});
  });

  it('strips the salary that shares the title node', () => {
    expect(api.cleanJobTitle('Python开发工程师25-40K·13薪', '25-40K·13薪'))
      .toBe('Python开发工程师');
  });

  it('strips a 【】 prefix and the 招聘 suffix', () => {
    expect(api.cleanJobTitle('【急招】Python开发工程师', '')).toBe('Python开发工程师');
    expect(api.cleanCompanyName('字节跳动招聘')).toBe('字节跳动');
  });

  it('keeps only the location part of a combined detail string', () => {
    expect(api.cleanLocation('北京·朝阳区 ·3-5年 ·本科')).toBe('北京·朝阳区');
    expect(api.cleanLocation('上海·浦东新区')).toBe('上海·浦东新区');
    expect(api.cleanLocation('3-5年 · 本科')).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// Detail page (JD) capture
// ═══════════════════════════════════════════════════════════════

describe('BOSS detail page capture', () => {
  function createDetailPage() {
    document.body.innerHTML = `
      <div class="job-banner">
        <div class="name">Python开发工程师</div>
        <div class="job-place">北京·朝阳区</div>
        <div class="salary">25-40K·13薪</div>
      </div>
      <div class="job-detail">
        <div class="job-sec">
          <div class="job-sec-text">职位描述：负责后端服务开发与维护</div>
        </div>
      </div>
      <div class="job-sider">
        <div class="company">
          <div class="company-info">
            <div class="name">字节跳动</div>
          </div>
        </div>
      </div>
    `;
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.zhipin.com', href: 'https://www.zhipin.com/job_detail/abc123def.html?lid=xxx', origin: 'https://www.zhipin.com', pathname: '/job_detail/abc123def.html' },
      writable: true,
      configurable: true,
    });
  }

  it('extracts title/company/description/salary from a detail page', () => {
    createDetailPage();
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    const data = api.extractDetailPageData(config);
    expect(data).not.toBeNull();
    expect(data.title).toBe('Python开发工程师'); // raw business content
    expect(data.company).toBe('字节跳动'); // raw business content
    expect(data.description).toContain('职位描述');
    expect(data.url).toBe('https://www.zhipin.com/job_detail/abc123def.html');
    expect(data.salary_min).toBe(25000);
    expect(data.salary_max).toBe(40000);
  });

  it('returns null on non-detail pages', () => {
    createDetailPage();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.zhipin.com', href: 'https://www.zhipin.com/web/geek/job', origin: 'https://www.zhipin.com', pathname: '/web/geek/job' },
      writable: true,
      configurable: true,
    });
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    expect(api.extractDetailPageData(config)).toBeNull();
  });

  it('returns null when description is missing', () => {
    createDetailPage();
    document.querySelector('.job-sec-text').remove();
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    expect(api.extractDetailPageData(config)).toBeNull();
  });

  it('captureDetailPage saves via saveJob when job already known', async () => {
    createDetailPage();
    globalThis.chrome.runtime.sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { found: true, job_id: 7, score: 80 } })
      .mockResolvedValueOnce({ ok: true, data: { job_id: 7 } });

    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    await api.captureDetailPage(config);

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    const saveCall = globalThis.chrome.runtime.sendMessage.mock.calls[1][0];
    expect(saveCall.type).toBe('saveJob');
    expect(saveCall.jobData.source).toBe('BOSS直聘');
    expect(saveCall.jobData.description).toContain('职位描述');
  });

  it('captureDetailPage skips unknown job without title/company', async () => {
    createDetailPage();
    document.querySelector('.job-banner .name').textContent = '';
    globalThis.chrome.runtime.sendMessage = vi.fn()
      .mockResolvedValue({ ok: false });

    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    await api.captureDetailPage(config);

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('captureDetailPage does not re-capture the same URL', async () => {
    createDetailPage();
    globalThis.chrome.runtime.sendMessage = vi.fn()
      .mockResolvedValue({ ok: true, data: { found: true, job_id: 7 } });

    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    await api.captureDetailPage(config);
    await api.captureDetailPage(config);

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('reads the current detail layout where the title shares a node with the salary', () => {
    document.body.innerHTML = `
      <div class="job-primary detail-box">
        <div class="info-primary">
          <div class="name"><h1>Python开发工程师</h1><span class="salary">25-40K·13薪</span></div>
          <p>北京·朝阳区 ·3-5年 ·本科</p>
        </div>
        <div class="info-company">
          <div class="company-info"><a href="/gongsi/abc.html"><h3 class="name">字节跳动</h3></a></div>
        </div>
      </div>
      <div class="job-detail-section">
        <h2 class="job-sec-title">职位描述</h2>
        <div class="job-sec-text">负责后端服务开发与维护</div>
      </div>
    `;
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.zhipin.com', href: 'https://www.zhipin.com/job_detail/abc123def.html', origin: 'https://www.zhipin.com', pathname: '/job_detail/abc123def.html' },
      writable: true,
      configurable: true,
    });

    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    const data = api.extractDetailPageData(config);

    expect(data.title).toBe('Python开发工程师'); // raw business content
    expect(data.company).toBe('字节跳动'); // raw business content
    expect(data.location).toBe('北京·朝阳区'); // raw business content
    expect(data.description).toContain('后端服务开发');
    expect(data.salary_min).toBe(25000);
    expect(data.salary_max).toBe(40000);
  });

  it('finds the JD by section heading when the wrapper class changed', () => {
    document.body.innerHTML = `
      <div class="job-primary"><div class="info-primary"><div class="name"><h1>Python开发工程师</h1></div></div></div>
      <div class="brand-new-wrapper">
        <h2>岗位职责</h2>
        <div>负责后端服务开发与维护，参与系统设计，编写高质量代码，配合测试完成上线并持续优化服务性能与稳定性。</div>
      </div>
    `;
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.zhipin.com', href: 'https://www.zhipin.com/job_detail/abc123def.html', origin: 'https://www.zhipin.com', pathname: '/job_detail/abc123def.html' },
      writable: true,
      configurable: true,
    });

    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    const data = api.extractDetailPageData(config);
    expect(data).not.toBeNull();
    expect(data.description).toContain('负责后端服务开发与维护');
  });

  it('retries until the asynchronously rendered JD appears', async () => {
    createDetailPage();
    document.querySelector('.job-sec-text').remove();
    globalThis.chrome.runtime.sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { found: true, job_id: 7 } })
      .mockResolvedValueOnce({ ok: true, data: { job_id: 7 } });

    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    const capture = api.captureDetailPage(config, { attempts: 10, intervalMs: 5 });
    setTimeout(() => {
      const sec = document.createElement('div');
      sec.className = 'job-sec-text';
      sec.textContent = '职位描述：负责后端服务开发与维护';
      document.querySelector('.job-detail').appendChild(sec);
    }, 10);

    await expect(capture).resolves.toBe(true);
    const saveCall = globalThis.chrome.runtime.sendMessage.mock.calls[1][0];
    expect(saveCall.type).toBe('saveJob');
    expect(saveCall.jobData.description).toContain('职位描述');
  });

  it('re-captures the JD when an SPA navigation swaps the job in place', async () => {
    createDetailPage();
    globalThis.chrome.runtime.sendMessage = vi.fn()
      .mockResolvedValue({ ok: true, data: { found: true, job_id: 7 } });

    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    await api.captureDetailPage(config);
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);

    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.zhipin.com', href: 'https://www.zhipin.com/job_detail/zzz999.html', origin: 'https://www.zhipin.com', pathname: '/job_detail/zzz999.html' },
      writable: true,
      configurable: true,
    });
    await api.captureDetailPage(config);

    const saveCall = globalThis.chrome.runtime.sendMessage.mock.calls[3][0];
    expect(saveCall.jobData.url).toBe('https://www.zhipin.com/job_detail/zzz999.html');
  });

  it('watches the URL so in-page navigations get captured', () => {
    createDetailPage();
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    const spy = vi.spyOn(globalThis, 'setInterval');
    api.watchDetailNavigation(config);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBeGreaterThan(0);
    spy.mockRestore();
  });
});
