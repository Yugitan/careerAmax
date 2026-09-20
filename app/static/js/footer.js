// === Site footer (app shell) ===
//
// The footer markup lives in index.html and its static copy is translated
// through `data-i18n` (see `i18n.applyStatic`). This script owns only the parts
// that need runtime values:
//   * the copyright year,
//   * the oversized brand watermark, whose SVG viewBox is measured from the
//     rendered glyph box so the wordmark sits flush with the card edges,
//   * the calendar CTA, which reuses the existing iCal subscription flow
//     instead of asking the API for a second token.

/** Keep the copyright line on the current year. */
function setFooterYear() {
    const el = document.getElementById('footer-year');
    if (el) el.textContent = String(new Date().getFullYear());
}

/** Tighten the SVG viewBox around the wordmark so its glyph edges stay flush. */
function fitFooterWatermark() {
    const svg = document.getElementById('footer-watermark');
    const text = document.getElementById('footer-watermark-text');
    if (!svg || !text) return;
    try {
        const box = text.getBBox();
        if (!box || !box.width || !box.height) return;
        svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
    } catch { /* measuring the glyph box is unavailable in some environments */ }
}

/** Coalesce resize bursts into a single measurement per animation frame. */
function requestFooterWatermarkFit() {
    if (requestFooterWatermarkFit.frame !== null) return;
    const schedule = window.requestAnimationFrame || ((cb) => window.setTimeout(cb, 16));
    requestFooterWatermarkFit.frame = schedule(() => {
        requestFooterWatermarkFit.frame = null;
        fitFooterWatermark();
    });
}

requestFooterWatermarkFit.frame = null;

function initFooter() {
    setFooterYear();
    fitFooterWatermark();

    window.addEventListener('resize', requestFooterWatermarkFit);

    // Caveat / KaiTi only change the glyph box once they have actually loaded.
    const fonts = document.fonts;
    if (fonts && fonts.ready && typeof fonts.ready.then === 'function') {
        fonts.ready.then(fitFooterWatermark).catch(() => {});
    }

    const ctaButton = document.getElementById('footer-ical-btn');
    if (ctaButton) {
        ctaButton.addEventListener('click', () => {
            if (typeof showIcalModal === 'function') showIcalModal();
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFooter);
} else {
    initFooter();
}
