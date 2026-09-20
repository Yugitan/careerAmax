import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as fixtures from './fixtures/boss-api.js';

// boss-page-bridge.js 是注入到页面 world 的采集桥：只被动转发页面自己发出的
// 职位接口响应，不额外发任何请求。这里用假的 fetch/XHR 验证转发、缓冲与重投。
//
// 桥的对外出口是 window.postMessage（页面 world 里唯一的跨 world 通道），
// 测试把它换成同步记录器：jsdom 的 postMessage 投递时机不确定，同步记录才稳定。

const bridgeCode = readFileSync(join(import.meta.dirname, '..', 'boss-page-bridge.js'), 'utf-8');

const DETAIL_URL = `https://www.zhipin.com/wapi/zpgeek/job/detail.json?encryptJobId=${fixtures.BOSS_PAGE_JOB_ID}`;

let posted;
let originalFetch;
let bridgeMessageListeners = [];

function fakeJsonResponse(payload, url) {
  const text = JSON.stringify(payload);
  return {
    url,
    headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null) },
    clone() { return { text: async () => text }; },
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 在一个干净环境里加载采集桥；postMessage 换成同步记录器。 */
function loadBridge({ fetchImpl } = {}) {
  delete window.__cpBossApiBridgeInstalled;
  window.fetch = fetchImpl || (async () => fakeJsonResponse({}, 'https://www.zhipin.com/other'));
  window.postMessage = (data) => {
    if (data && data.__cpBossApi === true) posted.push(data);
  };

  // 每个测试都会重新 eval 一次桥，而 jsdom 的 window 是共享的：记账后逐个摘掉，
  // 否则前几个测试装的桥也会响应重投请求，断言数字就串了。
  const realAdd = window.addEventListener.bind(window);
  window.addEventListener = (type, handler, options) => {
    if (type === 'message') bridgeMessageListeners.push(handler);
    return realAdd(type, handler, options);
  };
  eval(bridgeCode);
  window.addEventListener = realAdd;
}

beforeEach(() => {
  posted = [];
  originalFetch = window.fetch;
});

afterEach(() => {
  for (const handler of bridgeMessageListeners) window.removeEventListener('message', handler);
  bridgeMessageListeners = [];
  window.fetch = originalFetch;
  delete window.__cpBossApiBridgeInstalled;
});

describe('boss page bridge — fetch', () => {
  it('forwards JSON responses from the platform API to the content script', async () => {
    loadBridge({ fetchImpl: async () => fakeJsonResponse(fixtures.detailResponse, DETAIL_URL) });

    const response = await window.fetch(DETAIL_URL);
    expect(response.url).toBe(DETAIL_URL);  // 原返回值原样透传，页面逻辑不能被打断
    await flush();

    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe(DETAIL_URL);
    expect(posted[0].payload).toEqual(fixtures.detailResponse);
  });

  it('ignores responses that are not platform job API calls', async () => {
    loadBridge({ fetchImpl: async (url) => fakeJsonResponse({ ok: true }, url) });

    await window.fetch('https://www.zhipin.com/job_detail/abc.html');
    await window.fetch('https://hm.baidu.com/collect');
    await flush();

    expect(posted).toHaveLength(0);
  });

  it('ignores JSON payloads that are not job data', async () => {
    // /wapi/ 前缀下还有聊天、简历等接口，不能顺手把用户数据也递给扩展
    loadBridge({
      fetchImpl: async () => fakeJsonResponse(
        { code: 0, zpData: { messages: [{ from: 'hr', text: '你好' }] } },
        'https://www.zhipin.com/wapi/zpchat/message/list.json'
      ),
    });

    await window.fetch('https://www.zhipin.com/wapi/zpchat/message/list.json');
    await flush();

    expect(posted).toHaveLength(0);
  });

  it('ignores non-JSON responses', async () => {
    loadBridge({
      fetchImpl: async () => ({
        url: DETAIL_URL,
        headers: { get: () => 'text/html' },
        clone() { return { text: async () => '<html></html>' }; },
      }),
    });

    await window.fetch(DETAIL_URL);
    await flush();

    expect(posted).toHaveLength(0);
  });

  it('does not expose the wrapper through toString', () => {
    const nativeFetch = async () => {};
    const nativeSource = 'function fetch() { [native code] }';
    nativeFetch.toString = () => nativeSource;
    window.fetch = nativeFetch;

    delete window.__cpBossApiBridgeInstalled;
    window.postMessage = () => {};
    eval(bridgeCode);

    expect(window.fetch).not.toBe(nativeFetch);      // 确实被包裹了
    expect(String(window.fetch)).toBe(nativeSource);  // 但页面的自检看到的还是原生实现
  });

  it('does not install itself twice', () => {
    loadBridge();
    const bridged = window.fetch;
    eval(bridgeCode);
    expect(window.fetch).toBe(bridged);
  });
});

describe('boss page bridge — XMLHttpRequest', () => {
  class FakeXhr {
    constructor() {
      this.listeners = {};
      this.responseType = '';
      this.response = null;
      this.responseText = '';
    }
    open() {}
    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    }
    getResponseHeader() { return 'application/json'; }
    send() {
      this.responseType = 'json';
      this.response = fixtures.detailResponse;
      for (const handler of this.listeners.loadend || []) handler();
    }
  }

  it('forwards JSON XHR responses', async () => {
    window.XMLHttpRequest = FakeXhr;
    loadBridge();
    const xhr = new window.XMLHttpRequest();
    xhr.open('GET', DETAIL_URL, true);
    xhr.send();
    await flush();

    expect(posted).toHaveLength(1);
    expect(posted[0].payload).toEqual(fixtures.detailResponse);
  });

  it('ignores XHR calls outside the platform API', async () => {
    window.XMLHttpRequest = FakeXhr;
    loadBridge();
    const xhr = new window.XMLHttpRequest();
    xhr.open('GET', 'https://www.zhipin.com/job_detail/abc.html', true);
    xhr.send();
    await flush();

    expect(posted).toHaveLength(0);
  });
});

describe('boss page bridge — replay handshake', () => {
  it('re-delivers buffered responses when the content script asks', async () => {
    loadBridge({ fetchImpl: async () => fakeJsonResponse(fixtures.detailResponse, DETAIL_URL) });
    await window.fetch(DETAIL_URL);
    await flush();
    expect(posted).toHaveLength(1);

    // 内容脚本到 document_idle 才装监听，用重投把它错过的早期响应补上
    window.dispatchEvent(new MessageEvent('message', {
      data: { __cpBossApiRequest: true },
      origin: window.location.origin,
      source: window,
    }));

    expect(posted).toHaveLength(2);
    expect(posted[1].payload).toEqual(fixtures.detailResponse);
  });

  it('ignores replay requests that do not come from this window', async () => {
    loadBridge({ fetchImpl: async () => fakeJsonResponse(fixtures.detailResponse, DETAIL_URL) });
    await window.fetch(DETAIL_URL);
    await flush();

    window.dispatchEvent(new MessageEvent('message', {
      data: { __cpBossApiRequest: true },
      origin: window.location.origin,
      source: null,
    }));

    expect(posted).toHaveLength(1);
  });

  it('keeps only a bounded buffer', async () => {
    loadBridge({
      fetchImpl: async (url) => fakeJsonResponse({
        code: 0,
        zpData: { jobInfo: { jobName: url, salaryDesc: '10-20K', jobDescription: '岗位职责' } },
      }, url),
    });
    for (let i = 0; i < 8; i += 1) {
      await window.fetch(`https://www.zhipin.com/wapi/zpgeek/job/card.json?id=${i}`);
    }
    await flush();
    expect(posted).toHaveLength(8);

    posted = [];
    window.dispatchEvent(new MessageEvent('message', {
      data: { __cpBossApiRequest: true },
      origin: window.location.origin,
      source: window,
    }));

    expect(posted).toHaveLength(5);  // BUFFER_LIMIT
  });
});

describe('boss page bridge — resilience', () => {
  it('never breaks the page when a response cannot be read', async () => {
    loadBridge({
      fetchImpl: async () => ({
        url: DETAIL_URL,
        headers: { get: () => 'application/json' },
        clone() { return { text: async () => { throw new Error('stream closed'); } }; },
      }),
    });

    await expect(window.fetch(DETAIL_URL)).resolves.toBeTruthy();
    await flush();
    expect(posted).toHaveLength(0);
  });

  it('survives a rejected request', async () => {
    loadBridge({ fetchImpl: async () => { throw new Error('network down'); } });

    await expect(window.fetch(DETAIL_URL)).rejects.toThrow('network down');
    await flush();
    expect(posted).toHaveLength(0);
  });

  it('ignores a malformed JSON body', async () => {
    loadBridge({
      fetchImpl: async () => ({
        url: DETAIL_URL,
        headers: { get: () => 'application/json' },
        clone() { return { text: async () => 'not json at all' }; },
      }),
    });

    await window.fetch(DETAIL_URL);
    await flush();
    expect(posted).toHaveLength(0);
  });
});
