import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadScripts, resetI18n } from './setup.js';

// The footer is static shell markup in index.html, so these tests render that
// exact fragment the way the browser does and then exercise js/footer.js on it.
const indexPath = join(import.meta.dirname, '..', 'index.html');
const indexHtml = readFileSync(indexPath, 'utf-8');
const footerHtml = indexHtml.match(/<footer[\s\S]*?<\/footer>/)[0];

const APP_ROUTES = ['#/', '#/stats', '#/pipeline', '#/calendar', '#/queue', '#/network', '#/calculator', '#/settings'];

// Every external link the footer is allowed to carry: the GitHub repository,
// its user guide, the API docs and the two MacNeil Media Group URLs that were
// already in the footer. Anything else would be an invented destination.
const ALLOWED_LINKS = [
    /^#\/(?:stats|pipeline|calendar|queue|network|calculator|settings)?$/,
    /^https:\/\/github\.com\/Yugitan\/careerAmax$/,
    /^https:\/\/github\.com\/Yugitan\/careerAmax\/blob\/prod\/docs\/USAGE\.md$/,
    /^https:\/\/careerpulse\.macneilmediagroup\.com$/,
    /^https:\/\/macneilmediagroup\.com$/,
    /^\/docs$/,
];

function mountFooter() {
    document.body.innerHTML = footerHtml;
    loadScripts('footer.js');
    if (document.readyState === 'loading') {
        document.dispatchEvent(new Event('DOMContentLoaded'));
    }
}

beforeAll(() => {
    globalThis.showToast = vi.fn();
    mountFooter();
});

beforeEach(() => {
    vi.restoreAllMocks();
    delete globalThis.showIcalModal;
});

describe('footer shell', () => {
    it('splits into a brand card, an information card and a watermark', () => {
        expect(document.querySelector('.footer-shell .footer-brand-card')).not.toBeNull();
        expect(document.querySelector('.footer-shell .footer-info-card')).not.toBeNull();
        expect(document.querySelector('.site-footer > .footer-watermark')).not.toBeNull();
    });

    it('keeps the product identity: CareerPulse, never the reference brand', () => {
        expect(document.querySelector('.footer-brand-name').textContent).toBe('CareerPulse');
        expect(document.querySelector('.footer-watermark').textContent.trim()).toBe('CareerPulse');
        expect(footerHtml).not.toMatch(/Kresna/i);
    });

    it('exposes every workspace route as a footer link', () => {
        const routes = [...document.querySelectorAll('.footer-col-link')]
            .map((link) => link.getAttribute('href'))
            .filter((href) => href.startsWith('#/'));
        expect(new Set(routes)).toEqual(new Set(APP_ROUTES));
    });

    it('only links to real destinations', () => {
        const hrefs = [...document.querySelectorAll('.site-footer a')].map((link) => link.getAttribute('href'));
        expect(hrefs.length).toBeGreaterThan(APP_ROUTES.length);
        for (const href of hrefs) {
            expect(ALLOWED_LINKS.some((pattern) => pattern.test(href)), `unexpected footer link: ${href}`).toBe(true);
        }
    });

    it('keeps the decorative layers out of the accessibility tree', () => {
        expect(document.querySelector('.footer-watermark').getAttribute('aria-hidden')).toBe('true');
        expect(document.querySelector('.footer-brand-visual').getAttribute('aria-hidden')).toBe('true');
        expect(document.querySelector('.footer-cube').getAttribute('aria-hidden')).toBe('true');
        expect(document.querySelector('.footer-columns nav, .footer-columns').tagName.toLowerCase()).toBe('nav');
    });

    it('labels the icon-only social links', () => {
        const links = [...document.querySelectorAll('.footer-social-link')];
        expect(links.length).toBeGreaterThan(0);
        i18n.applyStatic(document);
        for (const link of links) {
            expect(link.getAttribute('data-i18n-aria-label')).toBeTruthy();
            expect(link.getAttribute('aria-label')).toBeTruthy();
            expect(link.querySelector('svg')).not.toBeNull();
        }
    });
});

describe('footer copy', () => {
    it('renders the Chinese copy by default', () => {
        const i18nInstance = resetI18n('zh-CN');
        i18nInstance.applyStatic(document);
        expect(document.querySelector('.footer-tagline-lead').textContent).toBe('把求职这件事，');
        expect(document.querySelector('.footer-tagline-emphasis').textContent).toBe('握在自己手里。');
        expect(document.querySelectorAll('.footer-col-title')[0].textContent).toBe('工作台');
        expect(document.getElementById('footer-ical-btn').textContent).toBe('订阅日历');
        expect(document.querySelector('.footer-social').textContent).toContain('保持联系！');
        resetI18n('en');
    });

    it('renders the English copy when the language is switched', () => {
        const i18nInstance = resetI18n('en');
        i18nInstance.applyStatic(document);
        expect(document.querySelector('.footer-tagline-lead').textContent).toBe('Take your job search');
        expect(document.querySelector('.footer-tagline-emphasis').textContent).toBe('into your own hands.');
        expect(document.querySelectorAll('.footer-col-title')[2].textContent).toBe('Resources');
        expect(document.getElementById('footer-ical-btn').textContent).toBe('Subscribe to calendar');
    });
});

describe('footer runtime', () => {
    beforeEach(() => {
        document.getElementById('footer-watermark-text').getBBox = () => ({ x: 4, y: 40, width: 1192, height: 180 });
    });

    it('stamps the current year into the copyright line', () => {
        expect(document.getElementById('footer-year').textContent).toBe(String(new Date().getFullYear()));
    });

    it('reuses the existing iCal subscription flow from the CTA', () => {
        const openModal = vi.fn();
        globalThis.showIcalModal = openModal;

        document.getElementById('footer-ical-btn').click();

        expect(openModal).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the subscription flow is unavailable', () => {
        expect(() => document.getElementById('footer-ical-btn').click()).not.toThrow();
    });

    it('fits the watermark viewBox to the measured glyph box', () => {
        fitFooterWatermark();
        expect(document.getElementById('footer-watermark').getAttribute('viewBox')).toBe('4 40 1192 180');
    });

    it('keeps the previous viewBox when measuring the glyph box fails', () => {
        fitFooterWatermark();
        const fitted = document.getElementById('footer-watermark').getAttribute('viewBox');
        document.getElementById('footer-watermark-text').getBBox = () => { throw new Error('unsupported'); };

        fitFooterWatermark();

        expect(document.getElementById('footer-watermark').getAttribute('viewBox')).toBe(fitted);
    });

    it('coalesces resize bursts into one measurement per frame', () => {
        const frames = [];
        const originalRaf = window.requestAnimationFrame;
        window.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
        let measured = 0;
        document.getElementById('footer-watermark-text').getBBox = () => {
            measured += 1;
            return { x: 0, y: 0, width: 100, height: 20 };
        };

        requestFooterWatermarkFit();
        requestFooterWatermarkFit();
        expect(frames.length).toBe(1);

        frames[0]();
        window.requestAnimationFrame = originalRaf;

        expect(measured).toBe(1);
    });
});
