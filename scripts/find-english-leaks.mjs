// Find i18n leaks in the web catalogs.
//
// Two independent checks:
//   1. Key drift  — a key defined in one language but not the other.
//   2. English leaks — a `zh-CN` value that is still plain English, i.e. it is
//      byte-identical to the English value and contains no Chinese characters.
//
// The catalogs are loaded through the real `app/static/js/i18n.js` module (same
// code path as the browser and `app/static/tests/setup.js`), so nested objects
// are flattened exactly the way the runtime flattens them.
//
// Values that are legitimately identical in both languages are listed in
// INTENTIONALLY_IDENTICAL (brand names, file formats, units). Add to that list
// only when the Chinese UI really is meant to show the same text.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import vm from 'vm';

const jsDir = join(import.meta.dirname, '..', 'app', 'static', 'js');
const localesDir = join(jsDir, 'locales');

// Keys whose zh-CN value is deliberately the English one: brand and product
// names, acronyms, file formats, URLs and field placeholders. Everything else
// that is still English is reported.
const INTENTIONALLY_IDENTICAL = new Set([
    // Brand / product names
    'common.appName',
    'settings.ai.providerOpenai',
    'settings.ai.providerOpenrouter',
    'settings.ai.providerBedrock',
    'settings.profile.github',
    'detail.contact.github',
    'settings.profile.linkedin',
    'detail.contact.linkedin',
    'network.linkedin',
    'onboarding.ai.providers.openrouter',
    // Acronyms and language codes
    'nav.languageEn',
    'settings.profile.gpa',
    'settings.profile.mba',
    // Formats and placeholders
    'onboarding.ai.apiKeyPlaceholder',
    'onboarding.profile.emailPlaceholder',
    'onboarding.ai.ollamaUrlPlaceholder',
    'settings.email.emailPlaceholder',
    'settings.email.fromPlaceholder',
    'common.salary.range',
    'shell.scrape.progress',
    'time.dateRange',
]);

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => store.clear(),
};
globalThis.__CP_I18N_DEBUG__ = false;

const runCode = (code, filename) => vm.runInThisContext(code, { filename });
runCode(readFileSync(join(jsDir, 'i18n.js'), 'utf-8'), 'i18n.js');
for (const file of readdirSync(localesDir).filter((f) => f.endsWith('.js')).sort()) {
    runCode(readFileSync(join(localesDir, file), 'utf-8'), `locales/${file}`);
}

const { i18n } = globalThis;
const en = i18n.catalog('en');
const zh = i18n.catalog('zh-CN');

const hasChinese = (value) => /[\u4e00-\u9fff]/.test(value);
// Copy that carries words: at least two adjacent letters. Filters out
// punctuation-only values ("—", "%", "·"), numbers and single-letter markers.
const looksEnglish = (value) => /[A-Za-z]{2}/.test(value);

const issues = [];

for (const key of Object.keys(en)) {
    if (!(key in zh)) issues.push(`key missing in zh-CN: ${key}`);
}
for (const key of Object.keys(zh)) {
    if (!(key in en)) issues.push(`key missing in en: ${key}`);
}

for (const [key, value] of Object.entries(zh)) {
    if (key in en && en[key] !== value) continue;
    if (!looksEnglish(String(value))) continue;
    if (hasChinese(String(value))) continue;
    if (INTENTIONALLY_IDENTICAL.has(key)) continue;
    issues.push(`still English in zh-CN: ${key} = ${JSON.stringify(value)}`);
}

if (issues.length) {
    console.log(`Found ${issues.length} i18n leaks:`);
    issues.sort().forEach((issue) => console.log('  ' + issue));
    process.exit(1);
}

console.log(`OK: en/zh-CN aligned, no English left in ${Object.keys(zh).length} zh-CN values.`);
