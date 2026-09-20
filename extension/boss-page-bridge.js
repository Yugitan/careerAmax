// CareerPulse — BOSS 直聘页面上下文采集桥（MAIN world，document_start）
//
// 为什么要有这个文件：DOM 解析在站点改版时会整体失效（class 名一换就全线断掉）。
// 这里注入到**页面自己的 world**，只做一件事：把页面自己已经发出的、指向 BOSS
// 职位接口的响应被动地转发给内容脚本（隔离世界），由 content.js 归一化后回传。
//
// 采集纪律（PRD 5.2，写进代码而不只是文档）：
// 1. 不主动发任何请求 —— 只读页面自己已经拿到、用户已经看到的响应，零额外流量；
// 2. 不伪造签名、不缓存 token、不重放 HTTP 请求（缓冲+重投的是"已经收到的响应"，
//    不是重新请求）；
// 3. 只转发 JSON 响应，且 URL 命中 BOSS 自己的接口前缀；
// 4. 只读：从不触碰页面的写操作接口；
// 5. 任何异常都吞掉 —— 采集桥绝不能影响用户正常浏览。
//
// MAIN world 里没有 chrome.* API，只能通过 window.postMessage 与隔离世界通信。
// 隔离世界收到消息后会校验「载荷里的职位 id 必须和当前页面 URL 上的 id 一致」，
// 所以页面上的第三方脚本无法凭空往本地库里塞职位。

(function installBossApiBridge() {
  if (window.__cpBossApiBridgeInstalled) return;
  window.__cpBossApiBridgeInstalled = true;

  const MESSAGE_TAG = '__cpBossApi';
  const REQUEST_TAG = '__cpBossApiRequest';
  const URL_HINTS = ['/wapi/', '/zpgeek/', '/api/'];
  // 同一前缀下还有聊天、简历、账号之类的接口，与职位无关的载荷一律不放行，
  // 既不进缓冲也不跨界传给扩展。
  const JOB_KEY_HINTS = ['jobName', 'jobTitle', 'salaryDesc', 'jobDescription', 'jobDesc', 'encryptJobId'];
  const JOB_HINT_THRESHOLD = 2;
  const BUFFER_LIMIT = 5;
  const BODY_LIMIT = 400000;

  // 页面加载早期的响应（详情 JSON 通常早于 document_idle）先缓冲起来，
  // 等隔离世界发来 REQUEST_TAG 时再重投一次，否则这批数据永远丢掉。
  const buffer = [];

  function isCandidateUrl(url) {
    return typeof url === 'string' && URL_HINTS.some((hint) => url.includes(hint));
  }

  function looksLikeJobData(node, depth) {
    if (!node || typeof node !== 'object' || depth > 4) return false;
    if (Array.isArray(node)) return node.some((item) => looksLikeJobData(item, depth + 1));
    let hints = 0;
    for (const key of JOB_KEY_HINTS) {
      if (key in node) hints += 1;
    }
    if (hints >= JOB_HINT_THRESHOLD) return true;
    return Object.values(node).some((value) => looksLikeJobData(value, depth + 1));
  }

  function publish(url, payload, contentType) {
    if (!isCandidateUrl(url)) return;
    if (!payload || typeof payload !== 'object') return;
    if (contentType && !/json/i.test(contentType)) return;
    if (!looksLikeJobData(payload, 0)) return;
    buffer.push({ url, payload });
    if (buffer.length > BUFFER_LIMIT) buffer.shift();
    try {
      window.postMessage({ [MESSAGE_TAG]: true, url, payload }, window.location.origin);
    } catch { /* 同窗口投递失败无所谓，采集不该影响页面 */ }
  }

  function publishBody(text, url, contentType) {
    if (typeof text !== 'string' || !text || text.length > BODY_LIMIT) return;
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return;
    }
    publish(url, payload, contentType);
  }

  function installFetchBridge() {
    const nativeFetch = window.fetch;
    if (typeof nativeFetch !== 'function') return;
    const bridgedFetch = function (...args) {
      const result = nativeFetch.apply(this, args);
      try {
        result.then((response) => {
          try {
            const url = (response && response.url) || (args[0] && args[0].url) || String(args[0] || '');
            if (!isCandidateUrl(url)) return;
            const contentType = response && response.headers && response.headers.get
              ? response.headers.get('content-type') || ''
              : '';
            if (contentType && !/json/i.test(contentType)) return;
            response.clone().text()
              .then((text) => publishBody(text, url, contentType))
              .catch(() => {});
          } catch { /* 忽略 */ }
        }).catch(() => {});
      } catch { /* 忽略 */ }
      return result;
    };
    try {
      // 保持 toString 与原生一致，降低被页面自检（反调试/反注入）发现的概率
      bridgedFetch.toString = nativeFetch.toString.bind(nativeFetch);
      window.fetch = bridgedFetch;
    } catch { /* 页面可能把 fetch 设为只读，放弃劫持 */ }
  }

  function installXhrBridge() {
    const XHR = window.XMLHttpRequest;
    if (!XHR || !XHR.prototype) return;
    const nativeOpen = XHR.prototype.open;
    const nativeSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url, ...rest) {
      try {
        this.__cpBossApiUrl = typeof url === 'string' ? url : String(url || '');
      } catch { /* 忽略 */ }
      return nativeOpen.call(this, method, url, ...rest);
    };

    XHR.prototype.send = function (...args) {
      try {
        this.addEventListener('loadend', () => {
          try {
            const url = this.__cpBossApiUrl || this.responseURL || '';
            if (!isCandidateUrl(url)) return;
            const contentType = this.getResponseHeader
              ? this.getResponseHeader('content-type') || ''
              : '';
            if (this.responseType === 'json') {
              publish(url, this.response, contentType || 'application/json');
              return;
            }
            if (this.responseType && this.responseType !== 'text') return;
            publishBody(this.responseText, url, contentType);
          } catch { /* responseType 不匹配等情况一律忽略 */ }
        });
      } catch { /* 忽略 */ }
      return nativeSend.apply(this, args);
    };

    try {
      XHR.prototype.open.toString = nativeOpen.toString.bind(nativeOpen);
      XHR.prototype.send.toString = nativeSend.toString.bind(nativeSend);
    } catch { /* 忽略 */ }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data[REQUEST_TAG] !== true) return;
    for (const entry of buffer) {
      try {
        window.postMessage({ [MESSAGE_TAG]: true, url: entry.url, payload: entry.payload }, window.location.origin);
      } catch { /* 忽略 */ }
    }
  });

  installFetchBridge();
  installXhrBridge();
})();
