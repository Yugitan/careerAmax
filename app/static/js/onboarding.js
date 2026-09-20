// === Onboarding Wizard ===

const ONBOARDING_KEY = 'careerpulse_onboarded';

function isOnboardingDone() {
    return localStorage.getItem(ONBOARDING_KEY) === 'true';
}

function markOnboardingDone() {
    localStorage.setItem(ONBOARDING_KEY, 'true');
}

async function checkSetupCompleteness() {
    try {
        const [profile, resumesData, aiSettings] = await Promise.all([
            api.request('GET', '/api/profile'),
            api.request('GET', '/api/resumes'),
            api.getAISettings(),
        ]);
        const steps = {
            profile: !!(profile.full_name && profile.email),
            resume: (resumesData.resumes || []).length > 0,
            ai: !!(aiSettings.provider && (aiSettings.api_key || aiSettings.provider === 'ollama')),
        };
        const done = Object.values(steps).filter(Boolean).length;
        const total = Object.keys(steps).length;
        return { steps, done, total, complete: done === total };
    } catch {
        return { steps: {}, done: 0, total: 3, complete: false };
    }
}

async function updateSetupIndicator() {
    const existing = document.getElementById('setup-indicator');
    if (existing) existing.remove();

    const status = await checkSetupCompleteness();
    if (status.complete) {
        markOnboardingDone();
        return;
    }

    const settingsLink = document.querySelector('.nav-link[data-route="settings"]');
    if (settingsLink) {
        const indicator = document.createElement('span');
        indicator.id = 'setup-indicator';
        indicator.className = 'setup-indicator';
        indicator.textContent = `${status.done}/${status.total}`;
        indicator.title = t('onboarding.setupIndicator');
        settingsLink.style.position = 'relative';
        settingsLink.appendChild(indicator);
    }
}

/**
 * Register an unsaved-changes check for the wizard's in-progress inputs.
 * Deferred with `setTimeout` because `handleRoute()` calls `clearDirtyChecks()`
 * synchronously on initial load and after a language switch; deferring lets the
 * check land after that cleanup while the wizard is still open.
 */
function scheduleWizardDirtyCheck() {
    if (typeof registerDirtyCheck !== 'function') return;
    setTimeout(() => {
        registerDirtyCheck(() => {
            const wizard = document.getElementById('onboarding-wizard');
            if (!wizard) return false;
            return !!(
                (wizard.querySelector('#onb-name')?.value || '').trim() ||
                (wizard.querySelector('#onb-email')?.value || '').trim() ||
                (wizard.querySelector('#onb-location')?.value || '').trim() ||
                (wizard.querySelector('#onb-provider')?.value || '') ||
                (wizard.querySelector('#onb-api-key')?.value || '').trim()
            );
        });
    }, 0);
}

function showOnboardingWizard() {
    const state = {
        currentStep: 0,
        stepData: { name: '', email: '', location: '' },
        aiData: { provider: '', apiKey: '', ollamaUrl: 'http://localhost:11434' },
    };

    const wizard = document.createElement('div');
    wizard.id = 'onboarding-wizard';
    // Expose the wizard's mutable state so `rerenderOnboarding()` can re-render
    // the current step without resetting the user's progress or typed input.
    wizard.__onboardingState = state;

    function renderStep() {
        const steps = [renderStep1, renderStep2, renderStep3, renderStep4];
        const dots = [0, 1, 2, 3].map(i =>
            `<div class="onboarding-step-dot ${i === state.currentStep ? 'active' : (i < state.currentStep ? 'done' : '')}"></div>`
        ).join('');

        wizard.innerHTML = `
            <div class="modal-overlay">
                <div class="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
                    <div class="onboarding-steps">${dots}</div>
                    <div id="onboarding-step-content">${steps[state.currentStep]()}</div>
                </div>
            </div>
        `;

        if (!wizard.parentNode) document.body.appendChild(wizard);
        attachStepListeners();
    }

    function renderStep1() {
        // raw business content: user-entered profile values
        const nameValue = escapeHtml(state.stepData.name);
        const emailValue = escapeHtml(state.stepData.email);
        const locationValue = escapeHtml(state.stepData.location);
        return `
            <h2 id="onboarding-title" class="onboarding-heading">${t('onboarding.profile.title')}</h2>
            <p class="onboarding-desc">${t('onboarding.profile.desc')}</p>
            <div class="onboarding-form">
                <div class="onboarding-field">
                    <label for="onb-name">${t('onboarding.profile.fullName')}</label>
                    <input type="text" id="onb-name" class="search-input" placeholder="${t('onboarding.profile.namePlaceholder')}" value="${nameValue}">
                </div>
                <div class="onboarding-field">
                    <label for="onb-email">${t('fields.email')}</label>
                    <input type="email" id="onb-email" class="search-input" placeholder="${t('onboarding.profile.emailPlaceholder')}" value="${emailValue}">
                </div>
                <div class="onboarding-field">
                    <label for="onb-location">${t('fields.location')}</label>
                    <input type="text" id="onb-location" class="search-input" placeholder="${t('onboarding.profile.locationPlaceholder')}" value="${locationValue}">
                </div>
            </div>
            <div class="onboarding-actions">
                <button class="btn btn-primary" id="onb-next">${t('actions.next')}</button>
            </div>
        `;
    }

    function renderStep2() {
        return `
            <h2 id="onboarding-title" class="onboarding-heading">${t('onboarding.resume.title')}</h2>
            <p class="onboarding-desc">${t('onboarding.resume.desc')}</p>
            <div class="onboarding-upload" id="onb-upload-area">
                <div class="onboarding-upload-icon">&#128196;</div>
                <div class="onboarding-upload-text">${t('onboarding.resume.dropHint')}</div>
                <div class="onboarding-upload-hint">${t('onboarding.resume.formats')}</div>
                <input type="file" id="onb-file" accept=".pdf,.docx,.doc,.txt" style="display:none">
            </div>
            <div id="onb-upload-status"></div>
            <div class="onboarding-actions">
                <button class="btn btn-secondary" id="onb-back">${t('actions.back')}</button>
                <button class="btn btn-ghost" id="onb-skip">${t('actions.skip')}</button>
                <button class="btn btn-primary" id="onb-next">${t('actions.next')}</button>
            </div>
        `;
    }

    function renderStep3() {
        // raw business content: user-entered API key and Ollama base URL
        const apiKeyValue = escapeHtml(state.aiData.apiKey);
        const ollamaUrlValue = escapeHtml(state.aiData.ollamaUrl);
        const provider = state.aiData.provider || '';
        const showKey = provider && provider !== 'ollama';
        const showOllama = provider === 'ollama';
        const showTest = !!provider;
        return `
            <h2 id="onboarding-title" class="onboarding-heading">${t('onboarding.ai.title')}</h2>
            <p class="onboarding-desc">${t('onboarding.ai.desc')}</p>
            <div class="onboarding-form">
                <div class="onboarding-field">
                    <label for="onb-provider">${t('onboarding.ai.provider')}</label>
                    <select id="onb-provider" class="filter-select" style="width:100%">
                        <option value="">${t('onboarding.ai.selectProvider')}</option>
                        <option value="deepseek"${provider === 'deepseek' ? ' selected' : ''}>${t('onboarding.ai.providers.deepseek')}</option>
                        <option value="qwen"${provider === 'qwen' ? ' selected' : ''}>${t('onboarding.ai.providers.qwen')}</option>
                        <option value="kimi"${provider === 'kimi' ? ' selected' : ''}>${t('onboarding.ai.providers.kimi')}</option>
                        <option value="zhipu"${provider === 'zhipu' ? ' selected' : ''}>${t('onboarding.ai.providers.zhipu')}</option>
                        <option value="anthropic"${provider === 'anthropic' ? ' selected' : ''}>${t('onboarding.ai.providers.anthropic')}</option>
                        <option value="openai"${provider === 'openai' ? ' selected' : ''}>${t('onboarding.ai.providers.openai')}</option>
                        <option value="google"${provider === 'google' ? ' selected' : ''}>${t('onboarding.ai.providers.google')}</option>
                        <option value="openrouter"${provider === 'openrouter' ? ' selected' : ''}>${t('onboarding.ai.providers.openrouter')}</option>
                        <option value="ollama"${provider === 'ollama' ? ' selected' : ''}>${t('onboarding.ai.providers.ollama')}</option>
                    </select>
                </div>
                <div class="onboarding-field" id="onb-key-field" style="display:${showKey ? '' : 'none'}">
                    <label for="onb-api-key">${t('onboarding.ai.apiKey')}</label>
                    <input type="password" id="onb-api-key" class="search-input" placeholder="${t('onboarding.ai.apiKeyPlaceholder')}" value="${apiKeyValue}">
                </div>
                <div class="onboarding-field" id="onb-ollama-field" style="display:${showOllama ? '' : 'none'}">
                    <label for="onb-ollama-url">${t('onboarding.ai.ollamaUrl')}</label>
                    <input type="text" id="onb-ollama-url" class="search-input" placeholder="${t('onboarding.ai.ollamaUrlPlaceholder')}" value="${ollamaUrlValue}">
                </div>
                <button class="btn btn-secondary btn-sm" id="onb-test-ai" style="display:${showTest ? '' : 'none'}">${t('onboarding.ai.testConnection')}</button>
                <div id="onb-ai-status"></div>
            </div>
            <div class="onboarding-actions">
                <button class="btn btn-secondary" id="onb-back">${t('actions.back')}</button>
                <button class="btn btn-ghost" id="onb-skip">${t('actions.skip')}</button>
                <button class="btn btn-primary" id="onb-next">${t('actions.next')}</button>
            </div>
        `;
    }

    function renderStep4() {
        return `
            <h2 id="onboarding-title" class="onboarding-heading">${t('onboarding.summary.title')}</h2>
            <p class="onboarding-desc">${t('onboarding.summary.desc')}</p>
            <div class="onboarding-summary">
                <div class="onboarding-summary-item" id="onb-summary"></div>
            </div>
            <div class="onboarding-actions">
                <button class="btn btn-secondary" id="onb-back">${t('actions.back')}</button>
                <button class="btn btn-primary" id="onb-scrape">${t('onboarding.summary.startScraping')}</button>
                <button class="btn btn-ghost" id="onb-later">${t('onboarding.summary.later')}</button>
            </div>
        `;
    }

    function attachStepListeners() {
        const next = wizard.querySelector('#onb-next');
        const back = wizard.querySelector('#onb-back');
        const skip = wizard.querySelector('#onb-skip');
        const scrape = wizard.querySelector('#onb-scrape');
        const later = wizard.querySelector('#onb-later');

        if (back) back.addEventListener('click', () => { state.currentStep--; renderStep(); });
        if (skip) skip.addEventListener('click', () => { state.currentStep++; renderStep(); });

        if (state.currentStep === 0 && next) {
            const nameInput = wizard.querySelector('#onb-name');
            if (nameInput) nameInput.focus();
            next.addEventListener('click', async () => {
                // raw business content: user-entered profile values
                state.stepData.name = wizard.querySelector('#onb-name')?.value?.trim() || '';
                state.stepData.email = wizard.querySelector('#onb-email')?.value?.trim() || '';
                state.stepData.location = wizard.querySelector('#onb-location')?.value?.trim() || '';
                if (state.stepData.name || state.stepData.email) {
                    try {
                        await api.request('POST', '/api/profile', {
                            full_name: state.stepData.name, email: state.stepData.email, location: state.stepData.location
                        });
                    } catch {}
                }
                state.currentStep++;
                renderStep();
            });
        }

        if (state.currentStep === 1) {
            const uploadArea = wizard.querySelector('#onb-upload-area');
            const fileInput = wizard.querySelector('#onb-file');
            const statusEl = wizard.querySelector('#onb-upload-status');

            if (uploadArea && fileInput) {
                uploadArea.addEventListener('click', () => fileInput.click());
                uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
                uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
                uploadArea.addEventListener('drop', (e) => {
                    e.preventDefault();
                    uploadArea.classList.remove('drag-over');
                    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files[0]);
                });
                fileInput.addEventListener('change', () => {
                    if (fileInput.files.length) handleUpload(fileInput.files[0]);
                });
            }

            async function handleUpload(file) {
                if (statusEl) statusEl.innerHTML = `<span class="spinner"></span> ${t('status.uploading')}`;
                try {
                    await api.uploadResume(file);
                    if (statusEl) statusEl.innerHTML = `<span style="color:var(--score-green);font-weight:600">${t('onboarding.resume.uploaded')}</span>`;
                } catch (err) {
                    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">${escapeHtml(apiErrorMessage(err))}</span>`;
                }
            }

            if (next) next.addEventListener('click', () => { state.currentStep++; renderStep(); });
        }

        if (state.currentStep === 2) {
            const providerSelect = wizard.querySelector('#onb-provider');
            const keyField = wizard.querySelector('#onb-key-field');
            const ollamaField = wizard.querySelector('#onb-ollama-field');
            const testBtn = wizard.querySelector('#onb-test-ai');
            const statusEl = wizard.querySelector('#onb-ai-status');

            if (providerSelect) {
                providerSelect.addEventListener('change', () => {
                    const v = providerSelect.value;
                    if (keyField) keyField.style.display = (v && v !== 'ollama') ? '' : 'none';
                    if (ollamaField) ollamaField.style.display = v === 'ollama' ? '' : 'none';
                    if (testBtn) testBtn.style.display = v ? '' : 'none';
                });
            }

            if (testBtn) {
                testBtn.addEventListener('click', async () => {
                    const provider = providerSelect?.value;
                    const apiKey = wizard.querySelector('#onb-api-key')?.value?.trim();
                    const ollamaUrl = wizard.querySelector('#onb-ollama-url')?.value?.trim();
                    if (!provider) return;
                    testBtn.disabled = true;
                    testBtn.innerHTML = `<span class="spinner"></span> ${t('onboarding.ai.testing')}`;
                    try {
                        const settings = { provider, api_key: apiKey || undefined, base_url: ollamaUrl || undefined };
                        await api.testAIConnection(settings);
                        if (statusEl) statusEl.innerHTML = `<span style="color:var(--score-green);font-weight:600">${t('onboarding.ai.connected')}</span>`;
                    } catch (err) {
                        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">${escapeHtml(apiErrorMessage(err))}</span>`;
                    } finally {
                        testBtn.disabled = false;
                        testBtn.textContent = t('onboarding.ai.testConnection');
                    }
                });
            }

            if (next) {
                next.addEventListener('click', async () => {
                    const provider = providerSelect?.value;
                    if (provider) {
                        const apiKey = wizard.querySelector('#onb-api-key')?.value?.trim();
                        const ollamaUrl = wizard.querySelector('#onb-ollama-url')?.value?.trim();
                        try {
                            await api.updateAISettings({ provider, api_key: apiKey || undefined, base_url: ollamaUrl || undefined });
                        } catch {}
                    }
                    state.currentStep++;
                    renderStep();
                });
            }
        }

        if (state.currentStep === 3) {
            const summaryEl = wizard.querySelector('#onb-summary');
            if (summaryEl) {
                checkSetupCompleteness().then(status => {
                    const items = [];
                    items.push(status.steps.profile ? `&#10003; ${t('onboarding.summary.profileConfigured')}` : `&#10007; ${t('onboarding.summary.profileNotSet')}`);
                    items.push(status.steps.resume ? `&#10003; ${t('onboarding.summary.resumeUploaded')}` : `&#10007; ${t('onboarding.summary.resumeMissing')}`);
                    items.push(status.steps.ai ? `&#10003; ${t('onboarding.summary.aiConnected')}` : `&#10007; ${t('onboarding.summary.aiNotConfigured')}`);
                    summaryEl.innerHTML = items.map(i => `<div class="onboarding-check-item">${i}</div>`).join('');
                });
            }

            if (scrape) {
                scrape.addEventListener('click', async () => {
                    markOnboardingDone();
                    wizard.remove();
                    updateSetupIndicator();
                    handleScrape();
                });
            }

            if (later) {
                later.addEventListener('click', () => {
                    markOnboardingDone();
                    wizard.remove();
                    updateSetupIndicator();
                });
            }
        }

        // Keyboard: Escape to skip
        wizard.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                markOnboardingDone();
                wizard.remove();
                updateSetupIndicator();
            }
        });
    }

    state.renderStep = renderStep;
    renderStep();
    scheduleWizardDirtyCheck();
}

/**
 * Re-render the wizard in place for the new interface language without
 * resetting the user's current step or typed input. Called from
 * `rerenderForLanguage()` only while the wizard is open.
 */
function rerenderOnboarding() {
    const wizard = document.getElementById('onboarding-wizard');
    const state = wizard && wizard.__onboardingState;
    if (!wizard || !state) return;

    // Preserve the user's in-progress input before re-rendering so a language
    // switch keeps the current step and everything typed so far.
    const nameEl = wizard.querySelector('#onb-name');
    if (nameEl) state.stepData.name = nameEl.value;
    const emailEl = wizard.querySelector('#onb-email');
    if (emailEl) state.stepData.email = emailEl.value;
    const locationEl = wizard.querySelector('#onb-location');
    if (locationEl) state.stepData.location = locationEl.value;

    const providerEl = wizard.querySelector('#onb-provider');
    if (providerEl) state.aiData.provider = providerEl.value;
    const apiKeyEl = wizard.querySelector('#onb-api-key');
    if (apiKeyEl) state.aiData.apiKey = apiKeyEl.value;
    const ollamaEl = wizard.querySelector('#onb-ollama-url');
    if (ollamaEl) state.aiData.ollamaUrl = ollamaEl.value;

    // Re-render the current step with the freshly translated copy.
    state.renderStep();
    // The re-render restored the inputs programmatically; re-baseline them so
    // they are not treated as unsaved user edits, and re-register the dirty
    // check (handleRoute clears it right after this runs).
    if (typeof refreshFormBaseline === 'function') refreshFormBaseline(wizard);
    scheduleWizardDirtyCheck();
}
