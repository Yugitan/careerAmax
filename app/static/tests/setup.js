import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import vm from 'vm';

const jsDir = join(import.meta.dirname, '..', 'js');
const localesDir = join(jsDir, 'locales');

// Node exposes an experimental `localStorage` global that is undefined without
// `--localstorage-file`, and it shadows jsdom's implementation. Install an
// in-memory replacement so language persistence behaves like a browser.
function installLocalStoragePolyfill() {
    if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) return;
    const store = new Map();
    const memoryStorage = {
        getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
        setItem: (key, value) => { store.set(String(key), String(value)); },
        removeItem: (key) => { store.delete(String(key)); },
        clear: () => { store.clear(); },
        key: (index) => Array.from(store.keys())[index] ?? null,
        get length() { return store.size; },
    };
    try {
        Object.defineProperty(globalThis, 'localStorage', {
            value: memoryStorage, configurable: true, writable: true,
        });
    } catch { /* fall back to per-test stubs */ }
}

installLocalStoragePolyfill();

function runCode(code, filename) {
    vm.runInThisContext(code, { filename });
}

let _i18nLoaded = false;
let _loadedLanguage = 'en';

function loadCatalogs() {
    runCode(readFileSync(join(jsDir, 'i18n.js'), 'utf-8'), 'i18n.js');
    const files = readdirSync(localesDir).filter((f) => f.endsWith('.js')).sort();
    for (const file of files) {
        runCode(readFileSync(join(localesDir, file), 'utf-8'), `locales/${file}`);
    }
}

/**
 * Interface copy is exercised in English by default so existing DOM assertions
 * keep checking the same strings. i18n tests call `resetI18n('zh-CN')` (or
 * `resetI18n()` for the real default) to check the actual behavior.
 */
export function ensureI18n(lang = 'en') {
    if (_i18nLoaded) return globalThis.i18n;
    globalThis.__CP_I18N_DEBUG__ = false;
    if (lang) globalThis.localStorage.setItem('careerpulse_lang', lang);
    loadCatalogs();
    _i18nLoaded = true;
    _loadedLanguage = globalThis.i18n.getLanguage();
    return globalThis.i18n;
}

/** Re-load the i18n module and every catalog with a specific language. */
export function resetI18n(lang) {
    globalThis.__CP_I18N_DEBUG__ = false;
    if (lang) globalThis.localStorage.setItem('careerpulse_lang', lang);
    else globalThis.localStorage.removeItem('careerpulse_lang');
    loadCatalogs();
    _i18nLoaded = true;
    _loadedLanguage = globalThis.i18n.getLanguage();
    return globalThis.i18n;
}

export function currentTestLanguage() {
    return _loadedLanguage;
}

/**
 * Load a browser script file into the current global scope.
 * Uses vm.runInThisContext so declarations are globally visible, matching browser behavior.
 */
export function loadScript(filename) {
    ensureI18n();
    const code = readFileSync(join(jsDir, filename), 'utf-8');
    runCode(code, filename);
}

/**
 * Load multiple scripts in order (simulating <script> tag loading).
 */
export function loadScripts(...filenames) {
    for (const f of filenames) {
        loadScript(f);
    }
}
