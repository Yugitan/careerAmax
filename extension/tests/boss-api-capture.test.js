import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanDOM } from './helpers.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as api_ from './fixtures/boss-api.js';

// C1 页面上下文采集：浏览器扩展的 MAIN world 桥（boss-page-bridge.js）把页面自己
// 发出的职位接口响应转发给内容脚本，这里验证「校验 + 归一化 + 兼底合并」的契约。

const extensionDir = join(__dirname, '..');

function loadScript() {
  window.__cpAutofillLoaded = false;
  window.__cpAutofillTest = true;
  window.__cpAutofillTestAPI = undefined;
  const code = readFileSync(join(extensionDir, 'content.js'), 'utf-8');
  eval(code.replace(
    /chrome\.runtime\.onMessage\.addListener/g,
    'globalThis.chrome.runtime.onMessage.addListener'
  ));
  return window.__cpAutofillTestAPI;
}

function setLocation(pathname, search = '') {
  Object.defineProperty(window, 'location', {
    value: {
      hostname: 'www.zhipin.com',
      href: `https://www.zhipin.com${pathname}${search}`,
      origin: 'https://www.zhipin.com',
      pathname,
      search,
    },
    writable: true,
    configurable: true,
  });
}

const DETAIL_PATH = `/job_detail/${api_.BOSS_PAGE_JOB_ID}.html`;
const PAGE_IDS = {
  pathId: api_.BOSS_PAGE_JOB_ID,
  securityId: api_.BOSS_PAGE_SECURITY_ID,
};

let api;
let config;

beforeEach(() => {
  cleanDOM();
  globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false });
  api = loadScript();
  config = api.JOB_BOARD_CONFIGS['zhipin.com'];
  setLocation(DETAIL_PATH);
});

afterEach(() => {
  cleanDOM();
});

/** 模拟页面 world（MAIN）把接口响应投递过来 */
async function deliverBossApiResponse(payload, url = `https://www.zhipin.com/wapi/zpgeek/job/detail.json?encryptJobId=${api_.BOSS_PAGE_JOB_ID}`) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { __cpBossApi: true, url, payload },
    origin: 'https://www.zhipin.com',
    source: window,
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ═══════════════════════════════════════════════════════════════
// 载荷归一化
// ═══════════════════════════════════════════════════════════════

describe('extractBossApiJob', () => {
  it('normalizes the detail response into the capture payload', () => {
    const job = api.extractBossApiJob(api_.detailResponse, 'https://www.zhipin.com/wapi/zpgeek/job/detail.json', PAGE_IDS);

    expect(job).not.toBeNull();
    expect(job.title).toBe('资深后端开发工程师'); // raw business content
    expect(job.company).toBe('某某科技有限公司'); // raw business content
    expect(job.location).toBe('深圳·南山区'); // raw business content
    expect(job.salary_min).toBe(35000);
    expect(job.salary_max).toBe(60000);
    expect(job.experience_req).toBe('5-10年');
    expect(job.education_req).toBe('本科');
    expect(job.company_size).toBe('1000-9999');
    expect(job.company_stage).toBe('已上市');
    // welfareList 才是福利；skills 是技能标签，不该混进福利
    expect(job.job_labels).toEqual(['五险一金', '补充医疗保险', '年终奖']);
    expect(job.description).toContain('核心交易链路');
    expect(job.description).not.toContain('<br>');
  });

  it('finds the job object regardless of the response nesting', () => {
    const job = api.extractBossApiJob(api_.detailResponseNested, 'https://www.zhipin.com/wapi/zpgeek/job/detail.json', PAGE_IDS);

    expect(job.title).toBe('资深后端开发工程师'); // raw business content
    expect(job.experience_req).toBe('5-10年');
    expect(job.education_req).toBe('本科');
  });

  it('rejects a related-jobs payload that belongs to another posting', () => {
    expect(api.extractBossApiJob(
      api_.relatedJobsResponse,
      'https://www.zhipin.com/wapi/zpgeek/job/related.json',
      PAGE_IDS,
    )).toBeNull();
  });

  it('accepts an id-less payload only when the response URL carries the page id', () => {
    expect(api.extractBossApiJob(
      api_.detailResponseWithoutId,
      `https://www.zhipin.com/wapi/zpgeek/job/detail.json?encryptJobId=${api_.BOSS_PAGE_JOB_ID}`,
      PAGE_IDS,
    )).not.toBeNull();

    expect(api.extractBossApiJob(
      api_.detailResponseWithoutId,
      'https://www.zhipin.com/wapi/zpgeek/job/recommend.json',
      PAGE_IDS,
    )).toBeNull();
  });

  it('matches the page job id through the securityId as well', () => {
    const job = api.extractBossApiJob(api_.detailResponse, 'https://www.zhipin.com/wapi/zpgeek/job/detail.json', {
      pathId: '',
      securityId: api_.BOSS_PAGE_SECURITY_ID,
    });
    expect(job).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// 兼底合并
// ═══════════════════════════════════════════════════════════════

describe('mergeBossDetailData', () => {
  it('keeps the DOM values the user actually sees', () => {
    const merged = api.mergeBossDetailData(
      { title: 'DOM 标题', description: 'DOM 正文', location: '深圳·南山区' }, // raw business content
      { title: '接口标题', description: '接口正文', job_labels: ['五险一金'], company_size: '1000-9999' },
    );
    expect(merged.title).toBe('DOM 标题');
    expect(merged.description).toBe('DOM 正文');
    expect(merged.job_labels).toEqual(['五险一金']);
    expect(merged.company_size).toBe('1000-9999');
  });

  it('fills fields the DOM could not read and ignores empty DOM values', () => {
    const merged = api.mergeBossDetailData(
      { description: 'DOM 正文', experience_req: '', job_labels: [] },
      { experience_req: '5-10年', job_labels: ['年终奖'], company_stage: '已上市' },
    );
    expect(merged.experience_req).toBe('5-10年');
    expect(merged.job_labels).toEqual(['年终奖']);
    expect(merged.company_stage).toBe('已上市');
  });

  it('returns null when neither source produced a description', () => {
    expect(api.mergeBossDetailData({ title: '只有标题' }, { company_size: '100-499' })).toBeNull();
    expect(api.mergeBossDetailData(null, null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// 端到端：DOM 全失效时靠接口数据完成采集
// ═══════════════════════════════════════════════════════════════

describe('page-context capture fallback', () => {
  it('saves the job from the page API when the DOM yields nothing', async () => {
    // 大改版：页面结构与所有选择器都不匹配，连职位描述都找不到
    document.body.innerHTML = '<div class="y9"><span class="z1">加载中</span></div>';

    api.initBossApiSniffer(config);
    await deliverBossApiResponse(api_.detailResponse);

    globalThis.chrome.runtime.sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { found: false } })
      .mockResolvedValueOnce({ ok: true, data: { job_id: 21 } });

    const saved = await api.captureDetailPage(config, { attempts: 3, intervalMs: 5 });
    expect(saved).toBe(true);

    const payload = globalThis.chrome.runtime.sendMessage.mock.calls[1][0].jobData;
    expect(payload).toMatchObject({
      title: '资深后端开发工程师', // raw business content
      company: '某某科技有限公司', // raw business content
      location: '深圳·南山区', // raw business content
      experience_req: '5-10年',
      education_req: '本科',
      company_size: '1000-9999',
      company_stage: '已上市',
      salary_min: 35000,
      salary_max: 60000,
      source: 'BOSS直聘', // i18n-audit-ignore: 站点展示名（专有名词）
    });
    expect(payload.description).toContain('核心交易链路');
  });

  it('prefers what the DOM shows and only tops up the missing fields', async () => {
    document.body.innerHTML = `
      <div class="job-primary detail-box">
        <div class="info-primary"><div class="name"><h1>资深后端开发工程师</h1></div></div>
      </div>
      <div class="job-detail-section"><div class="job-sec-text">页面上的职位描述正文，用户看到的就是这一段。</div></div>
    `;

    api.initBossApiSniffer(config);
    await deliverBossApiResponse(api_.detailResponse);

    const data = api.mergeBossDetailData(
      api.extractDetailPageData(config),
      api.capturedBossApiJobs.get(api_.BOSS_PAGE_JOB_ID),
    );
    expect(data.title).toBe('资深后端开发工程师'); // raw business content
    expect(data.description).toContain('页面上的职位描述正文');
    expect(data.company_size).toBe('1000-9999');  // 接口补齐
    expect(data.company_stage).toBe('已上市');
  });

  it('ignores responses for postings other than the one on screen', async () => {
    document.body.innerHTML = '<div class="y9">加载中</div>';

    api.initBossApiSniffer(config);
    await deliverBossApiResponse(api_.relatedJobsResponse, 'https://www.zhipin.com/wapi/zpgeek/job/related.json');

    expect(api.capturedBossApiJobs.size).toBe(0);
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false });
    const saved = await api.captureDetailPage(config, { attempts: 1, intervalMs: 5 });
    expect(saved).toBe(false);
    expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('only listens on zhipin pages', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.linkedin.com', href: 'https://www.linkedin.com/jobs/', origin: 'https://www.linkedin.com', pathname: '/jobs/', search: '' },
      writable: true,
      configurable: true,
    });
    expect(api.initBossApiSniffer(config)).toBe(false);
  });

  it('ignores messages that are not tagged as job API responses', async () => {
    document.body.innerHTML = '<div class="y9">加载中</div>';
    api.initBossApiSniffer(config);
    window.postMessage({ someOtherMessage: true, payload: api_.detailResponse }, '*');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.capturedBossApiJobs.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 桥的装配（manifest）
// ═══════════════════════════════════════════════════════════════

describe('boss page bridge wiring', () => {
  it('is injected into the page world before any page script runs', () => {
    const manifest = JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf-8'));
    const bridge = manifest.content_scripts.find((entry) => entry.js.includes('boss-page-bridge.js'));

    expect(bridge).toBeDefined();
    expect(bridge.world).toBe('MAIN');
    expect(bridge.run_at).toBe('document_start');
    expect(bridge.matches).toContain('https://*.zhipin.com/*');
    // 桥必须是页面 world 的第一件事：晚于页面脚本就抓不到早期响应
    expect(bridge.js[0]).toBe('boss-page-bridge.js');
  });

  it('keeps the isolated-world content script as the first entry', () => {
    const manifest = JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf-8'));
    const contentScripts = manifest.content_scripts[0].js;
    expect(contentScripts[0]).toBe('i18n.js');
    expect(contentScripts[contentScripts.length - 1]).toBe('content.js');
  });
});
