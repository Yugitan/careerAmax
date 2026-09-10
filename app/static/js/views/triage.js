// === Triage Mode ===
let triageActive = false;
let triageJobs = [];
let triageIndex = 0;
let triageUndoStack = [];

async function enterTriageMode() {
    if (triageActive) return;
    triageActive = true;
    triageUndoStack = [];

    const savedState = loadSavedFilterState();
    const params = {
        limit: 200,
        offset: 0,
        min_score: savedState?.['filter-score'] || '',
        sort: 'score',
        search: savedState?.['filter-search'] || '',
        work_type: savedState?.['filter-work-type'] || '',
        employment_type: savedState?.['filter-employment'] || '',
        location: savedState?.['filter-location'] || '',
        region: savedState?.['filter-region'] || '',
        clearance: savedState?.['filter-clearance'] || '',
        posted_within: savedState?.['filter-posted-within'] || '',
    };

    try {
        const data = await api.getJobs(params);
        triageJobs = (data.jobs || []).filter(j => !j.app_status);
        triageIndex = 0;
        if (triageJobs.length === 0) {
            showToast(t('triage.noJobs'), 'info');
            triageActive = false;
            return;
        }
        renderTriageCard();
    } catch (err) {
        showToast(t('triage.loadFailed', { error: apiErrorMessage(err) }), 'error');
        triageActive = false;
    }
}

function exitTriageMode() {
    triageActive = false;
    triageJobs = [];
    triageIndex = 0;
    triageUndoStack = [];
    handleRoute();
}

function renderTriageCard() {
    const container = document.getElementById('app');
    if (triageIndex >= triageJobs.length) {
        container.innerHTML = `
            <div class="triage-container">
                <div class="triage-done">
                    <div class="empty-state-icon">&#9989;</div>
                    <div class="empty-state-title">${t('triage.doneTitle')}</div>
                    <div class="empty-state-desc">${t('triage.doneDesc', { count: triageJobs.length })}</div>
                    <button class="btn btn-primary" style="margin-top:16px" onclick="exitTriageMode()">${t('triage.backToFeed')}</button>
                </div>
            </div>
        `;
        return;
    }

    const job = triageJobs[triageIndex];
    const score = job.match_score;
    const reasons = parseJsonField(job.match_reasons);
    const concerns = parseJsonField(job.concerns);
    const salary = formatSalary(job.salary_min, job.salary_max, job.salary_estimate_min, job.salary_estimate_max);

    container.innerHTML = `
        <div class="triage-container" role="region" aria-label="${t('triage.ariaLabel')}" aria-live="polite">
            <div class="triage-header">
                <span class="triage-progress">${t('triage.progress', { current: triageIndex + 1, total: triageJobs.length })}</span>
                <div class="triage-progress-bar">
                    <div class="triage-progress-fill" style="width:${((triageIndex + 1) / triageJobs.length) * 100}%"></div>
                </div>
                <button class="btn btn-ghost btn-sm" onclick="exitTriageMode()">${t('triage.exit')}</button>
            </div>
            <div class="triage-card card">
                <div class="triage-card-body">
                    <div class="triage-score-row">
                        ${score != null ? `<span class="score-badge score-large ${getScoreClass(score)}">${score}</span>` : '<span class="score-badge score-large score-badge-none">--</span>'}
                        <div>
                            <div class="triage-title">${escapeHtml(job.title)}</div>
                            <div class="triage-company">${escapeHtml(job.company)}${job.location ? ` &mdash; ${escapeHtml(job.location)}` : ''}</div>
                        </div>
                    </div>
                    ${salary ? `<div class="triage-salary">${salary}</div>` : ''}
                    ${reasons.length ? `
                        <div class="triage-section">
                            <div class="triage-section-label">Match Reasons</div>
                            <ul class="score-reasons">${reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
                        </div>
                    ` : ''}
                    ${concerns.length ? `
                        <div class="triage-section">
                            <div class="triage-section-label">Concerns</div>
                            <ul class="score-concerns">${concerns.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
                        </div>
                    ` : ''}
                    <div class="triage-actions">
                        <button class="btn btn-primary" id="triage-keep-btn">${t('triage.keepPrepare')}</button>
                        <button class="btn btn-secondary" id="triage-skip-btn">${t('triage.skip')}</button>
                        <button class="btn btn-danger" id="triage-dismiss-btn">${t('triage.dismiss')}</button>
                        <button class="btn btn-ghost" id="triage-view-btn">${t('triage.viewDetails')}</button>
                        ${triageUndoStack.length ? `<button class="btn btn-ghost" id="triage-undo-btn">${t('actions.undo')}</button>` : ''}
                    </div>
                    <div class="triage-shortcuts-hint">
                        <kbd>&rarr;</kbd> ${t('triage.shortcutKeep')} &nbsp; <kbd>&larr;</kbd> ${t('triage.dismiss')} &nbsp; <kbd>&darr;</kbd> ${t('triage.skip')} &nbsp; <kbd>Enter</kbd> ${t('triage.viewDetails')} &nbsp; <kbd>z</kbd> ${t('actions.undo')} &nbsp; <kbd>Esc</kbd> ${t('triage.exit')}
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('triage-keep-btn').addEventListener('click', triageKeep);
    document.getElementById('triage-skip-btn').addEventListener('click', triageSkip);
    document.getElementById('triage-dismiss-btn').addEventListener('click', triageDismiss);
    document.getElementById('triage-view-btn').addEventListener('click', () => navigate(`#/job/${job.id}`));
    const undoBtn = document.getElementById('triage-undo-btn');
    if (undoBtn) undoBtn.addEventListener('click', triageUndo);
}

async function triageKeep() {
    if (!await requireAIAndResume()) return;
    const job = triageJobs[triageIndex];
    triageUndoStack.push({ index: triageIndex, action: 'keep', jobId: job.id });
    try {
        await api.prepareApplication(job.id);
    } catch {}
    triageIndex++;
    renderTriageCard();
}

function triageSkip() {
    triageUndoStack.push({ index: triageIndex, action: 'skip' });
    triageIndex++;
    renderTriageCard();
}

async function triageDismiss() {
    const job = triageJobs[triageIndex];
    triageUndoStack.push({ index: triageIndex, action: 'dismiss', jobId: job.id });
    try {
        await api.dismissJob(job.id);
    } catch {}
    triageIndex++;
    renderTriageCard();
}

async function triageUndo() {
    if (!triageUndoStack.length) return;
    const last = triageUndoStack.pop();
    triageIndex = last.index;
    if (last.action === 'dismiss' && last.jobId) {
        try { await api.updateApplication(last.jobId, 'interested'); } catch {}
    }
    renderTriageCard();
}
