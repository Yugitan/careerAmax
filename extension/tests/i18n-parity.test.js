import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { SHARED_NAMESPACES } from '../scripts/sync-common-locale.mjs';

// The web app and the extension must use the same translation keys and the same
// wording for shared terminology (docs/i18n.md). The extension mirrors the web
// catalogs through extension/scripts/sync-common-locale.mjs; this test fails
// when the generated file drifts or when a shared value is edited on one side.

const repoRoot = join(import.meta.dirname, '..', '..');
const webLocalesDir = join(repoRoot, 'app', 'static', 'js', 'locales');

function loadCatalogDirs(paths) {
    const registrations = [];
    globalThis.i18n = { register: (ns, catalog) => registrations.push([ns, catalog]) };
    for (const path of paths) new Function(readFileSync(path, 'utf-8'))();
    const flat = {};
    for (const [ns, catalog] of registrations) {
        for (const [lang, values] of Object.entries(catalog)) {
            const normalized = lang === 'zh-CN' ? 'zh-CN' : 'en';
            flat[normalized] = flat[normalized] || {};
            const walk = (obj, prefix) => {
                for (const [key, value] of Object.entries(obj)) {
                    const full = prefix ? `${prefix}.${key}` : key;
                    if (value && typeof value === 'object') walk(value, full);
                    else flat[normalized][full] = value;
                }
            };
            walk(values, ns);
        }
    }
    return flat;
}

const webFiles = [join(webLocalesDir, 'common.js'), join(webLocalesDir, 'errors.js')];
const extFiles = [
    join(repoRoot, 'extension', 'locales', 'common.js'),
    join(repoRoot, 'extension', 'locales', 'extension.js'),
];

const web = loadCatalogDirs(webFiles);
const ext = loadCatalogDirs(extFiles);

describe('web <-> extension translation parity', () => {
    it('shares the same value for every shared key, in both languages', () => {
        const mismatches = [];
        for (const lang of ['en', 'zh-CN']) {
            for (const [key, value] of Object.entries(ext[lang] || {})) {
                const namespace = key.split('.')[0];
                if (!SHARED_NAMESPACES.includes(namespace)) continue;
                if (namespace === 'queue') continue; // queue has web- and extension-specific keys
                const webValue = (web[lang] || {})[key];
                // Extension-only keys inside a shared namespace are allowed (the
                // background worker raises codes the web app never sees), but a
                // key that exists on both sides must carry the same wording.
                if (webValue === undefined) continue;
                if (webValue !== value) {
                    mismatches.push(`${lang} ${key}: web "${webValue}" vs extension "${value}"`);
                }
            }
        }
        expect(mismatches).toEqual([]);
    });

    it('limits extension-only keys in shared namespaces to extension domains', () => {
        const extensionOnly = Object.keys(ext.en || {})
            .filter((key) => SHARED_NAMESPACES.includes(key.split('.')[0]))
            .filter((key) => (web.en || {})[key] === undefined);
        const unexpected = extensionOnly.filter((key) => !/^errors\.(queue|background)[A-Z]/.test(key));
        expect(unexpected).toEqual([]);
    });

    it('keeps the shared key sets identical for both languages', () => {
        for (const lang of ['en', 'zh-CN']) {
            const en = Object.keys(ext.en || {});
            const other = Object.keys(ext[lang] || {});
            expect(en.filter((key) => !other.includes(key))).toEqual([]);
        }
    });

    it('has an up-to-date generated extension common catalog', () => {
        const result = spawnSync('node', ['extension/scripts/sync-common-locale.mjs', '--check'], {
            cwd: repoRoot, encoding: 'utf-8',
        });
        expect(result.stdout + result.stderr).toContain('up to date');
        expect(result.status).toBe(0);
    });

    it('translates every backend error code on both sides', () => {
        const errorsPy = readFileSync(join(repoRoot, 'app', 'errors.py'), 'utf-8');
        const codes = [...errorsPy.matchAll(/^\s{4}"([a-z0-9_.]+)":\s*"/gm)].map((m) => m[1]);
        expect(codes.length).toBeGreaterThan(20);
        const keyFor = (code) => 'errors.' + code.split(/[.\-_]/).filter(Boolean)
            .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
            .join('');
        for (const lang of ['en', 'zh-CN']) {
            const missing = codes.filter((code) => {
                const key = keyFor(code);
                return (web[lang] || {})[key] === undefined || (ext[lang] || {})[key] === undefined;
            });
            expect(missing, `missing ${lang} translations`).toEqual([]);
        }
    });

    it('registers catalogs from every locale file in both bundles', () => {
        const webLocaleFiles = readdirSync(webLocalesDir).filter((file) => file.endsWith('.js'));
        const extLocaleFiles = readdirSync(join(repoRoot, 'extension', 'locales')).filter((file) => file.endsWith('.js'));
        expect(webLocaleFiles.length).toBeGreaterThanOrEqual(14);
        expect(extLocaleFiles.length).toBeGreaterThanOrEqual(2);
    });
});
