(() => {
  'use strict';

  // Guard against multiple injections
  if (window.__cpAutofillLoaded) return;
  window.__cpAutofillLoaded = true;

  const PREFIX = 'cp-autofill';
  const OVERLAY_PREFIX = 'cp-overlay';
  const FIELD_TIMEOUT_MS = 8000;  // Max time per field fill
  const API_TIMEOUT_MS = 60000;   // Max time for API analyze call
  const SCAN_DEBOUNCE_MS = 1500;  // Debounce for MutationObserver re-scans
  let currentState = 'idle'; // idle | analyzing | filling | done | error

  // Track original field values for undo support
  const originalValues = new Map(); // selector -> { originalValue, label, value, confidence, action }
  let overlayMode = 'status'; // status | compact | expanded | panel

  // ─── History interceptor (single patch, multiple callbacks) ──

  const historyCallbacks = { pushState: new Set(), replaceState: new Set() };
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;

  history.pushState = function (...args) {
    origPushState.apply(this, args);
    for (const cb of historyCallbacks.pushState) cb();
  };
  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    for (const cb of historyCallbacks.replaceState) cb();
  };

  // ─── Utilities ──────────────────────────────────────────────

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function withTimeout(promise, ms, label = 'operation') {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      ),
    ]);
  }

  // ─── Shadow DOM traversal ──────────────────────────────────

  function deepQuerySelectorAll(root, selector) {
    const results = [];
    try {
      results.push(...root.querySelectorAll(selector));
    } catch { /* skip */ }

    // Traverse shadow roots
    const walk = (node) => {
      if (node.shadowRoot) {
        try {
          results.push(...node.shadowRoot.querySelectorAll(selector));
          node.shadowRoot.querySelectorAll('*').forEach(walk);
        } catch { /* skip */ }
      }
    };

    try {
      root.querySelectorAll('*').forEach(walk);
    } catch { /* skip */ }
    return results;
  }

  function deepQuerySelector(root, selector) {
    try {
      const direct = root.querySelector(selector);
      if (direct) return direct;
    } catch { /* skip */ }

    // Search shadow roots
    const walk = (node) => {
      if (node.shadowRoot) {
        try {
          const found = node.shadowRoot.querySelector(selector);
          if (found) return found;
          for (const child of node.shadowRoot.querySelectorAll('*')) {
            const result = walk(child);
            if (result) return result;
          }
        } catch { /* skip */ }
      }
      return null;
    };

    try {
      for (const node of root.querySelectorAll('*')) {
        const result = walk(node);
        if (result) return result;
      }
    } catch { /* skip */ }
    return null;
  }

  // ─── Form extraction ─────────────────────────────────────────

  function findLabel(el) {
    try {
      // 1. Explicit <label for="">
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) return label.textContent.trim();
      }

      // 2. aria-labelledby
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const parts = labelledBy.split(/\s+/).map(id => {
          const ref = document.getElementById(id);
          return ref ? ref.textContent.trim() : '';
        }).filter(Boolean);
        if (parts.length) return parts.join(' ');
      }

      // 3. aria-label
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel.trim();

      // 4. Parent label
      const parentLabel = el.closest('label');
      if (parentLabel) {
        const clone = parentLabel.cloneNode(true);
        clone.querySelectorAll('input, select, textarea').forEach(c => c.remove());
        const text = clone.textContent.trim();
        if (text) return text;
      }

      // 5. Preceding sibling or nearby text
      const prev = el.previousElementSibling;
      if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV')) {
        const text = prev.textContent.trim();
        if (text && text.length < 200) return text;
      }

      // 6. Google Forms: walk up to question container and find the title
      // Google Forms nests inputs inside [data-params] containers with [role="heading"] titles
      let ancestor = el.parentElement;
      for (let i = 0; i < 15 && ancestor; i++) {
        if (ancestor.hasAttribute('data-params') || ancestor.classList.contains('freebirdFormviewerComponentsQuestionBaseRoot')) {
          const heading = ancestor.querySelector('[role="heading"], .freebirdFormviewerComponentsQuestionBaseTitle');
          if (heading) return heading.textContent.trim();
        }
        ancestor = ancestor.parentElement;
      }

      // 7. Generic: walk up looking for a heading-like element near a form field container
      ancestor = el.parentElement;
      for (let i = 0; i < 8 && ancestor; i++) {
        const heading = ancestor.querySelector('[role="heading"], legend, h3, h4');
        if (heading) {
          const inputs = ancestor.querySelectorAll('input, select, textarea, [role="checkbox"], [role="radio"]');
          if (inputs.length <= 10) return heading.textContent.trim();
        }
        ancestor = ancestor.parentElement;
      }

      return '';
    } catch {
      return '';
    }
  }

  function getNearbyHeading(el) {
    try {
      let node = el;
      for (let i = 0; i < 10; i++) {
        node = node.parentElement;
        if (!node) break;
        const heading = node.querySelector('h1, h2, h3, h4, h5, h6, legend');
        if (heading) return heading.textContent.trim().slice(0, 200);
      }
      return '';
    } catch {
      return '';
    }
  }

  function getSelectOptions(el) {
    try {
      return Array.from(el.options).map(opt => ({
        value: opt.value,
        text: opt.textContent.trim(),
      }));
    } catch {
      return [];
    }
  }

  function getRadioCheckboxGroup(el) {
    try {
      const name = el.getAttribute('name');
      if (!name) return [];
      const group = document.querySelectorAll(`input[name="${CSS.escape(name)}"]`);
      return Array.from(group).map(inp => ({
        value: inp.value,
        label: findLabel(inp) || inp.value,
        checked: inp.checked,
      }));
    } catch {
      return [];
    }
  }

  function buildSelector(el) {
    try {
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.name) {
        const tag = el.tagName.toLowerCase();
        const type = el.type ? `[type="${el.type}"]` : '';
        const sel = `${tag}[name="${CSS.escape(el.name)}"]${type}`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
      // Fallback: build a path
      const parts = [];
      let cur = el;
      while (cur && cur !== document.body) {
        let seg = cur.tagName.toLowerCase();
        if (cur.id) {
          seg = `#${CSS.escape(cur.id)}`;
          parts.unshift(seg);
          break;
        }
        const parent = cur.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(cur) + 1;
            seg += `:nth-of-type(${idx})`;
          }
        }
        parts.unshift(seg);
        cur = parent;
      }
      return parts.join(' > ');
    } catch {
      return '';
    }
  }

  function extractFormData(formRoot) {
    const root = formRoot || document;
    const fields = [];
    const seen = new Set();

    const selectors = 'input, select, textarea, [contenteditable="true"], [role="combobox"], [role="textbox"], [role="spinbutton"], button[aria-haspopup], [role="button"][aria-haspopup], [data-automation-id][aria-haspopup], [data-automation-id*="select"], [data-automation-id*="dropdown"], [data-automation-id*="stateProvince"], [data-automation-id*="countryRegion"]';

    // Search both light DOM and shadow DOM
    const elements = deepQuerySelectorAll(root, selectors);

    // Also check iframes we can access
    try {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iDoc) elements.push(...deepQuerySelectorAll(iDoc, selectors));
        } catch { /* cross-origin, skip */ }
      }
    } catch { /* skip */ }

    for (const el of elements) {
      try {
        const type = (el.type || '').toLowerCase();
        if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') {
          // Don't skip dropdown trigger elements (e.g., Workday button dropdowns)
          if (!el.hasAttribute('aria-haspopup')) continue;
        }
        if (el.disabled) continue;

        // Skip our own overlay/badge elements
        if (el.closest(`#${PREFIX}-overlay`) || el.closest(`#${PREFIX}-learn-prompt`) || el.closest('.cp-auto-badge')) continue;

        const selector = buildSelector(el);
        if (!selector || seen.has(selector)) continue;
        seen.add(selector);

        // For radio/checkbox groups, only process once per name
        if ((type === 'radio' || type === 'checkbox') && el.name) {
          const groupKey = `group:${el.name}`;
          if (seen.has(groupKey)) continue;
          seen.add(groupKey);
        }

        const field = {
          selector,
          tag: el.tagName.toLowerCase(),
          type: type || null,
          name: el.name || null,
          id: el.id || null,
          placeholder: el.placeholder || null,
          label: findLabel(el),
          nearbyHeading: getNearbyHeading(el),
          required: el.required || el.getAttribute('aria-required') === 'true',
          currentValue: el.value || el.textContent?.trim() || '',
          isContentEditable: el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA',
          role: el.getAttribute('role') || null,
        };

        if (el.tagName === 'SELECT') {
          field.options = getSelectOptions(el);
        } else if (type === 'radio' || type === 'checkbox') {
          field.options = getRadioCheckboxGroup(el);
        }

        fields.push(field);
      } catch {
        // Skip problematic elements
      }
    }

    return fields;
  }

  // ─── Post-extraction field enrichment ──────────────────────────

  function enrichFieldHints(fields) {
    for (const field of fields) {
      // Detect country code selects by dial-code options like "(+1)", "(+44)"
      if (field.tag === 'select' && field.options?.length > 5) {
        const dialCodeCount = field.options.filter(o =>
          /\(\+\d{1,4}\)/.test(o.text || o.value || '')
        ).length;
        if (dialCodeCount > 5 && !/country.?code/i.test(`${field.label} ${field.name} ${field.id}`)) {
          field.label = field.label ? `${field.label} (phone country code)` : 'phone country code';
        }
      }
    }
    return fields;
  }

  // ─── Form HTML serialization ──────────────────────────────────

  function serializeFormHtml() {
    try {
      const clone = document.body.cloneNode(true);

      // Remove noisy elements
      const removeSelectors = 'script, style, img, svg, iframe, video, audio, canvas, noscript, link, meta';
      clone.querySelectorAll(removeSelectors).forEach(el => el.remove());

      // Remove data attributes and inline styles
      const allEls = clone.querySelectorAll('*');
      for (const el of allEls) {
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
          if (attr.name.startsWith('data-') || attr.name === 'style' || attr.name === 'onclick'
              || attr.name === 'onchange' || attr.name === 'onsubmit') {
            el.removeAttribute(attr.name);
          }
        }
      }

      // Only keep form-relevant sections
      const forms = clone.querySelectorAll('form, [role="form"], main, [role="main"]');
      let html;
      if (forms.length) {
        html = Array.from(forms).map(f => f.outerHTML).join('\n');
      } else {
        html = clone.innerHTML;
      }

      // Truncate to 50KB
      if (html.length > 50000) {
        html = html.slice(0, 50000);
      }

      return html;
    } catch (err) {
      return `<error>${err.message}</error>`;
    }
  }

  // ─── Element resolution ────────────────────────────────────

  function resolveElement(selector) {
    // Handle iframe selectors: "iframe:SELECTOR>>>FIELD_SELECTOR"
    if (selector.startsWith('iframe:')) {
      try {
        const parts = selector.slice(7).split('>>>');
        const iframeSelector = parts[0];
        const fieldSelector = parts[1];
        const iframe = document.querySelector(iframeSelector);
        if (!iframe) return null;
        const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iDoc) return null;
        return iDoc.querySelector(fieldSelector);
      } catch {
        return null;
      }
    }

    // Try standard querySelector first
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch { /* skip */ }

    // Try shadow DOM
    try {
      const el = deepQuerySelector(document, selector);
      if (el) return el;
    } catch { /* skip */ }

    // Fallback: try finding by id/name fragments from the selector
    try {
      const idMatch = selector.match(/#([\w-]+)/);
      if (idMatch) {
        const el = document.getElementById(idMatch[1]);
        if (el) return el;
      }
      const nameMatch = selector.match(/\[name="([^"]+)"\]/);
      if (nameMatch) {
        const el = document.querySelector(`[name="${nameMatch[1]}"]`);
        if (el) return el;
      }
    } catch { /* skip */ }

    return null;
  }

  // ─── Event dispatch ────────────────────────────────────────

  function setNativeValue(el, value) {
    // React-compatible value setting
    const prototype = Object.getPrototypeOf(el);
    const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
  }

  function dispatchEvents(el, eventNames) {
    for (const name of eventNames) {
      try {
        if (name === 'input') {
          el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText' }));
        } else if (name === 'change') {
          el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        } else if (name === 'click') {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        } else if (name === 'focus') {
          el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        } else if (name === 'blur') {
          el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        } else if (name === 'keydown' || name === 'keyup' || name === 'keypress') {
          el.dispatchEvent(new KeyboardEvent(name, { bubbles: true, cancelable: true }));
        }
      } catch { /* skip */ }
    }
  }

  function simulateTyping(el, value) {
    // Simulate realistic key-by-key input for frameworks that need it
    setNativeValue(el, '');
    dispatchEvents(el, ['input']);

    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      try {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
      } catch { /* skip */ }
      setNativeValue(el, value.slice(0, i + 1));
      dispatchEvents(el, ['input']);
      try {
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
      } catch { /* skip */ }
    }
  }

  // ─── Field hints and phone detection ────────────────────────

  function getFieldHints(el) {
    if (!el) return { label: '', name: '', id: '', placeholder: '' };
    try {
      return {
        label: findLabel(el),
        name: el.getAttribute('name') || '',
        id: el.id || '',
        placeholder: el.getAttribute('placeholder') || '',
      };
    } catch {
      return { label: '', name: '', id: '', placeholder: '' };
    }
  }

  function looksLikePhoneNumber(val) {
    if (val == null) return false;
    const s = String(val).trim();
    if (!s) return false;
    // Must be composed only of digits and phone formatting characters
    if (!/^[\d\s()+.\-/]+$/.test(s)) return false;
    const digits = s.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
  }

  function isPhoneExtensionField(el) {
    if (!el) return false;
    try {
      const hints = getFieldHints(el);
      const combined = `${hints.label} ${hints.name} ${hints.id} ${hints.placeholder}`;
      return /\bext(ension)?\b/i.test(combined);
    } catch {
      return false;
    }
  }

  function isPhoneField(el) {
    if (!el) return false;
    try {
      // Phone extension fields are NOT phone number fields
      if (isPhoneExtensionField(el)) return false;
      // Phone country code fields are NOT phone number fields
      if (isPhoneCountryCodeField(el)) return false;
      if ((el.type || '').toLowerCase() === 'tel') return true;
      const hints = getFieldHints(el);
      const combined = `${hints.label} ${hints.name} ${hints.id} ${hints.placeholder}`;
      return /phone|tel|mobile|cell/i.test(combined);
    } catch {
      return false;
    }
  }

  function isPhoneCountryCodeField(el) {
    if (!el) return false;
    try {
      const hints = getFieldHints(el);
      const combined = `${hints.label} ${hints.name} ${hints.id} ${hints.placeholder}`;
      return /country.?(?:phone|code)|phone.?country|dial.?code|calling.?code|countryPhoneCode|country.?iso/i.test(combined);
    } catch {
      return false;
    }
  }

  function hasNearbyPhoneCountryCode(el) {
    // Check if there's a phone country code dropdown near this phone field
    try {
      const container = el.closest('fieldset, [data-automation-id*="phone"], [class*="phone"], section, .form-group, .field-group, #app_form, #application_form, #grnhse_app') || el.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
      if (!container) return false;
      const candidates = container.querySelectorAll('select, [role="combobox"], [role="listbox"], [aria-haspopup], button[aria-haspopup]');
      for (const c of candidates) {
        if (isPhoneCountryCodeField(c)) return true;
      }
      // Also check for Workday-specific phone code dropdown
      if (container.querySelector('[data-automation-id="countryPhoneCode"]')) return true;
    } catch { /* skip */ }
    return false;
  }

  // ─── Dropdown / listbox detection ──────────────────────────

  function fuzzyMatchOption(options, targetValue, fieldHints) {
    if (!options || !options.length) return -1;
    const target = targetValue.toLowerCase().trim();

    // Pass 1: exact match on value
    for (let i = 0; i < options.length; i++) {
      if (options[i].value.toLowerCase() === target) return i;
    }
    // Pass 2: exact match on text
    for (let i = 0; i < options.length; i++) {
      if (options[i].text.toLowerCase().trim() === target) return i;
    }

    // Pass 3: normalization via lookup tables
    if (window.__cpNormalize) {
      try {
        const norm = window.__cpNormalize;
        const hints = fieldHints || {};
        const hintValues = [hints.label, hints.name, hints.id, hints.placeholder].filter(Boolean);
        const tables = norm.detectFieldCategory(hintValues);

        // Try normalizedMatch against option text values
        const optionTexts = options.map(o => o.text.trim());
        const normIdx = norm.normalizedMatch(optionTexts, targetValue, tables.length ? tables : undefined);
        if (normIdx >= 0) return normIdx;

        // Try normalizedMatch against option value attributes
        const optionValues = options.map(o => o.value);
        const normValIdx = norm.normalizedMatch(optionValues, targetValue, tables.length ? tables : undefined);
        if (normValIdx >= 0) return normValIdx;

        // Boolean equivalence (yes/true/1, no/false/0)
        const boolIdx = norm.normalizedMatch(optionTexts, targetValue, [norm.BOOLEAN_YES_NO]);
        if (boolIdx >= 0) return boolIdx;
        const boolValIdx = norm.normalizedMatch(optionValues, targetValue, [norm.BOOLEAN_YES_NO]);
        if (boolValIdx >= 0) return boolValIdx;
      } catch { /* normalization unavailable, continue */ }
    }

    // Pass 4: contains / substring match
    for (let i = 0; i < options.length; i++) {
      if (options[i].value.toLowerCase().includes(target) || options[i].text.toLowerCase().includes(target)) return i;
      if (target.includes(options[i].value.toLowerCase()) || target.includes(options[i].text.toLowerCase().trim())) return i;
    }
    return -1;
  }

  function dismissOpenDropdowns() {
    // Close any stale dropdowns from previous field fills
    const dropdownSelectors = [
      '[role="listbox"]',
      '.autocomplete-results',
      '.autocomplete-dropdown',
      '.suggestions',
      '.tt-menu',
      '.select2-results__options',
      '[class*="MenuList"]',
      '[class*="menu-list"]',
    ];

    for (const sel of dropdownSelectors) {
      try {
        const dropdowns = document.querySelectorAll(sel);
        for (const dd of dropdowns) {
          if (dd.offsetParent !== null && dd.children.length > 0) {
            // Press Escape to close it
            document.activeElement?.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
            );
            // Also click the body to dismiss
            document.body.click();
            return;
          }
        }
      } catch { /* skip */ }
    }
  }

  function isElementVisible(el) {
    if (!el) return false;
    try {
      // Check offsetParent (null for hidden elements, but also null for position:fixed)
      if (el.offsetParent === null) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (style.position !== 'fixed' && style.position !== 'sticky') return false;
      }
      if (el.offsetHeight === 0 && el.offsetWidth === 0) return false;
      return true;
    } catch {
      return false;
    }
  }

  function findTypeaheadDropdown(el) {
    const searchSelectors = [
      '[role="listbox"]',
      '[role="option"]',
      '.autocomplete-results',
      '.autocomplete-dropdown',
      '.suggestions',
      '.tt-menu',
      '.select2-results',
      '.css-1nmdiq5-menu',
      '[class*="menu-list"]',
      '[class*="MenuList"]',
      '[class*="listbox"]',
      '[class*="dropdown"] ul',
      '[class*="suggestion"]',
      '[class*="typeahead"]',
      '[class*="autocomplete"]',
      'ul[id*="listbox"]',
      'ul[id*="options"]',
      'div[id*="listbox"]',
      'datalist',
    ];

    // Check aria-owns / aria-controls on the input first
    for (const attr of ['aria-owns', 'aria-controls', 'aria-activedescendant', 'list']) {
      const refId = el.getAttribute(attr);
      if (refId) {
        const ref = document.getElementById(refId);
        if (ref && isElementVisible(ref)) return ref;
      }
    }

    // Search near the input (parent containers, then document-wide)
    let container = el.parentElement;
    for (let depth = 0; depth < 8 && container; depth++) {
      for (const sel of searchSelectors) {
        try {
          const found = container.querySelector(sel);
          if (found && isElementVisible(found) && found !== el) return found;
        } catch { /* invalid selector, skip */ }
      }
      container = container.parentElement;
    }

    // Document-wide search for visible listboxes/dropdowns
    for (const sel of searchSelectors) {
      try {
        const all = document.querySelectorAll(sel);
        for (const node of all) {
          if (isElementVisible(node) && node !== el) return node;
        }
      } catch { /* skip */ }
    }

    // Shadow DOM search
    try {
      const shadowDropdowns = deepQuerySelectorAll(document, '[role="listbox"], [role="option"]');
      for (const node of shadowDropdowns) {
        if (isElementVisible(node)) return node;
      }
    } catch { /* skip */ }

    return null;
  }

  function getDropdownOptions(dropdownEl) {
    const optionSelectors = [
      '[role="option"]',
      '[data-automation-id="promptOption"]',
      '[data-automation-id="menuItem"]',
      'li:not([role="presentation"])',
      '[class*="option"]',
      '[class*="item"]:not([class*="menu-item"])',
      '[class*="suggestion"]',
      '[class*="result"]',
    ];

    for (const sel of optionSelectors) {
      try {
        const options = dropdownEl.querySelectorAll(sel);
        if (options.length > 0) {
          const visible = Array.from(options).filter(o => isElementVisible(o) || o.offsetHeight > 0);
          if (visible.length > 0) return visible;
        }
      } catch { /* skip */ }
    }

    // Fallback: direct children that look clickable
    const children = Array.from(dropdownEl.children).filter(c =>
      c.offsetHeight > 0 && c.tagName !== 'STYLE' && c.tagName !== 'SCRIPT'
    );
    if (children.length > 0) return children;

    return [];
  }

  function fuzzyMatchDropdownOption(options, targetValue, fieldHints) {
    if (!options.length) return null;
    const target = targetValue.toLowerCase().trim();

    // Pass 1: Exact text match
    for (const opt of options) {
      if (opt.textContent.trim().toLowerCase() === target) return opt;
    }

    // Pass 2: Text starts with target
    for (const opt of options) {
      if (opt.textContent.trim().toLowerCase().startsWith(target)) return opt;
    }

    // Pass 2b: Target starts with option text
    for (const opt of options) {
      const text = opt.textContent.trim().toLowerCase();
      if (text.startsWith(target) || target.startsWith(text)) return opt;
    }

    // Pass 3: Normalization via lookup tables
    if (window.__cpNormalize) {
      try {
        const norm = window.__cpNormalize;
        const hints = fieldHints || {};
        const hintValues = [hints.label, hints.name, hints.id, hints.placeholder].filter(Boolean);
        const tables = norm.detectFieldCategory(hintValues);

        const optionTexts = options.map(o => o.textContent.trim());
        const normIdx = norm.normalizedMatch(optionTexts, targetValue, tables.length ? tables : undefined);
        if (normIdx >= 0) return options[normIdx];

        // Boolean equivalence
        const boolIdx = norm.normalizedMatch(optionTexts, targetValue, [norm.BOOLEAN_YES_NO]);
        if (boolIdx >= 0) return options[boolIdx];
      } catch { /* normalization unavailable, continue */ }
    }

    // Pass 4: Contains match
    for (const opt of options) {
      const text = opt.textContent.trim().toLowerCase();
      if (text.includes(target) || target.includes(text)) return opt;
    }

    // Pass 5: Word-level overlap (for "Animas, Hidalgo, NM" matching "Animas")
    const targetWords = target.split(/[\s,]+/).filter(Boolean);
    let bestMatch = null;
    let bestScore = 0;
    for (const opt of options) {
      const text = opt.textContent.trim().toLowerCase();
      const words = text.split(/[\s,]+/).filter(Boolean);
      let score = 0;
      for (const tw of targetWords) {
        if (words.some(w => w.startsWith(tw) || tw.startsWith(w))) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = opt;
      }
    }
    if (bestMatch && bestScore > 0) return bestMatch;

    // If only one option visible, select it
    if (options.length === 1) return options[0];

    return null;
  }

  // ─── Custom (click-to-open) dropdown handling ──────────────

  function isCustomDropdownTrigger(el) {
    // Detect elements that are styled as dropdowns but aren't native <select>
    const role = el.getAttribute('role');
    if (role === 'combobox' || role === 'listbox') return true;

    const ariaHaspopup = el.getAttribute('aria-haspopup');
    if (ariaHaspopup === 'listbox' || ariaHaspopup === 'true') return true;

    const ariaExpanded = el.getAttribute('aria-expanded');
    if (ariaExpanded !== null) return true;

    // Check for common custom dropdown class patterns
    const className = (el.className || '').toString().toLowerCase();
    if (/select|dropdown|combobox|picker/.test(className)) return true;

    return false;
  }

  async function handleCustomDropdown(el, value, fieldHints) {
    // Pre-normalize the target value via the lookup tables (e.g., "CA" → "California").
    // Workday state dropdowns ship a `searchBox` that filters option text — typing the
    // canonical full name yields the correct single match; typing "CA" matches
    // California, North Carolina, and South Carolina.
    let effectiveValue = value;
    if (window.__cpNormalize && fieldHints) {
      try {
        const norm = window.__cpNormalize;
        const hintValues = [fieldHints.label, fieldHints.name, fieldHints.id, fieldHints.placeholder].filter(Boolean);
        const tables = norm.detectFieldCategory(hintValues);
        for (const t of tables) {
          const canonical = norm.normalizeValue(value, t);
          if (canonical) {
            effectiveValue = canonical.replace(/\b\w/g, c => c.toUpperCase());
            break;
          }
        }
      } catch { /* skip */ }
    }

    // Snapshot existing *visible* option elements BEFORE clicking, so any
    // newly-appeared (or previously-hidden) options can be treated as part of
    // the freshly-opened dropdown. Tracking options is more reliable than
    // tracking listbox containers because Workday renders its prompt popup as
    // a portal that may not have role="listbox" on the outer element.
    const preExistingOptions = new Set();
    try {
      for (const opt of document.querySelectorAll('[role="option"], [data-automation-id="promptOption"]')) {
        if (isElementVisible(opt)) preExistingOptions.add(opt);
      }
    } catch { /* skip */ }

    // Click to open the dropdown. Some Workday builds only respond to a full
    // pointer sequence (mousedown → mouseup → click), so dispatch them too.
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    } catch { /* skip */ }
    el.click();
    dispatchEvents(el, ['click', 'focus']);

    // Wait for new options / dropdown to appear (retry with increasing delays)
    let dd = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      await sleep(attempt < 2 ? 200 : 300);

      // Look for newly-appeared option elements (Workday uses
      // [data-automation-id="promptOption"]; others use [role="option"])
      try {
        const newOptions = [];
        for (const opt of document.querySelectorAll('[role="option"], [data-automation-id="promptOption"]')) {
          if (preExistingOptions.has(opt)) continue;
          if (isElementVisible(opt) || opt.offsetHeight > 0) newOptions.push(opt);
        }
        if (newOptions.length > 1) {
          // Find the container: nearest listbox/menu/popup ancestor,
          // else the shared parent of the options.
          dd = newOptions[0].closest('[role="listbox"], [role="menu"], [data-automation-widget*="popup"], [data-automation-widget*="prompt"]')
            || newOptions[0].parentElement;
          if (dd) break;
        }
      } catch { /* skip */ }

      // Fallback: use findTypeaheadDropdown but prefer listboxes with multiple options
      const candidate = findTypeaheadDropdown(el);
      if (candidate) {
        const opts = getDropdownOptions(candidate);
        if (opts.length > 1) { dd = candidate; break; }
      }

      // On first failure, try clicking a child trigger
      if (attempt === 1) {
        const trigger = el.querySelector('button, [class*="arrow"], [class*="indicator"], [class*="toggle"]');
        if (trigger && trigger !== el) {
          trigger.click();
        }
      }
    }

    if (!dd) {
      closeOpenDropdowns();
      return { success: false, reason: 'no dropdown appeared' };
    }

    const options = getDropdownOptions(dd);
    if (!options.length) {
      closeOpenDropdowns();
      return { success: false, reason: 'no options in dropdown' };
    }

    // Try typing to filter first (for searchable dropdowns)
    // Workday uses [data-automation-id="searchBox"] for dropdown search inputs
    const searchInput = dd.querySelector('[data-automation-id="searchBox"]') || dd.querySelector('input');
    if (searchInput) {
      searchInput.focus();
      setNativeValue(searchInput, effectiveValue);
      dispatchEvents(searchInput, ['input']);
      await sleep(300);

      // Re-fetch filtered options
      const filteredOptions = getDropdownOptions(dd);
      const match = fuzzyMatchDropdownOption(filteredOptions.length ? filteredOptions : options, effectiveValue, fieldHints);
      if (match) {
        clickOption(match);
        await sleep(200);
        closeOpenDropdowns();
        return { success: true, selectedText: match.textContent.trim() };
      }
    }

    // Direct option match without filtering
    const match = fuzzyMatchDropdownOption(options, effectiveValue, fieldHints);
    if (match) {
      clickOption(match);
      await sleep(200);
      closeOpenDropdowns();
      return { success: true, selectedText: match.textContent.trim() };
    }

    closeOpenDropdowns();
    return { success: false, reason: `no matching option for "${value}"` };
  }

  function clickOption(optionEl) {
    optionEl.scrollIntoView?.({ block: 'nearest' });
    optionEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    optionEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    optionEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    optionEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    optionEl.click();
  }

  function closeOpenDropdowns() {
    try {
      const active = document.activeElement;
      if (!active || active === document.body) return;

      // Strategy 1: Tab away — this is what real users do to dismiss dropdowns.
      // Frameworks (React, Angular, Workday) handle Tab to close dropdowns and move focus.
      active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, cancelable: true }));
      active.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, cancelable: true }));

      // Strategy 2: Pointer events (React 17+ uses pointer events, not mouse events)
      // Click outside the dropdown at a neutral position
      const neutralEl = document.querySelector('h1, h2, h3, [role="heading"], header, main') || document.body;
      const rect = neutralEl.getBoundingClientRect?.() || { left: 0, top: 0 };
      const x = rect.left + 5;
      const y = rect.top + 5;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        neutralEl.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true,
          clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
        }));
      }

      // Strategy 3: Blur active element
      active.blur();
    } catch { /* ignore errors in test/headless environments */ }
  }

  // ─── Typeahead handling ────────────────────────────────────

  async function typeAndSelectDropdown(el, value, fieldHints) {
    // Clear existing value first
    setNativeValue(el, '');
    dispatchEvents(el, ['input']);
    await sleep(50);

    // Type the value — use simulated typing for better framework compat
    simulateTyping(el, value);

    // Wait for dropdown to appear (check multiple times with increasing delay)
    for (let wait = 0; wait < 6; wait++) {
      await sleep(wait < 3 ? 200 : 400);

      const dropdown = findTypeaheadDropdown(el);
      if (!dropdown) continue;

      const options = getDropdownOptions(dropdown);
      if (!options.length) continue;

      const match = fuzzyMatchDropdownOption(options, value, fieldHints);
      if (match) {
        clickOption(match);
        await sleep(200);
        closeOpenDropdowns();
        return { success: true, selectedText: match.textContent.trim() };
      }

      // If dropdown is open but no good match, try with just the first word
      // (e.g., typing "United States" but dropdown expects just typing "United" first)
      if (wait === 2 && value.includes(' ')) {
        const firstWord = value.split(/[\s,]+/)[0];
        setNativeValue(el, firstWord);
        dispatchEvents(el, ['input']);
        await sleep(300);

        const retryDropdown = findTypeaheadDropdown(el);
        if (retryDropdown) {
          const retryOptions = getDropdownOptions(retryDropdown);
          const retryMatch = fuzzyMatchDropdownOption(retryOptions, value, fieldHints);
          if (retryMatch) {
            clickOption(retryMatch);
            await sleep(200);
            closeOpenDropdowns();
            return { success: true, selectedText: retryMatch.textContent.trim() };
          }
        }
      }

      // Last resort: select first option if it seems reasonable
      if (wait >= 4 && options.length <= 3) {
        clickOption(options[0]);
        await sleep(200);
        closeOpenDropdowns();
        return { success: true, selectedText: options[0].textContent.trim(), fallback: true };
      }
    }

    // Try keyboard navigation as last resort (ArrowDown + Enter)
    try {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      await sleep(100);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      await sleep(100);
      closeOpenDropdowns();
      // Check if value changed (something was selected)
      if (el.value !== value && el.value !== '') {
        return { success: true, selectedText: el.value, keyboard: true };
      }
    } catch { /* skip */ }

    closeOpenDropdowns();
    return { success: false };
  }

  // ─── Contenteditable / Rich text editor handling ───────────

  function isRichTextEditor(el) {
    if (el.isContentEditable) return true;
    if (el.getAttribute('role') === 'textbox' && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return true;

    // Check for known WYSIWYG editor wrappers
    const className = (el.className || '').toString().toLowerCase();
    if (/ql-editor|tox-edit-area|ck-editor|fr-element|note-editable|ProseMirror|DraftEditor/.test(className)) return true;

    return false;
  }

  function findRichTextEditor(el) {
    // The element itself might be the editor
    if (el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return el;

    // Check if there's an iframe with a contenteditable body (TinyMCE, CKEditor classic)
    const wrapper = el.closest('[class*="editor"], [class*="wysiwyg"], [class*="rich-text"]') || el.parentElement;
    if (wrapper) {
      const iframe = wrapper.querySelector('iframe');
      if (iframe) {
        try {
          const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iDoc?.body?.isContentEditable) return iDoc.body;
        } catch { /* cross-origin */ }
      }

      // Check for contenteditable div inside the wrapper
      const editable = wrapper.querySelector('[contenteditable="true"]');
      if (editable) return editable;
    }

    return null;
  }

  function fillRichText(editorEl, value) {
    try {
      editorEl.focus();

      // Clear existing content safely
      while (editorEl.firstChild) editorEl.removeChild(editorEl.firstChild);

      // Insert as text nodes with <br> for newlines (no innerHTML to avoid XSS)
      const lines = value.split('\n');
      lines.forEach((line, i) => {
        editorEl.appendChild(document.createTextNode(line));
        if (i < lines.length - 1) editorEl.appendChild(document.createElement('br'));
      });

      // Dispatch events that editors listen for
      editorEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      editorEl.dispatchEvent(new Event('change', { bubbles: true }));

      // For Draft.js and similar, we may need to use execCommand
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, value);
      } catch { /* skip — not all editors support this */ }

      return true;
    } catch (err) {
      console.warn('[CareerPulse] fillRichText failed:', err.message);
      return false;
    }
  }

  // ─── Date picker handling ──────────────────────────────────

  function isDateField(el) {
    const type = (el.type || '').toLowerCase();
    if (type === 'date' || type === 'month') return true;

    const name = (el.name || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const label = findLabel(el).toLowerCase();
    const placeholder = (el.placeholder || '').toLowerCase();

    return /date|month|year|start.?date|end.?date|graduation|from.?date|to.?date/.test(
      `${name} ${id} ${label} ${placeholder}`
    );
  }

  function fillDateField(el, value) {
    try {
      const type = (el.type || '').toLowerCase();

      if (type === 'date') {
        // Native date input: needs YYYY-MM-DD format
        const parsed = parseFlexibleDate(value);
        if (parsed) {
          setNativeValue(el, parsed);
          dispatchEvents(el, ['input', 'change']);
          return true;
        }
      }

      if (type === 'month') {
        // Native month input: needs YYYY-MM format
        const parsed = parseFlexibleDate(value);
        if (parsed) {
          setNativeValue(el, parsed.slice(0, 7));
          dispatchEvents(el, ['input', 'change']);
          return true;
        }
      }

      // For text inputs that are date fields, just set the value directly
      setNativeValue(el, value);
      dispatchEvents(el, ['input', 'change']);
      return true;
    } catch {
      return false;
    }
  }

  function parseFlexibleDate(value) {
    // Try to parse various date formats into YYYY-MM-DD
    if (!value) return null;

    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

    // YYYY-MM
    if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;

    // MM/DD/YYYY or MM-DD-YYYY
    const mdyMatch = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (mdyMatch) {
      return `${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}-${mdyMatch[2].padStart(2, '0')}`;
    }

    // Month YYYY (e.g., "January 2024")
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'];
    const monthYearMatch = value.match(/^(\w+)\s+(\d{4})$/);
    if (monthYearMatch) {
      const monthIdx = monthNames.indexOf(monthYearMatch[1].toLowerCase());
      if (monthIdx >= 0) {
        return `${monthYearMatch[2]}-${String(monthIdx + 1).padStart(2, '0')}-01`;
      }
    }

    // Just a year
    if (/^\d{4}$/.test(value)) return `${value}-01-01`;

    // Try native Date parsing as last resort
    try {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
      }
    } catch { /* skip */ }

    return null;
  }

  // ─── Field filling (main) ──────────────────────────────────

  async function fillField(selector, value, action, confidence, label) {
    try {
      // Dismiss any stale dropdowns from previous field
      dismissOpenDropdowns();
      await sleep(50);

      const el = resolveElement(selector);
      if (!el) {
        // Selector may have gone stale after DOM mutation; try re-extracting
        return { selector, success: false, reason: 'element not found' };
      }

      // Compute field hints once for normalization throughout this fill
      const fieldHints = getFieldHints(el);

      // Guard: skip phone extension fields when AI sends a phone number
      if (isPhoneExtensionField(el)) {
        const digits = String(value).replace(/\D/g, '');
        if (digits.length >= 7) {
          return { selector, success: true, skipped: true, reason: 'phone extension field — value looks like a phone number' };
        }
      }

      // Guard: skip phone-number-like values for fields not identified as phone
      if (!isPhoneField(el) && !isPhoneCountryCodeField(el) && looksLikePhoneNumber(value)) {
        return { selector, success: true, skipped: true, reason: 'value looks like phone number for non-phone field' };
      }

      // Capture original value before filling (for undo support)
      const origVal = el.value || el.textContent?.trim() || '';
      const fieldLabel = label || findLabel(el) || el.name || el.id || selector;
      originalValues.set(selector, {
        originalValue: origVal,
        label: fieldLabel,
        value: String(value),
        confidence: confidence || 1,
        action,
        undone: false,
      });

      // Scroll element into view so it's interactable
      try {
        el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      } catch { /* skip */ }

      el.focus();
      dispatchEvents(el, ['focus']);

      switch (action) {
        case 'fill_text': {
          // 1. Check if this is a rich text / contenteditable editor
          const richEditor = findRichTextEditor(el);
          if (richEditor && richEditor !== el) {
            const filled = fillRichText(richEditor, value);
            if (filled) return { selector, success: true, action, richText: true };
          }
          if (isRichTextEditor(el)) {
            const filled = fillRichText(el, value);
            if (filled) return { selector, success: true, action, richText: true };
          }

          // 2. Check if this is a date field
          if (isDateField(el)) {
            const filled = fillDateField(el, value);
            if (filled) return { selector, success: true, action, dateField: true };
          }

          // 3. Phone formatting — normalize and format before text fill
          let fillValue = value;
          if (isPhoneField(el) && window.__cpNormalize) {
            try {
              let digits = window.__cpNormalize.normalizePhone(value);
              // Strip leading country code if a separate country code dropdown exists nearby
              if (digits && digits.length === 11 && digits[0] === '1' && hasNearbyPhoneCountryCode(el)) {
                digits = digits.slice(1);
              }
              if (digits) {
                fillValue = window.__cpNormalize.formatPhoneLike(digits, fieldHints.placeholder);
              }
            } catch { /* skip, use original value */ }
          }

          // 4. Check if this is a custom click-to-open dropdown (not a typeahead)
          if (isCustomDropdownTrigger(el) && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
            const result = await handleCustomDropdown(el, fillValue, fieldHints);
            if (result.success) return { selector, success: true, action, selectedText: result.selectedText };
          }

          // 5. Check if this is a typeahead/autocomplete field (has ARIA hints)
          const isTypeahead = el.getAttribute('role') === 'combobox'
            || el.getAttribute('aria-autocomplete')
            || el.getAttribute('aria-owns')
            || el.getAttribute('aria-controls')
            || el.getAttribute('list')
            || el.closest('[class*="autocomplete"]')
            || el.closest('[class*="typeahead"]')
            || el.closest('[class*="combobox"]');

          if (isTypeahead) {
            const result = await typeAndSelectDropdown(el, fillValue, fieldHints);
            if (result.success) {
              return { selector, success: true, action, selectedText: result.selectedText };
            }
          }

          // 6. Normal text fill
          setNativeValue(el, fillValue);
          dispatchEvents(el, ['input', 'change']);

          // 7. After setting value, check if a dropdown appeared anyway
          await sleep(300);
          const dropdown = findTypeaheadDropdown(el);
          if (dropdown) {
            const options = getDropdownOptions(dropdown);
            if (options.length > 0) {
              const match = fuzzyMatchDropdownOption(options, fillValue, fieldHints);
              if (match) {
                clickOption(match);
                await sleep(100);
                return { selector, success: true, action, selectedText: match.textContent.trim() };
              }
            }
          }

          dispatchEvents(el, ['blur']);
          return { selector, success: true, action };
        }

        case 'select_dropdown_safe':
        case 'select_dropdown': {
          // For 'select_dropdown_safe': check if the field already contains the
          // desired value before interacting — avoids opening dropdowns unnecessarily
          if (action === 'select_dropdown_safe') {
            let container = el.closest('[data-automation-id], [class*="combobox"], [role="combobox"], [role="listbox"]') || el.parentElement;
            // Walk up to find chip/pill/tag elements that indicate an already-selected value
            // (e.g., Workday shows "× United States of America (+1)" as a chip)
            let searchEl = container;
            for (let i = 0; i < 5 && searchEl && searchEl !== document.body; i++) {
              // Check for chip elements by selector
              const hasChip = searchEl.querySelector(
                '[data-automation-id*="delete"], [data-automation-id*="Delete"], ' +
                '[data-automation-id*="selectedItem"], [data-automation-id*="SelectedItem"], ' +
                '[class*="chip"], [class*="pill"], [class*="tag-item"], ' +
                '[aria-selected="true"]'
              );
              if (hasChip) {
                container = searchEl;
                break;
              }
              // Also detect chips by text pattern: "×" or "✕" followed by a value
              // (Workday renders chips as plain elements with a close button + text)
              const childText = searchEl.textContent || '';
              if (/[\u00d7\u2715\u2716\u2717\u2718×✕✖]\s*\S/.test(childText)) {
                container = searchEl;
                break;
              }
              searchEl = searchEl.parentElement;
            }
            const existingText = (container?.textContent || el.value || '').toLowerCase();
            const valueLower = value.toLowerCase();
            // Check if the value (or a key part) is already present
            const valueWords = valueLower.split(/[\s()]+/).filter(w => w.length > 2);
            const alreadySet = valueWords.length > 0 && valueWords.every(w => existingText.includes(w));
            if (alreadySet) {
              return { selector, success: true, action, skipped: true, reason: 'already set' };
            }
          }

          // Handle native <select>
          if (el.tagName === 'SELECT') {
            const options = Array.from(el.options || []).map(o => ({ value: o.value, text: o.textContent }));
            const idx = fuzzyMatchOption(options, value, fieldHints);
            if (idx >= 0) {
              el.selectedIndex = idx;
              dispatchEvents(el, ['change', 'blur']);
              return { selector, success: true, action, selectedValue: options[idx].value };
            }
            return { selector, success: false, reason: `no matching option for "${value}"` };
          }

          // Handle custom dropdown (div-based)
          const customResult = await handleCustomDropdown(el, value, fieldHints);
          if (customResult.success) {
            return { selector, success: true, action, selectedText: customResult.selectedText };
          }
          return { selector, success: false, reason: customResult.reason || `no matching option for "${value}"` };
        }

        case 'click_radio': {
          const name = el.name || el.getAttribute('name');
          if (name) {
            const root = el.closest('form') || el.getRootNode();
            const radios = root.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`);
            const target = value.toLowerCase().trim();

            // Pass 1: exact match on value or label
            for (const radio of radios) {
              const radioLabel = findLabel(radio).toLowerCase().trim();
              const radioValue = radio.value.toLowerCase();
              if (radioValue === target || radioLabel === target) {
                radio.click();
                return { selector, success: true, action, selectedValue: radio.value };
              }
            }
            // Pass 2: label contains target (but only if target is long enough to be meaningful)
            if (target.length >= 3) {
              for (const radio of radios) {
                const radioLabel = findLabel(radio).toLowerCase().trim();
                if (radioLabel.includes(target)) {
                  radio.click();
                  return { selector, success: true, action, selectedValue: radio.value };
                }
              }
            }

            // Pass 3: normalization via lookup tables (handles synonyms like Caucasian→White)
            if (window.__cpNormalize) {
              try {
                const norm = window.__cpNormalize;
                const hints = fieldHints || {};
                const hintValues = [hints.label, hints.name, hints.id, hints.placeholder].filter(Boolean);
                const tables = norm.detectFieldCategory(hintValues);
                const radioLabels = Array.from(radios).map(r => findLabel(r).trim());
                const normIdx = norm.normalizedMatch(radioLabels, value, tables.length ? tables : undefined);
                if (normIdx >= 0) {
                  radios[normIdx].click();
                  return { selector, success: true, action, selectedValue: radios[normIdx].value };
                }
              } catch { /* normalization unavailable */ }
            }
          }
          el.click();
          return { selector, success: true, action };
        }

        case 'check_checkbox': {
          const shouldCheck = value === true || value === 'true' || value === 'yes' || value === '1';
          if (el.checked !== shouldCheck) {
            el.click(); // .click() toggles checked and fires events
          }
          return { selector, success: true, action };
        }

        case 'upload_file': {
          return { selector, success: false, reason: 'file upload requires user interaction' };
        }

        case 'skip':
          return { selector, success: true, action: 'skip', skipped: true };

        default:
          // Best-effort: try setting value
          setNativeValue(el, value);
          dispatchEvents(el, ['input', 'change', 'blur']);
          return { selector, success: true, action: 'fallback' };
      }
    } catch (err) {
      return { selector, success: false, reason: err.message };
    }
  }

  // ─── File upload helper ──────────────────────────────────────

  let currentJobId = null;

  function getFieldLabel(fileInput) {
    const label = findLabel(fileInput);
    if (label) return label;
    const name = (fileInput.name || '').toLowerCase();
    const id = (fileInput.id || '').toLowerCase();
    return `${name} ${id}`;
  }

  function detectUploadType(fileInput) {
    const text = getFieldLabel(fileInput).toLowerCase();
    if (/cover.?letter/i.test(text)) return 'cover-letter';
    if (/resume|cv|curriculum/i.test(text)) return 'resume';

    // Also check accept attribute for document types
    const accept = (fileInput.getAttribute('accept') || '').toLowerCase();
    if (accept && /pdf|doc|rtf/.test(accept)) {
      // Could be resume or cover letter; check nearby context
      const parent = fileInput.closest('div, fieldset, section, li');
      const parentText = parent ? parent.textContent.toLowerCase() : '';
      if (/cover.?letter/i.test(parentText)) return 'cover-letter';
      if (/resume|cv|curriculum/i.test(parentText)) return 'resume';
    }

    return null;
  }

  function detectFileUploadFields() {
    const fileInputs = deepQuerySelectorAll(document, 'input[type="file"]');

    for (const fileInput of fileInputs) {
      // Skip if already processed
      if (fileInput.dataset.cpUploadHelper) continue;

      const uploadType = detectUploadType(fileInput);
      if (!uploadType) continue;

      fileInput.dataset.cpUploadHelper = uploadType;
      showUploadHelper(fileInput, uploadType);
    }
  }

  function showUploadHelper(fileInput, type) {
    const label = type === 'cover-letter' ? t('upload.coverLetter') : t('upload.tailoredResume');
    const messageType = type === 'cover-letter' ? 'downloadCoverLetter' : 'downloadResume';

    // Highlight the file input
    fileInput.classList.add(`${PREFIX}-upload-highlight`);

    // Create tooltip container
    const helper = document.createElement('div');
    helper.className = `${PREFIX}-upload-helper`;

    const text = document.createElement('span');
    text.className = `${PREFIX}-upload-helper-text`;
    text.textContent = t('upload.ready', { label });

    const btn = document.createElement('button');
    btn.className = `${PREFIX}-upload-helper-btn`;
    btn.textContent = t('upload.download', { label });
    btn.type = 'button';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!currentJobId) {
        text.textContent = t('upload.noJobId');
        return;
      }

      btn.disabled = true;
      btn.textContent = t('upload.downloading');

      try {
        const response = await chrome.runtime.sendMessage({
          type: messageType,
          jobId: currentJobId,
        });

        if (response && response.ok) {
          helper.classList.add(`${PREFIX}-upload-helper-downloaded`);
          text.textContent = t('upload.downloadedHint');
          btn.textContent = t('upload.downloaded');
        } else {
          text.textContent = t('upload.downloadFailed', { error: extErrorMessage(response) });
          btn.disabled = false;
          btn.textContent = t('upload.retryDownload');
        }
      } catch (err) {
        text.textContent = t('upload.downloadFailed', { error: extErrorMessage(err) });
        btn.disabled = false;
        btn.textContent = t('upload.retryDownload');
      }
    });

    helper.appendChild(text);
    helper.appendChild(btn);

    // Position the helper near the file input
    const parent = fileInput.parentElement;
    if (parent) {
      // Ensure parent has relative positioning for absolute placement
      const parentPos = getComputedStyle(parent).position;
      if (parentPos === 'static') {
        parent.style.position = 'relative';
      }
      parent.appendChild(helper);
    } else {
      fileInput.insertAdjacentElement('afterend', helper);
    }
  }

  // ─── Iterative form fill ──────────────────────────────────────

  async function fillForm(mappings, atsAdapter) {
    const results = [];
    let filledCount = 0;
    const totalMappable = mappings.filter(m => m.action !== 'skip').length;
    const failedSelectors = new Set();
    const atsFormRoot = atsAdapter?.getFormRoot?.(document) || null;

    for (let iteration = 0; iteration < 2; iteration++) {
      const currentMappings = iteration === 0 ? mappings : await getNewMappings();
      if (!currentMappings || !currentMappings.length) break;

      for (const mapping of currentMappings) {
        if (mapping.action === 'skip') continue;
        if (failedSelectors.has(mapping.selector) && iteration > 0) continue;

        let result;
        try {
          result = await withTimeout(
            fillField(mapping.selector, mapping.value, mapping.action, mapping.confidence, mapping.label),
            FIELD_TIMEOUT_MS,
            `filling ${mapping.selector}`
          );
        } catch (err) {
          result = { selector: mapping.selector, success: false, reason: err.message };
        }

        results.push(result);

        // Close any dropdowns left open by the previous fill
        closeOpenDropdowns();
        await sleep(100);

        if (result.success && !result.skipped) {
          filledCount++;
          updateOverlay('filling', t('overlay.fillingFields', { done: filledCount, total: totalMappable }));

          try {
            const el = resolveElement(mapping.selector);
            if (el) {
              const confidence = mapping.confidence || 1;
              el.classList.add(confidence >= 0.8 ? `${PREFIX}-filled` : `${PREFIX}-review`);
            }
          } catch { /* skip */ }
        } else if (!result.success) {
          failedSelectors.add(mapping.selector);
        }
      }

      // Wait for dynamic fields
      await sleep(500);

      // Check if new fields appeared (use ATS form root if available)
      const newFields = extractFormData(atsFormRoot);
      const previousSelectors = new Set(currentMappings.map(m => m.selector));
      const newUnmapped = newFields.filter(f => !previousSelectors.has(f.selector) && !f.currentValue);

      if (newUnmapped.length === 0) break;
    }

    // After filling, detect file upload fields that need user help
    detectFileUploadFields();

    return { results, filledCount, total: totalMappable };
  }

  async function getNewMappings() {
    try {
      const formHtml = serializeFormHtml();
      const response = await withTimeout(
        chrome.runtime.sendMessage({ type: 'analyzeForm', formHtml }),
        API_TIMEOUT_MS,
        'API form analysis' // i18n-audit-ignore: internal timeout label, not user copy
      );
      if (response && response.ok && response.data?.mappings) {
        return response.data.mappings;
      }
    } catch (err) {
      console.warn('[CareerPulse] Re-analysis failed:', err?.message || err);
    }
    return null;
  }

  // ─── Overlay UI ───────────────────────────────────────────────

  let overlayEl = null;
  let dragState = null;

  function createOverlay() {
    if (overlayEl) return overlayEl;

    overlayEl = document.createElement('div');
    overlayEl.id = `${PREFIX}-overlay`;
    overlayEl.innerHTML = `
      <div class="${PREFIX}-overlay-header">
        <span class="${PREFIX}-overlay-title">${t('overlay.brand')}</span>
        <div class="${PREFIX}-overlay-actions">
          <button class="${PREFIX}-overlay-lang" title="${t('nav.languageSwitcher')}">${i18n.getLanguage() === 'zh-CN' ? t('nav.languageEn') : t('nav.languageZh')}</button>
          <button class="${PREFIX}-overlay-minimize" title="${t('overlay.minimize')}">&#x2013;</button>
          <button class="${PREFIX}-overlay-close" title="${t('overlay.close')}">&#x2715;</button>
        </div>
      </div>
      <div class="${PREFIX}-overlay-body">
        <span class="${PREFIX}-overlay-status">${t('overlay.initializing')}</span>
      </div>
    `;

    document.body.appendChild(overlayEl);

    overlayEl.querySelector(`.${PREFIX}-overlay-close`).addEventListener('click', () => {
      removeOverlay();
    });

    // 窗口缩放/旋屏后把面板拉回可见范围，别让它跑到屏幕外
    const el = overlayEl;
    window.addEventListener('resize', () => {
      const left = parseFloat(el.style.left);
      const top = parseFloat(el.style.top);
      if (Number.isFinite(left) && Number.isFinite(top)) applyPanelPosition(el, { left, top });
    });

    // Independent language toggle for the injected overlay (chrome.storage.local).
    overlayEl.querySelector(`.${PREFIX}-overlay-lang`).addEventListener('click', (e) => {
      e.stopPropagation();
      const next = i18n.getLanguage() === 'zh-CN' ? 'en' : 'zh-CN';
      i18n.setLanguage(next);
      refreshOverlayLabels();
    });

    overlayEl.querySelector(`.${PREFIX}-overlay-minimize`).addEventListener('click', () => {
      const body = overlayEl.querySelector(`.${PREFIX}-overlay-body`);
      const collapse = body.style.display !== 'none';
      // 常驻面板的收起状态跨页面记住；填表过程中的浮层只管这一次
      if (overlayMode === 'panel') setPanelCollapsed(collapse);
      else body.style.display = collapse ? 'none' : 'block';
    });

    // Drag support on header
    const header = overlayEl.querySelector(`.${PREFIX}-overlay-header`);
    header.addEventListener('mousedown', onDragStart);

    // 用户把它拖到哪儿，下次打开就待在哪儿
    restorePanelState(overlayEl);

    return overlayEl;
  }

  // ─── Drag handling ───────────────────────────────────────────

  function onDragStart(e) {
    // Don't drag when clicking buttons
    if (e.target.closest('button')) return;
    e.preventDefault();

    const rect = overlayEl.getBoundingClientRect();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
    };

    // Switch from bottom/right positioning to top/left for drag
    overlayEl.style.left = rect.left + 'px';
    overlayEl.style.top = rect.top + 'px';
    overlayEl.style.right = 'auto';
    overlayEl.style.bottom = 'auto';

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  function onDragMove(e) {
    if (!dragState) return;
    e.preventDefault();

    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;

    // 拖到视口外也拉回来：面板全在外面，用户就再也找不到它了
    const pos = clampPanelPosition(dragState.origLeft + dx, dragState.origTop + dy, overlayEl);
    overlayEl.style.left = `${pos.left}px`;
    overlayEl.style.top = `${pos.top}px`;
  }

  function onDragEnd() {
    dragState = null;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    if (overlayEl) savePanelPosition(overlayEl);
  }

  // ─── Overlay mode rendering ──────────────────────────────────

  function getOverlayCounts() {
    let filled = 0;
    let review = 0;
    let undone = 0;
    for (const [, entry] of originalValues) {
      if (entry.undone) {
        undone++;
      } else if (entry.confidence < 0.8) {
        review++;
      } else {
        filled++;
      }
    }
    return { filled, review, undone, total: originalValues.size };
  }

  function renderCompactPill() {
    if (!overlayEl) return;

    const { filled, review } = getOverlayCounts();
    const body = overlayEl.querySelector(`.${PREFIX}-overlay-body`);
    if (!body) return;

    overlayEl.classList.add(`${PREFIX}-overlay-compact`);
    overlayEl.classList.remove(`${PREFIX}-overlay-expanded`);
    overlayMode = 'compact';

    const parts = [];
    if (filled > 0) parts.push(t('overlay.pillFilled', { count: filled }));
    if (review > 0) parts.push(t('overlay.pillReview', { count: review }));
    if (!parts.length) parts.push(t('overlay.pillNoFields'));

    body.innerHTML = `
      <div class="${PREFIX}-overlay-pill" title="${t('overlay.expandTitle')}">
        <span class="${PREFIX}-overlay-pill-check">&#x2713;</span>
        <span class="${PREFIX}-overlay-pill-text">${parts.join(' \u00B7 ')}</span>
        <span class="${PREFIX}-overlay-pill-expand">&#x25BC;</span>
      </div>
    `;

    body.style.display = 'block';
    body.querySelector(`.${PREFIX}-overlay-pill`).addEventListener('click', () => {
      renderExpandedList();
    });
  }

  function renderExpandedList() {
    if (!overlayEl) return;

    const body = overlayEl.querySelector(`.${PREFIX}-overlay-body`);
    if (!body) return;

    overlayEl.classList.remove(`${PREFIX}-overlay-compact`);
    overlayEl.classList.add(`${PREFIX}-overlay-expanded`);
    overlayMode = 'expanded';

    const entries = Array.from(originalValues.entries());
    if (!entries.length) {
      body.innerHTML = `<span class="${PREFIX}-overlay-status">${t('overlay.noFieldsTracked')}</span>`;
      return;
    }

    const rows = entries.map(([selector, entry]) => {
      const dotClass = entry.undone ? 'gray' : (entry.confidence < 0.8 ? 'yellow' : 'green');
      const displayValue = entry.undone ? `(undone) ${entry.originalValue || 'empty'}` : entry.value;
      const truncatedValue = displayValue.length > 50 ? displayValue.slice(0, 47) + '...' : displayValue;
      const truncatedLabel = entry.label.length > 30 ? entry.label.slice(0, 27) + '...' : entry.label;
      const undoBtnHtml = entry.undone
        ? ''
        : `<button class="${PREFIX}-undo-btn" data-selector="${escapeHtml(selector)}" title="${t('overlay.undo')}">&#x21A9;</button>`;

      return `
        <div class="${PREFIX}-overlay-field-row" data-selector="${escapeHtml(selector)}">
          <span class="${PREFIX}-status-dot ${dotClass}"></span>
          <div class="${PREFIX}-overlay-field-info">
            <span class="${PREFIX}-overlay-field-label">${escapeHtml(truncatedLabel)}</span>
            <span class="${PREFIX}-overlay-field-value">${escapeHtml(truncatedValue)}</span>
          </div>
          ${undoBtnHtml}
        </div>
      `;
    }).join('');

    body.innerHTML = `
      <div class="${PREFIX}-overlay-field-list">
        ${rows}
      </div>
      <div class="${PREFIX}-overlay-collapse" title="${t('overlay.collapseTitle')}">
        <span>&#x25B2; ${t('overlay.collapse')}</span>
      </div>
    `;

    body.style.display = 'block';

    // Undo button handlers
    body.querySelectorAll(`.${PREFIX}-undo-btn`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        undoField(btn.dataset.selector);
      });
    });

    // Collapse handler
    body.querySelector(`.${PREFIX}-overlay-collapse`).addEventListener('click', () => {
      renderCompactPill();
    });
  }

  function undoField(selector) {
    const entry = originalValues.get(selector);
    if (!entry || entry.undone) return;

    const el = resolveElement(selector);
    if (!el) return;

    // Restore original value
    setNativeValue(el, entry.originalValue);
    dispatchEvents(el, ['input', 'change']);

    // Remove highlight classes
    el.classList.remove(`${PREFIX}-filled`);
    el.classList.remove(`${PREFIX}-review`);

    entry.undone = true;

    // Re-render the current overlay mode
    if (overlayMode === 'expanded') {
      renderExpandedList();
    } else if (overlayMode === 'compact') {
      renderCompactPill();
    }
  }

  function updateOverlay(state, message) {
    const overlay = createOverlay();
    currentState = state;

    // During active operations (analyzing, filling, error), show status text
    if (state === 'done' && originalValues.size > 0) {
      // Switch to compact pill when fill is complete
      overlayMode = 'compact';
      renderCompactPill();
      return;
    }

    // Status mode: show text message
    overlayEl.classList.remove(`${PREFIX}-overlay-compact`);
    overlayEl.classList.remove(`${PREFIX}-overlay-expanded`);
    overlayMode = 'status';

    const body = overlay.querySelector(`.${PREFIX}-overlay-body`);
    if (body) {
      body.style.display = 'block';
      body.innerHTML = `<span class="${PREFIX}-overlay-status">${escapeHtml(message || state)}</span>`;
    }
  }

  function showOverlay(status) {
    updateOverlay(status, status);
  }

  function removeOverlay() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    // Clean up drag listeners
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    dragState = null;
    // 用户亲手关掉的面板不该因为切了界面语言又冒出来
    if (overlayMode === 'panel') overlayMode = 'status';
  }

  // ─── Job-board panel（招聘站点常驻悬浮面板）───────────────────
  //
  // 进了支持的招聘站点，用户不必再去点扩展图标：面板自己浮在页面上，内容就是
  // 弹窗里那一套（连接状态 / 填写申请表 / 一键抓取 / 打开设置），拖动、最小化、
  // 切语言都在同一个浮层里完成。面板复用自动填表浮层元素与它的表头，抓取进度也
  // 直接显示在面板上（见下面的 syncPanelCapture / paintPanel）。

  const PANEL_POSITION_KEY = 'panelPosition';
  const PANEL_COLLAPSED_KEY = 'panelCollapsed';
  const PANEL_EDGE_MARGIN = 12;  // 距视口边缘的最小留白
  const PANEL_CAPTURE_BTN_ID = `${PREFIX}-panel-capture`;
  const DEFAULT_SERVER_URL = 'http://localhost:8085';
  const PANEL_CONNECTION_RETRY_MS = 15000;  // 没连上服务时，页面扫描顺带复检的间隔

  let panelCollapsed = false;
  let panelStateRestored = false;
  let panelConfig = null;
  let lastPanelConnectionCheck = 0;
  // 连接/表单/卡片数都是异步或随时会变的：集中放这里，paintPanel 只负责画
  const panelState = { connected: null, error: '', hasForm: false, cardCount: 0 };

  function panelBody() {
    return overlayEl ? overlayEl.querySelector(`.${PREFIX}-overlay-body`) : null;
  }

  function setPanelCollapsed(collapsed) {
    panelCollapsed = Boolean(collapsed);
    if (overlayEl) {
      const body = overlayEl.querySelector(`.${PREFIX}-overlay-body`);
      if (body) body.style.display = panelCollapsed ? 'none' : 'block';
      overlayEl.classList.toggle(`${PREFIX}-overlay-collapsed`, panelCollapsed);
    }
    try {
      const stored = chrome.storage.local.set({ [PANEL_COLLAPSED_KEY]: panelCollapsed });
      if (stored && typeof stored.catch === 'function') stored.catch(() => {});
    } catch { /* 存不下只是下次回来不会记住 */ }
  }

  function clampPanelPosition(left, top, el) {
    const rect = el && typeof el.getBoundingClientRect === 'function'
      ? el.getBoundingClientRect()
      : null;
    const width = (rect && rect.width) || el?.offsetWidth || 0;
    const height = (rect && rect.height) || el?.offsetHeight || 0;
    const maxLeft = Math.max(PANEL_EDGE_MARGIN, (window.innerWidth || 0) - width - PANEL_EDGE_MARGIN);
    const maxTop = Math.max(PANEL_EDGE_MARGIN, (window.innerHeight || 0) - height - PANEL_EDGE_MARGIN);
    return {
      left: Math.min(Math.max(PANEL_EDGE_MARGIN, Math.round(left)), maxLeft),
      top: Math.min(Math.max(PANEL_EDGE_MARGIN, Math.round(top)), maxTop),
    };
  }

  // CSS 默认把面板钉在右下角；拖过之后就改用 left/top
  function applyPanelPosition(el, position) {
    if (!position || typeof position.left !== 'number' || typeof position.top !== 'number') return null;
    const pos = clampPanelPosition(position.left, position.top, el);
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    return pos;
  }

  function savePanelPosition(el) {
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;
    try {
      const stored = chrome.storage.local.set({
        [PANEL_POSITION_KEY]: clampPanelPosition(left, top, el),
      });
      if (stored && typeof stored.catch === 'function') stored.catch(() => {});
    } catch { /* 存不下不影响这一次的位置 */ }
  }

  // 位置与收起状态只读一次：页面后续的扫描重绘不会再把它弹回默认位置
  function restorePanelState(el) {
    if (panelStateRestored) {
      if (panelCollapsed) setPanelCollapsed(true);
      return;
    }
    panelStateRestored = true;
    try {
      const stored = chrome.storage.local.get([PANEL_POSITION_KEY, PANEL_COLLAPSED_KEY]);
      if (stored && typeof stored.then === 'function') {
        stored.then((data) => {
          if (!data || el !== overlayEl) return;  // 浮层已经换了一茬
          applyPanelPosition(el, data[PANEL_POSITION_KEY]);
          if (data[PANEL_COLLAPSED_KEY]) setPanelCollapsed(true);
        }).catch(() => {});
      }
    } catch { /* 读不到就停在默认的右下角、默认展开 */ }
  }

  // 面板的全部文案与可用性都由这里画：状态和进度变了就叫一次，幂等
  function paintPanel() {
    if (!overlayEl || overlayMode !== 'panel') return;
    const body = panelBody();
    if (!body) return;

    const dot = body.querySelector(`.${PREFIX}-panel-dot`);
    const statusText = body.querySelector(`.${PREFIX}-panel-status-text`);
    let dotTone = '';
    let statusLabel;
    if (panelState.connected === null) {
      statusLabel = t('status.checking');
    } else if (panelState.connected) {
      dotTone = 'connected';
      statusLabel = t('popup.connected');
    } else {
      dotTone = 'disconnected';
      statusLabel = panelState.error || t('errors.serverUnreachable');
    }
    if (dot) dot.className = `${PREFIX}-panel-dot${dotTone ? ` ${dotTone}` : ''}`;
    if (statusText) statusText.textContent = statusLabel;

    // 招聘列表页本来就没有申请表：按钮留着但置灰，并说明为什么
    const fill = body.querySelector(`.${PREFIX}-panel-fill`);
    if (fill) {
      fill.textContent = t('popup.fillApplication');
      fill.disabled = panelState.connected !== true || !panelState.hasForm;
      fill.title = panelState.hasForm ? '' : t('overlay.panelNoForm');
    }

    const capture = body.querySelector(`.${PREFIX}-panel-capture`);
    if (capture) {
      const snapshot = captureProgress || captureResultSummary;
      if (snapshot) capture.textContent = captureProgressText(snapshot);
      else if (bulkCaptureInFlight) capture.textContent = t('overlay.bulkCapturing');
      else if (panelState.cardCount > 0) capture.textContent = t('overlay.bulkCapture', { count: panelState.cardCount });
      else capture.textContent = t('overlay.panelNoCards');
      capture.title = snapshot || bulkCaptureInFlight
        ? capture.textContent
        : (panelState.cardCount > 0 ? t('overlay.bulkCaptureTitle') : t('overlay.panelNoCardsHint'));
      capture.classList.toggle(`${PREFIX}-panel-busy`, Boolean(snapshot) || bulkCaptureInFlight);
      capture.disabled = panelState.connected !== true
        || bulkCaptureInFlight
        || panelState.cardCount === 0;
    }
  }

  // 面板一出现就报一次连接状态（跟弹窗打开时做的事一样）
  async function checkPanelConnection() {
    lastPanelConnectionCheck = Date.now();
    panelState.connected = null;
    panelState.error = '';
    paintPanel();
    try {
      const response = await chrome.runtime.sendMessage({ type: 'checkConnection' });
      if (response && response.ok) {
        panelState.connected = true;
      } else {
        panelState.connected = false;
        panelState.error = response && response.error
          ? (typeof extErrorMessage === 'function' ? extErrorMessage(response) : response.error)
          : t('errors.serverUnreachable');
      }
    } catch {
      panelState.connected = false;
      panelState.error = t('popup.extensionError');
    }
    paintPanel();
  }

  // ATS 内嵌页面（Greenhouse/Workday 等）真正的申请表在 iframe 里：顶层文档探不到
  // 字段，但 iframe 里的内容脚本能填 —— 走和页面角标、弹窗同一条路（broadcastStartFill）
  function hasAtsEmbedSignals() {
    return hasAtsIframe() || hasAtsEmbedContainer() || hasAtsUrlParam();
  }

  // 表单可用性不能只在面板创建那一刻算一次：LinkedIn Easy Apply、SPA 路由这类页面
  // 是点「立即申请」之后才把表单渲染出来的，一次性的快照会永远停在
  // 「本页没有可填写的申请表」，于是按钮一直是灰的。
  // 弹窗（detectForm 消息）问的是同一个函数，两边的按钮颜色才一致。
  function pageHasApplicationForm() {
    return detectApplicationForm() !== 'none'
      || (!isInIframe() && hasAtsEmbedSignals());
  }

  function renderPanel(config) {
    const overlay = createOverlay();
    const body = panelBody();
    if (!overlay || !body) return null;

    overlay.classList.remove(`${PREFIX}-overlay-compact`, `${PREFIX}-overlay-expanded`);
    overlayMode = 'panel';
    if (config) panelConfig = config;
    // 「填写申请表」只在真的检测到申请表时可用（detectApplicationForm 返回
    // 'none' | 'medium' | 'high'）；页面之后才渲染出的表单由扫描路径补上
    panelState.hasForm = pageHasApplicationForm();

    body.innerHTML = `
      <div class="${PREFIX}-panel">
        <div class="${PREFIX}-panel-status">
          <span class="${PREFIX}-panel-dot"></span>
          <span class="${PREFIX}-panel-status-text"></span>
        </div>
        <button type="button" class="${PREFIX}-panel-btn ${PREFIX}-panel-fill"></button>
        <button type="button" class="${PREFIX}-panel-btn ${PREFIX}-panel-capture" id="${PANEL_CAPTURE_BTN_ID}"></button>
        <a class="${PREFIX}-panel-settings" href="#" target="_blank" rel="noopener">${t('popup.openSettings')}</a>
      </div>
    `;

    // 表头就是拖动把手：给个提示，别让用户以为面板钉死在右下角
    const header = overlay.querySelector(`.${PREFIX}-overlay-header`);
    if (header) header.title = t('overlay.panelDragHint');

    body.querySelector(`.${PREFIX}-panel-fill`).addEventListener('click', () => {
      if (panelState.connected !== true || !panelState.hasForm) return;
      // 内嵌 ATS：真正的表单位于 iframe，顶层自己 startFillFlow 会静默退出，
      // 因此和页面角标、弹窗（chrome.tabs.sendMessage 送到所有 frame）一样广播一次
      if (!isInIframe() && hasAtsEmbedSignals()) {
        chrome.runtime.sendMessage({ type: 'broadcastStartFill' });
        return;
      }
      // 交给自动填表流程：状态/字段列表会接管浮层 body
      startFillFlow();
    });

    body.querySelector(`.${PREFIX}-panel-capture`).addEventListener('click', (e) => {
      e.preventDefault();
      runPanelCapture();
    });

    // 设置入口：和弹窗一样跳到本地服务
    const settings = body.querySelector(`.${PREFIX}-panel-settings`);
    if (settings) {
      try {
        const stored = chrome.storage.local.get({ serverUrl: DEFAULT_SERVER_URL });
        if (stored && typeof stored.then === 'function') {
          stored.then((data) => {
            const url = (data && data.serverUrl) || DEFAULT_SERVER_URL;
            settings.href = `${String(url).replace(/\/+$/, '')}/#/settings`;
          }).catch(() => {});
        }
      } catch { /* 读不到就保留默认链接 */ }
    }

    setPanelCollapsed(panelCollapsed);
    paintPanel();
    checkPanelConnection();
    return overlay;
  }

  // 进了支持的招聘站点就自动把面板浮出来（syncPanelCapture 补上卡片数）
  function showJobBoardPanel(config) {
    if (!config || !config.listingSelector) return null;
    const overlay = renderPanel(config);
    if (!overlay) return null;
    syncPanelCapture(config);
    return overlay;
  }

  // 填表流程收场后：只有浮层什么都不剩时才把面板放回来（填成功的会留下结果条，
  // 用户亲手关掉的也不该被这个函数复活）
  function restoreJobBoardPanel() {
    if (overlayEl || !panelConfig) return;
    if (!detectJobBoard()) return;
    showJobBoardPanel(panelConfig);
  }

  // ─── Learn prompt (post-submission) ───────────────────────────

  let preSubmitValues = {};

  function captureFormValues() {
    const values = {};
    const fields = extractFormData();
    for (const field of fields) {
      if (field.currentValue) {
        values[field.selector] = {
          value: field.currentValue,
          label: field.label,
          name: field.name,
        };
      }
    }
    return values;
  }

  function showLearnPrompt(newData) {
    if (!newData.length) return;

    // Remove any existing learn prompt
    const existing = document.getElementById(`${PREFIX}-learn-prompt`);
    if (existing) existing.remove();

    const promptEl = document.createElement('div');
    promptEl.id = `${PREFIX}-learn-prompt`;
    promptEl.innerHTML = `
      <div class="${PREFIX}-learn-modal">
        <div class="${PREFIX}-learn-header">
          <h3 class="${PREFIX}-learn-title">${t('overlay.learnTitle', { count: newData.length })}</h3>
          <button class="${PREFIX}-learn-close" aria-label="${t('a11y.close')}">\u00d7</button>
        </div>
        <div class="${PREFIX}-learn-list">
          ${newData.map((item, i) => `
            <label class="${PREFIX}-learn-item">
              <input type="checkbox" checked data-index="${i}">
              <div class="${PREFIX}-learn-item-detail">
                <span class="${PREFIX}-learn-item-label">${escapeHtml(item.label || item.name || t('overlay.learnUnknownField'))}</span>
                <span class="${PREFIX}-learn-item-value">${escapeHtml(String(item.value).slice(0, 100))}</span>
              </div>
            </label>
          `).join('')}
        </div>
        <div class="${PREFIX}-learn-actions">
          <button class="${PREFIX}-learn-save">${t('overlay.learnSave')}</button>
          <button class="${PREFIX}-learn-dismiss">${t('overlay.learnDismiss')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(promptEl);

    promptEl.querySelector(`.${PREFIX}-learn-save`).addEventListener('click', async () => {
      const checkboxes = promptEl.querySelectorAll('input[type="checkbox"]');
      const selectedData = [];
      checkboxes.forEach(cb => {
        if (cb.checked) {
          selectedData.push(newData[parseInt(cb.dataset.index)]);
        }
      });
      if (selectedData.length) {
        try {
          await chrome.runtime.sendMessage({
            type: 'saveLearnedData',
            data: { learned_fields: selectedData },
          });
          showToast(t('overlay.learnSaved', { count: selectedData.length }), 'success');
        } catch { /* skip */ }
      }
      promptEl.remove();
    });

    promptEl.querySelector(`.${PREFIX}-learn-dismiss`).addEventListener('click', () => {
      promptEl.remove();
    });

    promptEl.querySelector(`.${PREFIX}-learn-close`).addEventListener('click', () => {
      promptEl.remove();
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Toast notifications ─────────────────────────────────────

  function showToast(message, type = 'success') {
    const existing = document.getElementById(`${PREFIX}-toast`);
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = `${PREFIX}-toast`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const bgColor = type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6';
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      background: ${bgColor}; color: white; padding: 12px 20px;
      border-radius: 8px; font: 14px/1.4 system-ui, sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-width: 360px;
      opacity: 0; transform: translateY(12px);
      transition: opacity 0.3s, transform 0.3s;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);

    return toast;
  }

  // ─── Auto-track applied jobs ────────────────────────────────

  let autoTrackFired = false;

  async function autoTrackApplied() {
    if (autoTrackFired) return;
    autoTrackFired = true;

    try {
      const pageUrl = location.href;
      const result = await chrome.runtime.sendMessage({ type: 'markAppliedByUrl', url: pageUrl });
      if (result && result.ok) {
        showToast(t('overlay.markedApplied'), 'success');
      }
    } catch (err) {
      console.warn('[CareerPulse] autoTrackApplied failed:', err.message);
    }
  }

  // ─── Submission detection ─────────────────────────────────────

  function detectSubmission() {
    document.addEventListener('submit', handleSubmission, true);

    // Register pushState callback via central interceptor
    historyCallbacks.pushState.add(handleSubmission);

    document.addEventListener('click', (e) => {
      try {
        const btn = e.target.closest('button[type="submit"], input[type="submit"], [role="button"]');
        if (btn && btn.closest('form')) {
          setTimeout(handleSubmission, 1000);
        }
      } catch { /* skip */ }
    }, true);

    // MutationObserver: detect form removal or "thank you" confirmation pages
    const observer = new MutationObserver((mutations) => {
      try {
        for (const mutation of mutations) {
          // Check removed nodes for form elements
          for (const node of mutation.removedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'FORM' || node.querySelector?.('form')) {
              setTimeout(handleSubmission, 500);
              return;
            }
          }

          // Check added nodes for success/confirmation indicators
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            const text = (node.textContent || '').toLowerCase();
            if (text.includes('application submitted') ||
                text.includes('thank you for applying') ||
                text.includes('application received') ||
                text.includes('successfully submitted')) {
              handleSubmission();
              return;
            }
          }
        }
      } catch { /* skip */ }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function handleSubmission() {
    try {
      if (Object.keys(preSubmitValues).length === 0) return;

      const postValues = captureFormValues();
      const newData = [];

      for (const [selector, post] of Object.entries(postValues)) {
        const pre = preSubmitValues[selector];
        if (!pre || pre.value !== post.value) {
          if (post.value && post.value.trim()) {
            newData.push({
              selector,
              label: post.label,
              name: post.name,
              value: post.value,
              previousValue: pre ? pre.value : null,
            });
          }
        }
      }

      if (newData.length > 0) {
        showLearnPrompt(newData);
      }

      // Auto-track this job as applied
      autoTrackApplied();
    } catch (err) {
      console.warn('[CareerPulse] handleSubmission failed:', err.message);
    }
  }

  // ─── Custom Q&A matching ─────────────────────────────────────

  function fuzzyMatchQA(fieldLabel, qaEntries) {
    if (!fieldLabel || !qaEntries || !qaEntries.length) return null;
    const label = fieldLabel.toLowerCase().trim();
    if (!label) return null;

    const labelWords = label.split(/\s+/).filter(w => w.length > 2);

    let bestMatch = null;
    let bestScore = 0;

    for (const qa of qaEntries) {
      const pattern = (qa.question_pattern || '').toLowerCase().trim();
      if (!pattern) continue;

      // Exact match
      if (label === pattern) return qa;

      // Substring: label contains pattern or pattern contains label
      if (label.includes(pattern) || pattern.includes(label)) {
        const score = 3;
        if (score > bestScore) { bestScore = score; bestMatch = qa; }
        continue;
      }

      // Keyword overlap: count shared words
      const patternWords = pattern.split(/\s+/).filter(w => w.length > 2);
      if (patternWords.length > 0 && labelWords.length > 0) {
        const shared = patternWords.filter(pw => labelWords.some(lw => lw.includes(pw) || pw.includes(lw)));
        const score = shared.length / Math.max(patternWords.length, labelWords.length);
        if (score >= 0.5 && score > bestScore) {
          bestScore = score;
          bestMatch = qa;
        }
      }
    }

    return bestMatch;
  }

  async function applyCustomQA(mappings) {
    let qaEntries;
    try {
      const qaResult = await chrome.runtime.sendMessage({ type: 'getCustomQA' });
      if (!qaResult || !qaResult.ok || !Array.isArray(qaResult.data)) return mappings;
      qaEntries = qaResult.data;
    } catch (err) {
      console.warn('[CareerPulse] applyCustomQA failed:', err.message);
      return mappings;
    }

    if (!qaEntries.length) return mappings;

    return mappings.map(mapping => {
      if (mapping.action !== 'skip') return mapping;

      const label = mapping.field_label || '';
      const match = fuzzyMatchQA(label, qaEntries);
      if (match && match.answer) {
        return { ...mapping, action: 'fill_text', value: match.answer, qa_matched: true };
      }
      return mapping;
    });
  }

  // ─── Main fill flow ──────────────────────────────────────────

  const OVERALL_TIMEOUT_MS = 90000; // Max time for entire fill flow

  async function startFillFlow() {
    try {
      // Remove the auto-detection badge if present
      removeBadge();

      // If we're in the top frame and there are ATS embed/iframe signals, bail
      // silently — the iframe's content script handles filling.
      if (!isInIframe() && (hasAtsIframe() || hasAtsEmbedContainer() || hasAtsUrlParam())) {
        return;
      }

      currentState = 'analyzing';

      // Look up the job ID by URL if not already set (enables resume/cover letter downloads)
      if (!currentJobId) {
        try {
          const lookupResult = await chrome.runtime.sendMessage({
            type: 'lookupJob',
            url: location.href,
          });
          if (lookupResult?.ok && lookupResult.data?.id) {
            currentJobId = lookupResult.data.id;
          }
        } catch { /* skip — job may not be saved yet */ }
      }

      // Detect ATS-specific adapter
      const atsAdapter = window.__cpAtsAdapters
        ? window.__cpAtsAdapters.detectATS(location.href, document)
        : null;

      if (atsAdapter) {
        showOverlay(t('overlay.detectedAnalyzing', { name: atsAdapter.name })); // raw business content: ATS product name
      } else {
        showOverlay(t('overlay.analyzingGeneric'));
      }

      await withTimeout((async () => {
        preSubmitValues = captureFormValues();

        // Use ATS adapter's form root if available
        const formRoot = atsAdapter?.getFormRoot?.(document) || null;

        const formHtml = serializeFormHtml();

        // If adapter provides extra field extraction (e.g. Google Forms), merge them
        let adapterFields = [];
        if (atsAdapter?.getExtraFields) {
          try {
            adapterFields = atsAdapter.getExtraFields(document);
          } catch (err) {
            console.warn('[CareerPulse] ATS getExtraFields failed:', err.message);
          }
        }

        // Extract structured fields for more reliable AI analysis
        let structuredFields = extractFormData(formRoot);

        // In iframes with no form fields, bail silently — avoids showing
        // confusing overlays in tracking/footer/privacy iframes
        if (isInIframe() && !structuredFields.length) {
          removeOverlay();
          return;
        }

        // Enrich field hints (e.g. detect dial-code selects as country code fields)
        try {
          structuredFields = enrichFieldHints(structuredFields);
        } catch (err) {
          console.warn('[CareerPulse] enrichFieldHints failed:', err.message);
        }

        // Apply ATS-specific field enhancement if adapter provides it
        if (atsAdapter?.enhanceExtraction) {
          try {
            structuredFields = atsAdapter.enhanceExtraction(structuredFields);
          } catch (err) {
            console.warn('[CareerPulse] ATS enhanceExtraction failed:', err.message);
          }
        }

        // Debug: log extracted fields so we can diagnose fill issues
        console.log('[CareerPulse] Extracted fields:', structuredFields.map(f => ({
          selector: f.selector, tag: f.tag, type: f.type, label: f.label,
          name: f.name, role: f.role, currentValue: f.currentValue,
          hasOptions: !!(f.options && f.options.length),
          optionCount: f.options?.length || 0,
        })));

        // Include ATS metadata in the analysis request
        const analyzePayload = { type: 'analyzeForm', formHtml, structuredFields };
        if (atsAdapter) {
          analyzePayload.atsName = atsAdapter.name;
          analyzePayload.atsFieldMap = atsAdapter.getFieldMap?.() || {};
          if (adapterFields.length) {
            analyzePayload.adapterFields = adapterFields;
          }
        }

        let response;
        try {
          response = await withTimeout(
            chrome.runtime.sendMessage(analyzePayload),
            API_TIMEOUT_MS,
            'Form analysis'
          );
        } catch (err) {
          updateOverlay('error', t('overlay.analysisTimeout'));
          return;
        }

        console.log('[CareerPulse] Analyze response:', JSON.stringify(response?.data?.mappings || [], null, 2));

        if (!response || !response.ok) {
          updateOverlay('error', t('errors.dynamic', { detail: extErrorMessage(response) }));
          return;
        }

        let mappings = response.data?.mappings || [];
        if (!mappings.length) {
          updateOverlay('done', t('overlay.noFillableFields'));
          return;
        }

        // Post-process: fill skipped fields that match custom Q&A
        mappings = await applyCustomQA(mappings);

        currentState = 'filling';
        const result = await fillForm(mappings, atsAdapter);

        const failedCount = result.results.filter(r => !r.success).length;
        let statusMsg = `Filled ${result.filledCount}/${result.total} fields.`;
        if (failedCount > 0) {
          statusMsg += ' ' + t('overlay.fieldsNeedReview', { count: failedCount });
        } else {
          statusMsg += ' ' + t('overlay.reviewHighlighted');
        }
        updateOverlay('done', statusMsg);

        preSubmitValues = captureFormValues();
        detectSubmission();

        // Start multi-page tracking or update cumulative progress
        if (multiPageState && multiPageState.currentPage > 1) {
          updateMultiPageProgress(result.filledCount);
        } else {
          startMultiPageTracking(result.filledCount);
        }
      })(), OVERALL_TIMEOUT_MS, 'Autofill operation');
    } catch (err) {
      if (err.message && err.message.includes('timed out')) {
        updateOverlay('error', t('overlay.autofillTimeout'));
      } else {
        updateOverlay('error', t('errors.dynamic', { detail: extErrorMessage(err) }));
      }
    } finally {
      // 招聘站点上的面板是常驻的：填表流程退出（没检测到表单、ATS 内嵌页直接
      // 返回）后把面板放回来，别让用户以为面板不见了
      restoreJobBoardPanel();
    }
  }

  // ─── ATS iframe / embed detection ───────────────────────────

  const ATS_IFRAME_PATTERNS = [
    /(?:boards|job-boards)\.greenhouse\.io/i,
    /jobs\.lever\.co/i,
    /icims\.com/i,
    /taleo\.net/i,
  ];

  const ATS_EMBED_URL_PARAMS = ['gh_jid']; // Greenhouse job ID in parent page URL

  function hasAtsIframe() {
    try {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        const src = iframe.src || '';
        for (const pattern of ATS_IFRAME_PATTERNS) {
          if (pattern.test(src)) return true;
        }
      }
    } catch { /* skip */ }
    return false;
  }

  function hasAtsEmbedContainer() {
    return !!(document.getElementById('grnhse_app')
      || document.querySelector('[class*="grnhse"]')
      || document.querySelector('iframe[id*="grnhse"]'));
  }

  function hasAtsUrlParam() {
    try {
      const params = new URLSearchParams(window.location.search);
      return ATS_EMBED_URL_PARAMS.some(p => params.has(p));
    } catch { return false; }
  }

  function isInIframe() {
    try { return window.self !== window.top; } catch { return true; }
  }

  // ─── Application form auto-detection ────────────────────────

  function detectApplicationForm() {
    const url = window.location.href;
    let confidence = 'none';

    // URL patterns (high confidence)
    const highConfidenceUrls = [
      /myworkdayjobs\.com\/.*\/job\//i,
      /(?:boards|job-boards)\.greenhouse\.io/i,
      /jobs\.lever\.co\/.*\/apply/i,
      /icims\.com\/.*\/job\//i,
      /taleo\.net\/.*\/apply/i,
      /\/careers?\/.*(apply|application)/i,
    ];

    // Parent page with ATS embed signals (e.g. ?gh_jid= for Greenhouse)
    if (hasAtsUrlParam() || hasAtsEmbedContainer()) {
      confidence = 'high';
    }

    for (const pattern of highConfidenceUrls) {
      if (pattern.test(url)) {
        confidence = 'high';
        break;
      }
    }

    // Form field signals — require job-specific fields within actual forms
    if (confidence !== 'high') {
      // Only consider fields inside <form> elements or known ATS containers
      const forms = document.querySelectorAll('form, [role="form"], [data-testid*="application"], .application-form');
      if (forms.length === 0) return 'none';

      const inputs = document.querySelectorAll('form input, form select, form textarea, form [role="textbox"], [role="form"] input, [role="form"] select, [role="form"] textarea');
      if (inputs.length === 0) return 'none';

      // Negative signals: password fields indicate login/registration
      for (const el of inputs) {
        if (el.type === 'password') return 'none';
      }

      // Negative signals: search forms
      for (const form of forms) {
        const formAction = form.getAttribute('action') || '';
        if (form.getAttribute('role') === 'search' || formAction.includes('search')) return 'none';
      }

      // Job-specific signals — fields that only appear on job applications
      const jobSpecificPatterns = /resum[eé]|cv[\b\s_\-.]upload|cover.?letter|work.?auth|visa.?status|salary.?expect|desired.?salary|years?.?of?.?experience|how.?did.?you.?(hear|find)|willing.?to.?relocate|security.?clearance|equal.?opportunity|eeo\b|start.?date|available.?start/i;
      // Generic contact fields
      const genericPatterns = /first.?name|last.?name|email|phone|address|city|state|zip/i;

      let jobSignals = 0;
      let genericSignals = 0;

      for (const el of inputs) {
        if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') continue;
        const name = el.name || '';
        const id = el.id || '';
        const label = findLabel(el);
        const placeholder = el.placeholder || '';
        const combined = `${name} ${id} ${label} ${placeholder}`;

        if (jobSpecificPatterns.test(combined)) {
          jobSignals++;
        } else if (genericPatterns.test(combined)) {
          genericSignals++;
        }

        // Resume/CV file upload is a very strong signal
        if (el.type === 'file' && /resum[eé]|cv[\b\s_\-.]|upload.?cv/i.test(combined)) {
          jobSignals += 2;
        }
      }

      // Page title must contain job-application-specific terms (not just "career")
      const pageText = document.title;
      const titleMatch = /\bapply\b|application.?form|job.?application|submit.?your.?application/i.test(pageText);

      // Require strong job-specific evidence
      if (jobSignals >= 2) {
        confidence = 'high';
      } else if (jobSignals >= 1 && genericSignals >= 2) {
        confidence = 'high';
      } else if (jobSignals >= 1 && titleMatch) {
        confidence = 'medium';
      } else if (genericSignals >= 3 && titleMatch) {
        confidence = 'medium';
      }
    }

    return confidence;
  }

  // ─── Auto-detection badge ──────────────────────────────────────

  let badgeEl = null;

  function removeBadge() {
    if (badgeEl) {
      badgeEl.remove();
      badgeEl = null;
    }
  }

  function showBadge(confidence) {
    if (badgeEl) return;

    badgeEl = document.createElement('div');
    badgeEl.className = 'cp-auto-badge' + (confidence === 'medium' ? ' cp-badge-medium' : '');
    badgeEl.innerHTML = `
      <span class="cp-auto-badge-main">
        <svg class="cp-auto-badge-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        ${t('overlay.badgeFill')}
      </span>
      <button class="cp-auto-badge-dismiss" title="${t('overlay.badgeDismiss')}">\u00d7</button>
    `;

    document.body.appendChild(badgeEl);

    // Click main area to start fill
    badgeEl.querySelector('.cp-auto-badge-main').addEventListener('click', () => {
      removeBadge();
      // If we're on a parent page with an ATS iframe, broadcast startFill via
      // the background script so the iframe's content script picks it up.
      if (!isInIframe() && (hasAtsIframe() || hasAtsEmbedContainer() || hasAtsUrlParam())) {
        chrome.runtime.sendMessage({ type: 'broadcastStartFill' });
      } else {
        startFillFlow();
      }
    });

    // Dismiss button: suppress for this hostname
    badgeEl.querySelector('.cp-auto-badge-dismiss').addEventListener('click', async (e) => {
      e.stopPropagation();
      const host = window.location.hostname;
      try {
        const result = await chrome.storage.local.get({ dismissedHosts: [] });
        const hosts = result.dismissedHosts;
        if (!hosts.includes(host)) {
          hosts.push(host);
          // Cap dismissed hosts to prevent unbounded storage growth
          if (hosts.length > 500) hosts.splice(0, hosts.length - 500);
          await chrome.storage.local.set({ dismissedHosts: hosts });
        }
      } catch (err) {
        console.warn('[CareerPulse] Failed to save dismissed host:', err.message);
      }
      removeBadge();
    });
  }

  async function tryShowBadge() {
    const confidence = detectApplicationForm();
    if (confidence === 'none') return;

    try {
      const result = await chrome.storage.local.get({ dismissedHosts: [] });
      const host = window.location.hostname;
      if (result.dismissedHosts.includes(host)) return;
      showBadge(confidence);
    } catch (err) {
      console.warn('[CareerPulse] Failed to check dismissed hosts:', err.message);
    }
  }

  // Run detection after page load (with delay for SPA content)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryShowBadge, 500));
  } else {
    setTimeout(tryShowBadge, 500);
  }

  // Watch for SPA navigation via debounced DOM mutations
  let badgeObserverTimeout = null;
  const badgeObserver = new MutationObserver(() => {
    if (badgeObserverTimeout) clearTimeout(badgeObserverTimeout);
    badgeObserverTimeout = setTimeout(() => {
      if (!badgeEl && currentState === 'idle') {
        tryShowBadge();
      }
    }, 1000);
  });
  badgeObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });


  // ─── Multi-page form tracking ────────────────────────────────

  let multiPageState = null;

  function startMultiPageTracking(filledOnThisPage) {
    stopMultiPageTracking();

    const origin = location.origin;
    multiPageState = {
      origin,
      currentPage: 1,
      totalFilled: filledOnThisPage || 0,
      lastUrl: location.href,
      observer: null,
      debounceTimer: null,
      popstateHandler: null,
      hashchangeHandler: null,
    };

    function onPageChange() {
      if (!multiPageState) return;
      if (location.origin !== multiPageState.origin) {
        stopMultiPageTracking();
        return;
      }
      clearTimeout(multiPageState.debounceTimer);
      multiPageState.debounceTimer = setTimeout(() => checkForNewPage(), 1000);
    }

    function checkForNewPage() {
      if (!multiPageState) return;
      // Only detect a new page if the URL actually changed
      const currentUrl = location.href;
      if (currentUrl === multiPageState.lastUrl) return;
      const fields = extractFormData();
      const unfilled = fields.filter(f => f.required && !f.currentValue);
      if (unfilled.length >= 2) {
        multiPageState.lastUrl = currentUrl;
        multiPageState.currentPage++;
        showMultiPageBadge(multiPageState.currentPage);
      }
    }

    // MutationObserver on body for DOM changes (SPA page transitions)
    multiPageState.observer = new MutationObserver(() => onPageChange());
    multiPageState.observer.observe(document.body, { childList: true, subtree: true });

    // Popstate and hashchange for URL-based navigation
    multiPageState.popstateHandler = () => onPageChange();
    multiPageState.hashchangeHandler = () => onPageChange();
    window.addEventListener('popstate', multiPageState.popstateHandler);
    window.addEventListener('hashchange', multiPageState.hashchangeHandler);

    // Register history callbacks via central interceptor
    multiPageState.pushStateCallback = () => onPageChange();
    multiPageState.replaceStateCallback = () => onPageChange();
    historyCallbacks.pushState.add(multiPageState.pushStateCallback);
    historyCallbacks.replaceState.add(multiPageState.replaceStateCallback);
  }

  function stopMultiPageTracking() {
    if (!multiPageState) return;

    if (multiPageState.observer) {
      multiPageState.observer.disconnect();
    }
    clearTimeout(multiPageState.debounceTimer);

    if (multiPageState.popstateHandler) {
      window.removeEventListener('popstate', multiPageState.popstateHandler);
    }
    if (multiPageState.hashchangeHandler) {
      window.removeEventListener('hashchange', multiPageState.hashchangeHandler);
    }

    // Unregister history callbacks
    if (multiPageState.pushStateCallback) {
      historyCallbacks.pushState.delete(multiPageState.pushStateCallback);
    }
    if (multiPageState.replaceStateCallback) {
      historyCallbacks.replaceState.delete(multiPageState.replaceStateCallback);
    }

    multiPageState = null;
  }

  function showMultiPageBadge(pageNum) {
    const existing = document.getElementById(`${PREFIX}-multipage-badge`);
    if (existing) existing.remove();

    const badge = document.createElement('div');
    badge.id = `${PREFIX}-multipage-badge`;
    badge.textContent = t('overlay.pageDetected', { page: pageNum });
    badge.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;'
      + 'padding:10px 18px;background:#1a73e8;color:#fff;border-radius:8px;'
      + 'font:14px/1.4 -apple-system,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);';

    badge.addEventListener('click', async () => {
      badge.remove();
      await startFillFlow();
    });
    document.body.appendChild(badge);
  }

  function updateMultiPageProgress(filledOnThisPage) {
    if (!multiPageState) return;
    multiPageState.totalFilled += filledOnThisPage;
    const total = multiPageState.totalFilled;
    const pages = multiPageState.currentPage;
    updateOverlay('done', t(pages > 1 ? 'overlay.filledFieldsPages' : 'overlay.filledFields', { count: total, pages }));
  }

  // ─── Queue fill orchestration (content side) ─────────────────

  let queueContext = null; // { queueItemId, jobId, jobTitle, company, position, total }
  let queueBannerEl = null;
  let lastQueueBannerArgs = null;

  function showQueueBanner(position, total, jobTitle, company) {
    lastQueueBannerArgs = { position, total, jobTitle, company };
    removeQueueBanner();

    queueBannerEl = document.createElement('div');
    queueBannerEl.id = `${PREFIX}-queue-banner`;

    const label = jobTitle
      ? `${jobTitle}${company ? ' at ' + company : ''}`
      : t('overlay.queueApplicationOfTotal', { position, total });

    queueBannerEl.innerHTML = `
      <div class="${PREFIX}-queue-banner-inner">
        <span class="${PREFIX}-queue-banner-progress">${position}/${total}</span>
        <span class="${PREFIX}-queue-banner-label">${escapeHtml(label)}</span>
        <div class="${PREFIX}-queue-banner-actions">
          <button class="${PREFIX}-queue-done-btn" title="${t('queue.doneTitle')}">${t('queue.done')}</button>
          <button class="${PREFIX}-queue-skip-btn" title="${t('queue.skipTitle')}">${t('queue.skip')}</button>
          <button class="${PREFIX}-queue-cancel-btn" title="${t('queue.cancelTitle')}">${t('queue.cancel')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(queueBannerEl);

    queueBannerEl.querySelector(`.${PREFIX}-queue-done-btn`).addEventListener('click', () => {
      handleQueueAction('submitted');
    });

    queueBannerEl.querySelector(`.${PREFIX}-queue-skip-btn`).addEventListener('click', () => {
      handleQueueAction('skipped');
    });

    queueBannerEl.querySelector(`.${PREFIX}-queue-cancel-btn`).addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'cancelQueue' });
      removeQueueBanner();
      queueContext = null;
    });
  }

  function removeQueueBanner() {
    if (queueBannerEl) {
      queueBannerEl.remove();
      queueBannerEl = null;
    }
  }

  function handleQueueAction(action) {
    if (!queueContext) return;

    chrome.runtime.sendMessage({
      type: 'queueUserAction',
      queueItemId: queueContext.queueItemId,
      action,
    });

    removeQueueBanner();
    queueContext = null;
  }

  async function startQueueFill(message) {
    // If we're the parent frame with an ATS embed, skip — the iframe handles filling
    if (!isInIframe() && (hasAtsIframe() || hasAtsEmbedContainer() || hasAtsUrlParam())) {
      return;
    }

    queueContext = {
      queueItemId: message.queueItemId,
      jobId: message.jobId,
      jobTitle: message.jobTitle || '',
      company: message.company || '',
      position: message.queuePosition,
      total: message.queueTotal,
    };

    showQueueBanner(
      queueContext.position,
      queueContext.total,
      queueContext.jobTitle,
      queueContext.company
    );

    // Set jobId and trigger the normal fill flow
    if (message.jobId) currentJobId = message.jobId;
    await startFillFlow();

    // Report fill completed (NOT submitted — user must explicitly submit)
    if (queueContext) {
      try {
        await chrome.runtime.sendMessage({
          type: 'reportFillStatus',
          queueItemId: queueContext.queueItemId,
          status: 'filled',
          details: { state: currentState },
        });
      } catch { /* skip */ }
    }
  }

  // ─── Language ─────────────────────────────────────────────────

  /** Re-render the overlay chrome in the current language. */
  function refreshOverlayLabels() {
    // 常驻面板：整块重绘一次（状态、按钮、抓取进度都是同一份状态算出来的）
    if (overlayMode === 'panel' && panelConfig) {
      renderPanel(panelConfig);
      return;
    }

    if (!overlayEl || !overlayEl.isConnected) return;
    const title = overlayEl.querySelector(`.${PREFIX}-overlay-title`);
    if (title) title.textContent = t('overlay.brand');
    const langBtn = overlayEl.querySelector(`.${PREFIX}-overlay-lang`);
    if (langBtn) {
      langBtn.textContent = i18n.getLanguage() === 'zh-CN' ? t('nav.languageEn') : t('nav.languageZh');
      langBtn.title = t('nav.languageSwitcher');
    }
    const minimize = overlayEl.querySelector(`.${PREFIX}-overlay-minimize`);
    if (minimize) minimize.title = t('overlay.minimize');
    const close = overlayEl.querySelector(`.${PREFIX}-overlay-close`);
    if (close) close.title = t('overlay.close');
    const collapse = overlayEl.querySelector(`.${PREFIX}-overlay-collapse`);
    if (collapse) collapse.title = t('overlay.collapseTitle');
    const pill = overlayEl.querySelector(`.${PREFIX}-overlay-pill`);
    if (pill) pill.title = t('overlay.expandTitle');
    // Re-render the queue banner so its prompts follow the language too.
    if (queueBannerEl && queueBannerEl.isConnected && lastQueueBannerArgs) {
      showQueueBanner(
        lastQueueBannerArgs.position,
        lastQueueBannerArgs.total,
        lastQueueBannerArgs.jobTitle,
        lastQueueBannerArgs.company,
      );
    }
  }

  // Read the stored language before the overlay can be rendered, and follow
  // changes made in the popup while this page stays open.
  if (typeof i18n !== 'undefined') {
    i18n.init();
    i18n.watchStorage();
    i18n.onChange(() => refreshOverlayLabels());
  }

  // ─── Message handler ──────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Validate message origin — only accept messages from this extension
    if (sender.id !== chrome.runtime.id) return false;

    try {
      switch (message.type) {
        case 'startFill':
          if (message.jobId) currentJobId = message.jobId;
          startFillFlow().then(() => {
            sendResponse({ ok: true, state: currentState });
          }).catch(err => {
            sendResponse({ ok: false, error: err.message });
          });
          return true;

        case 'startCapture':
          captureCurrentPage().then((result) => {
            sendResponse(result);
          }).catch(err => {
            sendResponse({ ok: false, error: err.message });
          });
          return true;

        // 弹窗问「这个页面上有申请表可填吗」：和常驻面板同一条判据
        case 'detectForm':
          sendResponse({ ok: true, hasForm: pageHasApplicationForm() });
          return false;

        case 'queueFill':
          startQueueFill(message).then(() => {
            sendResponse({ ok: true, state: currentState });
          }).catch(err => {
            sendResponse({ ok: false, error: err.message });
          });
          return true;

        case 'getStatus':
          sendResponse({ ok: true, state: currentState, queueActive: !!queueContext });
          return false;

        default:
          return false;
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
      return false;
    }
  });

  // ─── Keyboard shortcut: Escape to dismiss overlay ─────────────

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    // Don't intercept Escape when user is focused on a form field
    const active = document.activeElement;
    if (active) {
      const tag = active.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (active.isContentEditable) return;
    }

    // Dismiss overlay if present
    if (overlayEl) {
      removeOverlay();
      currentState = 'idle';
    }
  });

  // ─── Job Board Detection & Overlay ──────────────────────────────

  // 招聘站点改版会直接换掉 class 名（BOSS 直聘改版尤其频繁），单一选择器一失效
  // 整条采集链路就静默断掉。因此每个字段都接受"从精确到宽松"的候选列表。
  function asSelectorList(value) {
    if (!value) return [];
    return Array.isArray(value) ? value.filter(Boolean) : [value];
  }

  function queryFirst(root, selectorList, fallbackRoot) {
    if (!root) return null;
    for (const selector of asSelectorList(selectorList)) {
      const found = root.querySelector(selector);
      if (found) return found;
      if (fallbackRoot && fallbackRoot !== root) {
        const fallback = fallbackRoot.querySelector(selector);
        if (fallback) return fallback;
      }
    }
    return null;
  }

  function textOf(root, selectorList, fallbackRoot) {
    const el = queryFirst(root, selectorList, fallbackRoot);
    return el ? (el.innerText || el.textContent || '').trim() : '';
  }

  const SALARY_RANGE_RE = /(\d+(?:\.\d+)?)\s*[-~—－～]\s*(\d+(?:\.\d+)?)\s*([KkＫｋWw万])/;
  const SALARY_TEXT_RE = /\d+(?:\.\d+)?\s*[-~—－～]\s*\d+(?:\.\d+)?\s*[KkＫｋWw万][^\s·，,；;]*/g;
  const NEGOTIABLE_SALARY_RE = /面议|面谈|薪资面议/;

  function parseSalaryText(rawText) {
    const text = (rawText || '').trim();
    if (!text) return {};
    // 「面议」没有区间可解析，交给用户在看板上人工判断
    if (NEGOTIABLE_SALARY_RE.test(text)) return {};
    const match = text.match(SALARY_RANGE_RE);
    if (!match) return {};
    const multiplier = /万/.test(match[3]) ? 10000 : 1000;
    return {
      salary_min: Math.round(parseFloat(match[1]) * multiplier),
      salary_max: Math.round(parseFloat(match[2]) * multiplier),
    };
  }

  // 详情页把职位名和薪资塞进同一个容器（<div class="name"><h1>前端开发</h1>
  // <span class="salary">15-25K</span></div>），直接取容器文本会得到
  // "前端开发工程师15-25K"。这里剥掉薪资片段与「【急招】」之类的前缀。
  function cleanJobTitle(rawText, salaryText) {
    let value = (rawText || '').replace(/[\u00a0\s]+/g, ' ').trim();
    if (!value) return '';
    const salary = (salaryText || '').replace(/[\u00a0\s]+/g, ' ').trim();
    if (salary && value.includes(salary)) value = value.split(salary).join(' ');
    value = value.replace(SALARY_TEXT_RE, ' ');
    value = value.replace(/^【[^】]{0,30}】\s*/, '');
    return value.replace(/[\u00a0\s]+/g, ' ').trim();
  }

  function cleanCompanyName(rawText) {
    return (rawText || '')
      .replace(/[\u00a0\s]+/g, ' ')
      .replace(/\s*招聘$/, '')
      .trim();
  }

  // 详情页把地点、经验、学历串成一段（"北京·朝阳区 ·3-5年 ·本科"），
  // 而列表卡片上就是纯地点（"北京·朝阳区"）。逐段扫描，遇到经验/学历片段就停。
  const NON_LOCATION_TOKEN = /^(经验不限|经验优先|学历不限|不限|应届|在校|全职|兼职|实习|\d{1,2}\s*[-~—～]\s*\d{1,2}\s*年|\d{1,2}\s*年|大专|本科|硕士|博士)/;

  function cleanLocation(rawText) {
    const value = (rawText || '').replace(/[\u00a0\s]+/g, ' ').trim();
    if (!value) return '';
    const kept = [];
    for (const segment of value.split('·')) {
      const token = segment.replace(/^[\s,，、]+|[\s,，、]+$/g, '');
      if (!token) continue;
      const head = token.split(/\s+/)[0];
      if (NON_LOCATION_TOKEN.test(token) || NON_LOCATION_TOKEN.test(head)) break;
      kept.push(token);
      if (kept.length >= 2) break;  // 城市 + 区县已经够了
    }
    return kept.join('·').trim();
  }

  // ── 平台词汇归一化 ────────────────────────────────────────────
  //
  // 经验/学历/公司规模/融资阶段/福利标签的值直接来自招聘平台原文，属业务内容，
  // 界面不翻译；归一化只把平台的写法收敏到 PRD 6.2.1 的枚举（对不上就原样保留，
  // 宁可存平台新词，也不丢信息）。
  const COMPANY_SIZE_ENUM = ['0-20', '20-99', '100-499', '500-999', '1000-9999', '10000+'];
  const COMPANY_STAGE_ENUM = ['未融资', '天使轮', 'A轮', 'B轮', 'C轮', 'D轮及以上', '已上市', '不需要融资'];
  const EXPERIENCE_TOKEN_RE = /(经验不限|应届|在校|\d+\s*[-~—－到至]\s*\d+\s*年|\d+\s*年[以上以内下]*|不限)/;
  const EDUCATION_TOKEN_RE = /(学历不限|大专|专科|高职|本科|学士|硕士|研究生|博士|中专|中技|高中|初中|MBA|EMBA|不限)/;

  function collapseText(value) {
    return (value || '').replace(/[\u00a0\s]+/g, '').trim();
  }

  function normalizeExperience(rawText) {
    const text = collapseText(rawText).replace(/[~～—－到至]/g, '-');
    if (!text) return '';
    if (/不限/.test(text)) return '不限';
    if (/应届|在校/.test(text)) return '应届';
    if (/1年以内|一年以内/.test(text)) return '1年以内';
    if (/10年以上/.test(text)) return '10年以上';
    if (/5-10年/.test(text)) return '5-10年';
    if (/3-5年/.test(text)) return '3-5年';
    if (/1-3年/.test(text)) return '1-3年';
    return text;  // 平台用词超出 PRD 枚举时原样保留
  }

  function normalizeEducation(rawText) {
    const text = collapseText(rawText);
    if (!text) return '';
    if (/不限/.test(text)) return '不限';
    if (/博士/.test(text)) return '博士';
    if (/硕士|研究生/.test(text)) return '硕士';
    if (/本科|学士/.test(text)) return '本科';
    if (/大专|专科|高职/.test(text)) return '大专';
    return text;
  }

  function normalizeCompanySize(rawText) {
    const text = collapseText(rawText).replace(/[~～—－到至]/g, '-');
    if (!text) return '';
    const range = text.match(/(\d+)\s*-\s*(\d+)/);
    if (range) return `${range[1]}-${range[2]}`;
    const above = text.match(/(\d+)\s*人以上/);
    if (above) return above[1] === '10000' ? '10000+' : `${above[1]}+`;
    return text;
  }

  // 只认已知融资阶段，认不出就返回空（用于从大段文本里挑，避免把整段文字当阶段）
  function matchCompanyStage(rawText) {
    const text = collapseText(rawText);
    if (!text) return '';
    const stage = COMPANY_STAGE_ENUM.find((item) => text.includes(item));
    if (stage) return stage;
    if (/不需要融资|无需融资/.test(text)) return '不需要融资';
    if (/未融资/.test(text)) return '未融资';
    if (/天使/.test(text)) return '天使轮';
    if (/上市/.test(text)) return '已上市';
    if (/[D-Z]轮/i.test(text)) return 'D轮及以上';
    const round = text.match(/([A-C])轮/i);
    return round ? `${round[1].toUpperCase()}轮` : '';
  }

  function normalizeCompanyStage(rawText) {
    const text = collapseText(rawText);
    if (!text) return '';
    return matchCompanyStage(text) || text;  // 平台新词原样保留
  }

  // 列表卡片的标签是混装的（经验、学历、福利、融资阶段放在同一个 tag-list），
  // 所以按内容分类而不是按位置取。
  function classifyJobTags(texts) {
    const out = {
      experience_req: '', education_req: '', company_size: '', company_stage: '', job_labels: [],
    };
    for (const raw of texts || []) {
      const text = (raw || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 20) continue;
      if (!out.experience_req && EXPERIENCE_TOKEN_RE.test(text)) {
        out.experience_req = normalizeExperience(text);
        continue;
      }
      if (!out.education_req && EDUCATION_TOKEN_RE.test(text)) {
        out.education_req = normalizeEducation(text);
        continue;
      }
      if (!out.company_size && /\d+\s*[-~—－]\s*\d+\s*人|\d+\s*人以上/.test(text)) {
        out.company_size = normalizeCompanySize(text);
        continue;
      }
      const stage = matchCompanyStage(text);
      if (!out.company_stage && stage) {
        out.company_stage = stage;
        continue;
      }
      if (out.job_labels.length < 20 && !out.job_labels.includes(text)) out.job_labels.push(text);
    }
    return out;
  }

  function collectTagTexts(root, selectorList) {
    const texts = [];
    for (const selector of asSelectorList(selectorList)) {
      for (const node of root.querySelectorAll(selector)) {
        const items = node.querySelectorAll('li, span, i, em');
        const nodes = items.length ? Array.from(items) : [node];
        for (const item of nodes) {
          const text = (item.textContent || '').replace(/\s+/g, ' ').trim();
          if (text) texts.push(text);
        }
      }
      if (texts.length) break;  // 精确选择器命中后不再叠加，避免同一批标签被取两次
    }
    return texts;
  }

  // 公司规模在详情页是散落的文本（“100-499人”），而且同一个块里就混着融资阶段
  // （“已上市 1000-9999人”），所以按模式取而不是直接信选择器命中的整段文字。
  function findCompanySize(rawText) {
    const text = (rawText || '').replace(/[\u00a0\s]+/g, ' ').trim();
    const size = text.match(/\d+\s*[-~—－]\s*\d+\s*人|\d+\s*人以上/);
    return size ? normalizeCompanySize(size[0]) : '';
  }

  // 公司规模/融资阶段在详情页是散落的文本（“100-499人 · 不需要融资”），
  // 按模式在文本块里找比逐个猜 class 更耐改版。
  function findCompanyFacts(rawText) {
    const text = (rawText || '').replace(/[\u00a0\s]+/g, ' ').trim();
    const out = { company_size: '', company_stage: '' };
    if (!text) return out;
    out.company_size = findCompanySize(text);
    // 只在前 200 字里找融资阶段：公司信息块很短，而 JD 正文里可能顺口提到“已上市”
    out.company_stage = matchCompanyStage(text.slice(0, 200));
    return out;
  }

  // ── C1：页面上下文接口采集（DOM 改版时的兼底） ────────────────────
  //
  // extension/boss-page-bridge.js（MAIN world）把页面自己发出的职位接口
  // 响应转发过来，这里负责校验与归一化。纪律：只接受「与当前页面职位 id 对得上」
  // 的载荷，因此页面上的第三方脚本无法凭空往本地库里写职位。
  const BOSS_API_LIMIT_PER_PAGE = 30;
  const BOSS_JOB_KEY_HINTS = [
    'jobName', 'jobTitle', 'salaryDesc', 'jobDescription', 'jobDesc',
    'brandName', 'encryptJobId', 'experienceName', 'degreeName',
  ];

  const bossApiJobs = new Map();  // 职位 id → 归一化后的接口数据

  function currentDetailJobIds(config) {
    const detail = config && config.detailPage;
    if (!detail || !detail.urlPattern.test(window.location.pathname)) return {};
    const match = window.location.pathname.match(/\/job_detail\/([^/?#]+?)(?:\.html)?$/);
    let securityId = '';
    try {
      securityId = new URL(window.location.href).searchParams.get('securityId') || '';
    } catch { securityId = ''; }
    return { pathId: match ? match[1] : '', securityId };
  }

  function stripHtmlText(value) {
    return (value || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/[\u00a0\s]+/g, ' ')
      .trim();
  }

  // 接口层级各版本不同（zpData.jobInfo / zpData.data.job / 列表 item），所以不硬编码
  // 路径：在有限深度里找「像职位」的对象（同时命中多个职位字段名）。
  function findJobLikeObjects(node, depth, out) {
    if (!node || typeof node !== 'object' || depth > 5 || out.length >= 50) return out;
    if (Array.isArray(node)) {
      for (const item of node) findJobLikeObjects(item, depth + 1, out);
      return out;
    }
    let hints = 0;
    for (const hint of BOSS_JOB_KEY_HINTS) {
      if (hint in node) hints += 1;
    }
    if (hints >= 2) out.push(node);
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') findJobLikeObjects(value, depth + 1, out);
    }
    return out;
  }

  function normalizeBossApiJob(job) {
    const pick = (...keys) => {
      for (const key of keys) {
        const value = job[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return '';
    };

    const out = {};
    const salaryText = pick('salaryDesc', 'salary');
    const title = cleanJobTitle(pick('jobName', 'jobTitle'), salaryText);
    if (title) out.title = title;                        // raw business content
    const company = cleanCompanyName(pick('brandName', 'companyName'));
    if (company) out.company = company;                  // raw business content
    Object.assign(out, parseSalaryText(salaryText));

    const city = pick('cityName', 'locationName', 'jobArea');
    const district = pick('areaDistrict', 'businessDistrict');
    const locationParts = city ? [city] : [];
    if (district && district !== city) locationParts.push(district);
    const location = locationParts.join('·');
    if (location) out.location = location;               // raw business content

    const experience = pick('experienceName', 'jobExperience', 'experience');
    if (experience) out.experience_req = normalizeExperience(experience);
    const education = pick('degreeName', 'jobDegree', 'education');
    if (education) out.education_req = normalizeEducation(education);
    const size = pick('brandScaleName', 'scaleName', 'companySize');
    if (size) out.company_size = normalizeCompanySize(size);
    const stage = pick('brandStageName', 'stageName', 'companyStage');
    if (stage) out.company_stage = normalizeCompanyStage(stage);

    // 福利优先取 welfareList；skills 是技能标签，不当福利存
    const labels = job.welfareList || job.jobLabels || job.labels;
    if (Array.isArray(labels)) {
      out.job_labels = labels
        .filter((label) => typeof label === 'string' && label.trim())
        .map((label) => label.trim().slice(0, 40))
        .slice(0, 20);
    }

    const description = stripHtmlText(pick('jobDescription', 'jobDesc', 'postDescription', 'description'));
    if (description) out.description = description.slice(0, 20000);

    return Object.keys(out).length ? out : null;
  }

  function extractBossApiJob(payload, responseUrl, pageIds = {}) {
    const candidates = findJobLikeObjects(payload, 0, []);
    if (!candidates.length) return null;

    const matchIds = [pageIds.pathId, pageIds.securityId].filter(Boolean);
    const idsOf = (job) => [job.encryptJobId, job.encryptId, job.jobId, job.securityId]
      .filter(Boolean).map(String);

    let pool = candidates.filter((job) => idsOf(job).some((id) => matchIds.includes(id)));
    if (!pool.length) {
      // 载荷不带 id 时，要求响应 URL 自己带着当前页面的职位 id；
      // 否则很可能是「相似职位/推荐位」的数据，宁可不采。
      const urlMatches = typeof responseUrl === 'string'
        && matchIds.some((id) => responseUrl.includes(id));
      if (matchIds.length && !urlMatches) return null;
      pool = candidates.filter((job) => (job.jobName || job.jobTitle)
        && (job.jobDescription || job.jobDesc || job.description));
      if (!pool.length) return null;
    }

    const best = pool.sort((a, b) => {
      const score = (job) => (job.jobDescription || job.jobDesc || job.description ? 2 : 0)
        + (job.jobName || job.jobTitle ? 1 : 0);
      return score(b) - score(a);
    })[0];
    return normalizeBossApiJob(best);
  }

  function initBossApiSniffer(config) {
    if (!config || !config.detailPage) return false;
    if (!/(^|\.)zhipin\.com$/.test(window.location.hostname)) return false;

    let accepted = 0;
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const message = event.data;
      if (!message || message.__cpBossApi !== true) return;
      if (accepted >= BOSS_API_LIMIT_PER_PAGE) return;

      const pageIds = currentDetailJobIds(config);
      const key = pageIds.pathId || pageIds.securityId;
      if (!key) return;  // 只在职位详情页接受

      const job = extractBossApiJob(message.payload, message.url, pageIds);
      if (!job) return;
      accepted += 1;
      bossApiJobs.set(key, { ...(bossApiJobs.get(key) || {}), ...job });
    });

    // 页面早期的响应被页面 world 缓冲着，这里主动要一次重投
    try {
      window.postMessage({ __cpBossApiRequest: true }, window.location.origin);
    } catch { /* 忽略 */ }
    return true;
  }

  function capturedBossApiJob(config) {
    const { pathId, securityId } = currentDetailJobIds(config);
    return bossApiJobs.get(pathId || securityId) || null;
  }

  // DOM 是用户眼前看到的东西，优先；接口数据补齐 DOM 采不到/改版采不到的字段。
  function mergeBossDetailData(domData, apiData) {
    if (!domData && !apiData) return null;
    const merged = { ...(apiData || {}), ...(domData || {}) };
    for (const [key, value] of Object.entries(apiData || {})) {
      const current = merged[key];
      const empty = current === undefined || current === ''
        || (Array.isArray(current) && current.length === 0);
      if (empty) merged[key] = value;
    }
    if (!merged.description) return null;  // 没有正文就没有采集价值
    return merged;
  }

  const JOB_BOARD_CONFIGS = {
    'linkedin.com': {
      name: 'LinkedIn', // i18n-audit-ignore: site name (proper noun), same in every language
      listingSelector: '.job-card-container, .jobs-search-results__list-item, .scaffold-layout__list-item',
      titleSelector: '.job-card-list__title, .job-card-container__link, a.job-card-list__title--link',
      companySelector: '.job-card-container__primary-description, .artdeco-entity-lockup__subtitle',
      locationSelector: '.job-card-container__metadata-item, .artdeco-entity-lockup__caption',
      getJobUrl: (card) => {
        const link = card.querySelector('a[href*="/jobs/view/"], a[href*="/jobs/collections/"]');
        if (!link) return null;
        try {
          const url = new URL(link.href, window.location.origin);
          url.search = '';
          url.hash = '';
          return url.href;
        } catch { return null; }
      },
    },
    'indeed.com': {
      name: 'Indeed',
      listingSelector: '.job_seen_beacon, .jobsearch-ResultsList .result, .tapItem',
      titleSelector: '.jobTitle a, h2.jobTitle span, .jcs-JobTitle span',
      companySelector: '.companyName, [data-testid="company-name"], .company_location .companyName',
      locationSelector: '.companyLocation, [data-testid="text-location"]',
      getJobUrl: (card) => {
        const link = card.querySelector('a[href*="/viewjob"], a[href*="/rc/clk"], a.jcs-JobTitle');
        if (!link) return null;
        try {
          const url = new URL(link.href, window.location.origin);
          url.search = '';
          url.hash = '';
          return url.href;
        } catch { return null; }
      },
    },
    'dice.com': {
      name: 'Dice',
      listingSelector: '[data-cy="search-card"], .card-content, dhi-search-card',
      titleSelector: 'a.card-title-link, [data-cy="card-title-link"]',
      companySelector: 'a[data-cy="search-result-company-name"], .card-company a',
      locationSelector: 'span[data-cy="search-result-location"], .card-posted-date',
      getJobUrl: (card) => {
        const link = card.querySelector('a[href*="/job-detail/"], a.card-title-link');
        if (!link) return null;
        try {
          const url = new URL(link.href, window.location.origin);
          url.search = '';
          url.hash = '';
          return url.href;
        } catch { return null; }
      },
    },
    'glassdoor.com': {
      name: 'Glassdoor',
      listingSelector: '.JobsList_jobListItem__wjTHv, li[data-test="jobListing"]',
      titleSelector: 'a[data-test="job-title"], .JobCard_jobTitle__GLyJ1',
      companySelector: '.EmployerProfile_compactEmployerName__9MGiV, .JobCard_companyName__N1YM5',
      locationSelector: '.JobCard_location__N_iYE, [data-test="emp-location"]',
      getJobUrl: (card) => {
        const link = card.querySelector('a[href*="/job-listing/"], a[data-test="job-title"]');
        if (!link) return null;
        try {
          const url = new URL(link.href, window.location.origin);
          url.search = '';
          url.hash = '';
          return url.href;
        } catch { return null; }
      },
    },
    'zhipin.com': {
      name: 'BOSS直聘', // i18n-audit-ignore: 站点名（专有名词），两种语言一致
      listingSelector: '.job-card-wrapper, .job-card-box, .job-list-box > li, li[class*="job-card"]',
      titleSelector: ['.job-name', '[class*="job-name"]', '.job-card-body h3', 'h3'],
      companySelector: [
        '.company-name a',
        '.company-name',
        '[class*="company-name"]',
        '.job-card-footer .name a',
        // 大改版时 class 会换，但指向公司主页的链接不会：这是最稳的一手
        'a[href*="/gongsi/"]',
      ],
      locationSelector: ['.job-area', '.job-area-wrapper', '[class*="job-area"]'],
      salarySelector: ['.job-salary', '.salary', '[class*="salary"]'],
      tagSelector: ['.tag-list li', '.tag-list', '.job-card-body .job-tags span'],
      companyTagSelector: ['.company-tag-list li', '.company-tag-list span', '.company-tag-list'],
      companyBlobSelector: ['.job-card-footer', '.company-info'],
      normalize: { title: true, company: true, location: true },
      getJobUrl: (card) => {
        const link = card.querySelector('a[href*="/job_detail/"]');
        if (!link) return null;
        return stableBoardUrl(link.getAttribute('href') || link.href);
      },
      captureDetailPage: true,
      detailPage: {
        urlPattern: /\/job_detail\//,
        containerSelector: ['.job-detail', '.job-detail-section', '.job-sec-container', '#main'],
        // 容器在旧版是 .job-detail，新版拆成了 .job-primary + 多个 .job-sec 区块，
        // 因此标题/公司名按"从最精确到最宽松"的顺序依次尝试。
        titleSelector: [
          '.job-primary .name h1',
          '.info-primary .name h1',
          '.job-detail-header h1',
          '.job-banner .name h1',
          '.job-primary .name',
          '.info-primary .name',
          '.job-banner .name',
          'h1',
        ],
        companySelector: [
          '.job-primary .company-info .name',
          '.info-company .company-info .name',
          '.company-info .name',
          '.sider-company .company-info .name',
          '.job-sider .company-info .name',
          '.job-sider .company',
          '.company-name',
          // 大改版时 class 全换，但指向公司主页的链接不会换
          'a[href*="/gongsi/"]',
        ],
        locationSelector: [
          '.job-primary .info-primary p',
          '.info-primary p',
          '.job-banner .job-place',
          '.job-place',
          '.location-address',
        ],
        salarySelector: [
          '.job-primary .salary',
          '.info-primary .salary',
          '.job-banner .salary',
          '.salary',
          '.job-salary',
        ],
        descriptionSelector: [
          '.job-sec-text',
          '.job-detail-section .job-sec-text',
          '[class*="job-sec-text"]',
          '.job-detail-content',
        ],
        descriptionHeadingKeywords: ['职位描述', '岗位职责', '工作职责', '职位要求'],
        // 详情页把「城市·经验·学历」串成一行，其余属性散在标签与公司信息块里
        metaSelector: ['.job-primary .info-primary p', '.info-primary p', '.job-banner .job-place', '.job-place'],
        tagSelector: ['.job-keyword-list li', '.job-tags li', '.job-tags span', '.tag-list li', '[class*="keyword"] li'],
        companyStageSelector: ['.company-info-other .company-info-item', '.company-tag-list li', '.company-tag-list span'],
        companySizeSelector: ['.company-info-other span', '.company-info .size', '[class*="scale"]'],
        companyBlobSelector: ['.job-sider', '.info-company', '.job-primary'],
        normalize: { title: true, company: true, location: true },
        getJobUrl: (loc) => stableBoardUrl(loc.href),
      },
    },
  };

  // 列表卡片与详情页的链接都带 lid / securityId 之类的会话参数，去掉后
  // 同一个职位在"卡片采集"和"详情页补 JD"两次回传中才是同一个 URL。
  function stableBoardUrl(rawUrl) {
    if (!rawUrl) return null;
    try {
      const url = new URL(rawUrl, window.location.origin);
      url.search = '';
      url.hash = '';
      const path = url.pathname.replace(/\/+$/, '');
      url.pathname = path || '/';
      return url.href;
    } catch { return null; }
  }

  function detectJobBoard() {
    const hostname = window.location.hostname;
    for (const [domain, config] of Object.entries(JOB_BOARD_CONFIGS)) {
      if (hostname.includes(domain)) {
        return config;
      }
    }
    return null;
  }

  function cardSalary(card, config) {
    if (config.salarySelector) return parseSalaryText(textOf(card, config.salarySelector));
    if (typeof config.parseSalary === 'function') return config.parseSalary(card) || {};
    return {};
  }

  function parseJobCard(card, config) {
    const titleEl = queryFirst(card, config.titleSelector);
    const url = config.getJobUrl(card);

    if (!titleEl || !url) return null;

    const rules = config.normalize || {};
    const salaryText = config.salarySelector ? textOf(card, config.salarySelector) : '';
    const rawTitle = (titleEl.innerText || titleEl.textContent || '').trim();
    // 列表是懒渲染的：骨架阶段的标题是空的。此时不能建按钮（payload 会被后端
    // 以「职位名称和公司为必填项」拒掉），返回 null 让下一轮扫描重新处理。
    if (!rawTitle) return null;
    const rawCompany = textOf(card, config.companySelector);
    const rawLocation = textOf(card, config.locationSelector);

    // 卡片上的 经验/学历/福利 混在同一个标签列表里，按内容分类
    const tags = classifyJobTags([
      ...collectTagTexts(card, config.tagSelector),
      ...collectTagTexts(card, config.companyTagSelector),
    ]);
    const companyFacts = config.companyBlobSelector
      ? findCompanyFacts(textOf(card, config.companyBlobSelector))
      : { company_size: '', company_stage: '' };

    return {
      title: rules.title ? cleanJobTitle(rawTitle, salaryText) : rawTitle,
      company: rules.company ? cleanCompanyName(rawCompany) : rawCompany,
      location: rules.location ? cleanLocation(rawLocation) : rawLocation,
      url,
      source: config.name,
      ...cardSalary(card, config),
      experience_req: tags.experience_req,
      education_req: tags.education_req,
      company_size: companyFacts.company_size || tags.company_size,
      company_stage: companyFacts.company_stage || tags.company_stage,
      job_labels: tags.job_labels,
    };
  }

  // 扩展被重新加载后，已经打开的页面里那份内容脚本就与扩展失联了：
  // chrome.runtime 还在，但 id 没了，任何消息都发不出去。重试无用，只能刷新页面。
  function extensionContextAlive() {
    try {
      return Boolean(chrome && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function markSaveButtonRetryable(btn, reason) {
    btn.textContent = t('overlay.errorRetry');
    btn.classList.remove(`${OVERLAY_PREFIX}-saving`);
    btn.classList.add(`${OVERLAY_PREFIX}-error`);
    btn.disabled = false;
    if (reason) {
      btn.title = reason;
      showToast(t('overlay.saveFailed', { reason }), 'error');
    }
  }

  function markSaveButtonDone(btn) {
    btn.textContent = t('overlay.saved');
    btn.classList.remove(`${OVERLAY_PREFIX}-saving`, `${OVERLAY_PREFIX}-error`);
    btn.classList.add(`${OVERLAY_PREFIX}-saved`);
    btn.disabled = true;
    btn.removeAttribute('title');
  }

  function isCardSaved(card) {
    const btn = card.querySelector(`.${OVERLAY_PREFIX}-save-btn`);
    return Boolean(btn && btn.classList.contains(`${OVERLAY_PREFIX}-saved`));
  }

  // 卡片保存的唯一入口：右上角按钮和「一键抓取本页岗位」走同一条链路，
  // 保证按钮状态、匹配分角标与统计口径始终一致。
  // 返回 'saved' | 'failed' | 'stale'（内容脚本与扩展失联，只能刷新页面）| 'skipped'。
  async function submitJobCard(jobData, card, btn) {
    if (!extensionContextAlive()) {
      // 提示刷新而不是「重试」：这种情况下重试永远不会成功
      markSaveButtonRetryable(btn, '');
      showToast(t('overlay.refreshRequired'), 'error');
      return 'stale';
    }

    btn.disabled = true;
    btn.textContent = t('overlay.saving');
    btn.classList.add(`${OVERLAY_PREFIX}-saving`);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'saveJob',
        jobData,
      });

      if (response && response.ok) {
        if (response.data?.created === false) {
          // 后端认出来是已在库里的职位（详情页补采时很常见）
          markSaveButtonDone(btn);
          if (response.data?.score != null) showScoreBadge(card, response.data.score);
          return 'skipped';
        }
        markSaveButtonDone(btn);
        if (response.data?.score != null) {
          showScoreBadge(card, response.data.score);
        }
        return 'saved';
      }

      // 把后端的错误码翻成中文原因（如「职位名称和公司为必填项」），
      // 别再让用户面对一个无信息量的「出错了」
      const reason = response && (response.code || response.detail)
        ? (typeof extErrorMessage === 'function' ? extErrorMessage(response) : response.detail)
        : (response && response.error) || '';
      markSaveButtonRetryable(btn, reason);
      return 'failed';
    } catch (err) {
      if (/extension context invalidated|message port closed|receiving end does not exist/i.test(err?.message || '')) {
        markSaveButtonRetryable(btn, '');
        showToast(t('overlay.refreshRequired'), 'error');
        return 'stale';
      }
      markSaveButtonRetryable(btn, typeof extErrorMessage === 'function' ? extErrorMessage(err) : '');
      return 'failed';
    }
  }

  function createSaveButton(jobData, card) {
    const existing = card.querySelector(`.${OVERLAY_PREFIX}-save-btn`);
    if (existing) return existing;

    const btn = document.createElement('button');
    btn.className = `${OVERLAY_PREFIX}-save-btn`;
    btn.textContent = t('overlay.saveToCareerPulse');
    btn.title = t('overlay.saveButtonTitle');

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await submitJobCard(jobData, card, btn);
    });

    const wrapper = document.createElement('div');
    wrapper.className = `${OVERLAY_PREFIX}-actions`;
    wrapper.appendChild(btn);
    card.style.position = card.style.position || 'relative';
    card.appendChild(wrapper);

    return btn;
  }

  function showScoreBadge(card, score) {
    let badge = card.querySelector(`.${OVERLAY_PREFIX}-score-badge`);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = `${OVERLAY_PREFIX}-score-badge`;
      card.style.position = card.style.position || 'relative';
      card.appendChild(badge);
    }

    const numScore = Math.round(Number(score));
    badge.textContent = `${numScore}%`;
    badge.title = t('a11y.matchScoreTitle', { score: numScore });

    badge.classList.remove(
      `${OVERLAY_PREFIX}-score-high`,
      `${OVERLAY_PREFIX}-score-mid`,
      `${OVERLAY_PREFIX}-score-low`
    );

    if (numScore >= 75) {
      badge.classList.add(`${OVERLAY_PREFIX}-score-high`);
    } else if (numScore >= 50) {
      badge.classList.add(`${OVERLAY_PREFIX}-score-mid`);
    } else {
      badge.classList.add(`${OVERLAY_PREFIX}-score-low`);
    }
  }

  // 列表是虚拟滚动的：同一个 <li> 会被回收给别的职位，只看 "已处理" 标记
  // 会把上一个职位的按钮和匹配分留在新职位上。
  function resetCardOverlay(card) {
    card.querySelectorAll(`.${OVERLAY_PREFIX}-actions, .${OVERLAY_PREFIX}-score-badge`)
      .forEach((el) => el.remove());
  }

  async function processJobCards(config) {
    const cards = document.querySelectorAll(config.listingSelector);
    if (!cards.length) return;

    for (const card of cards) {
      const jobData = parseJobCard(card, config);
      if (!jobData) continue;

      // 签名包含标题与公司：虚拟滚动回收节点、或懒渲染后把内容补齐时，
      // 都要重新处理（否则按钮挂在旧数据上，点了必然被后端拒掉）。
      const signature = [jobData.url, jobData.title, jobData.company].join('|');
      if (card.dataset.cpProcessed === signature) continue;
      if (card.dataset.cpProcessed) resetCardOverlay(card);
      card.dataset.cpProcessed = signature;
      card.dataset.cpProcessedUrl = jobData.url;

      try {
        const lookupResp = await chrome.runtime.sendMessage({
          type: 'getScoreForUrl',
          url: jobData.url,
        });

        const data = (lookupResp && lookupResp.ok && lookupResp.data) || null;
        // 后端对未收录的职位返回 {found:false}（HTTP 200），只判断 data 是否存在
        // 会把每个新职位都画成"已保存"，按钮从此点不动。
        const found = Boolean(data && (data.found === true || data.job_id != null));

        if (found) {
          const btn = createSaveButton(jobData, card);
          btn.textContent = t('overlay.saved');
          btn.classList.add(`${OVERLAY_PREFIX}-saved`);
          btn.disabled = true;

          if (data.score != null) {
            showScoreBadge(card, data.score);
          }
        } else {
          createSaveButton(jobData, card);
        }
      } catch {
        createSaveButton(jobData, card);
      }
    }
  }

  let scanTimer = null;

  function scheduleScan(config) {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => processJobCards(config), SCAN_DEBOUNCE_MS);
  }

  // ─── 一键抓取本页岗位 ─────────────────────────────────────────
  //
  // 网页端的「立即抓取」按钮会请求扩展采集（见 app/routers/capture.py），
  // 这里提供真正的执行体：把**当前页面上已经渲染出来**的卡片一次性全部回传。
  // 只动用户眼前看得到的内容：不翻页、不滚屏、不发任何平台请求。

  // PRD §5.2：单次会话最多采集 100 条
  const BULK_CAPTURE_LIMIT = 100;
  // 并发几路回传：本地服务写一条约 10ms，真正的成本是消息往返。
  //
  // 这里**刻意不用 setTimeout 做节流**：用户点网页上的「立即抓取」时，BOSS 标签页
  // 是隐藏的，而 Chrome 会把隐藏页面的定时器降到 1 秒一次 —— 45 张卡片就会从
  // 6 秒变成 45 秒，网页端等不到结果只能报超时。改成并发：既不碰定时器，
  // 又比串行更快。
  const BULK_CAPTURE_CONCURRENCY = 3;
  // 进度上报节流（毫秒）：网页端靠它区分「在跑」与「卡住」
  const BULK_PROGRESS_REPORT_MS = 800;

  let bulkCaptureInFlight = false;

  function collectVisibleJobCards(config, limit = BULK_CAPTURE_LIMIT) {
    if (!config || !config.listingSelector) return [];
    const seen = new Set();
    const entries = [];
    for (const card of document.querySelectorAll(config.listingSelector)) {
      const jobData = parseJobCard(card, config);
      if (!jobData || !jobData.url || seen.has(jobData.url)) continue;
      seen.add(jobData.url);
      entries.push({ card, jobData });
      if (entries.length >= limit) break;
    }
    return entries;
  }

  // 便宜的存在性检查（不走完整解析）：认领请求要带上「本页到底有没有职位卡片」，
  // 而详情页上的内容脚本也在轮询 —— 让一个采不到东西的标签领走请求，用户只会
  // 得到一句「没采到职位」，却不知道原因。
  function hasVisibleCards(config) {
    if (!config || !config.listingSelector) return false;
    try {
      return document.querySelector(config.listingSelector) !== null;
    } catch {
      return false;
    }
  }

  async function captureVisibleJobs(config, options = {}) {
    const entries = collectVisibleJobCards(config, options.limit || BULK_CAPTURE_LIMIT);
    const summary = { total: entries.length, saved: 0, skipped: 0, failed: 0, reason: null };
    if (!entries.length) {
      // 空手而归也要说清楚为什么：网页据此提示「当前页面不是职位列表页」
      summary.reason = 'no_listing';
      return summary;
    }

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const concurrency = Math.max(1, Math.min(
      options.concurrency || BULK_CAPTURE_CONCURRENCY, entries.length
    ));

    const queue = entries.slice();
    let stale = false;
    let lastReport = 0;

    function report(force) {
      if (!onProgress) return;
      const now = Date.now();
      if (!force && now - lastReport < BULK_PROGRESS_REPORT_MS) return;
      lastReport = now;
      onProgress({ ...summary });
    }

    async function worker() {
      while (!stale && queue.length) {
        const { card, jobData } = queue.shift();
        // 已经查过库、显示「已保存」的卡片直接跳过，不重复回传
        if (isCardSaved(card)) {
          summary.skipped++;
          report();
          continue;
        }
        const btn = card.querySelector(`.${OVERLAY_PREFIX}-save-btn`)
          || createSaveButton(jobData, card);
        const result = await submitJobCard(jobData, card, btn);
        if (result === 'saved') summary.saved++;
        else if (result === 'skipped') summary.skipped++;
        else if (result === 'stale') {
          // 扩展上下文已失联：剩下的卡片也不会有救，直接收摊。
          // 这一张也算失败：它确实没进库。
          summary.failed++;
          stale = true;
          break;
        } else summary.failed++;
        report();
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (stale) summary.failed += queue.length;
    report(true);
    return summary;
  }

  function bulkSummaryText(summary) {
    let text = t('overlay.bulkResult', { saved: summary.saved, skipped: summary.skipped });
    if (summary.failed) text += t('overlay.bulkFailed', { count: summary.failed });
    return text;
  }

  async function runVisibleCapture(config, onProgress) {
    if (bulkCaptureInFlight) return null;
    if (!extensionContextAlive()) {
      showToast(t('overlay.refreshRequired'), 'error');
      return null;
    }
    bulkCaptureInFlight = true;
    let summary = null;
    try {
      if (onProgress) onProgress(true);
      // 页面上的悬浮面板同时变成进度牌：抓取途中显示「已回传 X/N」，
      // 用户不用等到最后一刻才知道进行到哪儿了。弹窗入口也走这条路，所以同样可见。
      beginCaptureProgress();
      summary = await captureVisibleJobs(config, { onProgress: updateCaptureProgress });
      showToast(
        summary.total
          ? bulkSummaryText(summary)
          : t('overlay.bulkNothing'),
        summary.saved ? 'success' : 'info'
      );
      return summary;
    } finally {
      bulkCaptureInFlight = false;
      if (onProgress) onProgress(false);
      endCaptureProgress(summary, config);
    }
  }

  // 扩展弹窗里的「立即抓取」（popup.js）：与页面左下角按钮共用同一条执行链路，
  // 只是把统计结果回传给弹窗。采集仍然发生在当前页面：不翻页、不滚屏、不发平台请求。
  async function captureCurrentPage() {
    const config = detectJobBoard();
    if (!config || !config.listingSelector) {
      return { ok: false, code: 'capture.unsupported_site' };
    }
    // 两个入口共用一个开关：页面上已经在抓时，再点一次只会重复回传同一批职位
    if (bulkCaptureInFlight) return { ok: false, code: 'capture.busy' };
    const summary = await runVisibleCapture(config);
    if (!summary) return { ok: false, code: 'capture.busy' };
    return { ok: true, summary };
  }

  // ─── 悬浮面板上的「一键抓取」行 ───────────────────────────────
  //
  // 抓取入口在常驻面板里（见下面的 Job-board panel），这里只管它的文案与状态：
  // 空闲时是本页卡片数，抓取途中是「已回传 X/N」，结束后把最终进度留几秒。

  const CAPTURE_RESULT_LINGER_MS = 5000;  // 抓完先把结果停在面板上，再退回计数

  let bulkButtonTimer = null;        // 卡片数重算的防抖
  let captureProgress = null;        // 抓取途中最近一次进度快照
  let captureResultSummary = null;   // 抓取结束后停在面板上的最终进度
  let captureResultTimer = null;

  function captureProgressText(summary) {
    const done = summary.saved + summary.skipped + summary.failed;
    return t('overlay.bulkProgress', { done, total: summary.total });
  }

  // 开始/进度/结束都只是改状态再重绘面板（paintPanel 是幂等的）
  function beginCaptureProgress() {
    if (captureResultTimer) { clearTimeout(captureResultTimer); captureResultTimer = null; }
    captureProgress = null;
    captureResultSummary = null;
    paintPanel();
  }

  // captureVisibleJobs 每回传完几张就回调一次：面板同步成「已回传 X/N」
  function updateCaptureProgress(progress) {
    if (!progress) return;
    captureProgress = progress;
    paintPanel();
  }

  function endCaptureProgress(summary, config) {
    if (captureResultTimer) { clearTimeout(captureResultTimer); captureResultTimer = null; }
    const hasProgress = Boolean(summary && captureProgress);
    captureProgress = null;
    captureResultSummary = hasProgress ? summary : null;
    paintPanel();
    if (!hasProgress) return;
    captureResultTimer = setTimeout(() => {
      captureResultTimer = null;
      captureResultSummary = null;
      syncPanelCapture(config);
    }, CAPTURE_RESULT_LINGER_MS);
  }

  // 面板上的抓取按钮：没有卡片时置灰并说明原因，不用用户猜
  async function runPanelCapture() {
    const result = await captureCurrentPage();
    if (!result || result.ok !== false) return;
    // 真正开抓时的反馈由 runVisibleCapture 负责，这里只补上「没开成」的原因
    if (result.code === 'capture.busy') showToast(t('errors.captureBusy'), 'info');
    else if (result.code === 'capture.unsupported_site') showToast(t('errors.captureUnsupportedSite'), 'error');
  }

  function syncPanelCapture(config) {
    panelState.cardCount = config && config.listingSelector
      ? collectVisibleJobCards(config).length
      : 0;
    // 页面每次变动都顺带重判一次表单可用性：晚出现的表单要自己把按钮点亮
    panelState.hasForm = pageHasApplicationForm();
    paintPanel();
    // 打开页面时服务还没起来的话，面板会一直停在「无法连接」：低频复检一次
    if (panelState.connected !== true
      && Date.now() - lastPanelConnectionCheck > PANEL_CONNECTION_RETRY_MS) {
      checkPanelConnection();
    }
  }

  // 页面是无限滚动的：卡片随时会变多/变少，防抖后重算面板上的数量
  function schedulePanelSync(config) {
    if (bulkButtonTimer) clearTimeout(bulkButtonTimer);
    bulkButtonTimer = setTimeout(() => syncPanelCapture(config), SCAN_DEBOUNCE_MS);
  }

  // 网页端「立即抓取」→ 服务端建一次采集请求 → 扩展轮询认领并在当前页面执行。
  // 轮询只在识别出的招聘页面上运行（initJobBoardOverlay 里启动）。
  const CAPTURE_POLL_MS = 3000;

  let capturePollTimer = null;

  async function pollCaptureRequest(config) {
    if (bulkCaptureInFlight) return;
    // 带上「本页有没有职位卡片」：没有的话服务端不会把请求派给这个标签，
    // 但这次调用仍然算心跳，网页因此能说出「扩展在，只是页面不对」。
    const hasListing = hasVisibleCards(config);
    let resp = null;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'claimCaptureRequest', hasListing });
    } catch (err) {
      // 扩展上下文失联（重载过扩展）→ 停止轮询，刷新页面后会重新启动
      if (/extension context invalidated|message port closed|receiving end does not exist/i.test(err?.message || '')) {
        stopCaptureRequestPolling();
      }
      return;
    }
    if (!resp || !resp.ok || !resp.data) return;
    // 只认 `pending`：另一个标签认走之后，这里会拿到 pending=false + status=capturing
    // （心跳式的重复轮询），跟着动手就会把同一批职位抓两遍。
    if (resp.data.pending !== true || !resp.data.request_id) return;

    const requestId = resp.data.request_id;
    let summary = { total: 0, saved: 0, skipped: 0, failed: 0, reason: null };
    bulkCaptureInFlight = true;
    try {
      beginCaptureProgress();
      // 一次采集可能要几十秒（页面卡片多）：把进度报给服务端，网页端就不会
      // 因为「太久没动静」而把一次正常采集判成超时；面板上顺手也刷一下进度。
      summary = await captureVisibleJobs(config, {
        onProgress: (progress) => {
          updateCaptureProgress(progress);
          try {
            chrome.runtime
              .sendMessage({ type: 'reportCaptureProgress', requestId, summary: progress })
              .catch(() => {});
          } catch { /* 进度报不上去不影响本地采集 */ }
        },
      });
    } catch (err) {
      console.warn('[CareerPulse] capture request failed:', err?.message || err);
    } finally {
      bulkCaptureInFlight = false;
      endCaptureProgress(summary, config);
    }

    try {
      await chrome.runtime.sendMessage({
        type: 'completeCaptureRequest',
        requestId,
        summary,
        pageUrl: window.location.href, // raw business content (当前页面地址)
      });
    } catch { /* 回执发不出去不影响本地已保存的职位 */ }
  }

  function startCaptureRequestPolling(config) {
    if (capturePollTimer) return;
    capturePollTimer = setInterval(() => pollCaptureRequest(config), CAPTURE_POLL_MS);
  }

  function stopCaptureRequestPolling() {
    if (capturePollTimer) clearInterval(capturePollTimer);
    capturePollTimer = null;
  }

  function initJobBoardOverlay() {
    const config = detectJobBoard();
    if (!config) return;

    processJobCards(config);
    // 进了支持的招聘站点就把面板浮出来：用户不用再点扩展图标
    showJobBoardPanel(config);
    startCaptureRequestPolling(config);

    const observer = new MutationObserver((records) => {
      // 面板自己的重绘（改文案、改计数）也会产生记录：不滤掉的话每次重绘都再排一轮
      // 扫描 + 重绘，页面停着不动也会每 SCAN_DEBOUNCE_MS 空转一次
      if (overlayEl && records.every((record) => overlayEl.contains(record.target))) return;
      scheduleScan(config);
      schedulePanelSync(config);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    if (config.captureDetailPage) {
      // 先装接口嗅探再采：页面早期的接口响应会被重投，采集循环下一轮就能用上
      initBossApiSniffer(config);
      captureDetailPage(config);
      watchDetailNavigation(config);
    }
  }

  // ─── Detail-page capture (JD) ─────────────────────────────────

  const DETAIL_CAPTURE_ATTEMPTS = 15;
  const DETAIL_CAPTURE_INTERVAL_MS = 1000;
  const PAGE_URL_POLL_MS = 1000;

  let detailCapturedUrl = null;
  let detailCaptureInFlight = null;
  let pageUrlTimer = null;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 站点改版可能把描述容器的 class 整个换掉；退化为"按小标题找正文"。
  function findDescriptionByHeading(keywords) {
    if (!keywords || !keywords.length) return '';
    const headings = document.querySelectorAll('h1, h2, h3, h4, dt, [class*="title"], [class*="sec-title"]');
    for (const heading of headings) {
      const headingText = (heading.textContent || '').trim();
      if (!headingText || !keywords.some((keyword) => headingText.includes(keyword))) continue;
      const parent = heading.parentElement;
      if (!parent) continue;
      const body = (parent.innerText || parent.textContent || '').trim();
      if (body.length >= 60) return body;
    }
    return '';
  }

  // class 全换掉之后，「城市·经验·学历」那一行的形态还认得出来：很短、带 ·、
  // 且含经验或学历词。只在精确选择器落空时才走这条路。
  function findMetaLineText() {
    for (const el of document.querySelectorAll('p, div, span, li')) {
      if (el.querySelector('p, div, span, ul, li')) continue;  // 只看叶子节点
      const text = (el.textContent || '').replace(/[\u00a0\s]+/g, ' ').trim();
      if (!text || text.length > 60 || !text.includes('·')) continue;
      if (!EXPERIENCE_TOKEN_RE.test(text) && !EDUCATION_TOKEN_RE.test(text)) continue;
      return text;
    }
    return '';
  }

  function extractDetailPageData(config) {
    const detail = config.detailPage;
    if (!detail) return null;
    if (!detail.urlPattern.test(window.location.pathname)) return null;

    const container = queryFirst(document, detail.containerSelector) || document;

    const descriptionEl = queryFirst(container, detail.descriptionSelector, document);
    let description = (descriptionEl?.innerText || descriptionEl?.textContent || '').trim();
    if (!description) description = findDescriptionByHeading(detail.descriptionHeadingKeywords);
    if (!description) return null;

    const rules = detail.normalize || {};
    const salaryText = textOf(container, detail.salarySelector, document);
    const rawTitle = textOf(container, detail.titleSelector, document);
    const rawCompany = textOf(container, detail.companySelector, document);
    const rawLocation = textOf(container, detail.locationSelector, document);

    // 「北京·朝阳区 ·3-5年 ·本科」这一行同时含地点与经验/学历，按内容分类
    const metaText = (detail.metaSelector ? textOf(container, detail.metaSelector, document) : '')
      || findMetaLineText();
    const metaTags = classifyJobTags(metaText.split('·'));
    // 标签不绑在 JD 容器里：改版后容器可能只剩一个职位描述区块，标签在另一个区块
    const tags = classifyJobTags(collectTagTexts(document, detail.tagSelector));

    const stageText = detail.companyStageSelector
      ? textOf(container, detail.companyStageSelector, document) : '';
    const sizeText = detail.companySizeSelector
      ? textOf(container, detail.companySizeSelector, document) : '';
    const companyBlob = detail.companyBlobSelector
      ? textOf(container, detail.companyBlobSelector, document) : '';
    const blobFacts = findCompanyFacts(companyBlob);

    const data = {
      url: detail.getJobUrl(window.location),
      description: description.slice(0, 20000),
    };
    const title = rules.title ? cleanJobTitle(rawTitle, salaryText) : rawTitle;
    if (title) data.title = title; // raw business content
    const company = rules.company ? cleanCompanyName(rawCompany) : rawCompany;
    if (company) data.company = company; // raw business content
    // meta 行里剩下的片段就是地点（“北京·朝阳区 ·3-5年 ·本科” → 北京·朝阳区）
    const location = metaTags.job_labels.slice(0, 2).join('·') || cleanLocation(rawLocation);
    if (location) data.location = location; // raw business content
    Object.assign(data, parseSalaryText(salaryText));

    // 平台原文（经验/学历/规模/融资阶段/福利），界面不翻译
    data.experience_req = metaTags.experience_req || tags.experience_req;
    data.education_req = metaTags.education_req || tags.education_req;
    data.company_size = findCompanySize(sizeText) || tags.company_size || blobFacts.company_size;
    data.company_stage = normalizeCompanyStage(stageText) || tags.company_stage || blobFacts.company_stage;
    data.job_labels = tags.job_labels;
    return data;
  }

  async function captureDetailPage(config, options = {}) {
    const detail = config.detailPage;
    if (!detail) return false;

    const attempts = options.attempts || DETAIL_CAPTURE_ATTEMPTS;
    const intervalMs = options.intervalMs || DETAIL_CAPTURE_INTERVAL_MS;
    const stableUrl = detail.getJobUrl(window.location);
    if (!stableUrl || stableUrl === detailCapturedUrl || detailCaptureInFlight === stableUrl) return false;

    detailCaptureInFlight = stableUrl;
    try {
      // 详情页正文可能是前端异步拉取渲染的（BOSS 直聘会先出骨架再补 JD），
      // 只等一次 800ms 就放弃会让大部分职位详情丢掉 JD。
      let data = null;
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (detail.getJobUrl(window.location) !== stableUrl) return false; // 已经跳走
        // DOM 优先（用户看到的就是这个），采不到字段时由页面接口数据补齐；
        // class 全改版的页面上 DOM 会整个失效，此时接口数据是唯一来源。
        data = mergeBossDetailData(
          extractDetailPageData(config),
          capturedBossApiJob(config),
        );
        if (data) break;
        if (attempt < attempts - 1) await delay(intervalMs);
      }
      if (!data) return false;

      detailCapturedUrl = stableUrl;

      const lookup = await chrome.runtime.sendMessage({
        type: 'getScoreForUrl',
        url: stableUrl,
      });

      const known = lookup && lookup.ok && lookup.data && lookup.data.found !== false && lookup.data.job_id;
      const payload = {
        ...data,
        url: stableUrl,
        source: config.name,
      };
      if (!known && (!payload.title || !payload.company)) {
        detailCapturedUrl = null;
        return false;
      }

      const response = await chrome.runtime.sendMessage({ type: 'saveJob', jobData: payload });
      if (response && response.ok) {
        showToast(t('overlay.detailSaved'), 'success');
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[CareerPulse] captureDetailPage failed:', err.message);
      detailCapturedUrl = null;
      return false;
    } finally {
      if (detailCaptureInFlight === stableUrl) detailCaptureInFlight = null;
    }
  }

  // BOSS 直聘是单页应用：从搜索列表点进详情、或在详情页之间跳转都不会重新加载
  // content script，只有监听 URL 变化才能补采到 JD。
  function watchDetailNavigation(config) {
    if (pageUrlTimer || !config.detailPage) return;
    let lastDetailUrl = config.detailPage.getJobUrl(window.location);

    pageUrlTimer = setInterval(() => {
      const detailUrl = config.detailPage.getJobUrl(window.location);
      if (detailUrl === lastDetailUrl) return;
      lastDetailUrl = detailUrl;
      if (detailUrl) {
        captureDetailPage(config);
      } else {
        scheduleScan(config);  // 回到列表页，重新注入按钮
      }
    }, PAGE_URL_POLL_MS);
  }

  // Run job board overlay detection (separate from the auto-fill badge)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initJobBoardOverlay);
  } else {
    setTimeout(initJobBoardOverlay, 300);
  }

  // ─── Export for testing ────────────────────────────────────────

  if (typeof window !== 'undefined' && window.__cpAutofillTest) {
    window.__cpAutofillTestAPI = {
      extractFormData,
      resolveElement,
      fillField,
      findTypeaheadDropdown,
      getDropdownOptions,
      fuzzyMatchDropdownOption,
      fuzzyMatchOption,
      getFieldHints,
      enrichFieldHints,
      looksLikePhoneNumber,
      isPhoneField,
      isPhoneExtensionField,
      isPhoneCountryCodeField,
      hasNearbyPhoneCountryCode,
      isDateField,
      parseFlexibleDate,
      fillDateField,
      isRichTextEditor,
      findRichTextEditor,
      fillRichText,
      isCustomDropdownTrigger,
      handleCustomDropdown,
      typeAndSelectDropdown,
      dismissOpenDropdowns,
      deepQuerySelectorAll,
      deepQuerySelector,
      simulateTyping,
      isElementVisible,
      buildSelector,
      findLabel,
      setNativeValue,
      dispatchEvents,
      clickOption,
      serializeFormHtml,
      fillForm,
      fuzzyMatchQA,
      applyCustomQA,
      detectApplicationForm,
      showBadge,
      removeBadge,
      tryShowBadge,
      undoField,
      originalValues,
      detectFileUploadFields,
      showUploadHelper,
      detectUploadType,

      startMultiPageTracking,
      stopMultiPageTracking,

      // Auto-track API
      showToast,
      autoTrackApplied,
      get autoTrackFired() { return autoTrackFired; },
      set autoTrackFired(v) { autoTrackFired = v; },

      // Job board overlay API
      detectJobBoard,
      parseJobCard,
      createSaveButton,
      submitJobCard,
      showScoreBadge,
      processJobCards,
      initJobBoardOverlay,
      collectVisibleJobCards,
      captureVisibleJobs,
      hasVisibleCards,
      BULK_CAPTURE_CONCURRENCY,
      runVisibleCapture,
      captureCurrentPage,
      // 常驻悬浮面板（招聘站点上用来自动展示扩展面板）
      showJobBoardPanel,
      renderPanel,
      paintPanel,
      checkPanelConnection,
      syncPanelCapture,
      runPanelCapture,
      clampPanelPosition,
      setPanelCollapsed,
      PANEL_CAPTURE_BTN_ID,
      PANEL_POSITION_KEY,
      PANEL_COLLAPSED_KEY,
      get panelState() { return panelState; },
      startCaptureRequestPolling,
      stopCaptureRequestPolling,
      pollCaptureRequest,
      get bulkCaptureInFlight() { return bulkCaptureInFlight; },
      get capturePolling() { return Boolean(capturePollTimer); },
      get BULK_CAPTURE_LIMIT() { return BULK_CAPTURE_LIMIT; },
      JOB_BOARD_CONFIGS,
      extractDetailPageData,
      captureDetailPage,
      watchDetailNavigation,
      initBossApiSniffer,
      extractBossApiJob,
      normalizeBossApiJob,
      mergeBossDetailData,
      get capturedBossApiJobs() { return bossApiJobs; },
      parseSalaryText,
      cleanJobTitle,
      cleanCompanyName,
      cleanLocation,
      queryFirst,
      textOf,

      // Queue fill API
      showQueueBanner,
      removeQueueBanner,
      handleQueueAction,
      startQueueFill,
      get queueContext() { return queueContext; },
      set queueContext(v) { queueContext = v; },

      // Timeout / flow internals for testing
      get API_TIMEOUT_MS() { return API_TIMEOUT_MS; },
      withTimeout,
      startFillFlow,
      getNewMappings,
      updateOverlay,
    };
  }

})();
