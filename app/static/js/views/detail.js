// === Job Detail View ===
async function renderJobDetail(container, jobId) {
    container.innerHTML = `<div class="loading-container"><div class="spinner spinner-lg"></div><span>${t('detail.loading')}</span></div>`;

    try {
        const [job, profile, resumesData] = await Promise.all([
            api.getJob(jobId),
            api.request('GET', '/api/profile'),
            api.request('GET', '/api/resumes'),
        ]);
        let companyInfo = null;
        try {
            companyInfo = await api.request('GET', `/api/companies/${encodeURIComponent(job.company)}`);
        } catch (e) {
            // silently ignore
        }
        renderJobDetailContent(container, job, profile, companyInfo, resumesData.resumes || []);
    } catch (err) {
        showToast(apiErrorMessage(err), 'error');
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-title">${t('errors.jobNotFound')}</div>
                <div class="empty-state-desc">${escapeHtml(apiErrorMessage(err))}</div>
            </div>
        `;
    }
}

function renderJobDetailContent(container, job, profile = {}, companyInfo = null, resumes = []) {
    const score = job.score;
    const matchScore = score?.match_score;
    const scoreClass = getScoreClass(matchScore);
    const salary = formatSalary(job.salary_min, job.salary_max);
    const sources = job.sources || [];
    const application = job.application;

    const hasSalary = job.salary_min && job.salary_max;
    const hasEstimate = job.salary_estimate_min && job.salary_estimate_max;
    let salaryHtml = '';
    if (hasSalary) {
        salaryHtml = `<span>${formatSalary(job.salary_min, job.salary_max)}</span>`;
    } else if (hasEstimate) {
        const conf = job.salary_confidence || t('detail.salary.level.low');
        const confColor = conf === t('detail.salary.level.high') ? '#22c55e' : conf === t('detail.salary.level.medium') ? '#f59e0b' : '#94a3b8';
        salaryHtml = `
            <span style="opacity:0.8">~${formatSalary(job.salary_estimate_min, job.salary_estimate_max)}</span>
            <span style="font-size:0.75rem;color:${confColor};margin-left:4px">(${conf} confidence)</span>
        `;
    } else {
        salaryHtml = `<button class="btn btn-ghost btn-sm" id="estimate-salary-btn" style="font-size:0.8125rem">${t('detail.actions.estimateSalary')}</button>`;
    }

    const reasonsHtml = (score?.match_reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join('');
    const concernsHtml = (score?.concerns || []).map(c => `<li>${escapeHtml(c)}</li>`).join('');

    const freshness = getFreshness(job);
    const freshnessHtml = freshness ? `<span class="freshness-badge ${freshness.class}">${freshness.label}</span>` : '';
    const staleWarning = freshness && freshness.class === 'freshness-stale' ? `<span style="font-size:0.8125rem;color:#ef4444;">${t('detail.staleWarning')}</span>` : '';

    const descriptionContent = job.description
        ? (job.description.includes('<') && job.description.includes('>') ? sanitizeHtml(job.description) : `<p>${escapeHtml(job.description).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`)
        : `<p class="text-tertiary">${t('detail.descriptionEmpty')}</p>`;

    const appStatus = application?.status || t('detail.status.interested');

    container.innerHTML = `
        <div class="detail-header">
            <a class="detail-back" id="back-btn">&larr; ${t('detail.backToJobs')}</a>
            <h1 class="detail-title">${escapeHtml(job.title)}</h1>
            <div class="detail-company">${escapeHtml(job.company)}</div>
            <div class="detail-meta">
                ${job.location ? `<span>${escapeHtml(job.location)}</span>` : ''}
                ${salaryHtml}
                <span>${formatDate(job.posted_date || job.created_at)}</span>
                ${freshnessHtml}
                ${staleWarning}
                ${sources.map(s => `<a href="${sanitizeUrl(s.source_url || job.url)}" target="_blank" rel="noopener noreferrer" class="source-tag">${escapeHtml(s.source_name)}</a>`).join('')}
            </div>
        </div>
        <div class="detail-layout">
            <div class="detail-main-col">
                <div class="card detail-description">
                    <h2>${t('detail.jobDescription')}</h2>
                    <div class="detail-description-content">${descriptionContent}</div>
                </div>
                ${application ? `<div id="interview-timeline-container"></div>` : ''}
                ${[t('detail.status.interviewing'), t('detail.status.applied'), 'offered'].includes(application?.status) ? `<div id="comp-snapshot-container"></div>` : ''}
            </div>
            <div class="detail-sidebar">
                ${score ? `
                <div class="card sidebar-section">
                    <h3>Match Score</h3>
                    <div class="score-display">
                        <span class="score-badge score-large ${scoreClass}">${matchScore}</span>
                        <div id="prediction-badge-container"></div>
                    </div>
                    ${reasonsHtml ? `<ul class="score-reasons">${reasonsHtml}</ul>` : ''}
                    ${concernsHtml ? `<div class="concerns-label">${t('detail.concerns')}</div><ul class="score-concerns">${concernsHtml}</ul>` : ''}
                    <button class="btn btn-ghost btn-sm" id="predict-success-btn" style="margin-top:8px;font-size:0.75rem">Predict Success</button>
                    <div id="prediction-detail" style="display:none;margin-top:8px;font-size:0.8125rem;color:var(--text-secondary)"></div>
                </div>
                ` : ''}
                <div class="card sidebar-section">
                    <h3>Actions</h3>
                    ${resumes.length > 1 ? `
                    <div style="margin-bottom:10px">
                        <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">${t('fields.resume')}</label>
                        <select class="filter-select" id="resume-select" style="width:100%">
                            ${resumes.map(r => `<option value="${r.id}"${r.is_default ? ' selected' : ''}>${escapeHtml(r.name)}${r.is_default ? ' (default)' : ''}</option>`).join('')}
                        </select>
                    </div>
                    ` : ''}
                    <div class="action-buttons">
                        <button class="btn btn-primary" id="prepare-btn">
                            Prepare Application
                        </button>
                        ${job.apply_url
                            ? `<button class="btn btn-success" id="apply-now-btn" style="width:100%;background:#22c55e;color:white;font-weight:600">${t('detail.actions.applyNow')}</button>`
                            : `<button class="btn btn-secondary btn-sm" id="find-apply-btn" style="width:100%">${t('detail.actions.findApplyLink')}</button>`
                        }
                        <a href="${sanitizeUrl(job.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">
                            Open Job Listing
                        </a>
                        <button class="btn btn-secondary" id="copy-listing-link-btn">${t('detail.actions.copyListingLink')}</button>
                        <button class="btn btn-secondary" id="add-to-queue-btn">${t('detail.actions.addToQueue')}</button>
                        ${(job.hiring_manager_email || job.contact_email) ? `<button class="btn btn-secondary" id="email-btn">${t('detail.actions.draftEmail')}</button>` : ''}
                    </div>
                    ${application?.status !== t('detail.status.applied') ? `
                        <button class="btn" id="mark-applied-btn" style="width:100%;background:#22c55e;color:white;font-weight:600;margin-top:8px">
                            Mark as Applied
                        </button>
                    ` : `
                        <div style="text-align:center;color:#22c55e;font-weight:600;font-size:0.875rem;margin-top:8px">
                            Applied ${application.applied_at ? formatDate(application.applied_at) : ''}
                        </div>
                    `}
                    <div class="mt-16">
                        <label class="mb-8" style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary)">${t('fields.status')}</label>
                        <select class="status-select" id="status-select">
                            ${[t('detail.status.interested'), t('detail.status.prepared'), t('detail.status.applied'), t('detail.status.interviewing'), t('detail.status.rejected')].map(s =>
                                `<option value="${s}" ${s === appStatus ? 'selected' : ''}>${s}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="mt-16">
                        <button class="btn btn-secondary btn-sm" id="save-status-btn">${t('detail.actions.saveStatus')}</button>
                    </div>
                    ${appStatus === t('detail.status.applied') || appStatus === t('detail.status.interviewing') ? `
                    <div class="mt-16" style="padding-top:12px;border-top:1px solid var(--border)">
                        <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">Log Response</label>
                        ${application?.response_type ? `
                            <div style="font-size:0.8125rem;color:var(--text-secondary);padding:8px 12px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm)">
                                Response: <strong style="text-transform:capitalize">${escapeHtml(application.response_type.replace('_', ' '))}</strong>
                                ${application.response_received_at ? ` &middot; ${formatDate(application.response_received_at)}` : ''}
                            </div>
                        ` : `
                            <div style="display:flex;gap:6px">
                                <select class="filter-select" id="response-type-select" style="flex:1">
                                    <option value="">${t('detail.response.selectType')}</option>
                                    <option value="interview_invite">${t('detail.response.type.interview_invite')}</option>
                                    <option value="rejection">Rejection</option>
                                    <option value="callback">Callback</option>
                                    <option value="ghosted">Ghosted</option>
                                </select>
                                <button class="btn btn-primary btn-sm" id="log-response-btn">Log</button>
                            </div>
                        `}
                    </div>
                    ` : ''}
                </div>
                ${(() => {
                    const contactEmail = job.hiring_manager_email || job.contact_email || '';
                    const contactName = job.hiring_manager_name || '';
                    const lookupDone = job.contact_lookup_done;
                    return `
                    <div class="card sidebar-section">
                        <h3>Contact Info</h3>
                        ${contactEmail ? `
                            <div style="display:flex;flex-direction:column;gap:6px">
                                ${contactName ? `<div style="font-weight:600;font-size:0.875rem">${escapeHtml(contactName)}</div>` : ''}
                                <div style="display:flex;align-items:center;gap:8px">
                                    <span style="font-size:0.875rem;color:var(--text-secondary)">${escapeHtml(contactEmail)}</span>
                                    <button class="btn btn-ghost btn-sm copy-btn" data-copy="${escapeHtml(contactEmail)}" title="${t('detail.copyEmailTitle')}">&#128203;</button>
                                </div>
                            </div>
                        ` : lookupDone ? `
                            <div style="font-size:0.8125rem;color:var(--text-tertiary);margin-bottom:8px">${t('detail.noContactFound')}</div>
                            <button class="btn btn-secondary btn-sm" id="find-contact-btn">${t('detail.retrySearch')}</button>
                        ` : `
                            <button class="btn btn-secondary btn-sm" id="find-contact-btn">${t('detail.findContact')}</button>
                        `}
                    </div>`;
                })()}
                ${(() => {
                    const profileFields = [
                        {label: t('fields.fullName'), key: 'full_name'},
                        {label: t('fields.email'), key: 'email'},
                        {label: t('fields.phone'), key: 'phone'},
                        {label: t('fields.location'), key: 'location'},
                        {label: t('detail.contact.linkedin'), key: 'linkedin_url'},
                        {label: t('detail.contact.github'), key: 'github_url'},
                        {label: t('detail.portfolioLabel'), key: 'portfolio_url'},
                    ];
                    const hasProfile = profile && Object.values(profile).some(v => v && v !== '');
                    if (!hasProfile) return '';
                    const items = profileFields
                        .filter(f => profile[f.key])
                        .map(f => `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0">
                            <span style="font-size:0.8125rem;color:var(--text-tertiary)">${f.label}</span>
                            <span style="display:flex;align-items:center;gap:4px">
                                <span style="font-size:0.8125rem;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(profile[f.key])}">${escapeHtml(profile[f.key])}</span>
                                <button class="btn btn-secondary btn-sm quick-copy-btn" data-value="${escapeHtml(profile[f.key])}" title="Copy" style="padding:2px 6px;min-width:auto;font-size:0.75rem">&#128203;</button>
                            </span>
                        </div>`).join('');
                    return `<div class="card sidebar-section">
                        <details open>
                            <summary style="cursor:pointer;font-weight:600;font-size:0.9375rem;margin-bottom:8px">Quick Copy</summary>
                            ${items}
                        </details>
                    </div>`;
                })()}
                <div class="card sidebar-section">
                    <h3>Timeline</h3>
                    ${renderQuickActions(job)}
                    <div class="timeline" id="timeline-container">
                        ${renderTimeline(job.events || [])}
                    </div>
                </div>
                ${(job.similar && job.similar.length > 0) ? `
                <div class="card sidebar-section">
                    <h3>Similar Listings (${job.similar.length})</h3>
                    <div style="display:flex;flex-direction:column;gap:8px">
                        ${job.similar.map(s => `
                            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm)">
                                <div>
                                    <a href="#/job/${s.id}" style="font-size:0.875rem;font-weight:500;color:var(--accent)">${escapeHtml(s.title)}</a>
                                    <div style="font-size:0.75rem;color:var(--text-tertiary)">${escapeHtml(s.company)}</div>
                                </div>
                                ${s.match_score ? `<span class="score-badge ${getScoreClass(s.match_score)}" style="font-size:0.75rem">${s.match_score}</span>` : ''}
                            </div>
                        `).join('')}
                    </div>
                    <button class="btn btn-secondary btn-sm" id="dismiss-dupes-btn" style="margin-top:12px;width:100%">Dismiss Duplicates</button>
                </div>
                ` : ''}
                ${companyInfo && (companyInfo.description || companyInfo.glassdoor_rating) ? `
                <div class="card sidebar-section">
                    <h3>About ${escapeHtml(job.company)}</h3>
                    ${companyInfo.description ? `<p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.5;margin-bottom:8px">${escapeHtml(companyInfo.description.substring(0, 200))}${companyInfo.description.length > 200 ? '...' : ''}</p>` : ''}
                    ${companyInfo.glassdoor_rating ? `
                        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                            <span style="font-weight:600;font-size:0.875rem">${companyInfo.glassdoor_rating}</span>
                            <span style="color:#f59e0b">★</span>
                            <span style="font-size:0.75rem;color:var(--text-tertiary)">Glassdoor</span>
                        </div>
                    ` : ''}
                    ${companyInfo.website ? `<a href="${sanitizeUrl(companyInfo.website)}" target="_blank" rel="noopener noreferrer" style="font-size:0.8125rem;color:var(--accent)">${t('detail.companyWebsite')}</a>` : ''}
                </div>
                ` : ''}
                <div id="prepared-container">
                    ${application?.tailored_resume ? renderPreparedSection(application, job.id) : ''}
                </div>
                <div id="cover-letter-container">
                    ${application?.cover_letter ? renderCoverLetterSection(application.cover_letter, job.id) : `
                    <div class="card sidebar-section">
                        <h3>${t('detail.coverLetterTitle')}</h3>
                        <button class="btn btn-secondary" id="generate-cover-letter-btn" style="width:100%">Generate Cover Letter</button>
                    </div>
                    `}
                </div>
                <div id="email-container">
                    ${application?.email_draft ? renderEmailPreview(JSON.parse(application.email_draft)) : ''}
                </div>
                <div id="interview-prep-container">
                    ${job.interview_prep ? renderInterviewPrep(job.interview_prep) : (appStatus === t('detail.status.interviewing') ? `
                    <div class="card sidebar-section">
                        <h3>${t('detail.interviewPrepTitle')}</h3>
                        <button class="btn btn-primary" id="generate-interview-prep-btn" style="width:100%">Generate Interview Prep</button>
                    </div>
                    ` : '')}
                </div>
            </div>
        </div>
    `;

    // Wire up events
    document.querySelectorAll('.quick-copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            copyToClipboard(btn.dataset.value);
        });
    });

    document.getElementById('back-btn').addEventListener('click', (e) => {
        e.preventDefault();
        navigate('#/');
    });

    const predictBtn = document.getElementById('predict-success-btn');
    if (predictBtn) {
        predictBtn.addEventListener('click', async () => {
            if (!await requireAI()) return;
            predictBtn.disabled = true;
            predictBtn.innerHTML = `<span class="spinner"></span> ${t('detail.predicting')}`;
            try {
                const pred = await api.request('GET', `/api/jobs/${job.id}/predict-success`);
                const raw = pred.probability || 0;
                const pct = Math.round(raw > 1 ? raw : raw * 100);
                const color = pct >= 60 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
                const badgeContainer = document.getElementById('prediction-badge-container');
                if (badgeContainer) {
                    badgeContainer.innerHTML = `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;font-size:0.8125rem;font-weight:600;background:${color}22;color:${color}">${pct}% likely</span>`;
                }
                const detail = document.getElementById('prediction-detail');
                if (detail) {
                    detail.style.display = '';
                    detail.innerHTML = `
                        <div style="font-size:0.75rem;color:var(--text-tertiary);margin-bottom:4px">Confidence: ${pred.confidence || 'N/A'}</div>
                        ${pred.reasoning ? `<div>${escapeHtml(pred.reasoning)}</div>` : ''}
                    `;
                }
                predictBtn.style.display = 'none';
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                predictBtn.disabled = false;
                predictBtn.textContent = t('detail.actions.predictSuccess');
            }
        });
    }

    const estSalaryBtn = document.getElementById('estimate-salary-btn');
    if (estSalaryBtn) {
        estSalaryBtn.addEventListener('click', async () => {
            if (!await requireAI()) return;
            estSalaryBtn.disabled = true;
            estSalaryBtn.innerHTML = '<span class="spinner"></span>';
            try {
                const result = await api.request('POST', `/api/jobs/${job.id}/estimate-salary`);
                if (result.min && result.min > 0) {
                    showToast(t('detail.estimatedSalary', { salary: formatSalary(result.min, result.max), confidence: result.confidence }), 'success');
                    const updated = await api.getJob(job.id);
                    renderJobDetailContent(container, updated, profile, companyInfo, resumes);
                } else {
                    showToast(t('detail.couldNotEstimateSalary'), 'info');
                    estSalaryBtn.disabled = false;
                    estSalaryBtn.textContent = t('detail.actions.estimateSalary');
                }
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                estSalaryBtn.disabled = false;
                estSalaryBtn.textContent = t('detail.actions.estimateSalary');
            }
        });
    }

    const logResponseBtn = document.getElementById('log-response-btn');
    if (logResponseBtn) {
        logResponseBtn.addEventListener('click', async () => {
            const typeSelect = document.getElementById('response-type-select');
            const responseType = typeSelect?.value;
            if (!responseType) { showToast(t('detail.selectResponseType'), 'error'); return; }
            logResponseBtn.disabled = true;
            logResponseBtn.innerHTML = '<span class="spinner"></span>';
            try {
                await api.request('POST', `/api/jobs/${job.id}/response`, { response_type: responseType });
                showToast(t('detail.responseLogged'), 'success');
                const updated = await api.getJob(job.id);
                renderJobDetailContent(container, updated, profile, companyInfo, resumes);
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                logResponseBtn.disabled = false;
                logResponseBtn.textContent = t('detail.actions.log');
            }
        });
    }

    document.getElementById('prepare-btn').addEventListener('click', async () => {
        if (!await requireAIAndResume()) return;
        const btn = document.getElementById('prepare-btn');
        const resumeSelect = document.getElementById('resume-select');
        const resumeId = resumeSelect ? parseInt(resumeSelect.value) : null;
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span> ${t('detail.preparing')}`;
        try {
            const result = await api.prepareApplication(job.id, resumeId);
            document.getElementById('prepared-container').innerHTML = renderPreparedSection(result, job.id);
            attachPreparedListeners();
            showToast(t('detail.applicationPrepared'), 'success');
        } catch (err) {
            showToast(apiErrorMessage(err), 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = t('detail.actions.prepareApplication');
        }
    });

    const findApplyBtn = document.getElementById('find-apply-btn');
    if (findApplyBtn) {
        findApplyBtn.addEventListener('click', async () => {
            findApplyBtn.disabled = true;
            findApplyBtn.innerHTML = `<span class="spinner"></span> ${t('detail.searching')}`;
            try {
                const result = await api.request('POST', `/api/jobs/${job.id}/find-apply-link`);
                if (result.apply_url) {
                    showToast(t('detail.applyLinkFound'), 'success');
                    const updated = await api.getJob(job.id);
                    renderJobDetailContent(container, updated, profile, companyInfo, resumes);
                } else {
                    showToast(t('detail.noApplyLinkFound'), 'info');
                    findApplyBtn.disabled = false;
                    findApplyBtn.textContent = t('detail.actions.findApplyLink');
                }
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                findApplyBtn.disabled = false;
                findApplyBtn.textContent = t('detail.actions.findApplyLink');
            }
        });
    }

    const applyNowBtn = document.getElementById('apply-now-btn');
    if (applyNowBtn) {
        applyNowBtn.addEventListener('click', async () => {
            applyNowBtn.disabled = true;
            applyNowBtn.innerHTML = `<span class="spinner"></span> ${t('detail.applying')}`;
            try {
                const result = await api.request('POST', `/api/jobs/${job.id}/apply`);
                window.open(result.url, '_blank');
                showToast(t('detail.markedApplied'), 'success');
                const updated = await api.getJob(job.id);
                renderJobDetailContent(container, updated, profile, companyInfo, resumes);
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                applyNowBtn.disabled = false;
                applyNowBtn.textContent = t('detail.actions.applyNow');
            }
        });
    }

    document.getElementById('save-status-btn').addEventListener('click', async () => {
        const status = document.getElementById('status-select').value;
        try {
            await api.updateApplication(job.id, status);
            showToast(t('detail.statusUpdated'), 'success');
        } catch (err) {
            showToast(apiErrorMessage(err), 'error');
        }
    });

    const copyLinkBtn = document.getElementById('copy-listing-link-btn');
    if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(job.url);
                showToast(t('detail.linkCopied'), 'success');
            } catch {
                showToast(t('detail.copyLinkFailed'), 'error');
            }
        });
    }

    document.getElementById('add-to-queue-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('add-to-queue-btn');
        const resumeSelect = document.getElementById('resume-select');
        const resumeId = resumeSelect ? parseInt(resumeSelect.value) : null;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>';
        try {
            await api.request('POST', '/api/queue/add', { job_id: job.id, resume_id: resumeId });
            showToast(t('detail.addedToQueue'), 'success');
            btn.textContent = t('detail.inQueue');
        } catch (err) {
            showToast(apiErrorMessage(err), 'error');
            btn.disabled = false;
            btn.textContent = t('detail.actions.addToQueue');
        }
    });

    const markAppliedBtn = document.getElementById('mark-applied-btn');
    if (markAppliedBtn) {
        markAppliedBtn.addEventListener('click', async () => {
            markAppliedBtn.disabled = true;
            try {
                await api.updateApplication(job.id, 'applied');
                showToast(t('detail.markedApplied'), 'success');
                const updated = await api.getJob(job.id);
                renderJobDetailContent(container, updated, profile, companyInfo, resumes);
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                markAppliedBtn.disabled = false;
            }
        });
    }

    wireCrmQuickActions(job, container, profile, companyInfo, resumes);

    const emailBtn = document.getElementById('email-btn');
    if (emailBtn) {
        emailBtn.addEventListener('click', async () => {
            if (!await requireAI()) return;
            emailBtn.disabled = true;
            emailBtn.innerHTML = `<span class="spinner"></span> ${t('detail.drafting')}`;
            try {
                const result = await api.draftEmail(job.id);
                document.getElementById('email-container').innerHTML = renderEmailPreview(result.email);
                wireSendEmailBtn(job.id);
                showToast(t('detail.emailDrafted'), 'success');
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
            } finally {
                emailBtn.disabled = false;
                emailBtn.textContent = t('detail.actions.draftEmail');
            }
        });
    }

    wireSendEmailBtn(job.id);

    const genCoverLetterBtn = document.getElementById('generate-cover-letter-btn');
    if (genCoverLetterBtn) {
        genCoverLetterBtn.addEventListener('click', async () => {
            if (!await requireAIAndResume()) return;
            genCoverLetterBtn.disabled = true;
            genCoverLetterBtn.innerHTML = '<span class="spinner"></span> Generating...';
            try {
                const result = await api.generateCoverLetter(job.id);
                document.getElementById('cover-letter-container').innerHTML = renderCoverLetterSection(result.cover_letter, job.id);
                attachCoverLetterListeners(job.id);
                showToast(t('detail.coverLetterGenerated'), 'success');
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                genCoverLetterBtn.disabled = false;
                genCoverLetterBtn.textContent = t('detail.generateCoverLetter');
            }
        });
    }

    attachCoverLetterListeners(job.id);

    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            copyToClipboard(btn.dataset.copy);
        });
    });

    const findContactBtn = document.getElementById('find-contact-btn');
    if (findContactBtn) {
        findContactBtn.addEventListener('click', async () => {
            if (!await requireAI()) return;
            findContactBtn.disabled = true;
            findContactBtn.innerHTML = `<span class="spinner"></span> ${t('detail.searching')}`;
            try {
                const result = await api.request('POST', `/api/jobs/${job.id}/find-contact`);
                if (result.contact && result.contact.email) {
                    showToast(t('detail.contactFound', { email: result.contact.email }), 'success');
                } else {
                    showToast(t('detail.noContactFound'), 'info');
                }
                // Refresh the job detail
                const updated = await api.getJob(job.id);
                renderJobDetailContent(container, updated, profile, companyInfo, resumes);
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                findContactBtn.disabled = false;
                findContactBtn.textContent = t('detail.findContact');
            }
        });
    }

    attachPreparedListeners();

    // Load interview timeline for pipeline jobs
    if (document.getElementById('interview-timeline-container')) {
        loadInterviewTimeline(job.id, container, profile, companyInfo, resumes);
    }

    // Render compensation snapshot for pipeline jobs
    if (document.getElementById('comp-snapshot-container')) {
        renderCompSnapshot(job);
    }

    const dismissDupesBtn = document.getElementById('dismiss-dupes-btn');
    if (dismissDupesBtn) {
        dismissDupesBtn.addEventListener('click', async () => {
            const ok = await showModal({
                title: t('detail.dismissSimilarTitle'),
                message: t('detail.dismissSimilarMessage'),
                confirmText: t('actions.dismiss'),
                danger: true,
            });
            if (!ok) return;
            for (const s of job.similar) {
                await api.dismissJob(s.id);
            }
            showToast(t('detail.dismissedSimilar', { count: job.similar.length }), 'success');
            await renderJobDetail(container, job.id);
        });
    }

    const genPrepBtn = document.getElementById('generate-interview-prep-btn');
    if (genPrepBtn) {
        genPrepBtn.addEventListener('click', async () => {
            if (!await requireAI()) return;
            genPrepBtn.disabled = true;
            genPrepBtn.innerHTML = '<span class="spinner"></span> Generating...';
            try {
                const result = await api.request('POST', `/api/jobs/${job.id}/interview-prep`);
                document.getElementById('interview-prep-container').innerHTML = renderInterviewPrep(result.prep);
                showToast(t('detail.interviewPrepGenerated'), 'success');
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                genPrepBtn.disabled = false;
                genPrepBtn.textContent = t('detail.generateInterviewPrep');
            }
        });
    }

}

function renderInterviewPrep(prep) {
    const section = (title, items) => {
        if (!items || items.length === 0) return '';
        return `
            <details open style="margin-bottom:12px">
                <summary style="cursor:pointer;font-weight:600;font-size:0.875rem;margin-bottom:6px">${title}</summary>
                <ul style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px">
                    ${items.map(item => `<li style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.5">${escapeHtml(item)}</li>`).join('')}
                </ul>
            </details>
        `;
    };
    return `
        <div class="card sidebar-section">
            <h3>${t('detail.interviewPrepTitle')}</h3>
            ${section(t('detail.prep.behavioral'), prep.behavioral_questions)}
            ${section(t('detail.prep.technical'), prep.technical_questions)}
            ${section(t('detail.prep.star'), prep.star_stories)}
            ${section(t('detail.prep.talkingPoints'), prep.talking_points)}
            <button class="btn btn-secondary btn-sm" id="generate-interview-prep-btn" style="width:100%;margin-top:8px">Regenerate</button>
        </div>
    `;
}

function linkifyDetail(escaped) {
    // Convert markdown-style [text](url) links (already HTML-escaped)
    let result = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
        const safeUrl = sanitizeUrl(url);
        return `<a href="${safeUrl}" target="_blank" rel="noopener" title="${text}">${text}</a>`;
    });
    // Convert bare URLs
    result = result.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
        if (url.includes('href=')) return url;
        const safeUrl = sanitizeUrl(url);
        const display = url.length > 60 ? url.slice(0, 57) + '...' : url;
        return `<a href="${safeUrl}" target="_blank" rel="noopener" title="${url}">${display}</a>`;
    });
    return result;
}

function renderTimeline(events) {
    if (!events || events.length === 0) {
        return `<div class="empty-state empty-state-compact"><div class="empty-state-title">${t('detail.timelineEmptyTitle')}</div><div class="empty-state-desc">${t('detail.timelineEmptyDesc')}</div></div>`;
    }
    const icons = {
        note: '\u{1F4DD}',
        call: '\u{1F4DE}',
        email_log: '\u{1F4E7}',
        status_change: '\u{1F504}',
        prepared: '\u{1F4C4}',
        email_drafted: '\u2709\uFE0F',
        pdf_downloaded: '\u2B07\uFE0F',
    };
    return events.map(e => {
        const icon = icons[e.event_type] || '\u{1F4DD}';
        let detail = '';
        if (e.event_type === 'call' || e.event_type === 'email_log') {
            try {
                const d = JSON.parse(e.detail);
                if (e.event_type === 'call') {
                    detail = `<div class="timeline-structured">
                        <span class="timeline-tag">Call</span>
                        ${d.who ? `<span class="timeline-meta">${t('detail.timeline.withWho', { who: escapeHtml(d.who) })}</span>` : ''}
                        ${d.duration ? `<span class="timeline-meta">${escapeHtml(d.duration)}</span>` : ''}
                        ${d.notes ? `<div class="timeline-notes">${escapeHtml(d.notes)}</div>` : ''}
                    </div>`;
                } else {
                    detail = `<div class="timeline-structured">
                        <span class="timeline-tag">${t('detail.timeline.email')}</span>
                        ${d.direction ? `<span class="timeline-meta">${escapeHtml(d.direction)}</span>` : ''}
                        ${d.subject ? `<div class="timeline-notes"><strong>${escapeHtml(d.subject)}</strong></div>` : ''}
                        ${d.notes ? `<div class="timeline-notes">${escapeHtml(d.notes)}</div>` : ''}
                    </div>`;
                }
            } catch {
                detail = `<div class="timeline-detail">${escapeHtml(e.detail)}</div>`;
            }
        } else {
            detail = `<div class="timeline-detail">${linkifyDetail(escapeHtml(e.detail))}</div>`;
        }
        return `
            <div class="timeline-event">
                <span class="timeline-icon">${icon}</span>
                <div style="min-width:0">
                    ${detail}
                    <div class="timeline-time">${formatDate(e.created_at)}</div>
                </div>
            </div>
        `;
    }).join('');
}

function renderQuickActions(job) {
    const status = job.application?.status || '';
    const isInterviewing = [t('detail.status.interviewing'), t('detail.status.applied'), 'offered'].includes(status);
    return `
        <div class="crm-quick-actions">
            ${isInterviewing ? `
            <div class="crm-action-bar">
                <button class="crm-action-btn" data-action="call" title="${t('detail.crm.logCallTitle')}">
                    <span class="crm-action-icon">\u{1F4DE}</span> Call
                </button>
                <button class="crm-action-btn" data-action="email" title="${t('detail.crm.logEmailTitle')}">
                    <span class="crm-action-icon">\u{1F4E7}</span> Email
                </button>
                <button class="crm-action-btn crm-action-btn-active" data-action="note" title="${t('detail.crm.addNoteTitle')}">
                    <span class="crm-action-icon">\u{1F4DD}</span> Note
                </button>
            </div>
            ` : ''}
            <div id="crm-form-area">
                <div class="flex gap-8 mb-16">
                    <input type="text" class="search-input" id="add-note-input" placeholder="${t('detail.crm.addNotePlaceholder')}" style="flex:1">
                    <button class="btn btn-primary btn-sm" id="add-note-btn">Add</button>
                </div>
            </div>
        </div>
    `;
}

function getCrmFormHtml(action) {
    if (action === 'call') {
        return `
            <div class="crm-inline-form" data-type="call">
                <div class="crm-form-row">
                    <input type="text" class="search-input crm-field" name="who" placeholder="${t('detail.crm.callWhoPlaceholder')}">
                    <select class="filter-select crm-field" name="duration" style="width:auto;min-width:90px">
                        <option value="">${t('detail.crm.duration')}</option>
                        <option value="5 min">${t('detail.crm.durationMin', { n: 5 })}</option>
                        <option value="10 min">${t('detail.crm.durationMin', { n: 10 })}</option>
                        <option value="15 min">${t('detail.crm.durationMin', { n: 15 })}</option>
                        <option value="30 min">${t('detail.crm.durationMin', { n: 30 })}</option>
                        <option value="45 min">${t('detail.crm.durationMin', { n: 45 })}</option>
                        <option value="1 hr">${t('detail.crm.durationHour')}</option>
                    </select>
                </div>
                <textarea class="search-input crm-field" name="notes" placeholder="${t('detail.crm.callNotesPlaceholder')}" rows="2" style="resize:vertical"></textarea>
                <div class="crm-form-footer">
                    <button class="btn btn-primary btn-sm crm-submit-btn">Log Call</button>
                    <button class="btn btn-secondary btn-sm crm-cancel-btn">${t('actions.cancel')}</button>
                </div>
            </div>
        `;
    }
    if (action === 'email') {
        return `
            <div class="crm-inline-form" data-type="email_log">
                <div class="crm-form-row">
                    <select class="filter-select crm-field" name="direction" style="width:auto;min-width:110px">
                        <option value="Sent">Sent</option>
                        <option value="Received">Received</option>
                    </select>
                    <input type="text" class="search-input crm-field" name="subject" placeholder="${t('detail.crm.subjectPlaceholder')}" style="flex:1">
                </div>
                <textarea class="search-input crm-field" name="notes" placeholder="${t('detail.crm.emailNotesPlaceholder')}" rows="2" style="resize:vertical"></textarea>
                <div class="crm-form-footer">
                    <button class="btn btn-primary btn-sm crm-submit-btn">${t('detail.crm.logEmail')}</button>
                    <button class="btn btn-secondary btn-sm crm-cancel-btn">${t('actions.cancel')}</button>
                </div>
            </div>
        `;
    }
    // note (default)
    return `
        <div class="flex gap-8 mb-16">
            <input type="text" class="search-input" id="add-note-input" placeholder="${t('detail.crm.addNotePlaceholder')}" style="flex:1">
            <button class="btn btn-primary btn-sm" id="add-note-btn">Add</button>
        </div>
    `;
}

function wireCrmQuickActions(job, container, profile, companyInfo, resumes) {
    const formArea = document.getElementById('crm-form-area');
    const actionBtns = document.querySelectorAll('.crm-action-btn');

    function refreshTimeline() {
        return api.getJob(job.id).then(updated => {
            document.getElementById('timeline-container').innerHTML = renderTimeline(updated.events || []);
        });
    }

    function wireNoteForm() {
        const addNoteBtn = document.getElementById('add-note-btn');
        const addNoteInput = document.getElementById('add-note-input');
        if (!addNoteBtn || !addNoteInput) return;
        addNoteBtn.addEventListener('click', async () => {
            const detail = addNoteInput.value.trim();
            if (!detail) return;
            addNoteBtn.disabled = true;
            try {
                await api.addEvent(job.id, detail, 'note');
                addNoteInput.value = '';
                await refreshTimeline();
                showToast(t('detail.noteAdded'), 'success');
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
            } finally {
                addNoteBtn.disabled = false;
            }
        });
        addNoteInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addNoteBtn.click();
        });
        addNoteInput.focus();
    }

    function wireInlineForm(type) {
        const form = formArea.querySelector('.crm-inline-form');
        if (!form) return;
        const submitBtn = form.querySelector('.crm-submit-btn');
        const cancelBtn = form.querySelector('.crm-cancel-btn');

        cancelBtn.addEventListener('click', () => {
            formArea.innerHTML = getCrmFormHtml('note');
            wireNoteForm();
            actionBtns.forEach(b => b.classList.toggle('crm-action-btn-active', b.dataset.action === 'note'));
        });

        submitBtn.addEventListener('click', async () => {
            const data = {};
            form.querySelectorAll('.crm-field').forEach(f => {
                if (f.value.trim()) data[f.name] = f.value.trim();
            });
            if (type === 'call' && !data.who && !data.notes) {
                showToast(t('detail.callRequired'), 'error');
                return;
            }
            if (type === 'email_log' && !data.subject && !data.notes) {
                showToast(t('detail.emailRequired'), 'error');
                return;
            }
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner"></span>';
            try {
                await api.addEvent(job.id, JSON.stringify(data), type);
                await refreshTimeline();
                showToast(type === 'call' ? t('detail.callLogged') : t('detail.emailLogged'), 'success');
                formArea.innerHTML = getCrmFormHtml('note');
                wireNoteForm();
                actionBtns.forEach(b => b.classList.toggle('crm-action-btn-active', b.dataset.action === 'note'));
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = type === 'call' ? t('detail.crm.logCall') : t('detail.crm.logEmail');
            }
        });

        const firstInput = form.querySelector('input, textarea');
        if (firstInput) firstInput.focus();
    }

    actionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            actionBtns.forEach(b => b.classList.toggle('crm-action-btn-active', b === btn));
            formArea.innerHTML = getCrmFormHtml(action);
            if (action === 'note') {
                wireNoteForm();
            } else {
                wireInlineForm(action === 'call' ? 'call' : 'email_log');
            }
        });
    });

    wireNoteForm();
}

function buildCompStateOptions(selected) {
    if (typeof TAX_DATA !== 'undefined' && TAX_DATA.states) {
        return Object.entries(TAX_DATA.states)
            .sort((a, b) => a[1].name.localeCompare(b[1].name))
            .map(([code, s]) => `<option value="${code}"${code === selected ? ' selected' : ''}>${s.name}${s.type === 'none' ? ' (no tax)' : ''}</option>`)
            .join('');
    }
    return `<option value="${selected}">${selected}</option>`;
}

function renderCompSnapshot(job) {
    const container = document.getElementById('comp-snapshot-container');
    if (!container) return;

    const gross = job.salary_max || job.salary_min ||
                  job.salary_estimate_max || job.salary_estimate_min || 0;

    if (!gross || gross <= 0) {
        container.innerHTML = '';
        return;
    }

    const isContract = job.employment_type === 'contract';
    const isHourly = isContract && gross > 0 && gross < 500;
    const annualGross = isHourly ? gross * 40 * 52 : gross;

    const stateMatch = (job.location || '').match(/,\s*([A-Z]{2})\b/);
    const defaultState = (typeof loadCalcSettings === 'function' ? loadCalcSettings().state : null) || 'TX';
    const state = stateMatch ? stateMatch[1] : defaultState;
    const empType = isContract ? '1099' : 'w2';
    const filingStatus = (typeof loadCalcSettings === 'function' ? loadCalcSettings().filing : null) || 'single';

    const result = typeof calculateSalary === 'function' ? calculateSalary({
        gross: annualGross, state, filingStatus, employmentType: empType,
        deductions: {}, c2cMargin: 0
    }) : null;

    if (!result) {
        container.innerHTML = '';
        return;
    }

    let comparisonHtml = '';
    if (isContract && typeof compareEmploymentTypes === 'function') {
        const comparison = compareEmploymentTypes(annualGross, state, filingStatus, {}, 0);
        const monthly = (type) => formatCurrency(Math.round((comparison[type]?.takeHome || 0) / 12));
        comparisonHtml = `
            <div class="comp-comparison">
                <span>W2: ${monthly('w2')}/mo</span>
                <span class="comp-divider">|</span>
                <span>1099: ${monthly('1099')}/mo</span>
                <span class="comp-divider">|</span>
                <span>C2C: ${monthly('c2c')}/mo</span>
            </div>`;
    }

    container.innerHTML = `
        <div class="card comp-snapshot-card">
            <div class="comp-snapshot-header">
                <h3>Compensation Snapshot</h3>
                <span class="comp-edit-hint">${t('detail.comp.adjustHint')}</span>
            </div>
            <div class="comp-controls">
                <div class="comp-control-group">
                    <label>${isHourly ? t('detail.comp.hourlyRate') : t('detail.comp.annualSalary')}</label>
                    <input type="number" class="search-input" id="comp-gross" value="${isHourly ? gross : annualGross}" min="0" step="${isHourly ? '1' : '1000'}">
                </div>
                <div class="comp-control-group">
                    <label>Type</label>
                    <div class="comp-toggle-row">
                        <button class="comp-toggle${empType === 'w2' ? ' active' : ''}" data-group="compEmp" data-value="w2">W-2</button>
                        <button class="comp-toggle${empType === '1099' ? ' active' : ''}" data-group="compEmp" data-value="1099">1099</button>
                        <button class="comp-toggle${empType === 'c2c' ? ' active' : ''}" data-group="compEmp" data-value="c2c">C2C</button>
                    </div>
                </div>
                <div class="comp-control-group">
                    <label>Filing</label>
                    <div class="comp-toggle-row">
                        <button class="comp-toggle${filingStatus === 'single' ? ' active' : ''}" data-group="compFiling" data-value="single">Single</button>
                        <button class="comp-toggle${filingStatus === 'married' ? ' active' : ''}" data-group="compFiling" data-value="married">Married</button>
                    </div>
                </div>
                <div class="comp-control-group">
                    <label>State</label>
                    <select class="filter-select" id="comp-state">${buildCompStateOptions(state)}</select>
                </div>
            </div>
            <div class="comp-stats" id="comp-stats">
                <div class="comp-stat">
                    <div class="comp-stat-value" id="comp-gross-val">${formatCurrency(result.gross)}</div>
                    <div class="comp-stat-label">Gross</div>
                </div>
                <div class="comp-stat">
                    <div class="comp-stat-value" id="comp-tax-val">${formatCurrency(result.totalTax)}</div>
                    <div class="comp-stat-label">Taxes</div>
                </div>
                <div class="comp-stat">
                    <div class="comp-stat-value comp-takehome" id="comp-takehome-val">${formatCurrency(result.takeHome)}</div>
                    <div class="comp-stat-label">Take-Home</div>
                </div>
                <div class="comp-stat">
                    <div class="comp-stat-value" id="comp-rate-val">${(result.effectiveRate * 100).toFixed(1)}%</div>
                    <div class="comp-stat-label">Eff. Rate</div>
                </div>
            </div>
            ${comparisonHtml}
            <div class="comp-chart-wrap">
                <canvas id="comp-donut"></canvas>
            </div>
        </div>
    `;

    // Render donut
    renderCompDonut(result);

    // Wire recalc
    wireCompSnapshotEvents(container, { isHourly, state, empType, filingStatus });
}

let compSnapshotChart = null;

function renderCompDonut(result) {
    if (compSnapshotChart) compSnapshotChart.destroy();
    const canvas = document.getElementById('comp-donut');
    if (!canvas || !result || typeof Chart === 'undefined') return;

    const colors = typeof getChartColors === 'function' ? getChartColors() : {
        federal: '#6366f1', state: '#f59e0b', ss: '#10b981', medicare: '#ec4899',
        seTax: '#8b5cf6', takeHome: '#22c55e', surface: '#fff', text: '#64748b'
    };
    const segments = [
        { label: t('detail.comp.federal'), value: result.federal, color: colors.federal },
        { label: t('detail.comp.state'), value: result.state, color: colors.state },
        { label: t('detail.comp.ss'), value: result.ss, color: colors.ss },
        { label: t('detail.comp.medicare'), value: result.medicare, color: colors.medicare }
    ];
    if (result.seTax > 0) segments.push({ label: t('detail.comp.seTax'), value: result.seTax, color: colors.seTax });
    segments.push({ label: t('detail.comp.takeHome'), value: Math.max(0, result.takeHome), color: colors.takeHome });
    const filtered = segments.filter(s => s.value > 0);

    compSnapshotChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: filtered.map(s => s.label),
            datasets: [{ data: filtered.map(s => s.value), backgroundColor: filtered.map(s => s.color), borderWidth: 2, borderColor: colors.surface }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '60%',
            animation: { animateRotate: true, duration: 600, easing: 'easeOutQuart' },
            plugins: {
                legend: { position: 'bottom', labels: { color: colors.text, padding: 8, usePointStyle: true, pointStyleWidth: 8, font: { size: 11 } } },
                tooltip: { callbacks: { label: ctx => t('detail.comp.tooltip', { label: ctx.label, amount: formatCurrency(ctx.raw), pct: ((ctx.raw / result.gross) * 100).toFixed(1) }) } }
            }
        }
    });
}

function wireCompSnapshotEvents(container, defaults) {
    let debounceId = null;
    const recalc = () => {
        clearTimeout(debounceId);
        debounceId = setTimeout(() => {
            const grossInput = container.querySelector('#comp-gross');
            let gross = parseFloat(grossInput?.value) || 0;
            if (defaults.isHourly) gross = gross * 40 * 52;

            const empBtn = container.querySelector('.comp-toggle[data-group="compEmp"].active');
            const filingBtn = container.querySelector('.comp-toggle[data-group="compFiling"].active');
            const stateSelect = container.querySelector('#comp-state');

            const employmentType = empBtn?.dataset.value || defaults.empType;
            const filingStatus = filingBtn?.dataset.value || defaults.filingStatus;
            const state = stateSelect?.value || defaults.state;

            const result = calculateSalary({ gross, state, filingStatus, employmentType, deductions: {}, c2cMargin: 0 });
            if (!result) return;

            const el = (id) => container.querySelector(id);
            if (el('#comp-gross-val')) el('#comp-gross-val').textContent = formatCurrency(result.gross);
            if (el('#comp-tax-val')) el('#comp-tax-val').textContent = formatCurrency(result.totalTax);
            if (el('#comp-takehome-val')) el('#comp-takehome-val').textContent = formatCurrency(result.takeHome);
            if (el('#comp-rate-val')) el('#comp-rate-val').textContent = (result.effectiveRate * 100).toFixed(1) + '%';

            renderCompDonut(result);
        }, 150);
    };

    container.querySelectorAll('.comp-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const group = btn.dataset.group;
            container.querySelectorAll(`.comp-toggle[data-group="${group}"]`).forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            recalc();
        });
    });

    container.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('input', recalc);
        el.addEventListener('change', recalc);
    });
}

function renderPreparedSection(data, jobId) {
    return `
        <div class="card sidebar-section">
            <h3>${t('detail.tailoredResume')}</h3>
            <div class="doc-download-row">
                <div class="pdf-download-card">
                    <a href="/api/jobs/${jobId}/resume.pdf" download class="pdf-file-link" draggable="true">
                        <span class="pdf-icon">PDF</span>
                        <span class="pdf-label">${t('detail.tailoredResume')}</span>
                    </a>
                </div>
                <div class="pdf-download-card">
                    <a href="/api/jobs/${jobId}/resume.docx" download class="pdf-file-link docx-file-link" draggable="true">
                        <span class="pdf-icon docx-icon">DOCX</span>
                        <span class="pdf-label">${t('detail.tailoredResume')}</span>
                    </a>
                </div>
            </div>
            <div class="prepared-section">
                <textarea class="textarea-styled" id="resume-textarea">${escapeHtml(data.tailored_resume || '')}</textarea>
                <div class="prepared-actions">
                    <button class="btn btn-secondary btn-sm" id="copy-resume-btn">${t('detail.copyResume')}</button>
                </div>
            </div>
        </div>
        <div class="card sidebar-section">
            <h3>${t('detail.coverLetterTitle')}</h3>
            <div class="doc-download-row">
                <div class="pdf-download-card">
                    <a href="/api/jobs/${jobId}/cover-letter.pdf" download class="pdf-file-link" draggable="true">
                        <span class="pdf-icon">PDF</span>
                        <span class="pdf-label">${t('detail.coverLetterTitle')}</span>
                    </a>
                </div>
                <div class="pdf-download-card">
                    <a href="/api/jobs/${jobId}/cover-letter.docx" download class="pdf-file-link docx-file-link" draggable="true">
                        <span class="pdf-icon docx-icon">DOCX</span>
                        <span class="pdf-label">${t('detail.coverLetterTitle')}</span>
                    </a>
                </div>
            </div>
            <div class="prepared-section">
                <textarea class="textarea-styled" id="cover-textarea">${escapeHtml(data.cover_letter || '')}</textarea>
                <div class="prepared-actions">
                    <button class="btn btn-secondary btn-sm" id="copy-cover-btn">${t('detail.copyCoverLetter')}</button>
                </div>
            </div>
        </div>
    `;
}

function attachPreparedListeners() {
    const copyResume = document.getElementById('copy-resume-btn');
    const copyCover = document.getElementById('copy-cover-btn');
    if (copyResume) {
        copyResume.addEventListener('click', () => {
            copyToClipboard(document.getElementById('resume-textarea').value);
        });
    }
    if (copyCover) {
        copyCover.addEventListener('click', () => {
            copyToClipboard(document.getElementById('cover-textarea').value);
        });
    }
}

function renderCoverLetterSection(coverLetterText, jobId) {
    if (!coverLetterText) return '';
    return `
        <div class="card sidebar-section">
            <h3>${t('detail.coverLetterTitle')}</h3>
            <div class="prepared-section">
                <textarea class="textarea-styled" id="standalone-cover-textarea" rows="12">${escapeHtml(coverLetterText)}</textarea>
                <div class="prepared-actions" style="display:flex;gap:8px;margin-top:8px">
                    <button class="btn btn-primary btn-sm" id="save-cover-letter-btn">${t('detail.saveEdits')}</button>
                    <button class="btn btn-secondary btn-sm" id="copy-cover-letter-btn">Copy</button>
                    <button class="btn btn-secondary btn-sm" id="regenerate-cover-letter-btn">Regenerate</button>
                </div>
            </div>
        </div>
    `;
}

function attachCoverLetterListeners(jobId) {
    const saveBtn = document.getElementById('save-cover-letter-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const text = document.getElementById('standalone-cover-textarea').value;
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner"></span>';
            try {
                await api.request('PUT', `/api/jobs/${jobId}/cover-letter`, { cover_letter: text });
                showToast(t('detail.coverLetterSaved'), 'success');
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = t('detail.saveEdits');
            }
        });
    }

    const copyBtn = document.getElementById('copy-cover-letter-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            copyToClipboard(document.getElementById('standalone-cover-textarea').value);
        });
    }

    const regenBtn = document.getElementById('regenerate-cover-letter-btn');
    if (regenBtn) {
        regenBtn.addEventListener('click', async () => {
            if (!await requireAIAndResume()) return;
            regenBtn.disabled = true;
            regenBtn.innerHTML = `<span class="spinner"></span> ${t('detail.regenerating')}`;
            try {
                const result = await api.generateCoverLetter(jobId);
                document.getElementById('cover-letter-container').innerHTML = renderCoverLetterSection(result.cover_letter, jobId);
                attachCoverLetterListeners(jobId);
                showToast(t('detail.coverLetterRegenerated'), 'success');
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                regenBtn.disabled = false;
                regenBtn.textContent = 'Regenerate';
            }
        });
    }
}

function wireSendEmailBtn(jobId) {
    const sendBtn = document.getElementById('send-email-btn');
    if (!sendBtn) return;
    sendBtn.addEventListener('click', async () => {
        sendBtn.disabled = true;
        sendBtn.innerHTML = `<span class="spinner"></span> ${t('detail.sending')}`;
        try {
            await api.request('POST', `/api/jobs/${jobId}/send-email`);
            showToast(t('detail.emailSent'), 'success');
            sendBtn.textContent = t('detail.sent');
        } catch (err) {
            showToast(apiErrorMessage(err), 'error');
            sendBtn.disabled = false;
            sendBtn.textContent = t('detail.sendEmail');
        }
    });
}

function renderEmailPreview(email) {
    if (!email) return '';
    return `
        <div class="card sidebar-section">
            <h3>${t('detail.emailDraft')}</h3>
            <div class="email-preview">
                <div class="email-field"><span class="email-label">To:</span> ${escapeHtml(email.to || '')}</div>
                <div class="email-field"><span class="email-label">Subject:</span> ${escapeHtml(email.subject || '')}</div>
                <div class="email-body">${escapeHtml(email.body || '')}</div>
            </div>
            <div class="prepared-actions">
                <button class="btn btn-primary btn-sm" id="send-email-btn">${t('detail.sendEmail')}</button>
                <button class="btn btn-secondary btn-sm" onclick="copyToClipboard(document.querySelector('.email-body')?.textContent || '')">Copy Email</button>
            </div>
        </div>
    `;
}

// === Interview Timeline ===

async function loadInterviewTimeline(jobId, container, profile, companyInfo, resumes) {
    const timelineContainer = document.getElementById('interview-timeline-container');
    if (!timelineContainer) return;

    let rounds = [];
    try {
        const data = await api.getInterviews(jobId);
        rounds = (data.rounds || []).sort((a, b) => a.round_number - b.round_number);
    } catch {
        // API may not exist yet — show empty state with add button
    }

    timelineContainer.innerHTML = renderInterviewTimeline(rounds, jobId);
    wireInterviewTimelineEvents(timelineContainer, jobId, container, profile, companyInfo, resumes);
}

function renderInterviewTimeline(rounds, jobId) {
    const statusBadge = (status) => {
        const colors = {
            scheduled: 'var(--accent)',
            completed: 'var(--score-green)',
            cancelled: 'var(--text-tertiary)',
            no_show: 'var(--danger)',
        };
        const color = colors[status] || 'var(--text-secondary)';
        return `<span style="font-size:0.7rem;font-weight:600;padding:2px 8px;border-radius:var(--radius-full);background:${color}18;color:${color};text-transform:capitalize">${escapeHtml((status || 'scheduled').replace('_', ' '))}</span>`;
    };

    return `
        <div class="card" style="padding:20px;margin-top:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h2 style="font-size:1.125rem;font-weight:700;margin:0">Interviews</h2>
                <button class="btn btn-primary btn-sm" id="add-interview-btn">${t('detail.addRound')}</button>
            </div>
            <div id="interview-add-form-container" style="display:none"></div>
            ${rounds.length === 0 ? `
                <div class="empty-state empty-state-compact" style="padding:16px 0">
                    <div class="empty-state-desc">No interview rounds yet. Add your first round to track interviews.</div>
                </div>
            ` : `
                <div class="interview-timeline-list">
                    ${rounds.map(round => `
                        <div class="interview-round-card" data-round-id="${round.id}">
                            <div class="interview-round-line"></div>
                            <div class="interview-round-dot"></div>
                            <div class="interview-round-content">
                                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                                    <div>
                                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                                            <span style="font-weight:600;font-size:0.9375rem">Round ${round.round_number}${round.label ? ': ' + escapeHtml(round.label) : ''}</span>
                                            ${statusBadge(round.status)}
                                        </div>
                                        ${round.scheduled_at ? `
                                            <div style="font-size:0.8125rem;color:var(--text-secondary);margin-top:4px">
                                                ${i18n.formatDateTime(round.scheduled_at)}
                                                ${round.duration_min ? t('detail.minutesSuffix', { n: round.duration_min }) : ''}
                                            </div>
                                        ` : ''}
                                        ${round.interviewer_name ? `
                                            <div style="font-size:0.8125rem;color:var(--text-secondary);margin-top:2px">
                                                ${escapeHtml(round.interviewer_name)}${round.interviewer_title ? ` — ${escapeHtml(round.interviewer_title)}` : ''}
                                                ${!round.contact_id ? `<button class="btn btn-ghost btn-sm interview-save-contact-btn" data-round-id="${round.id}" style="font-size:0.7rem;padding:1px 6px;margin-left:4px">${t('detail.saveToNetwork')}</button>` : `<span style="font-size:0.7rem;color:var(--score-green);margin-left:4px">In Network</span>`}
                                            </div>
                                        ` : ''}
                                        ${round.location ? `<div style="font-size:0.8125rem;color:var(--text-tertiary);margin-top:2px">${escapeHtml(round.location)}</div>` : ''}
                                        ${round.notes ? `<div style="font-size:0.8125rem;color:var(--text-tertiary);margin-top:4px;white-space:pre-line">${escapeHtml(round.notes)}</div>` : ''}
                                    </div>
                                    <div style="display:flex;gap:4px;flex-shrink:0">
                                        <button class="btn btn-ghost btn-sm interview-view-btn" data-round-id="${round.id}" data-job-id="${jobId}" title="${t('detail.viewDetailsTitle')}" style="padding:4px 8px">View</button>
                                        <button class="btn btn-ghost btn-sm interview-edit-btn" data-round-id="${round.id}" title="Edit" style="padding:4px 8px">Edit</button>
                                        <button class="btn btn-ghost btn-sm interview-delete-btn" data-round-id="${round.id}" title="${t('actions.delete')}" style="padding:4px 8px;color:var(--danger)">Del</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
        </div>
    `;
}

function wireInterviewTimelineEvents(timelineContainer, jobId, container, profile, companyInfo, resumes) {
    const addBtn = timelineContainer.querySelector('#add-interview-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            showInterviewForm(timelineContainer, jobId, null, container, profile, companyInfo, resumes);
        });
    }

    timelineContainer.querySelectorAll('.interview-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const roundId = parseInt(btn.dataset.roundId);
            const jid = parseInt(btn.dataset.jobId);
            if (typeof openInterviewPanel === 'function') {
                openInterviewPanel(roundId, jid);
            }
        });
    });

    timelineContainer.querySelectorAll('.interview-edit-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const roundId = parseInt(btn.dataset.roundId);
            try {
                const data = await api.getInterviews(jobId);
                const round = (data.rounds || []).find(r => r.id === roundId);
                if (round) showInterviewForm(timelineContainer, jobId, round, container, profile, companyInfo, resumes);
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
            }
        });
    });

    timelineContainer.querySelectorAll('.interview-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const roundId = parseInt(btn.dataset.roundId);
            const ok = await showModal({
                title: t('detail.deleteRoundTitle'),
                message: t('detail.deleteRoundMessage'),
                confirmText: t('actions.delete'),
                danger: true,
            });
            if (!ok) return;
            try {
                await api.deleteInterview(roundId);
                showToast(t('detail.roundDeleted'), 'success');
                await loadInterviewTimeline(jobId, container, profile, companyInfo, resumes);
            } catch (err) {
                showToast(t('detail.deleteFailed', { error: err.message }), 'error');
            }
        });
    });

    timelineContainer.querySelectorAll('.interview-save-contact-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const roundId = parseInt(btn.dataset.roundId);
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span>';
            try {
                await api.promoteInterviewer(roundId);
                showToast(t('detail.interviewerSaved'), 'success');
                await loadInterviewTimeline(jobId, container, profile, companyInfo, resumes);
            } catch (err) {
                showToast(t('detail.failed', { error: err.message }), 'error');
                btn.disabled = false;
                btn.textContent = t('detail.saveToNetwork');
            }
        });
    });
}

function showInterviewForm(timelineContainer, jobId, existingRound, container, profile, companyInfo, resumes) {
    const formContainer = timelineContainer.querySelector('#interview-add-form-container');
    if (!formContainer) return;

    const isEdit = !!existingRound;
    const labelSuggestions = [t('detail.interview.label.phoneScreen'), t('detail.interview.label.technical'), t('detail.interview.label.systemDesign'), t('detail.interview.label.behavioral'), t('detail.interview.label.hiringManager'), t('detail.interview.label.cultureFit'), t('detail.interview.label.panel'), t('detail.interview.label.finalRound'), t('detail.interview.label.takeHome')];

    const scheduledVal = existingRound?.scheduled_at
        ? existingRound.scheduled_at.slice(0, 16)
        : '';

    const currentLabel = existingRound?.label || '';
    const labelPills = labelSuggestions.map(s =>
        `<button type="button" class="iv-label-pill${s === currentLabel ? ' active' : ''}" data-label="${escapeHtml(s)}">${escapeHtml(s)}</button>`
    ).join('');

    const durationOptions = [15, 30, 45, 60, 90, 120, 180].map(m => {
        const label = m >= 60 ? `${m / 60}h${m % 60 ? ` ${m % 60}m` : ''}` : t('detail.interview.durationMin', { n: m });
        const selected = (existingRound?.duration_min || 60) === m;
        return `<button type="button" class="iv-duration-pill${selected ? ' active' : ''}" data-duration="${m}">${label}</button>`;
    }).join('');

    formContainer.style.display = 'block';
    formContainer.innerHTML = `
        <div class="iv-form-panel">
            <div class="iv-form-header">
                <h3>${isEdit ? t('detail.interview.editTitle') : t('detail.interview.addTitle')}</h3>
                <button type="button" class="btn btn-ghost btn-sm" id="cancel-interview-form" aria-label="${t('a11y.close')}">&times;</button>
            </div>
            <form id="interview-round-form">
                <div class="iv-form-section">
                    <label class="iv-form-label">Round Type</label>
                    <div class="iv-label-pills">${labelPills}</div>
                    <input type="text" name="label" class="search-input" id="interview-label-input" value="${escapeHtml(currentLabel)}" placeholder="${t('detail.interview.customLabelPlaceholder')}" style="margin-top:8px">
                </div>

                <div class="iv-form-row">
                    <div class="iv-form-section" style="flex:1.2">
                        <label class="iv-form-label">Date & Time</label>
                        <input type="datetime-local" name="scheduled_at" class="search-input" value="${scheduledVal}">
                    </div>
                    ${isEdit ? `
                    <div class="iv-form-section" style="flex:0.8">
                        <label class="iv-form-label">${t('fields.status')}</label>
                        <select name="status" class="filter-select" style="width:100%">
                            ${['scheduled', 'completed', 'cancelled', 'no_show'].map(s =>
                                `<option value="${s}" ${(existingRound?.status || 'scheduled') === s ? 'selected' : ''}>${t('detail.interview.status.' + s)}</option>`
                            ).join('')}
                        </select>
                    </div>
                    ` : '<input type="hidden" name="status" value="scheduled">'}
                </div>

                <div class="iv-form-section">
                    <label class="iv-form-label">${t('fields.duration')}</label>
                    <div class="iv-duration-pills">${durationOptions}</div>
                    <input type="hidden" name="duration_min" id="iv-duration-val" value="${existingRound?.duration_min || 60}">
                </div>

                <div class="iv-form-section">
                    <label class="iv-form-label">Interviewer</label>
                    <div class="iv-form-row">
                        <div style="flex:1">
                            <input type="text" name="interviewer_name" class="search-input" value="${escapeHtml(existingRound?.interviewer_name || '')}" placeholder="Name">
                        </div>
                        <div style="flex:1">
                            <input type="text" name="interviewer_title" class="search-input" value="${escapeHtml(existingRound?.interviewer_title || '')}" placeholder="${t('detail.interview.titlePlaceholder')}">
                        </div>
                    </div>
                </div>

                <div class="iv-form-section">
                    <label class="iv-form-label">${t('detail.interview.locationLabel')}</label>
                    <input type="text" name="location" class="search-input" value="${escapeHtml(existingRound?.location || '')}" placeholder="${t('detail.interview.locationPlaceholder')}">
                </div>

                <div class="iv-form-section">
                    <label class="iv-form-label">${t('fields.notes')}</label>
                    <textarea name="notes" class="search-input" rows="2" style="resize:vertical;min-height:48px" placeholder="Prep topics, questions to ask, things to remember...">${escapeHtml(existingRound?.notes || '')}</textarea>
                </div>

                <div class="iv-form-actions">
                    <button type="submit" class="btn btn-primary btn-sm" id="iv-form-submit">${isEdit ? t('detail.interview.submitSave') : t('detail.interview.submitAdd')}</button>
                    <button type="button" class="btn btn-ghost btn-sm" id="cancel-interview-form-bottom">${t('actions.cancel')}</button>
                </div>
            </form>
        </div>
    `;

    // Label pill click → fills text input
    formContainer.querySelectorAll('.iv-label-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            formContainer.querySelectorAll('.iv-label-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            formContainer.querySelector('#interview-label-input').value = pill.dataset.label;
        });
    });

    // Custom label input clears pill selection if text differs
    formContainer.querySelector('#interview-label-input').addEventListener('input', (e) => {
        const val = e.target.value;
        formContainer.querySelectorAll('.iv-label-pill').forEach(p => {
            p.classList.toggle('active', p.dataset.label === val);
        });
    });

    // Duration pill click
    formContainer.querySelectorAll('.iv-duration-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            formContainer.querySelectorAll('.iv-duration-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            formContainer.querySelector('#iv-duration-val').value = pill.dataset.duration;
        });
    });

    // Cancel buttons
    const cancelForm = () => {
        formContainer.style.display = 'none';
        formContainer.innerHTML = '';
    };
    formContainer.querySelector('#cancel-interview-form').addEventListener('click', cancelForm);
    formContainer.querySelector('#cancel-interview-form-bottom').addEventListener('click', cancelForm);

    // Submit
    formContainer.querySelector('#interview-round-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);

        const data = {
            label: fd.get('label') || '',
            scheduled_at: fd.get('scheduled_at') || null,
            duration_min: parseInt(fd.get('duration_min') || '60', 10),
            status: fd.get('status') || 'scheduled',
            interviewer_name: fd.get('interviewer_name') || '',
            interviewer_title: fd.get('interviewer_title') || '',
            location: fd.get('location') || '',
            notes: fd.get('notes') || '',
        };

        const submitBtn = formContainer.querySelector('#iv-form-submit');
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="spinner"></span> ${isEdit ? 'Saving...' : 'Adding...'}`;

        try {
            if (isEdit) {
                await api.updateInterview(existingRound.id, data);
                showToast(t('detail.roundUpdated'), 'success');
            } else {
                await api.createInterview(jobId, data);
                showToast(t('detail.roundAdded'), 'success');
            }
            formContainer.style.display = 'none';
            formContainer.innerHTML = '';
            await loadInterviewTimeline(jobId, container, profile, companyInfo, resumes);
        } catch (err) {
            showToast(t('detail.failed', { error: err.message }), 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = isEdit ? t('detail.interview.submitSave') : t('detail.interview.submitAdd');
        }
    });

    // Focus label input on open
    formContainer.querySelector('#interview-label-input').focus();
}
