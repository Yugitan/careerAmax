import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanDOM } from './helpers.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as fixtures from './fixtures/boss-dom.js';

// 回归固定样本：样本文件里是 BOSS 直聘各类页面结构的转录（见 fixtures/boss-dom.js）。
// 这里只断言「样本 → 解析结果」，不关心页面怎么被找到；站点改版时先更新样本。

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
let config;

beforeEach(() => {
  cleanDOM();
  globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false });
  api = loadScript();
  config = api.JOB_BOARD_CONFIGS['zhipin.com'];
});

afterEach(() => {
  cleanDOM();
});

function mountListing(html) {
  const wrapper = document.createElement('ul');
  wrapper.className = 'job-list-box';
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  Object.defineProperty(window, 'location', {
    value: {
      hostname: 'www.zhipin.com',
      href: 'https://www.zhipin.com/web/geek/job?query=后端',
      origin: 'https://www.zhipin.com',
      pathname: '/web/geek/job',
    },
    writable: true,
    configurable: true,
  });
  return wrapper;
}

function mountDetail(html, { pathname = '/job_detail/8f3c1e2b9a4d5c6e1f0a2b3c4d5e6f7081.html' } = {}) {
  document.body.innerHTML = html;
  Object.defineProperty(window, 'location', {
    value: {
      hostname: 'www.zhipin.com',
      href: `https://www.zhipin.com${pathname}`,
      origin: 'https://www.zhipin.com',
      pathname,
    },
    writable: true,
    configurable: true,
  });
}

// ═══════════════════════════════════════════════════════════════
// 列表卡片样本
// ═══════════════════════════════════════════════════════════════

describe('BOSS listing card fixtures', () => {
  it('reads the current card layout', () => {
    mountListing(fixtures.listingCardCurrent);
    const job = api.parseJobCard(document.querySelector('li.job-card-wrapper'), config);

    expect(job.title).toBe('资深后端开发工程师'); // raw business content
    expect(job.company).toBe('某某科技有限公司'); // raw business content
    expect(job.location).toBe('深圳·南山区'); // raw business content
    expect(job.url).toBe(
      'https://www.zhipin.com/job_detail/8f3c1e2b9a4d5c6e1f0a2b3c4d5e6f7081.html'
    );
    expect(job.salary_min).toBe(35000);
    expect(job.salary_max).toBe(60000);
    expect(job.experience_req).toBe('5-10年');
    expect(job.education_req).toBe('本科');
    expect(job.company_stage).toBe('已上市');
    expect(job.company_size).toBe('1000-9999');
    expect(job.job_labels).toEqual(['五险一金', '弹性工作']);
  });

  it('reads the classic card layout with span tags', () => {
    mountListing(fixtures.listingCardClassic);
    const job = api.parseJobCard(document.querySelector('li.job-card-wrapper'), config);

    expect(job.title).toBe('数据分析师'); // raw business content
    expect(job.company).toBe('某某信息技术有限公司'); // raw business content
    expect(job.location).toBe('杭州·西湖区'); // raw business content
    expect(job.salary_min).toBe(12000);
    expect(job.salary_max).toBe(18000);
    expect(job.experience_req).toBe('1-3年');
    expect(job.education_req).toBe('大专');
    expect(job.company_stage).toBe('不需要融资');
    expect(job.job_labels).toEqual(['双休']);
  });

  it('captures a 面议 card without inventing a salary', () => {
    mountListing(fixtures.listingCardNegotiable);
    const job = api.parseJobCard(document.querySelector('li.job-card-wrapper'), config);

    expect(job.title).toBe('技术合伙人'); // raw business content
    expect(job.salary_min).toBeUndefined();
    expect(job.salary_max).toBeUndefined();
    expect(job.experience_req).toBe('10年以上');
    expect(job.education_req).toBe('硕士');
    expect(job.company_stage).toBe('B轮');
    expect(job.company_size).toBe('100-499');
    expect(job.job_labels).toEqual([]);
  });

  it('injects an actionable save button for each fixture card', async () => {
    mountListing(fixtures.listingCardCurrent + fixtures.listingCardClassic + fixtures.listingCardNegotiable);
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { found: false },
    });

    await api.processJobCards(config);

    const buttons = document.querySelectorAll('.cp-overlay-save-btn');
    expect(buttons.length).toBe(3);
    for (const btn of buttons) expect(btn.disabled).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 详情页样本
// ═══════════════════════════════════════════════════════════════

describe('BOSS detail page fixtures', () => {
  it('reads the classic detail layout', () => {
    mountDetail(fixtures.detailPageClassic);
    const data = api.extractDetailPageData(config);

    expect(data.title).toBe('Python开发工程师'); // raw business content
    expect(data.company).toBe('某某网络科技有限公司'); // raw business content
    expect(data.location).toBe('北京·朝阳区'); // raw business content
    expect(data.experience_req).toBe('3-5年');
    expect(data.education_req).toBe('本科');
    expect(data.salary_min).toBe(25000);
    expect(data.salary_max).toBe(40000);
    expect(data.description).toContain('负责后端服务开发与维护');
  });

  it('reads the current detail layout', () => {
    mountDetail(fixtures.detailPageCurrent);
    const data = api.extractDetailPageData(config);

    expect(data.title).toBe('资深后端开发工程师'); // raw business content
    expect(data.company).toBe('某某科技有限公司'); // raw business content
    expect(data.location).toBe('深圳·南山区'); // raw business content
    expect(data.experience_req).toBe('5-10年');
    expect(data.education_req).toBe('本科');
    expect(data.company_stage).toBe('已上市');
    expect(data.company_size).toBe('1000-9999');
    expect(data.job_labels).toEqual(['五险一金', '补充医疗保险', '年终奖']);
    expect(data.salary_min).toBe(35000);
    expect(data.salary_max).toBe(60000);
    expect(data.description).toContain('核心交易链路');
  });

  it('still captures a redesigned page where every class name changed', () => {
    mountDetail(fixtures.detailPageRenamedClasses);
    const data = api.extractDetailPageData(config);

    expect(data).not.toBeNull();
    expect(data.title).toBe('资深后端开发工程师'); // raw business content
    expect(data.company).toBe('某某科技有限公司'); // raw business content
    expect(data.location).toBe('深圳·南山区'); // raw business content
    expect(data.experience_req).toBe('5-10年');
    expect(data.education_req).toBe('本科');
    expect(data.description).toContain('核心交易链路');
  });

  it('sends the captured facts to the backend when saving a detail page', async () => {
    mountDetail(fixtures.detailPageCurrent);
    globalThis.chrome.runtime.sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { found: false } })
      .mockResolvedValueOnce({ ok: true, data: { job_id: 12 } });

    const saved = await api.captureDetailPage(config);
    expect(saved).toBe(true);

    const payload = globalThis.chrome.runtime.sendMessage.mock.calls[1][0].jobData;
    expect(payload).toMatchObject({
      url: 'https://www.zhipin.com/job_detail/8f3c1e2b9a4d5c6e1f0a2b3c4d5e6f7081.html',
      source: 'BOSS直聘', // i18n-audit-ignore: 站点展示名（专有名词）
      experience_req: '5-10年',
      education_req: '本科',
      company_size: '1000-9999',
      company_stage: '已上市',
      job_labels: ['五险一金', '补充医疗保险', '年终奖'],
      salary_min: 35000,
      salary_max: 60000,
    });
    expect(payload.description).toContain('核心交易链路');
  });
});
