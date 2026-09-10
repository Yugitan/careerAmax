import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resetExtensionI18n, loadExtensionI18n, ensureExtensionI18n } from './setup.js';

// Minimal content-script loader (mirrors the one used by content.test.js).
function loadContentScript() {
    window.__cpAutofillLoaded = false;
    window.__cpAutofillTest = true;
    window.__cpAutofillTestAPI = undefined;
    window.__cpNormalize = undefined;
    window.__cpAtsAdapters = undefined;
    ensureExtensionI18n();
    const dir = join(import.meta.dirname, '..');
    eval(readFileSync(join(dir, 'normalize.js'), 'utf-8'));
    eval(readFileSync(join(dir, 'ats-adapters.js'), 'utf-8'));
    let code = readFileSync(join(dir, 'content.js'), 'utf-8');
    code = code.replace(/chrome\.runtime\.onMessage\.addListener/g, 'globalThis.chrome.runtime.onMessage.addListener');
    code = code.replace(/badgeObserver\.observe\(document\.documentElement,\s*\{[\s\S]*?\}\);/g, '/* disabled in tests */');
    eval(code);
    return window.__cpAutofillTestAPI;
}

// The extension has its own language setting in chrome.storage.local, defaulting
// to Simplified Chinese and never following the browser language.
describe('extension i18n', () => {
    beforeEach(() => {
        resetExtensionI18n('en');
    });

    describe('defaults and storage', () => {
        it('defaults to Simplified Chinese when nothing is stored', async () => {
            resetExtensionI18n('en');
            globalThis.chrome.storage.local.get = vi.fn((query, callback) => {
                callback({}); // nothing stored yet
                return undefined;
            });
            const lang = await i18n.init();
            expect(i18n.DEFAULT_LANGUAGE).toBe('zh-CN');
            expect(lang).toBe('zh-CN');
            expect(t('popup.fillApplication')).toBe('填写申请表');
        });

        it('reads a stored language', async () => {
            globalThis.chrome.storage.local.get = vi.fn((query, callback) => {
                callback({ language: 'en' });
                return undefined;
            });
            await i18n.init();
            expect(i18n.getLanguage()).toBe('en');
            expect(t('popup.fillApplication')).toBe('Fill Application');
        });

        it('ignores an unsupported stored language', async () => {
            globalThis.chrome.storage.local.get = vi.fn((query, callback) => {
                callback({ language: 'ja-JP' });
                return undefined;
            });
            await i18n.init();
            expect(i18n.getLanguage()).toBe('zh-CN');
        });

        it('persists a switch to chrome.storage.local (not localStorage)', () => {
            resetExtensionI18n('en');
            globalThis.chrome.storage.local.set = vi.fn();
            i18n.setLanguage('zh-CN');
            expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith({ language: 'zh-CN' });
            expect(globalThis.localStorage && globalThis.localStorage.getItem('careerpulse_lang')).toBeFalsy();
        });

        it('keeps the web and extension storage keys separate', () => {
            expect(i18n.STORAGE_KEY).toBe('language');
            expect(i18n.STORAGE_KEY).not.toBe('careerpulse_lang');
        });

        it('follows a language change made by another extension context', () => {
            resetExtensionI18n('en');
            const listeners = [];
            globalThis.chrome.storage.onChanged = { addListener: (fn) => listeners.push(fn) };
            i18n.watchStorage();
            const onLanguage = vi.fn();
            i18n.onChange(onLanguage);
            listeners.forEach((fn) => fn({ language: { newValue: 'zh-CN' } }, 'local'));
            expect(i18n.getLanguage()).toBe('zh-CN');
            expect(onLanguage).toHaveBeenCalledWith('zh-CN');
        });
    });

    describe('translations', () => {
        it('translates popup, overlay, queue and upload copy in both languages', () => {
            const keys = [
                'popup.connected', 'popup.fillApplication', 'popup.invalidUrl',
                'overlay.initializing', 'overlay.noFieldsTracked', 'overlay.badgeFill',
                'overlay.learnSave', 'overlay.pageDetected',
                'queue.done', 'queue.skip', 'queue.cancel', 'queue.doneTitle',
                'upload.download', 'upload.downloadFailed', 'upload.noJobId',
            ];
            resetExtensionI18n('en');
            keys.forEach((key) => expect(i18n.has(key), key).toBe(true));
            const english = keys.map((key) => t(key));
            resetExtensionI18n('zh-CN');
            const chinese = keys.map((key) => t(key));
            expect(chinese.every((value) => value && value !== '')).toBe(true);
            expect(chinese).not.toEqual(english);
            // Every one of these keys must actually be translated into Chinese
            // (brand names like CareerPulse may appear inside the text).
            const untranslated = chinese.filter((value) => !/[\u4e00-\u9fff]/.test(value));
            expect(untranslated).toEqual([]);
        });

        it('interpolates parameters', () => {
            resetExtensionI18n('en');
            expect(t('overlay.fillingFields', { done: 2, total: 5 })).toBe('Filling 2/5 fields...');
            resetExtensionI18n('zh-CN');
            expect(t('overlay.fillingFields', { done: 2, total: 5 })).toBe('正在填写 2/5 个字段…');
        });

        it('uses singular/plural forms from the English catalog', () => {
            resetExtensionI18n('en');
            expect(t('overlay.learnTitle', { count: 1 })).toBe('Save 1 new answer to CareerPulse?');
            expect(t('overlay.learnTitle', { count: 3 })).toBe('Save 3 new answers to CareerPulse?');
        });

        it('falls back to English and records the fallback', () => {
            resetExtensionI18n('zh-CN');
            i18n.register('testFallbackExt', { en: { only: 'English only' }, 'zh-CN': {} });
            i18n.resetMissingKeys();
            expect(t('testFallbackExt.only')).toBe('English only');
            expect(i18n.getFallbackKeys()).toContain('testFallbackExt.only');
        });

        it('returns the key and records a miss for unknown keys', () => {
            resetExtensionI18n('en');
            i18n.resetMissingKeys();
            expect(t('nope.missing.key')).toBe('nope.missing.key');
            expect(i18n.getMissingKeys()).toContain('nope.missing.key');
        });

        it('warns about missing keys in development mode', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            resetExtensionI18n('en');
            globalThis.__CP_I18N_DEBUG__ = true;
            i18n.resetMissingKeys();
            t('another.missing.key');
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
            globalThis.__CP_I18N_DEBUG__ = false;
        });

        it('defines the same key set for both languages', () => {
            const en = i18n.keys('en');
            const zh = i18n.keys('zh-CN');
            expect(en.filter((key) => !zh.includes(key))).toEqual([]);
            expect(zh.filter((key) => !en.includes(key))).toEqual([]);
        });
    });

    describe('date and number formatting', () => {
        it('formats dates per language', () => {
            const date = new Date(2026, 2, 5, 14, 30);
            resetExtensionI18n('en');
            expect(i18n.formatMonthYear(date)).toBe('March 2026');
            resetExtensionI18n('zh-CN');
            expect(i18n.formatMonthYear(date)).toBe('2026年3月');
        });

        it('localizes relative time through the shared catalog', () => {
            const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
            resetExtensionI18n('zh-CN');
            expect(i18n.formatRelativeTime(threeDaysAgo)).toBe('3 天前');
            resetExtensionI18n('en');
            expect(i18n.formatRelativeTime(threeDaysAgo)).toBe('3d ago');
        });
    });
});

describe('extension error localization', () => {
    beforeEach(() => resetExtensionI18n('zh-CN'));

    it('maps backend error codes to localized messages', () => {
        expect(extErrorMessage({ code: 'resume.not_found', detail: 'Resume not found' })).toBe('简历不存在');
        expect(extErrorMessage({ code: 'ai.not_configured' })).toBe('尚未配置 AI 服务。请前往「设置 → AI 与集成」完成配置。');
        expect(extErrorMessage({ code: 'queue.no_active' })).toBe('当前没有进行中的队列');
    });

    it('interpolates params from the backend', () => {
        expect(extErrorMessage({ code: 'autofill.analysis_timeout', params: { seconds: 60 } }))
            .toBe('AI 分析超时（60 秒）');
    });

    it('keeps unknown third-party text behind a localized prefix', () => {
        const message = extErrorMessage({ code: 'third.party_failure', detail: 'upstream 502' });
        expect(message).toContain('upstream 502');
        expect(message.startsWith('错误：')).toBe(true);
    });

    it('keeps raw text when there is no code at all', () => {
        expect(extErrorMessage({ error: 'ECONNREFUSED' })).toBe('ECONNREFUSED');
    });

    it('localizes transport failures', () => {
        expect(extErrorMessage(new Error('Failed to fetch'))).toBe('网络请求失败，请检查网络连接。');
    });

    it('falls back to a generic message for empty payloads', () => {
        expect(extErrorMessage(null)).toBe('未知错误');
    });
});

describe('extension language switching re-render hook', () => {
    it('notifies listeners once per change so the overlay can re-render', () => {
        resetExtensionI18n('en');
        const listener = vi.fn();
        const off = i18n.onChange(listener);
        i18n.setLanguage('zh-CN');
        i18n.setLanguage('zh-CN');
        expect(listener).toHaveBeenCalledTimes(1);
        off();
        i18n.setLanguage('en');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('applies static markup bindings used by popup.html', () => {
        resetExtensionI18n('en');
        document.body.innerHTML = '<button id="fill" data-i18n="popup.fillApplication"></button>';
        i18n.applyStatic(document);
        expect(document.getElementById('fill').textContent).toBe('Fill Application');
        i18n.setLanguage('zh-CN');
        i18n.applyStatic(document);
        expect(document.getElementById('fill').textContent).toBe('填写申请表');
    });

    it('reloads with English after the tests force another language', () => {
        const loaded = loadExtensionI18n('en');
        expect(loaded.getLanguage()).toBe('en');
    });
});

describe('autofill overlay language toggle', () => {
    let api;

    beforeEach(() => {
        resetExtensionI18n('en');
        chrome.storage.local.set = vi.fn();
        document.body.innerHTML = '';
        api = loadContentScript();
        // content.js calls i18n.init() asynchronously; pin the language for the
        // synchronous assertions below.
        i18n.setLanguage('en', { force: true });
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('renders a language toggle in the overlay header', () => {
        api.updateOverlay('status', 'Filling 1/2 fields...');
        const overlay = document.getElementById('cp-autofill-overlay');
        expect(overlay).toBeTruthy();
        const toggle = overlay.querySelector('.cp-autofill-overlay-lang');
        expect(toggle).toBeTruthy();
        // While the interface is English the toggle offers Chinese.
        expect(toggle.textContent).toBe('中文');
        expect(toggle.title).toBe('Interface language');
    });

    it('switches the overlay language and persists it to chrome.storage.local', () => {
        api.updateOverlay('status', 'Filling 1/2 fields...');
        const overlay = document.getElementById('cp-autofill-overlay');
        overlay.querySelector('.cp-autofill-overlay-lang').click();
        expect(i18n.getLanguage()).toBe('zh-CN');
        expect(chrome.storage.local.set).toHaveBeenCalledWith({ language: 'zh-CN' });
        // The toggle now offers the other language.
        expect(overlay.querySelector('.cp-autofill-overlay-lang').textContent).toBe('EN');
    });

    it('re-renders the overlay chrome in the chosen language', () => {
        api.updateOverlay('status', 'Filling 1/2 fields...');
        i18n.setLanguage('zh-CN', { force: true });
        const overlay = document.getElementById('cp-autofill-overlay');
        overlay.querySelector('.cp-autofill-overlay-lang').click(); // zh -> en, triggers refresh
        expect(overlay.querySelector('.cp-autofill-overlay-title').textContent).toBe('CareerPulse');
        i18n.setLanguage('zh-CN', { force: true });
        overlay.querySelector('.cp-autofill-overlay-lang').click();
        expect(overlay.querySelector('.cp-autofill-overlay-lang').title).toBe('Interface language');
    });
});
