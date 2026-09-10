import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resetI18n, ensureI18n, loadScript } from './setup.js';

// Backend error codes are the contract the frontend must translate.
const errorsPyPath = join(import.meta.dirname, '..', '..', '..', 'app', 'errors.py');
const BACKEND_ERROR_CODES = [...readFileSync(errorsPyPath, 'utf-8')
    .matchAll(/^\s{4}"([a-z0-9_.]+)":\s*"/gm)].map((match) => match[1]);

// utils.js is loaded once per file (its top-level `const`s cannot be re-declared).
loadScript('utils.js');

// These tests exercise the i18n module itself, so they reload it explicitly
// (setup.js loads it once per file with English for the other suites).
describe('i18n core', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe('default language', () => {
        it('defaults to Simplified Chinese when nothing is stored', () => {
            const i18n = resetI18n();
            expect(i18n.DEFAULT_LANGUAGE).toBe('zh-CN');
            expect(i18n.getLanguage()).toBe('zh-CN');
            expect(t('nav.jobs')).toBe('职位');
        });

        it('does not follow the browser language', () => {
            Object.defineProperty(window.navigator, 'language', { value: 'fr-FR', configurable: true });
            const i18n = resetI18n();
            expect(i18n.getLanguage()).toBe('zh-CN');
        });

        it('honours a stored language', () => {
            const i18n = resetI18n('en');
            expect(i18n.getLanguage()).toBe('en');
            expect(t('nav.jobs')).toBe('Jobs');
        });

        it('ignores an unsupported stored language and falls back to the default', () => {
            globalThis.localStorage.setItem('careerpulse_lang', 'de-DE');
            const i18n = resetI18n();
            expect(i18n.getLanguage()).toBe('zh-CN');
            resetI18n('en');
        });
    });

    describe('translation and interpolation', () => {
        beforeEach(() => { resetI18n('en'); });

        it('translates a key in both languages', () => {
            expect(t('actions.save')).toBe('Save');
            i18n.setLanguage('zh-CN');
            expect(t('actions.save')).toBe('保存');
            i18n.setLanguage('en');
        });

        it('interpolates parameters', () => {
            expect(t('time.daysAgo', { count: 3 })).toBe('3d ago');
            i18n.setLanguage('zh-CN');
            expect(t('time.daysAgo', { count: 3 })).toBe('3 天前');
            i18n.setLanguage('en');
        });

        it('uses the first plural form when count is 1', () => {
            expect(t('common.total', { count: 1 })).toBe('1 item');
            expect(t('common.total', { count: 4 })).toBe('4 items');
        });

        it('returns the key and records a miss for an unknown key', () => {
            const i18n = globalThis.i18n;
            i18n.resetMissingKeys();
            expect(t('nope.notAKey')).toBe('nope.notAKey');
            expect(i18n.getMissingKeys()).toContain('nope.notAKey');
        });

        it('warns in development mode about a missing key', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            resetI18n('en');
            globalThis.__CP_I18N_DEBUG__ = true; // resetI18n() turns debug off
            i18n.resetMissingKeys();
            t('still.missing.key');
            expect(warn).toHaveBeenCalled();
            const messages = warn.mock.calls.map((call) => String(call[0]));
            expect(messages.some((m) => m.includes('[i18n]'))).toBe(true);
            warn.mockRestore();
            globalThis.__CP_I18N_DEBUG__ = false;
        });

        it('falls back to English when the current language lacks the key', () => {
            i18n.register('testFallback', { en: { onlyEnglish: 'English only' }, 'zh-CN': {} });
            i18n.setLanguage('zh-CN');
            i18n.resetMissingKeys();
            expect(t('testFallback.onlyEnglish')).toBe('English only');
            expect(i18n.getFallbackKeys()).toContain('testFallback.onlyEnglish');
            i18n.setLanguage('en');
        });

        it('reports whether a key exists in either language', () => {
            expect(i18n.has('nav.jobs')).toBe(true);
            expect(i18n.has('definitely.not.here')).toBe(false);
        });
    });

    describe('language switching', () => {
        it('persists the choice to localStorage and updates <html lang>', () => {
            resetI18n('en');
            i18n.setLanguage('zh-CN');
            expect(globalThis.localStorage.getItem('careerpulse_lang')).toBe('zh-CN');
            expect(document.documentElement.getAttribute('lang')).toBe('zh-CN');
            i18n.setLanguage('en');
            expect(globalThis.localStorage.getItem('careerpulse_lang')).toBe('en');
        });

        it('notifies listeners once per real change', () => {
            resetI18n('en');
            const listener = vi.fn();
            const off = i18n.onChange(listener);
            i18n.setLanguage('zh-CN');
            i18n.setLanguage('zh-CN');
            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith('zh-CN');
            off();
            i18n.setLanguage('en');
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('normalizes locale spellings', () => {
            expect(i18n.normalizeLanguage('zh')).toBe('zh-CN');
            expect(i18n.normalizeLanguage('zh_Hans_CN')).toBe('zh-CN');
            expect(i18n.normalizeLanguage('en-US')).toBe('en');
            expect(i18n.normalizeLanguage('pt-BR')).toBeNull();
        });
    });

    describe('catalog integrity', () => {
        it('defines the same keys for English and Simplified Chinese', () => {
            const en = i18n.keys('en');
            const zh = i18n.keys('zh-CN');
            const missingInZh = en.filter((key) => !zh.includes(key));
            const missingInEn = zh.filter((key) => !en.includes(key));
            expect(missingInZh).toEqual([]);
            expect(missingInEn).toEqual([]);
        });

        it('never ships an empty translation value', () => {
            for (const lang of i18n.SUPPORTED_LANGUAGES) {
                const catalog = i18n.catalog(lang);
                const empties = Object.entries(catalog)
                    .filter(([, value]) => !String(value).trim())
                    .map(([key]) => key);
                expect(empties, `empty values in ${lang}`).toEqual([]);
            }
        });

        it('keeps placeholder sets identical across languages for every key', () => {
            const placeholders = (value) => (String(value).match(/\{(\w+)\}/g) || []).sort();
            const en = i18n.catalog('en');
            const zh = i18n.catalog('zh-CN');
            const mismatched = Object.keys(en)
                .filter((key) => zh[key] !== undefined)
                .filter((key) => JSON.stringify(placeholders(en[key])) !== JSON.stringify(placeholders(zh[key])));
            expect(mismatched).toEqual([]);
        });

        it('has a translation key for every backend error code', () => {
            expect(BACKEND_ERROR_CODES.length).toBeGreaterThan(20);
            const missing = BACKEND_ERROR_CODES.filter((code) => {
                const key = 'errors.' + code.split(/[.\-_]/).filter(Boolean)
                    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
                    .join('');
                return !i18n.has(key);
            });
            expect(missing).toEqual([]);
        });
    });

    describe('date and number formatting', () => {
        it('formats dates per language', () => {
            const date = new Date(2026, 2, 5, 14, 30);
            resetI18n('en');
            expect(i18n.formatMonthYear(date)).toBe('March 2026');
            expect(i18n.formatTime(date)).toMatch(/2:30\s?PM/);
            resetI18n('zh-CN');
            expect(i18n.formatMonthYear(date)).toBe('2026年3月');
            expect(i18n.formatTime(date)).toMatch(/14:30/);
        });

        it('localizes weekday names for the calendar', () => {
            resetI18n('en');
            expect(i18n.weekdayNames()[0]).toBe('Sun');
            resetI18n('zh-CN');
            expect(i18n.weekdayNames()[0]).toContain('日');
        });

        it('localizes relative time', () => {
            const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
            resetI18n('en');
            const en = i18n.formatRelativeTime(threeDaysAgo);
            resetI18n('zh-CN');
            const zh = i18n.formatRelativeTime(threeDaysAgo);
            expect(en).toBe('3d ago');
            expect(zh).toBe('3 天前');
        });

        it('parses SQLite style timestamps as local wall-clock time', () => {
            const parsed = i18n.toDate('2026-03-05 14:30:00');
            expect(parsed.getFullYear()).toBe(2026);
            expect(parsed.getMonth()).toBe(2);
            expect(parsed.getDate()).toBe(5);
            expect(parsed.getHours()).toBe(14);
        });

        it('keeps returns of unresolvable values untouched', () => {
            expect(i18n.toDate('not-a-date')).toBeNull();
        });

        it('formats numbers per language', () => {
            resetI18n('en');
            expect(i18n.formatNumber(1234567)).toBe('1,234,567');
            expect(i18n.formatPercent(0.42)).toBe('42%');
        });

        it('never converts money to another currency', () => {
            // Business rule: amounts are USD, independent of interface language.
            resetI18n('zh-CN');
            expect(formatCurrency(120000)).toBe('$120,000');
            resetI18n('en');
            expect(formatCurrency(120000)).toBe('$120,000');
        });
    });
});

describe('static markup binding', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <button id="b" data-i18n="nav.jobs"></button>
            <input id="i" data-i18n-placeholder="fields.email">
            <button id="a" data-i18n-aria-label="nav.openMenu"></button>
        `;
    });

    it('applies text, placeholder and aria-label translations', () => {
        resetI18n('en');
        i18n.applyStatic(document);
        expect(document.getElementById('b').textContent).toBe('Jobs');
        expect(document.getElementById('i').getAttribute('placeholder')).toBe('Email');
        expect(document.getElementById('a').getAttribute('aria-label')).toBe('Open menu');
    });

    it('re-applies translations when the language changes', () => {
        resetI18n('en');
        i18n.applyStatic(document);
        i18n.setLanguage('zh-CN');
        i18n.applyStatic(document);
        expect(document.getElementById('b').textContent).toBe('职位');
        expect(document.getElementById('a').getAttribute('aria-label')).toBe('打开菜单');
        resetI18n('en');
    });
});

describe('unsaved form change detection', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="app">
                <input id="notes" value="initial">
                <input id="live-filter" data-dirty-ignore value="">
                <div id="editor" contenteditable="true">hello</div>
            </div>
        `;
        clearDirtyChecks();
        refreshFormBaseline();
    });

    afterEach(() => {
        clearDirtyChecks();
    });

    it('reports no changes for untouched controls', () => {
        expect(hasUnsavedChanges()).toBe(false);
    });

    it('detects edited input values', () => {
        document.getElementById('notes').value = 'changed';
        expect(hasUnsavedChanges()).toBe(true);
    });

    it('detects edited contenteditable text', () => {
        document.getElementById('editor').textContent = 'edited';
        expect(hasUnsavedChanges()).toBe(true);
    });

    it('ignores controls marked data-dirty-ignore', () => {
        document.getElementById('live-filter').value = 'react';
        expect(hasUnsavedChanges()).toBe(false);
    });

    it('treats programmatically filled values as the baseline', () => {
        document.getElementById('notes').value = 'filled by the view';
        refreshFormBaseline();
        expect(hasUnsavedChanges()).toBe(false);
    });

    it('supports explicit per-view checks', () => {
        registerDirtyCheck(() => true);
        expect(hasUnsavedChanges()).toBe(true);
        clearDirtyChecks();
        refreshFormBaseline();
        expect(hasUnsavedChanges()).toBe(false);
    });

    it('asks for confirmation only when there are unsaved changes', async () => {
        const modal = vi.fn().mockResolvedValue(true);
        globalThis.showModal = modal;
        await expect(confirmDiscardUnsavedChanges()).resolves.toBe(true);
        expect(modal).not.toHaveBeenCalled();

        document.getElementById('notes').value = 'dirty';
        await expect(confirmDiscardUnsavedChanges()).resolves.toBe(true);
        expect(modal).toHaveBeenCalledTimes(1);
        const args = modal.mock.calls[0][0];
        expect(args.title).toBeTruthy();
        expect(args.confirmText).toBeTruthy();
        expect(args.cancelText).toBeTruthy();
    });

    it('keeps the language when the user cancels the confirmation', async () => {
        globalThis.showModal = vi.fn().mockResolvedValue(false);
        document.getElementById('notes').value = 'dirty';
        await expect(confirmDiscardUnsavedChanges()).resolves.toBe(false);
    });
});

describe('missing-key coverage in shipped catalogs', () => {
    it('resolves every key used by the app shell', () => {
        resetI18n('en');
        i18n.resetMissingKeys();
        const shellKeys = [
            'nav.jobs', 'nav.stats', 'nav.pipeline', 'nav.calendar', 'nav.queue',
            'nav.network', 'nav.calculator', 'nav.settings', 'nav.scrapeNow',
            'nav.themeToggle', 'nav.notifications', 'shell.scrape.detailsTitle',
            'shell.shortcuts.title', 'shell.reminder.completed',
        ];
        shellKeys.forEach((key) => expect(i18n.has(key), key).toBe(true));
    });
});

ensureI18n('en');
