import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Static audit for hardcoded interface copy in the extension (docs/i18n.md).
// Raw business content (scraped labels, user input, third-party text) and
// developer strings are skipped; a line can opt out with an explicit
// `i18n-audit-ignore` comment that states why.

const extensionDir = join(import.meta.dirname, '..');
const AUDITED_FILES = ['popup.js', 'content.js', 'background.js', 'error-messages.js', 'boss-page-bridge.js'];

const SKIP_LINE_PATTERNS = [
    /i18n-audit-ignore/,
    /^\s*\/\//,
    /^\s*\*/,
    /\bconsole\.(log|warn|error|info|debug)\b/,
    /(getElementById|querySelector|querySelectorAll|closest|matches|createElement)\s*\(/,
    /(classList|dataset|setAttribute|removeAttribute|getAttribute)\b/,
    /addEventListener\s*\(/,
    /chrome\.(runtime|storage|tabs|downloads|scripting)\b/,
    /\b(api|fetch|EventSource)\b\s*[(.]/,
    /\bJSON\.(parse|stringify)\b/,
    /raw business content/i,
    // DOM/selector plumbing unique to a page-automation content script
    /\[(?:class|id|name|type|role|aria|data)[*^$~|]?=/,
    /\b[A-Z_]{3,}\b\s*[=:]/,
    /\bPREFIX\b|\bSELECTOR\b|\bselector\b/,
    /\bfunction\s+\w*[Ss]elector/, 
];

const NON_COPY_LITERAL = new RegExp([
    '^[a-z0-9_-]+$',
    '^[A-Z][A-Z0-9_]*$',
    '^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9]+)+$',
    '^#/[\\w./-]*$',                     // route hash
    '^/[\\w./-]*$',                      // URL path
    '^\\d+(\\.\\d+)?(px|rem|em|%|s|ms)?$',
    '^#[0-9a-fA-F]{3,8}$',
    '^rgba?\\([^)]*\\)$',
    '^var\\(--[^)]*\\)$',
    '^https?://\\S+$',
    '^(?:[\\w-]+:\\s*[^;]*;?\\s*)+$',
].join('|'));

const CSS_HINT = /(px|rem|var\(--|;\s*$|:\s*[a-z-]+;|border-|background|color:|position:|z-index)/i;
const COPY_HINT = /\b(the|a|an|your|you|no|not|all|any|and|or|of|to|from|for|with|this|that|is|are|be|will|can|has|have|select|search|save|cancel|delete|add|edit|close|open|show|hide|loading|failed|error|success|please|try|again|refresh|upload|download|copy|view|clear|apply|reset|new|job|jobs|resume|cover|letter|company|interview|contact|note|notes|date|time|score|status|queue|pipeline|calendar|settings|dashboard|match|salary|offer|alert|reminder|follow|up|template|linkedin|github|email|phone|location|remote|dismiss|prepare|compare|import|export|generate|preview|details|summary|title|name|description|category|amount|reason|tags|priority|source|duration|listings|filter|sort|min|max|hours?|days?|weeks?|months?|today|yesterday|tomorrow|filled|filling|detected|ready|downloaded|retry|saved|saving|unknown|answers?|fields?|page)\b/i;

function stripTranslationCalls(line) {
    return line.replace(/\b(?:t|extErrorMessage|errorKeyFromCode|i18n\.has)\s*\(\s*(['"])(?:\\.|(?!\1)[^\\])*\1/g, 'TRANSLATED');
}

function stripDataAttributes(line) {
    return line.replace(/\b(?:class|id|name|for|value|type|href|src|style|role|method|action|target|rel|rows|min|max|step|width|height|tabindex|autocomplete|data-[\w-]+)\s*=\s*("[^"]*"|'[^']*'|\{[^}]*\})/g, '');
}

function looksLikeCopy(value) {
    const text = value.trim();
    if (text.length < 3) return false;
    if (NON_COPY_LITERAL.test(text)) return false;
    if (CSS_HINT.test(text)) return false;
    if (/^[a-z][a-z0-9-]*(\s+[a-z][a-z0-9-]*)+$/.test(text)) return false;
    if (/^[A-Z][A-Za-z0-9]*$/.test(text) && text.length <= 4) return false;
    // CSS selector lists used to find fields on third-party pages
    if (/[[\]{}]/.test(text)) return false;
    if (/^[.#]/.test(text)) return false;
    if (!/[A-Za-z]{3}/.test(text)) return false;
    if (!COPY_HINT.test(text)) return false;
    return true;
}

function countBackticks(text) {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\\') { i += 1; continue; }
        if (text[i] === '`') count += 1;
    }
    return count;
}

const LITERAL_PATTERN = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

function auditFile(relativePath) {
    const source = readFileSync(join(extensionDir, relativePath), 'utf-8');
    const offenders = [];
    let insideTemplate = false;
    source.split('\n').forEach((line, index) => {
        const startsInsideTemplate = insideTemplate;
        insideTemplate = insideTemplate !== (countBackticks(line.replace(/\/\/.*$/, '')) % 2 === 1);
        if (SKIP_LINE_PATTERNS.some((pattern) => pattern.test(line))) return;

        if (startsInsideTemplate) {
            const markup = stripDataAttributes(line);
            for (const match of markup.matchAll(/>([^<>{}]*?)</g)) {
                const text = match[1].replace(/\s+/g, ' ').trim();
                if (looksLikeCopy(text)) {
                    offenders.push({ line: index + 1, value: text.slice(0, 80) });
                    return;
                }
            }
        }

        const scannable = stripTranslationCalls(stripDataAttributes(line));
        LITERAL_PATTERN.lastIndex = 0;
        let match;
        while ((match = LITERAL_PATTERN.exec(scannable)) !== null) {
            const raw = match[2];
            if (raw.includes('${')) continue;
            if (raw.includes('{') && raw.includes('}')) continue;
            const before = match.index === 0 ? '' : scannable[match.index - 1];
            if (before === '=') continue; // attribute value handled by the markup pass
            const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            if (!looksLikeCopy(text)) continue;
            offenders.push({ line: index + 1, value: text.slice(0, 80) });
            return;
        }
    });
    return offenders;
}

describe('extension i18n static copy audit', () => {
    for (const file of AUDITED_FILES) {
        it(`has no hardcoded interface copy in ${file}`, () => {
            const offenders = auditFile(file);
            const report = offenders.map((o) => `${file}:${o.line}  "${o.value}"`).join('\n');
            expect(offenders.length, `hardcoded copy found:\n${report}`).toBe(0);
        });
    }

    it('never hardcodes an English locale in a date format call', () => {
        const bad = [];
        for (const file of AUDITED_FILES) {
            readFileSync(join(extensionDir, file), 'utf-8').split('\n').forEach((line, index) => {
                if (/i18n-audit-ignore/.test(line)) return;
                if (/(toLocaleDateString|toLocaleTimeString|toLocaleString|Intl\.\w+Format)\(\s*['"](en-US|en-GB|default)['"]/.test(line)) {
                    bad.push(`${file}:${index + 1}`);
                }
            });
        }
        expect(bad).toEqual([]);
    });

    it('keeps money in USD (no currency conversion)', () => {
        for (const file of AUDITED_FILES) {
            expect(readFileSync(join(extensionDir, file), 'utf-8'), file).not.toMatch(/¥|CNY|RMB|人民币/);
        }
    });

    it('loads the i18n module and catalogs in every extension entry point', () => {
        const manifest = JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf-8'));
        const contentScripts = manifest.content_scripts[0].js;
        expect(contentScripts[0]).toBe('i18n.js');
        expect(contentScripts).toContain('locales/common.js');
        expect(contentScripts).toContain('error-messages.js');
        expect(contentScripts[contentScripts.length - 1]).toBe('content.js');

        const popupHtml = readFileSync(join(extensionDir, 'popup.html'), 'utf-8');
        expect(popupHtml).toContain('src="i18n.js"');
        expect(popupHtml).toContain('src="locales/common.js"');
        expect(popupHtml).toContain('src="locales/extension.js"');
        expect(popupHtml).toContain('id="lang-switch"');
    });
});
