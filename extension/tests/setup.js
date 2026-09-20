// Mock Chrome extension APIs
globalThis.chrome = {
  runtime: {
    // 真实扩展上下文一定带 id；内容脚本用它判断自己是否已因扩展重载而失联
    id: 'test-extension-id',
    sendMessage: vi.fn().mockResolvedValue({ ok: true, data: { mappings: [] } }),
    onMessage: {
      addListener: vi.fn(),
    },
  },
  storage: {
    local: {
      get: vi.fn().mockImplementation((query, callback) => {
        const result = { serverUrl: 'http://localhost:8085', dismissedHosts: [], language: 'en' };
        if (typeof callback === 'function') {
          callback(result);
          return undefined;
        }
        return Promise.resolve(result);
      }),
      set: vi.fn().mockImplementation((data, callback) => {
        if (typeof callback === 'function') {
          callback();
          return undefined;
        }
        return Promise.resolve(undefined);
      }),
    },
    onChanged: {
      addListener: vi.fn(),
    },
  },
};

// Mock CSS.escape (not available in jsdom)
if (!globalThis.CSS) {
  globalThis.CSS = {};
}
if (!CSS.escape) {
  CSS.escape = function (str) {
    return str.replace(/([^\w-])/g, '\\$1');
  };
}

// Enable test exports from content.js
window.__cpAutofillTest = true;
window.__cpAutofillLoaded = false;

// ─── i18n harness ───────────────────────────────────────────────
// Interface copy is exercised in English by default so existing DOM assertions
// keep checking the same strings. The i18n tests call `resetExtensionI18n()`
// to check the real Simplified Chinese default and switching behavior.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const extensionDir = join(import.meta.dirname, '..');
let i18nLoaded = false;

function evalFile(relativePath) {
  const code = readFileSync(join(extensionDir, relativePath), 'utf-8');
  eval(code); // eslint-disable-line no-eval
}

function loadCatalogs() {
  evalFile('i18n.js');
  evalFile('locales/common.js');
  const localeFiles = readdirSync(join(extensionDir, 'locales'))
    .filter((file) => file.endsWith('.js') && file !== 'common.js')
    .sort();
  for (const file of localeFiles) evalFile(join('locales', file));
  evalFile('error-messages.js');
}

/** Load the extension i18n module + catalogs, in the requested language. */
export function loadExtensionI18n(language = 'en') {
  globalThis.__CP_I18N_DEBUG__ = false;
  loadCatalogs();
  if (language) i18n.setLanguage(language, { force: true });
  i18nLoaded = true;
  return globalThis.i18n;
}

/** Re-load the catalogs and force a language (used by the i18n tests). */
export function resetExtensionI18n(language = 'zh-CN') {
  globalThis.__CP_I18N_DEBUG__ = false;
  loadCatalogs();
  i18n.setLanguage(language, { force: true });
  i18nLoaded = true;
  return globalThis.i18n;
}

export function ensureExtensionI18n() {
  if (!i18nLoaded) loadExtensionI18n('en');
  return globalThis.i18n;
}

// Every extension test gets the i18n module in English: the extension forces the
// interface language like the web tests do (see docs/i18n.md).
ensureExtensionI18n();

// ─── 定时器泄漏护栏 ─────────────────────────────────────────────
// content.js 会排一串定时器（防抖扫描 1.5s、角标 500ms、抓取结果停留 5s、采集轮询
// 3s…）。测试文件之间 jsdom 会被拆掉，队列里剩的定时器一旦触发就跑在没有 window 的
// 环境上，抛 `ReferenceError: window is not defined` —— vitest 把它记成 unhandled
// error，于是「测试全过」却退出码 1（实测约 1/4 概率，CI 因此红）。这里统一登记，
// 每个用例结束时清掉；测试自己 await 的 setTimeout 不受影响（清已触发的 id 是空操作）。
import { afterEach } from 'vitest';

const pendingTimers = new Set();
for (const name of ['setTimeout', 'setInterval']) {
  const real = globalThis[name];
  globalThis[name] = (...args) => {
    const id = real(...args);
    pendingTimers.add(id);
    return id;
  };
}

afterEach(() => {
  for (const id of pendingTimers) {
    clearTimeout(id);
    clearInterval(id);
  }
  pendingTimers.clear();
});
