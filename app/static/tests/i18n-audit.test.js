import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Static audit for hardcoded interface copy.
//
// Migration rule (docs/i18n.md): user-visible copy must come from `t(key)`.
// This test scans the migrated frontend files for English-looking string
// literals that never reach the translation layer. Raw business content and
// developer-only strings are skipped, and a line can opt out explicitly with
// an `i18n-audit-ignore` comment documenting why.

const jsDir = join(import.meta.dirname, '..', 'js');

const AUDITED_FILES = [
    'app.js',
    'utils.js',
    'api.js',
    'onboarding.js',
    'interview-panel.js',
    'interview-prep.js',
    'salary-calculator.js',
    'footer.js',
    'views/feed.js',
    'views/detail.js',
    'views/pipeline.js',
    'views/calendar.js',
    'views/triage.js',
    'views/stats.js',
    'views/network.js',
    'views/queue.js',
    'views/settings.js',
];

// Lines that legitimately carry non-interface strings.
const SKIP_LINE_PATTERNS = [
    /i18n-audit-ignore/,              // explicit, documented opt-out
    /^\s*\/\//,                       // comment
    /^\s*\*/,                         // block comment continuation
    /^\s*\/\*/,                        // block comment start
    /\bconsole\.(log|warn|error|info|debug)\b/,
    /\b(getElementById|querySelector|querySelectorAll|closest|matches|createElement)\s*\(/,
    /\b(classList|dataset|setAttribute|removeAttribute|getAttribute|insertAdjacentHTML)\b/,
    /\baddEventListener\s*\(/,
    /\blocalStorage\b|\bsessionStorage\b/,
    /\bimport\b|\brequire\s*\(/,
    /\b(api|fetch|EventSource)\b\s*[(.]/,
    /\bitemCard\(|\bsettingsField\(/,   // field-key mapping calls, not copy
    /\bJSON\.(parse|stringify)\b/,
    /\bDate\b|\bIntl\b/,
    /raw business content/i,
];

// Tokens that are identifiers, CSS values, status codes or data — not copy.
const NON_COPY_LITERAL = new RegExp([
    '^[a-z0-9_-]+$',                       // single lowercase token
    '^[A-Z][A-Z0-9_]*$',                   // CONSTANT
    '^[a-z][a-zA-Z0-9]*(\\.[a-zA-Z0-9]+)+$', // translation key (nav.jobs)
    '^#/[\\w./-]*$',                     // route hash
    '^/[\\w./-]*$',                      // URL path                       // route hash / path
    '^\\d+(\\.\\d+)?(px|rem|em|%|s|ms)?$',
    '^#[0-9a-fA-F]{3,8}$',
    '^rgba?\\([^)]*\\)$',
    '^var\\(--[^)]*\\)$',
    '^https?://\\S+$',
    '^(?:[\\w-]+:\\s*[^;]*;?\\s*)+$',      // css declarations
].join('|'));

const CSS_HINT = /(px|rem|var\(--|;\s*$|:\s*[a-z-]+;|border-|background|color:)/i;

// English words that mark a literal as interface copy.
const COPY_HINT = /\b(the|a|an|your|you|no|not|all|any|and|or|of|to|from|for|with|this|that|is|are|be|will|can|has|have|select|search|save|cancel|delete|add|edit|close|open|show|hide|loading|failed|error|success|please|try|again|refresh|upload|download|copy|view|clear|apply|reset|new|job|jobs|resume|cover|letter|company|interview|contact|note|notes|date|time|score|status|queue|pipeline|calendar|settings|dashboard|match|salary|offer|alert|reminder|follow|up|template|linkedin|github|email|phone|location|remote|apply|dismiss|prepare|compare|import|export|generate|preview|details|summary|title|name|description|category|amount|reason|tags|priority|bucket|stage|source|duration|listings|filter|sort|min|max|hours?|days?|weeks?|months?|today|yesterday|tomorrow)\b/i;

/** Remove arguments of translation calls so keys are not reported as copy. */
function stripTranslationCalls(line) {
    return line.replace(/\b(?:t|tr|i18n\.has|i18n\.register|errorKeyFromCode)\s*\(\s*(['"])(?:\\.|(?!\1)[^\\])*\1/g, 'TRANSLATED');
}

/**
 * Drop attribute values that are data, not copy: class/id/name/value/type,
 * data-* attributes, urls and inline styles. `title`, `placeholder`,
 * `aria-label` and `alt` are copy and stay in scope.
 */
function stripDataAttributes(line) {
    return line
        .replace(/\b(?:class|id|name|for|value|type|href|src|style|role|method|action|target|rel|rows|min|max|step|width|height|tabindex|autocomplete|inputmode|pattern|accept|spellcheck|contenteditable|data-[\w-]+|aria-(?!label[=])[\w-]+)\s*=\s*("[^"]*"|'[^']*'|\{[^}]*\})/g, '');
}

function looksLikeCopy(literal) {
    const value = literal.trim();
    if (value.length < 3) return false;
    if (NON_COPY_LITERAL.test(value)) return false;
    if (CSS_HINT.test(value)) return false;
    // Space separated CSS class lists (e.g. "btn btn-ghost btn-sm").
    if (/^[a-z][a-z0-9-]*(\s+[a-z][a-z0-9-]*)+$/.test(value)) return false;
    if (/^[A-Z][A-Za-z0-9]*$/.test(value) && value.length <= 4) return false; // acronym-ish
    if (!/[A-Za-z]{3}/.test(value)) return false;
    if (!COPY_HINT.test(value)) return false;
    return true;
}

const LITERAL_PATTERN = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

// Prose that sits directly inside a multi-line template literal is invisible to
// the quote scanner (the opening backtick is on an earlier line). Strip the
// interpolations, tags and split attributes, then check the text that is left.
function templateText(line) {
    return line
        .replace(/\$\{[^}]*\}/g, ' ')
        .replace(/<\/?[a-z][^>]*>/gi, ' ')
        .replace(/[a-zA-Z-]+="[^"]*"/g, ' ')
        .replace(/[a-zA-Z-]+='[^']*'/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// English function words that signal real prose rather than an identifier or a
// CSS class list.
const PROSE_HINT = /\b(the|a|an|your|you|no|not|all|any|and|or|of|to|from|for|with|this|that|these|those|is|are|be|will|can|has|have|one|per|only|when|including)\b/i;

function looksLikeCopyProse(text) {
    if (text.length < 8) return false;
    if (/[;{}<>]/.test(text)) return false;
    if (/^[a-z][a-z0-9-]*(\s+[a-z][a-z0-9-]*)+$/.test(text)) return false;
    const words = text.match(/[A-Za-z]{3,}/g) || [];
    if (words.length < 2) return false;
    return PROSE_HINT.test(text);
}

function countBackticks(text) {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\\') { i += 1; continue; }
        if (text[i] === '`') count += 1;
    }
    return count;
}

function scanLine(line, lineNumber, insideTemplate, offenders) {
    // 1. Text nodes and copy attributes of markup rendered from a template
    //    literal (including multi-line templates, where quote scanning fails).
    if (insideTemplate) {
        const prose = templateText(line);
        if (looksLikeCopyProse(prose)) {
            offenders.push({ line: lineNumber, value: prose.slice(0, 80) });
            return;
        }
        const markup = stripDataAttributes(line);
        for (const match of markup.matchAll(/>([^<>{}]*?)</g)) {
            const text = match[1].replace(/\s+/g, ' ').trim();
            if (looksLikeCopy(text)) {
                offenders.push({ line: lineNumber, value: text.slice(0, 80) });
                return;
            }
        }
        for (const match of markup.matchAll(/\b(?:title|placeholder|aria-label|alt)="([^"$]+)"/g)) {
            const value = match[1].trim();
            if (looksLikeCopy(value)) {
                offenders.push({ line: lineNumber, value: value.slice(0, 80) });
                return;
            }
        }
    }

    // 2. String literals carrying copy or markup with copy inside.
    // `${...}` expressions carry code (field keys, data mapping), not copy.
    const withoutExpressions = insideTemplate ? line.replace(/\$\{[^{}]*\}/g, 'EXPR') : line;
    const scannable = stripTranslationCalls(stripDataAttributes(withoutExpressions));
    LITERAL_PATTERN.lastIndex = 0;
    let match;
    while ((match = LITERAL_PATTERN.exec(scannable)) !== null) {
        const raw = match[2];
        if (raw.includes('${')) continue;                      // dynamic template
        if (raw.includes('{') && raw.includes('}')) continue;   // t() interpolation
        const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!looksLikeCopy(text)) continue;
        offenders.push({ line: lineNumber, value: text.slice(0, 80) });
        return;
    }
}

function auditFile(relativePath) {
    const source = readFileSync(join(jsDir, relativePath), 'utf-8');
    const offenders = [];
    let insideTemplate = false;
    source.split('\n').forEach((line, index) => {
        const startsInsideTemplate = insideTemplate;
        // Opening/closing backticks toggle template context (comments excluded).
        insideTemplate = insideTemplate !== (countBackticks(line.replace(/\/\/.*$/, '')) % 2 === 1);
        if (SKIP_LINE_PATTERNS.some((pattern) => pattern.test(line))) return;
        scanLine(line, index + 1, startsInsideTemplate, offenders);
    });
    return offenders;
}

describe('i18n static copy audit', () => {
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
            const source = readFileSync(join(jsDir, file), 'utf-8');
            source.split('\n').forEach((line, index) => {
                if (/i18n-audit-ignore/.test(line)) return;
                if (/(toLocaleDateString|toLocaleTimeString|toLocaleString|Intl\.\w+Format)\(\s*['"](en-US|en-GB|default)['"]/.test(line)) {
                    bad.push(`${file}:${index + 1}`);
                }
            });
        }
        expect(bad).toEqual([]);
    });

    it('keeps money formatting in CNY yuan', () => {
        // 金额一律人民币口径：不得残留美元符号或美元币种标记。
        // 计算器相关的美国税制文案随 M10 重写时一并清理，此处只守住
        // 金额格式化与消费点所在的视图脚本。
        for (const file of AUDITED_FILES) {
            const source = readFileSync(join(jsDir, file), 'utf-8');
            const offenders = source.split('\n')
                .map((line, index) => ({ line, index: index + 1 }))
                .filter(({ line }) => !/i18n-audit-ignore/.test(line))
                .filter(({ line }) => /\$\$|\bUSD\b|美元/.test(line))
                .map(({ line, index }) => `${file}:${index}  ${line.trim().slice(0, 80)}`);
            expect(offenders, `USD residue found:\n${offenders.join('\n')}`).toEqual([]);
        }
    });
});
