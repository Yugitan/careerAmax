// === Feed View ===
// Map of normalized company name → app_status for companies with active applications
let _companyAppMap = {};

async function renderFeed(container) {
    focusedJobIndex = -1;
    currentOffset = 0;
    container.innerHTML = `
        <div id="smart-views" class="smart-views-bar"></div>
        <div class="filter-bar">
            <input type="text" class="search-input" id="filter-search" placeholder="${t('feed.filters.searchPlaceholder')}" data-dirty-ignore>
            <input type="text" class="search-input" id="filter-exclude" placeholder="${t('feed.filters.excludePlaceholder')}" style="max-width:160px" data-dirty-ignore>
            <select class="filter-select" id="filter-score" data-dirty-ignore>
                <option value="">${t('feed.filters.allScores')}</option>
                <option value="40">40+</option>
                <option value="60">60+</option>
                <option value="80">80+</option>
            </select>
            <select class="filter-select" id="filter-sort" data-dirty-ignore>
                <option value="score">${t('feed.filters.sortByScore')}</option>
                <option value="date">${t('feed.filters.sortByDate')}</option>
                <option value="freshest">${t('feed.filters.freshest')}</option>
            </select>
            <select class="filter-select" id="filter-work-type" data-dirty-ignore>
                <option value="">${t('feed.filters.allWorkTypes')}</option>
                <option value="remote">${t('feed.filters.remote')}</option>
                <option value="onsite">${t('feed.filters.onsite')}</option>
                <option value="hybrid">${t('feed.filters.hybrid')}</option>
            </select>
            <select class="filter-select" id="filter-employment" data-dirty-ignore>
                <option value="">${t('feed.filters.allEmployment')}</option>
                <option value="fulltime">${t('feed.filters.fulltime')}</option>
                <option value="contract">${t('feed.filters.contract')}</option>
                <option value="parttime">${t('feed.filters.parttime')}</option>
            </select>
            <input type="text" class="search-input" id="filter-location" placeholder="${t('feed.filters.locationPlaceholder')}" style="max-width:160px" data-dirty-ignore>
            <select class="filter-select" id="filter-region" data-dirty-ignore>
                <option value="">${t('feed.filters.allRegions')}</option>
                <option value="us">${t('feed.filters.us')}</option>
                <option value="europe">${t('feed.filters.europe')}</option>
                <option value="uk">${t('feed.filters.uk')}</option>
                <option value="canada">${t('feed.filters.canada')}</option>
                <option value="latam">${t('feed.filters.latam')}</option>
                <option value="apac">${t('feed.filters.apac')}</option>
            </select>
            <select class="filter-select" id="filter-posted-within" data-dirty-ignore>
                <option value="">${t('feed.filters.anyDate')}</option>
                <option value="24h">${t('feed.filters.last24h')}</option>
                <option value="3d">${t('feed.filters.last3d')}</option>
                <option value="7d">${t('feed.filters.last7d')}</option>
                <option value="14d">${t('feed.filters.last14d')}</option>
                <option value="30d">${t('feed.filters.last30d')}</option>
            </select>
            <select class="filter-select" id="filter-clearance" data-dirty-ignore>
                <option value="">${t('feed.filters.anyClearance')}</option>
                <option value="hide">${t('feed.filters.hideClearance')}</option>
                <option value="only">${t('feed.filters.onlyClearance')}</option>
            </select>
            <label style="display:flex;align-items:center;gap:4px;font-size:0.8125rem;color:var(--text-secondary);white-space:nowrap;cursor:pointer"><input type="checkbox" id="filter-show-stale" data-dirty-ignore> ${t('feed.filters.showStale')}</label>
            <button class="btn btn-secondary btn-sm" id="save-view-btn" style="white-space:nowrap">${t('feed.saveView.title')}</button>
            <button class="btn btn-secondary btn-sm" id="create-alert-btn" style="white-space:nowrap">${t('feed.createAlert.title')}</button>
            <button class="btn btn-secondary btn-sm" id="select-mode-btn" style="white-space:nowrap">${t('feed.selectMode.title')}</button>
        </div>
        <div id="batch-bar" style="display:none;position:sticky;top:0;z-index:50;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:10px 16px;margin-bottom:12px;display:none;align-items:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,0.15)">
            <span id="batch-count" style="font-weight:600;font-size:0.875rem">${t('common.selected', { count: 0 })}</span>
            <button class="btn btn-primary btn-sm" id="batch-compare-btn" style="display:none">${t('feed.batch.compare')}</button>
            <button class="btn btn-primary btn-sm" id="batch-prepare-btn">${t('feed.batch.prepare')}</button>
            <button class="btn btn-secondary btn-sm" id="batch-dismiss-btn">${t('feed.batch.dismiss')}</button>
            <button class="btn btn-ghost btn-sm" id="batch-select-all-btn">${t('actions.selectAll')}</button>
            <button class="btn btn-ghost btn-sm" id="batch-clear-btn">${t('actions.clear')}</button>
        </div>
        <div class="job-list" id="job-list"></div>
        <div id="load-more-container" style="padding:24px 0;text-align:center;display:none">
            <button class="btn btn-secondary" id="load-more-btn">${t('feed.loadMore')}</button>
        </div>
    `;

    const searchInput = document.getElementById('filter-search');
    const excludeInput = document.getElementById('filter-exclude');
    const scoreSelect = document.getElementById('filter-score');
    const sortSelect = document.getElementById('filter-sort');
    const workTypeSelect = document.getElementById('filter-work-type');
    const employmentSelect = document.getElementById('filter-employment');
    const locationInput = document.getElementById('filter-location');
    const regionSelect = document.getElementById('filter-region');
    const clearanceSelect = document.getElementById('filter-clearance');
    const postedWithinSelect = document.getElementById('filter-posted-within');
    const loadMoreBtn = document.getElementById('load-more-btn');

    // Restore saved filter state (or apply defaults)
    const savedState = loadSavedFilterState();
    if (savedState) {
        applyFilterState(savedState);
    } else {
        scoreSelect.value = '60';
    }

    let debounceTimer;
    registerViewCleanup(() => clearTimeout(debounceTimer));
    const reload = () => {
        currentOffset = 0;
        saveFilterState();
        loadJobs(false);
    };

    searchInput.addEventListener('input', () => {
        filterJobsClientSide();
        saveFilterState();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(reload, 500);
    });
    excludeInput.addEventListener('input', () => {
        saveFilterState();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(filterJobsClientSide, 150);
    });
    locationInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(reload, 300);
    });
    scoreSelect.addEventListener('change', reload);
    sortSelect.addEventListener('change', reload);
    workTypeSelect.addEventListener('change', reload);
    employmentSelect.addEventListener('change', reload);
    regionSelect.addEventListener('change', reload);
    clearanceSelect.addEventListener('change', reload);
    postedWithinSelect.addEventListener('change', reload);
    document.getElementById('filter-show-stale').addEventListener('change', () => {
        saveFilterState();
        filterJobsClientSide();
    });

    // Smart views
    await renderSmartViewChips(reload);

    // Save View button
    document.getElementById('save-view-btn').addEventListener('click', async () => {
        const name = await showModal({
            title: t('feed.saveView.title'),
            input: { placeholder: t('feed.saveView.namePlaceholder') },
            confirmText: t('actions.save'),
        });
        if (!name?.trim()) return;
        try {
            const views = await getSmartViews();
            const existing = views.find(v => v.name === name.trim());
            if (existing) {
                await api.request('PUT', `/api/saved-views/${existing.id}`, { filters: getFilterState() });
            } else {
                await api.request('POST', '/api/saved-views', { name: name.trim(), filters: getFilterState() });
            }
            invalidateViewsCache();
            renderSmartViewChips(reload);
            showToast(t('feed.saveView.saved', { name: name.trim() }), 'success'); // name is raw business content (user-entered view name)
        } catch (err) {
            showToast(apiErrorMessage(err), 'error');
        }
    });
    document.getElementById('create-alert-btn').addEventListener('click', async () => {
        const name = await showModal({
            title: t('feed.createAlert.title'),
            input: { placeholder: t('feed.createAlert.namePlaceholder') },
            confirmText: t('actions.create'),
        });
        if (!name?.trim()) return;
        try {
            await api.request('POST', '/api/alerts', {
                name: name.trim(),
                filters: getFilterState(),
                min_score: parseInt(document.getElementById('filter-score')?.value || '0') || 0,
            });
            showToast(t('feed.createAlert.created', { name: name.trim() }), 'success'); // name is raw business content (user-entered alert name)
        } catch (err) { showToast(apiErrorMessage(err), 'error'); }
    });
    loadMoreBtn.addEventListener('click', () => loadJobs(true));

    // Select mode
    const selectModeBtn = document.getElementById('select-mode-btn');
    selectModeBtn.addEventListener('click', () => {
        selectMode = !selectMode;
        selectedJobIds.clear();
        selectModeBtn.textContent = selectMode ? t('feed.selectMode.cancel') : t('feed.selectMode.title');
        selectModeBtn.classList.toggle('btn-primary', selectMode);
        selectModeBtn.classList.toggle('btn-secondary', !selectMode);
        updateBatchBar();
        loadJobs(false);
    });

    document.getElementById('batch-compare-btn').addEventListener('click', () => {
        const ids = [...selectedJobIds];
        if (ids.length < 2 || ids.length > 3) return;
        selectedJobIds.clear();
        selectMode = false;
        const sBtn = document.getElementById('select-mode-btn');
        if (sBtn) { sBtn.textContent = t('feed.selectMode.title'); sBtn.classList.remove('btn-primary'); sBtn.classList.add('btn-secondary'); }
        renderComparison(document.getElementById('app'), ids);
    });
    document.getElementById('batch-prepare-btn').addEventListener('click', batchPrepare);
    document.getElementById('batch-dismiss-btn').addEventListener('click', batchDismiss);
    document.getElementById('batch-select-all-btn').addEventListener('click', () => {
        document.querySelectorAll('.job-card-checkbox').forEach(cb => {
            cb.checked = true;
            selectedJobIds.add(parseInt(cb.dataset.jobId));
        });
        updateBatchBar();
    });
    document.getElementById('batch-clear-btn').addEventListener('click', () => {
        selectedJobIds.clear();
        document.querySelectorAll('.job-card-checkbox').forEach(cb => cb.checked = false);
        updateBatchBar();
    });

    await loadJobs(false);

    // Save last visit after loading
    localStorage.setItem('jf_last_visit', new Date().toISOString());
}

async function loadJobs(append) {
    const list = document.getElementById('job-list');
    const loadMoreContainer = document.getElementById('load-more-container');

    if (!append) {
        currentOffset = 0;
        list.innerHTML = `<div class="loading-container"><div class="spinner spinner-lg"></div><span>${t('feed.loading.jobs')}</span></div>`;
    }

    const params = {
        limit: PAGE_SIZE,
        offset: currentOffset,
        search: document.getElementById('filter-search')?.value || '',
        min_score: document.getElementById('filter-score')?.value || '',
        sort: document.getElementById('filter-sort')?.value || 'score',
        work_type: document.getElementById('filter-work-type')?.value || '',
        employment_type: document.getElementById('filter-employment')?.value || '',
        location: document.getElementById('filter-location')?.value || '',
        region: document.getElementById('filter-region')?.value || '',
        clearance: document.getElementById('filter-clearance')?.value || '',
        posted_within: document.getElementById('filter-posted-within')?.value || '',
    };

    try {
        const data = await api.getJobs(params);
        const jobs = data.jobs || [];

        if (!append) {
            list.innerHTML = '';
            _companyAppMap = {};
        }

        // Build company → status map for cross-referencing
        for (const job of jobs) {
            if (job.app_status && job.company) {
                const key = job.company.trim().toLowerCase();
                if (!_companyAppMap[key]) _companyAppMap[key] = job.app_status;
            }
        }

        if (jobs.length === 0 && currentOffset === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#128270;</div>
                    <div class="empty-state-title">${t('feed.empty.title')}</div>
                    <div class="empty-state-desc">${t('feed.empty.desc')}</div>
                </div>
            `;
            loadMoreContainer.style.display = 'none';
            return;
        }

        jobs.forEach(job => {
            list.appendChild(createJobCard(job));
        });

        currentOffset += jobs.length;
        loadMoreContainer.style.display = jobs.length >= PAGE_SIZE ? '' : 'none';
        filterJobsClientSide();
    } catch (err) {
        showToast(apiErrorMessage(err), 'error');
        if (!append) list.innerHTML = '';
    }
}

function filterJobsClientSide() {
    const searchVal = (document.getElementById('filter-search')?.value || '').toLowerCase().trim();
    const excludeVal = (document.getElementById('filter-exclude')?.value || '').toLowerCase().trim();
    const showStale = document.getElementById('filter-show-stale')?.checked || false;
    const searchWords = searchVal ? searchVal.split(/\s+/) : [];
    const excludeWords = excludeVal ? excludeVal.split(/\s+/) : [];

    document.querySelectorAll('.job-card').forEach(card => {
        let visible = true;

        if (!showStale && card.dataset.freshness === 'freshness-stale') {
            visible = false;
        }
        if (visible && searchWords.length) {
            const text = card.dataset.searchText || '';
            visible = searchWords.every(w => text.includes(w));
        }
        if (visible && excludeWords.length) {
            const text = card.dataset.searchText || '';
            visible = !excludeWords.some(w => text.includes(w));
        }

        card.style.display = visible ? '' : 'none';
    });
}

function updateBatchBar() {
    const bar = document.getElementById('batch-bar');
    if (!bar) return;
    const count = selectedJobIds.size;
    bar.style.display = selectMode && count > 0 ? 'flex' : 'none';
    const countEl = document.getElementById('batch-count');
    if (countEl) countEl.textContent = t('common.selected', { count });
    const compareBtn = document.getElementById('batch-compare-btn');
    if (compareBtn) compareBtn.style.display = (count >= 2 && count <= 3) ? '' : 'none';
}

async function batchPrepare() {
    if (!await requireAIAndResume()) return;
    const ids = [...selectedJobIds];
    if (!ids.length) return;
    const btn = document.getElementById('batch-prepare-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${t('feed.batch.preparingProgress', { done: 0, total: ids.length })}`;
    let done = 0;
    let failed = 0;
    for (const id of ids) {
        try {
            await api.prepareApplication(id);
            done++;
        } catch {
            failed++;
        }
        btn.innerHTML = `<span class="spinner"></span> ${t('feed.batch.preparingProgress', { done: done + failed, total: ids.length })}`;
    }
    btn.disabled = false;
    btn.textContent = t('feed.batch.prepare');
    const msg = failed ? t('feed.batch.preparedPartial', { done, total: ids.length, failed }) : t('feed.batch.prepared', { count: done });
    showToast(msg, failed ? 'error' : 'success');
    selectedJobIds.clear();
    selectMode = false;
    const selectBtn = document.getElementById('select-mode-btn');
    if (selectBtn) { selectBtn.textContent = t('feed.selectMode.title'); selectBtn.classList.remove('btn-primary'); selectBtn.classList.add('btn-secondary'); }
    updateBatchBar();
    loadJobs(false);
}

async function batchDismiss() {
    const ids = [...selectedJobIds];
    if (!ids.length) return;
    const ok = await showModal({
        title: t('feed.batch.dismissTitle'),
        message: t('feed.batch.dismissConfirm', { count: ids.length }),
        confirmText: t('actions.dismiss'),
        danger: true,
    });
    if (!ok) return;
    for (const id of ids) {
        try { await api.dismissJob(id); } catch {}
    }
    showToast(t('feed.batch.dismissed', { count: ids.length }), 'info');
    selectedJobIds.clear();
    selectMode = false;
    const selectBtn = document.getElementById('select-mode-btn');
    if (selectBtn) { selectBtn.textContent = t('feed.selectMode.title'); selectBtn.classList.remove('btn-primary'); selectBtn.classList.add('btn-secondary'); }
    updateBatchBar();
    loadJobs(false);
}

async function renderComparison(container, jobIds) {
    container.innerHTML = `<div class="loading-container"><div class="spinner spinner-lg"></div><span>${t('feed.comparison.loading')}</span></div>`;

    try {
        const jobs = await Promise.all(jobIds.map(id => api.getJob(id)));

        const rows = [
            {
                label: t('feed.comparison.score'),
                render: job => {
                    const s = job.score?.match_score;
                    return `<span class="score-badge score-large ${getScoreClass(s)}">${s ?? '--'}</span>`;
                }
            },
            {
                label: t('fields.company'),
                render: job => escapeHtml(job.company) // raw business content
            },
            {
                label: t('fields.location'),
                render: job => escapeHtml(job.location || t('feed.comparison.notSpecified')) // raw business content (job location)
            },
            {
                label: t('fields.salary'),
                render: job => {
                    if (job.salary_min || job.salary_max) return formatSalary(job.salary_min, job.salary_max);
                    if (job.salary_estimate_min && job.salary_estimate_max)
                        return `<span style="opacity:0.7">~${formatSalary(job.salary_estimate_min, job.salary_estimate_max)}</span>`;
                    return `<span style="color:var(--text-tertiary)">${t('feed.comparison.notListed')}</span>`;
                }
            },
            {
                label: t('feed.comparison.workType'),
                render: job => escapeHtml(job.work_type || t('feed.comparison.notSpecified')) // raw business content (work type value)
            },
            {
                label: t('feed.comparison.employment'),
                render: job => escapeHtml(job.employment_type || t('feed.comparison.notSpecified')) // raw business content (employment type value)
            },
            {
                label: t('feed.comparison.posted'),
                render: job => formatDate(job.posted_date || job.created_at)
            },
            {
                label: t('fields.status'),
                render: job => {
                    const s = job.application?.status;
                    const safeS = s ? s.replace(/[^a-z0-9-]/gi, '') : '';
                    return safeS ? `<span class="status-badge status-${safeS}">${escapeHtml(s)}</span>` : `<span style="color:var(--text-tertiary)">${t('common.none')}</span>`; // status value is raw business content
                }
            },
            {
                label: t('feed.comparison.matchReasons'),
                render: job => {
                    const reasons = job.score?.match_reasons || [];
                    if (!reasons.length) return `<span style="color:var(--text-tertiary)">${t('feed.comparison.noScoreData')}</span>`;
                    return `<ul class="score-reasons">${reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`; // raw business content (AI match reasons)
                }
            },
            {
                label: t('feed.comparison.concerns'),
                render: job => {
                    const concerns = job.score?.concerns || [];
                    if (!concerns.length) return `<span style="color:var(--text-tertiary)">${t('common.none')}</span>`;
                    return `<ul class="score-concerns">${concerns.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`; // raw business content (AI concerns)
                }
            },
        ];

        container.innerHTML = `
            <div class="detail-header">
                <a class="detail-back" id="compare-back-btn">&larr; ${t('feed.comparison.backToJobs')}</a>
                <h1 class="detail-title">${t('feed.comparison.title')}</h1>
            </div>
            <div class="card comparison-table-wrap">
                <table class="comparison-table">
                    <thead>
                        <tr>
                            <th class="comparison-label-col"></th>
                            ${jobs.map(job => `
                                <th class="comparison-job-col">
                                    <a href="#/job/${job.id}" class="comparison-job-title">${escapeHtml(job.title) /* raw business content */}</a>
                                    <div class="comparison-job-company">${escapeHtml(job.company) /* raw business content */}</div>
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(row => `
                            <tr>
                                <td class="comparison-label">${row.label}</td>
                                ${jobs.map(job => `<td class="comparison-cell">${row.render(job)}</td>`).join('')}
                            </tr>
                        `).join('')}
                        <tr>
                            <td class="comparison-label">${t('feed.comparison.actions')}</td>
                            ${jobs.map(job => `
                                <td class="comparison-cell">
                                    <div style="display:flex;flex-direction:column;gap:6px">
                                        <a href="#/job/${job.id}" class="btn btn-primary btn-sm">${t('feed.comparison.viewDetails')}</a>
                                        <a href="${sanitizeUrl(job.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">${t('feed.comparison.openListing')}</a>
                                    </div>
                                </td>
                            `).join('')}
                        </tr>
                    </tbody>
                </table>
            </div>
        `;

        document.getElementById('compare-back-btn').addEventListener('click', (e) => {
            e.preventDefault();
            navigate('#/');
        });
    } catch (err) {
        showToast(apiErrorMessage(err), 'error');
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-title">${t('feed.comparison.failed')}</div>
                <div class="empty-state-desc">${escapeHtml(apiErrorMessage(err))}</div>
            </div>
        `;
    }
}

function createJobCard(job) {
    const card = document.createElement('div');
    card.className = 'card card-interactive job-card';
    card.dataset.jobId = job.id;
    card.dataset.searchText = [job.title, job.company, job.location, job.description || ''].join(' ').toLowerCase(); // raw business content
    const freshness = getFreshness(job);
    card.dataset.freshness = freshness ? freshness.class : '';

    const score = job.match_score;
    const salary = formatSalary(job.salary_min, job.salary_max);
    const scoreClass = getScoreClass(score);
    const newTag = isNew(job.created_at) ? `<span class="new-indicator">${t('feed.card.newTag')}</span>` : '';
    const safeStatus = job.app_status ? job.app_status.replace(/[^a-z0-9-]/gi, '') : '';
    const statusTag = safeStatus ? `<span class="status-badge status-${safeStatus}">${escapeHtml(job.app_status)}</span>` : ''; // raw business content (application status)
    const freshnessHtml = freshness ? `<span class="freshness-badge ${freshness.class}">${freshness.label}</span>` : '';

    // Company-level indicator: show if another job at this company has an active application
    let companyIndicator = '';
    if (!job.app_status && job.company) {
        const companyKey = job.company.trim().toLowerCase();
        const companyStatus = _companyAppMap[companyKey];
        if (companyStatus) {
            companyIndicator = `<span class="company-app-indicator" title="${t('feed.card.activeAtCompanyTitle', { company: escapeHtml(job.company) })}">${t('feed.card.activeAtCompany')}</span>`; // company name is raw business content
        }
    }

    let cardSalaryHtml = '';
    if (salary) {
        cardSalaryHtml = `<span>${salary}</span>`;
    } else if (job.salary_estimate_min && job.salary_estimate_max) {
        cardSalaryHtml = `<span style="opacity:0.8">~${formatSalary(job.salary_estimate_min, job.salary_estimate_max)}</span>`;
    }

    if (selectMode) card.classList.add('job-card-selecting');

    card.innerHTML = `
        ${selectMode ? `<div class="job-card-check"><input type="checkbox" class="job-card-checkbox" data-job-id="${job.id}"${selectedJobIds.has(job.id) ? ' checked' : ''}></div>` : ''}
        <div class="job-card-content">
            <div class="job-card-header">
                <span class="job-card-title text-truncate">${escapeHtml(job.title) /* raw business content */}</span>
                ${newTag}
                ${statusTag}
            </div>
            <span class="job-card-company">${escapeHtml(job.company) /* raw business content */}${companyIndicator ? ` ${companyIndicator}` : ''}</span>
            <div class="job-card-meta">
                ${job.location ? `<span>${escapeHtml(job.location) /* raw business content */}</span>` : ''}
                ${cardSalaryHtml}
                <span>${formatDate(job.created_at)}</span>
                ${freshnessHtml}
            </div>
        </div>
        <div class="job-card-actions">
            <span class="score-badge ${scoreClass}">${score !== null && score !== undefined ? score : '--'}</span>
            <div class="job-card-quick-actions">
                <button class="btn btn-danger btn-sm dismiss-btn" title="${t('actions.dismiss')}">${t('actions.dismiss')}</button>
            </div>
        </div>
    `;

    const checkbox = card.querySelector('.job-card-checkbox');
    if (checkbox) {
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            if (checkbox.checked) selectedJobIds.add(job.id);
            else selectedJobIds.delete(job.id);
            updateBatchBar();
        });
    }

    card.addEventListener('click', (e) => {
        if (e.target.closest('.dismiss-btn') || e.target.closest('.job-card-checkbox')) return;
        if (selectMode && checkbox) {
            checkbox.checked = !checkbox.checked;
            if (checkbox.checked) selectedJobIds.add(job.id);
            else selectedJobIds.delete(job.id);
            updateBatchBar();
            return;
        }
        navigate(`#/job/${job.id}`);
    });

    card.querySelector('.dismiss-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            await api.dismissJob(job.id);
            card.classList.add('job-card-dismiss');
            card.addEventListener('animationend', () => card.remove());
            showToast(t('feed.card.dismissed'), 'info');
        } catch (err) {
            showToast(apiErrorMessage(err), 'error');
        }
    });

    return card;
}
