import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanDOM } from './helpers.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// 卡片「保存到 CareerPulse」的失败路径：「出错了 — 重试」必须带上真实原因，
// 而且不能把「扩展已重载导致内容脚本失联」误报成可重试的错误。

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

function createBossCard({ title = '资深后端开发工程师', company = '某某科技有限公司' } = {}) {
  const li = document.createElement('li');
  li.className = 'job-card-wrapper';
  li.innerHTML = `
    <div class="job-card-body">
      <h3 class="job-name"><a href="/job_detail/abc123def.html?lid=x">${title}</a></h3>
      <span class="job-area">深圳·南山区</span>
      <span class="salary">35-60K·15薪</span>
    </div>
    <div class="job-card-footer">
      <div class="company-info"><h3 class="company-name"><a href="/gongsi/abc.html">${company}</a></h3></div>
    </div>
    <a class="job-card-left" href="/job_detail/abc123def.html?lid=x"></a>
  `;
  document.body.appendChild(li);
  return li;
}

const jobData = {
  title: '资深后端开发工程师',
  company: '某某科技有限公司',
  url: 'https://www.zhipin.com/job_detail/abc123def.html',
  source: 'BOSS直聘', // i18n-audit-ignore: 站点展示名（专有名词）
};

let api;
let card;

beforeEach(() => {
  cleanDOM();
  globalThis.chrome.runtime.id = 'test-extension-id';
  globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
    ok: true,
    data: { job_id: 1 },
  });
  api = loadScript();
  card = createBossCard();
});

afterEach(() => {
  cleanDOM();
  globalThis.chrome.runtime.id = 'test-extension-id';
});

function toastText() {
  return document.getElementById('cp-autofill-toast')?.textContent || '';
}

describe('card save — failure feedback', () => {
  it('tells the user why the backend rejected the capture', async () => {
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: false,
      code: 'job.title_and_company_required',
      params: {},
      detail: 'title and company are required',
      error: 'title and company are required',
    });

    const btn = api.createSaveButton(jobData, card);
    btn.click();
    await new Promise((r) => setTimeout(r, 10));

    // 后端错误码已经翻成可读原因，不再是空泛的「出错了」
    expect(toastText()).toContain('Job title and company are required');
    expect(btn.title).toContain('Job title and company are required');
    expect(btn.textContent).toContain('Error');
    expect(btn.disabled).toBe(false);  // 修好字段后仍可重试
  });

  it('keeps the raw message when the backend code has no translation', async () => {
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: false,
      error: 'API 500: Server Error',
    });

    const btn = api.createSaveButton(jobData, card);
    btn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(toastText()).toContain('API 500: Server Error');
    expect(btn.disabled).toBe(false);
  });

  it('asks for a page refresh when the content script lost its extension context', async () => {
    // 扩展被重新加载后，旧页面里的内容脚本发不出任何消息
    globalThis.chrome.runtime.id = undefined;
    globalThis.chrome.runtime.sendMessage = vi.fn();

    const btn = api.createSaveButton(jobData, card);
    btn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(toastText()).toContain('refresh this page');
    expect(btn.disabled).toBe(false);
  });

  it('recognizes an invalidated context reported by sendMessage', async () => {
    globalThis.chrome.runtime.sendMessage = vi.fn()
      .mockRejectedValue(new Error('Extension context invalidated.'));

    const btn = api.createSaveButton(jobData, card);
    btn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(toastText()).toContain('refresh this page');
  });
});

describe('card save — payload', () => {
  it('saves what the card shows', async () => {
    const btn = api.createSaveButton(jobData, card);
    btn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'saveJob',
      jobData,
    });
    expect(btn.textContent).toBe('Saved');
    expect(btn.disabled).toBe(true);
  });
});

describe('listing scan — lazy rendered cards', () => {
  it('waits for the title and picks the card up on the next scan', async () => {
    cleanDOM();
    const skeleton = createBossCard({ title: '' });
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];

    await api.processJobCards(config);
    // 骨架阶段不建按钮：这时提交的 payload 会被后端以「必填项」拒掉
    expect(skeleton.querySelector('.cp-overlay-save-btn')).toBeNull();

    skeleton.querySelector('.job-name').innerHTML = '<a href="/job_detail/abc123def.html?lid=x">资深后端开发工程师</a>';
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { found: false },
    });
    await api.processJobCards(config);

    const btn = skeleton.querySelector('.cp-overlay-save-btn');
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
  });

  it('replaces the button when a recycled node now shows another job', async () => {
    const config = api.JOB_BOARD_CONFIGS['zhipin.com'];
    globalThis.chrome.runtime.sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { found: true, job_id: 7, score: 90 } })
      .mockResolvedValue({ ok: true, data: { found: false } });

    await api.processJobCards(config);
    expect(card.querySelector('.cp-overlay-score-badge')).not.toBeNull();

    card.querySelector('.job-name a').textContent = '数据分析师';
    await api.processJobCards(config);

    expect(card.querySelector('.cp-overlay-score-badge')).toBeNull();
    expect(card.querySelector('.cp-overlay-save-btn').disabled).toBe(false);
  });

  it('reads the company from the /gongsi/ link when the class names changed', async () => {
    cleanDOM();
    const renamed = document.createElement('li');
    renamed.className = 'job-card-wrapper';
    renamed.innerHTML = `
      <h3 class="job-name"><a href="/job_detail/zzz999.html">资深后端开发工程师</a></h3>
      <span class="job-area">深圳·南山区</span>
      <a class="brand-new-class" href="/gongsi/abc.html">某某科技有限公司</a>
      <a class="job-card-left" href="/job_detail/zzz999.html"></a>
    `;
    document.body.appendChild(renamed);

    const job = api.parseJobCard(renamed, api.JOB_BOARD_CONFIGS['zhipin.com']);
    expect(job.company).toBe('某某科技有限公司'); // raw business content
  });
});
