#!/usr/bin/env node
// Generate extension/locales/common.js from the web catalog.
//
// The extension shares the cross-cutting terminology (nav / actions / status /
// errors / fields / a11y / time / common / toast / modal / i18n / notifications)
// with the web app. Instead of hand-copying values, this script mirrors them so
// both sides stay byte-identical; `extension/tests/i18n-parity.test.js` fails
// when the checked-in file drifts.
//
// Usage: node extension/scripts/sync-common-locale.mjs [--check]

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const webCatalogPaths = [
    join(repoRoot, 'app', 'static', 'js', 'locales', 'common.js'),
    join(repoRoot, 'app', 'static', 'js', 'locales', 'errors.js'),
];
const outPath = join(repoRoot, 'extension', 'locales', 'common.js');

// Namespaces shared with the extension (everything cross-cutting).
export const SHARED_NAMESPACES = [
    'nav', 'actions', 'status', 'errors', 'fields', 'a11y', 'time',
    'common', 'toast', 'modal', 'i18n', 'notifications', 'lang',
];

function loadWebCatalog() {
    const registrations = [];
    globalThis.i18n = { register: (ns, catalog) => registrations.push([ns, catalog]) };
    for (const path of webCatalogPaths) new Function(readFileSync(path, 'utf-8'))();
    return registrations;
}

/** Merge every registration of one namespace (common.js + errors.js). */
function mergeNamespace(registrations, ns) {
    const merged = { en: {}, 'zh-CN': {} };
    for (const [name, catalog] of registrations) {
        if (name !== ns) continue;
        for (const lang of ['en', 'zh-CN']) {
            Object.assign(merged[lang], catalog[lang] || {});
        }
    }
    return merged;
}

function quote(value) {
    return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function serialize(obj, indent) {
    const pad = '    '.repeat(indent);
    const inner = '    '.repeat(indent + 1);
    const lines = Object.entries(obj).map(([key, value]) => {
        const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : quote(key);
        if (value && typeof value === 'object') {
            return `${inner}${name}: ${serialize(value, indent + 1)},`;
        }
        return `${inner}${name}: ${quote(value)},`;
    });
    return `{\n${lines.join('\n')}\n${pad}}`;
}

const registrations = loadWebCatalog();
const header = `// === Shared interface copy (generated) ===
//
// GENERATED FILE — do not edit by hand. It mirrors the cross-cutting namespaces
// of app/static/js/locales/common.js so the web app and the extension use the
// exact same keys and wording (docs/i18n.md).
//
// Regenerate with:  node extension/scripts/sync-common-locale.mjs
// Verified by:      extension/tests/i18n-parity.test.js

`;

const blocks = [];
for (const ns of SHARED_NAMESPACES) {
    if (!registrations.some(([name]) => name === ns)) continue;
    const catalog = mergeNamespace(registrations, ns);
    blocks.push(`i18n.register('${ns}', {\n    en: ${serialize(catalog.en, 1)},\n    'zh-CN': ${serialize(catalog['zh-CN'], 1)},\n});`);
}

const output = `${header}${blocks.join('\n\n')}\n`;
const check = process.argv.includes('--check');
const current = (() => {
    try { return readFileSync(outPath, 'utf-8'); } catch { return null; }
})();

if (current !== output) {
    if (check) {
        console.error('extension/locales/common.js is out of date — run: node extension/scripts/sync-common-locale.mjs');
        process.exit(1);
    }
    writeFileSync(outPath, output);
    console.log(`wrote ${outPath} (${blocks.length} namespaces)`);
} else {
    console.log('extension/locales/common.js is up to date');
}
