// === Settings View ===
let settingsActiveTab = 'profile';
let settingsData = {};

async function renderSettings(container) {
    container.innerHTML = `<div class="loading-container"><div class="spinner spinner-lg"></div><span>${t('settings.loading')}</span></div>`;

    try {
        const [config, aiSettings, profile, fullProfile, scraperKeys, customQA, emailSettings, resumesData, embeddingSettings] = await Promise.all([
            api.getSearchConfig(),
            api.getAISettings(),
            api.request('GET', '/api/profile'),
            api.request('GET', '/api/profile/full'),
            api.request('GET', '/api/scraper-keys'),
            api.request('GET', '/api/custom-qa'),
            api.request('GET', '/api/settings/email'),
            api.request('GET', '/api/resumes'),
            api.request('GET', '/api/settings/embeddings'),
        ]);
        settingsData = { config, aiSettings, profile, fullProfile, scraperKeys, customQA: customQA.items || [], emailSettings, resumes: resumesData.resumes || [], embeddingSettings };
        renderSettingsShell(container);
    } catch (err) {
        showToast(err.message, 'error');
        container.innerHTML = `<div class="empty-state"><div class="empty-state-title">${t('settings.loadFailed')}</div></div>`;
    }
}

function renderSettingsShell(container) {
    const tabs = [
        { id: 'profile', label: 'Profile' },
        { id: 'resumes', label: t('settings.resumes.title') },
        { id: 'work-history', label: t('settings.profile.workHistory') },
        { id: 'job-search', label: t('settings.jobSearch.title') },
        { id: 'alerts', label: t('settings.alerts.title') },
        { id: 'follow-ups', label: t('settings.templates.title') },
        { id: 'integrations', label: 'AI & Integrations' },
        { id: 'data', label: 'Data Management' },
    ];

    container.innerHTML = `
        <h1 style="font-size:1.5rem;font-weight:700;letter-spacing:-0.02em;margin-bottom:24px">${t('settings.title')}</h1>
        <div class="settings-tab-bar" role="tablist">
            ${tabs.map(t => `<button id="settings-tab-${t.id}" class="settings-tab${settingsActiveTab === t.id ? ' settings-tab-active' : ''}" data-tab="${t.id}" role="tab" aria-selected="${settingsActiveTab === t.id}">${t.label}</button>`).join('')}
        </div>
        <div id="settings-tab-content" role="tabpanel" aria-labelledby="settings-tab-${settingsActiveTab}"></div>
    `;

    container.querySelectorAll('.settings-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            settingsActiveTab = btn.dataset.tab;
            container.querySelectorAll('.settings-tab').forEach(b => {
                const isActive = b.dataset.tab === settingsActiveTab;
                b.classList.toggle('settings-tab-active', isActive);
                b.setAttribute('aria-selected', String(isActive));
            });
            const panel = document.getElementById('settings-tab-content');
            if (panel) panel.setAttribute('aria-labelledby', `settings-tab-${settingsActiveTab}`);
            renderActiveTab(container);
        });
    });

    renderActiveTab(container);
}

function renderActiveTab(shell) {
    const content = shell.querySelector('#settings-tab-content');
    if (!content) return;
    const d = settingsData;
    switch (settingsActiveTab) {
        case 'profile': renderTabProfile(content, d.fullProfile || d.profile || {}); break;
        case 'resumes': renderTabResumes(content, d.resumes || []); break;
        case 'work-history': renderTabWorkHistory(content, d.fullProfile || {}); break;
        case 'job-search': renderTabJobSearch(content, d.config || {}, d.fullProfile || d.profile || {}, d.customQA || []); break;
        case 'alerts': renderTabAlerts(content); break;
        case 'follow-ups': renderTabFollowUps(content); break;
        case 'integrations': renderTabAI(content, d.aiSettings || {}, d.scraperKeys || {}, d.emailSettings || {}, d.embeddingSettings || {}); break;
        case 'data': renderTabData(content); break;
    }
}

async function renderTabAlerts(content) {
    content.innerHTML = '<div class="loading-container"><span class="spinner"></span></div>';
    try {
        const data = await api.request('GET', '/api/alerts');
        const alerts = data.alerts || [];
        content.innerHTML = `
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">${t('settings.alerts.title')}</h2>
            <p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:16px">${t('settings.alerts.description')}</p>
            ${alerts.length === 0 ? `
                <div class="empty-state" style="padding:32px">
                    <div class="empty-state-title">No alerts yet</div>
                    <div class="empty-state-desc">Use t('settings.alerts.create') on the Jobs page to save your current filters as an alert.</div>
                </div>
            ` : `
                <div style="display:flex;flex-direction:column;gap:8px">
                    ${alerts.map(a => `
                        <div class="card" style="padding:16px" data-alert-id="${a.id}">
                            <div style="display:flex;justify-content:space-between;align-items:center">
                                <div>
                                    <span style="font-weight:600;font-size:0.9375rem">${escapeHtml(a.name)}</span>
                                    ${a.enabled ? `<span class="status-badge status-applied" style="margin-left:8px">${t('status.active')}</span>` : `<span class="status-badge" style="margin-left:8px;background:var(--bg-surface-secondary);color:var(--text-tertiary)">${t('status.paused')}</span>`}
                                </div>
                                <div style="display:flex;gap:6px">
                                    <button class="btn btn-secondary btn-sm alert-toggle-btn" data-id="${a.id}" data-enabled="${a.enabled}">${a.enabled ? t('settings.alerts.pause') : t('actions.enable')}</button>
                                    <button class="btn btn-danger btn-sm alert-delete-btn" data-id="${a.id}">Delete</button>
                                </div>
                            </div>
                            ${a.min_score ? `<div style="font-size:0.75rem;color:var(--text-tertiary);margin-top:4px">${t('settings.alerts.minScore', { score: a.min_score })}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            `}
        `;

        content.querySelectorAll('.alert-toggle-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const enabled = btn.dataset.enabled === 'true';
                try {
                    await api.request('PUT', `/api/alerts/${btn.dataset.id}`, { enabled: !enabled });
                    showToast(enabled ? t('settings.alerts.paused') : t('settings.alerts.enabled'), 'success');
                    renderTabAlerts(content);
                } catch (err) { showToast(err.message, 'error'); }
            });
        });

        content.querySelectorAll('.alert-delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ok = await showModal({
                    title: t('settings.alerts.deleteTitle'),
                    message: t('settings.alerts.deleteConfirm'),
                    confirmText: 'Delete',
                    danger: true,
                });
                if (!ok) return;
                try {
                    await api.request('DELETE', `/api/alerts/${btn.dataset.id}`);
                    showToast(t('settings.alerts.deleted'), 'success');
                    renderTabAlerts(content);
                } catch (err) { showToast(err.message, 'error'); }
            });
        });
    } catch (err) {
        content.innerHTML = `<div style="color:var(--danger);font-size:0.875rem">${escapeHtml(err.message)}</div>`;
    }
}

async function renderTabFollowUps(content) {
    content.innerHTML = '<div class="loading-container"><span class="spinner"></span></div>';
    try {
        const data = await api.request('GET', '/api/follow-up-templates');
        const templates = data.templates || [];
        content.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h2 style="font-size:1.125rem;font-weight:600">${t('settings.templates.title')}</h2>
                <button class="btn btn-primary btn-sm" id="add-followup-btn">${t('settings.templates.addTitle')}</button>
            </div>
            <p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:16px">${t('settings.templates.description')}</p>
            <div id="followup-list">
                ${templates.length === 0 ? `
                    <div class="empty-state" style="padding:32px">
                        <div class="empty-state-title">No templates yet</div>
                        <div class="empty-state-desc">Add a follow-up template to automate reminders.</div>
                    </div>
                ` : templates.map(t => `
                    <div class="card" style="padding:16px;margin-bottom:8px" data-template-id="${t.id}">
                        <div style="display:flex;justify-content:space-between;align-items:center">
                            <div>
                                <span style="font-weight:600;font-size:0.9375rem">${escapeHtml(t.name)}</span>
                                ${t.is_default ? `<span class="status-badge status-applied" style="margin-left:8px">${t('settings.resumes.defaultBadge')}</span>` : ''}
                                <span style="font-size:0.75rem;color:var(--text-tertiary);margin-left:8px">${t.days_after} days after apply</span>
                            </div>
                            <div style="display:flex;gap:6px">
                                <button class="btn btn-secondary btn-sm followup-edit-btn" data-id="${t.id}">Edit</button>
                                <button class="btn btn-danger btn-sm followup-delete-btn" data-id="${t.id}">Delete</button>
                            </div>
                        </div>
                        ${t.template_text ? `<div style="font-size:0.8125rem;color:var(--text-secondary);margin-top:6px;white-space:pre-wrap;max-height:60px;overflow:hidden">${escapeHtml(t.template_text.slice(0, 150))}${t.template_text.length > 150 ? '...' : ''}</div>` : ''}
                    </div>
                `).join('')}
            </div>
            <div id="followup-form-container" style="display:none">
                <div class="card" style="padding:20px;margin-top:16px">
                    <h3 style="font-size:1rem;font-weight:600;margin-bottom:12px" id="followup-form-title">${t('settings.templates.addTitle')}</h3>
                    <div style="display:flex;flex-direction:column;gap:12px">
                        <div>
                            <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">${t('settings.profile.referenceName')}</label>
                            <input type="text" class="search-input" id="followup-name-input" placeholder="${t('settings.templates.namePlaceholder')}" style="width:100%">
                        </div>
                        <div>
                            <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">${t('settings.templates.daysLabel')}</label>
                            <input type="number" class="search-input" id="followup-days-input" value="7" min="1" max="90" style="width:120px">
                        </div>
                        <div>
                            <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">${t('settings.templates.textLabel')}</label>
                            <textarea class="textarea-styled textarea-notes" id="followup-text-input" placeholder="${t('settings.templates.textPlaceholder')}"></textarea>
                        </div>
                        <div style="display:flex;gap:8px">
                            <button class="btn btn-primary btn-sm" id="followup-save-btn">${t('settings.common.save')}</button>
                            <button class="btn btn-secondary btn-sm" id="followup-cancel-btn">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        let editingId = null;

        document.getElementById('add-followup-btn').addEventListener('click', () => {
            editingId = null;
            document.getElementById('followup-form-title').textContent = 'Add Template';
            document.getElementById('followup-name-input').value = '';
            document.getElementById('followup-days-input').value = '7';
            document.getElementById('followup-text-input').value = '';
            document.getElementById('followup-form-container').style.display = '';
        });

        document.getElementById('followup-cancel-btn').addEventListener('click', () => {
            document.getElementById('followup-form-container').style.display = 'none';
        });

        document.getElementById('followup-save-btn').addEventListener('click', async () => {
            const name = document.getElementById('followup-name-input').value.trim();
            if (!name) { showToast(t('settings.common.nameRequired'), 'error'); return; }
            const body = {
                name,
                days_after: parseInt(document.getElementById('followup-days-input').value) || 7,
                template_text: document.getElementById('followup-text-input').value,
            };
            try {
                if (editingId) {
                    await api.request('PUT', `/api/follow-up-templates/${editingId}`, body);
                    showToast(t('settings.templates.updated'), 'success');
                } else {
                    await api.request('POST', '/api/follow-up-templates', body);
                    showToast(t('settings.templates.added'), 'success');
                }
                renderTabFollowUps(content);
            } catch (err) { showToast(err.message, 'error'); }
        });

        content.querySelectorAll('.followup-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id);
                const t = templates.find(x => x.id === id);
                if (!t) return;
                editingId = id;
                document.getElementById('followup-form-title').textContent = 'Edit Template';
                document.getElementById('followup-name-input').value = t.name || '';
                document.getElementById('followup-days-input').value = t.days_after || 7;
                document.getElementById('followup-text-input').value = t.template_text || '';
                document.getElementById('followup-form-container').style.display = '';
            });
        });

        content.querySelectorAll('.followup-delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ok = await showModal({
                    title: t('settings.templates.deleteTitle'),
                    message: t('settings.templates.deleteConfirm'),
                    confirmText: 'Delete',
                    danger: true,
                });
                if (!ok) return;
                try {
                    await api.request('DELETE', `/api/follow-up-templates/${btn.dataset.id}`);
                    showToast(t('settings.templates.deleted'), 'success');
                    renderTabFollowUps(content);
                } catch (err) { showToast(err.message, 'error'); }
            });
        });
    } catch (err) {
        content.innerHTML = `<div style="color:var(--danger);font-size:0.875rem">${escapeHtml(err.message)}</div>`;
    }
}

function renderTabResumes(content, resumes) {
    content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="font-size:1.125rem;font-weight:600">Manage Resumes</h2>
            <button class="btn btn-primary btn-sm" id="add-resume-btn">${t('settings.resumes.addTitle')}</button>
        </div>
        <div id="resumes-list">
            ${resumes.length === 0 ? `
                <div class="empty-state" style="padding:32px">
                    <div class="empty-state-title">No resumes yet</div>
                    <div class="empty-state-desc">Add a resume to use when preparing applications.</div>
                </div>
            ` : resumes.map(r => `
                <div class="card" style="padding:16px;margin-bottom:8px" data-resume-id="${r.id}">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <div>
                            <span style="font-weight:600;font-size:0.9375rem">${escapeHtml(r.name)}</span>
                            ${r.is_default ? `<span class="status-badge status-applied" style="margin-left:8px">${t('settings.resumes.defaultBadge')}</span>` : ''}
                        </div>
                        <div style="display:flex;gap:6px">
                            ${!r.is_default ? `<button class="btn btn-secondary btn-sm resume-default-btn" data-id="${r.id}">Set Default</button>` : ''}
                            <button class="btn btn-secondary btn-sm resume-edit-btn" data-id="${r.id}">Edit</button>
                            <button class="btn btn-danger btn-sm resume-delete-btn" data-id="${r.id}">Delete</button>
                        </div>
                    </div>
                    ${r.summary ? `<div style="font-size:0.8125rem;color:var(--text-secondary);margin-top:6px">${escapeHtml(r.summary)}</div>` : ''}
                    <div style="font-size:0.75rem;color:var(--text-tertiary);margin-top:4px">${r.resume_text ? `${r.resume_text.length} chars` : t('settings.resumes.noContent')}</div>
                </div>
            `).join('')}
        </div>
        <div id="resume-form-container" style="display:none">
            <div class="card" style="padding:20px;margin-top:16px">
                <h3 style="font-size:1rem;font-weight:600;margin-bottom:12px" id="resume-form-title">${t('settings.resumes.addTitle')}</h3>
                <div style="display:flex;flex-direction:column;gap:12px">
                    <div>
                        <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">${t('settings.profile.referenceName')}</label>
                        <input type="text" class="search-input" id="resume-name-input" placeholder="${t('settings.resumes.namePlaceholder')}" style="width:100%">
                    </div>
                    <div>
                        <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">${t('settings.resumes.summaryLabel')}</label>
                        <input type="text" class="search-input" id="resume-summary-input" placeholder="${t('settings.resumes.summaryPlaceholder')}" style="width:100%">
                    </div>
                    <div>
                        <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">${t('settings.resumes.textLabel')}</label>
                        <textarea class="textarea-styled" id="resume-text-input" style="min-height:200px" placeholder="${t('settings.resumes.textPlaceholder')}"></textarea>
                    </div>
                    <div style="display:flex;gap:8px">
                        <button class="btn btn-primary btn-sm" id="resume-save-btn">${t('settings.common.save')}</button>
                        <button class="btn btn-secondary btn-sm" id="resume-cancel-btn">Cancel</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    let editingId = null;

    document.getElementById('add-resume-btn').addEventListener('click', () => {
        editingId = null;
        document.getElementById('resume-form-title').textContent = 'Add Resume';
        document.getElementById('resume-name-input').value = '';
        document.getElementById('resume-summary-input').value = '';
        document.getElementById('resume-text-input').value = '';
        document.getElementById('resume-form-container').style.display = '';
    });

    document.getElementById('resume-cancel-btn').addEventListener('click', () => {
        document.getElementById('resume-form-container').style.display = 'none';
    });

    document.getElementById('resume-save-btn').addEventListener('click', async () => {
        const name = document.getElementById('resume-name-input').value.trim();
        if (!name) { showToast(t('settings.common.nameRequired'), 'error'); return; }
        const body = {
            name,
            summary: document.getElementById('resume-summary-input').value.trim(),
            resume_text: document.getElementById('resume-text-input').value,
        };
        try {
            if (editingId) {
                await api.request('PUT', `/api/resumes/${editingId}`, body);
                showToast(t('settings.resumes.updated'), 'success');
            } else {
                await api.request('POST', '/api/resumes', body);
                showToast(t('settings.resumes.added'), 'success');
            }
            const data = await api.request('GET', '/api/resumes');
            settingsData.resumes = data.resumes || [];
            renderTabResumes(content, settingsData.resumes);
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    content.querySelectorAll('.resume-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id);
            const r = resumes.find(x => x.id === id);
            if (!r) return;
            editingId = id;
            document.getElementById('resume-form-title').textContent = 'Edit Resume';
            document.getElementById('resume-name-input').value = r.name || '';
            document.getElementById('resume-summary-input').value = r.summary || '';
            document.getElementById('resume-text-input').value = r.resume_text || '';
            document.getElementById('resume-form-container').style.display = '';
        });
    });

    content.querySelectorAll('.resume-default-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await api.request('POST', `/api/resumes/${btn.dataset.id}/set-default`);
                showToast(t('settings.resumes.defaultUpdated'), 'success');
                const data = await api.request('GET', '/api/resumes');
                settingsData.resumes = data.resumes || [];
                renderTabResumes(content, settingsData.resumes);
            } catch (err) { showToast(err.message, 'error'); }
        });
    });

    content.querySelectorAll('.resume-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const ok = await showModal({
                title: t('settings.resumes.deleteTitle'),
                message: t('settings.resumes.deleteConfirm'),
                confirmText: 'Delete',
                danger: true,
            });
            if (!ok) return;
            try {
                await api.request('DELETE', `/api/resumes/${btn.dataset.id}`);
                showToast(t('settings.resumes.deleted'), 'success');
                const data = await api.request('GET', '/api/resumes');
                settingsData.resumes = data.resumes || [];
                renderTabResumes(content, settingsData.resumes);
            } catch (err) { showToast(err.message, 'error'); }
        });
    });
}

function settingsField(label, id, value, type = 'text', opts = {}) {
    const ph = opts.placeholder || '';
    const extra = opts.extra || '';
    return `<div>
        <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">${label}</label>
        <input type="${type}" class="search-input" id="${id}" value="${escapeHtml(value != null ? String(value) : '')}" placeholder="${escapeHtml(ph)}" style="width:100%" ${extra}>
    </div>`;
}

function settingsSelect(label, id, value, options) {
    return `<div>
        <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">${label}</label>
        <select class="filter-select" id="${id}" style="width:100%">
            ${options.map(o => {
                const val = typeof o === 'string' ? o : o.value;
                const lbl = typeof o === 'string' ? o : o.label;
                return `<option value="${escapeHtml(val)}" ${val === (value || '') ? 'selected' : ''}>${escapeHtml(lbl)}</option>`;
            }).join('')}
        </select>
    </div>`;
}

// === Tab 1: Profile ===
function renderTabProfile(container, p) {
    const mil = p.military || {};
    const eeo = p.eeo || {};
    const sameAddr = !p.perm_address_street1 && !p.perm_address_city;
    const nameParts = (p.full_name || '').split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.length > 2 ? nameParts.slice(2).join(' ') : (nameParts[1] || '');

    container.innerHTML = `
        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">Personal Information</h2>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
                ${settingsField(t('settings.profile.firstName'), 'pf-first', firstName)}
                ${settingsField(t('settings.profile.middleName'), 'pf-middle', p.middle_name)}
                ${settingsField(t('settings.profile.lastName'), 'pf-last', lastName)}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
                ${settingsField(t('settings.profile.preferredName'), 'pf-preferred', p.preferred_name)}
                ${settingsField(t('settings.profile.email'), 'pf-email', p.email, 'email')}
                ${settingsSelect('Pronouns', 'pf-pronouns', p.pronouns, [
                    {value:'',label:'Select...'},{value:'he/him',label:'He/Him'},{value:'she/her',label:'She/Her'},
                    {value:'they/them',label:'They/Them'},{value:'other',label:t('settings.profile.genderOther')},
                ])}
            </div>
            <div style="display:grid;grid-template-columns:auto 1fr auto 1fr;gap:12px;margin-bottom:12px">
                ${settingsSelect('Code', 'pf-phone-cc', p.phone_country_code || '+1', [
                    {value:'+1',label:'+1 (US/CA)'},{value:'+44',label:'+44 (UK)'},{value:'+61',label:'+61 (AU)'},
                    {value:'+49',label:'+49 (DE)'},{value:'+33',label:'+33 (FR)'},{value:'+91',label:'+91 (IN)'},
                    {value:'+81',label:'+81 (JP)'},{value:'+86',label:'+86 (CN)'},{value:'+55',label:'+55 (BR)'},
                    {value:'+52',label:'+52 (MX)'},{value:'+82',label:'+82 (KR)'},
                ])}
                ${settingsField(t('settings.profile.phone'), 'pf-phone', p.phone, 'tel')}
                ${settingsSelect(t('settings.profile.phoneType'), 'pf-phone-type', p.phone_type, [
                    {value:'',label:'Select...'},{value:'mobile',label:t('settings.profile.phoneTypeMobile')},{value:'home',label:t('settings.profile.phoneTypeHome')},{value:'work',label:t('settings.profile.phoneTypeWork')},
                ])}
                ${settingsField(t('settings.profile.additionalPhone'), 'pf-addl-phone', p.additional_phone, 'tel')}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                ${settingsField(t('settings.profile.dateOfBirth'), 'pf-dob', p.date_of_birth, 'date')}
                ${settingsField(t('settings.profile.locationQuickCopy'), 'pf-location', p.location)}
            </div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">${t('settings.profile.address')}</h2>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
                ${settingsField('Street Address 1', 'pf-addr1', p.address_street1)}
                ${settingsField('Street Address 2', 'pf-addr2', p.address_street2)}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:16px">
                ${settingsField(t('settings.profile.city'), 'pf-addr-city', p.address_city)}
                ${settingsField(t('settings.profile.state'), 'pf-addr-state', p.address_state)}
                ${settingsField(t('settings.profile.zip'), 'pf-addr-zip', p.address_zip)}
                ${settingsField(t('fields.country'), 'pf-addr-country', p.address_country_name || p.address_country_code)}
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-size:0.875rem;cursor:pointer;margin-bottom:12px">
                <input type="checkbox" id="pf-same-addr" ${sameAddr ? 'checked' : ''}> Permanent address same as above
            </label>
            <div id="pf-perm-addr" style="${sameAddr ? 'display:none' : ''}">
                <h3 style="font-size:0.9375rem;font-weight:600;margin-bottom:12px;color:var(--text-secondary)">Permanent Address</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
                    ${settingsField('Street 1', 'pf-perm1', p.perm_address_street1)}
                    ${settingsField('Street 2', 'pf-perm2', p.perm_address_street2)}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px">
                    ${settingsField(t('settings.profile.city'), 'pf-perm-city', p.perm_address_city)}
                    ${settingsField(t('settings.profile.state'), 'pf-perm-state', p.perm_address_state)}
                    ${settingsField(t('settings.profile.zip'), 'pf-perm-zip', p.perm_address_zip)}
                    ${settingsField(t('fields.country'), 'pf-perm-country', p.perm_address_country_name || p.perm_address_country_code)}
                </div>
            </div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">Links</h2>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                ${settingsField(t('settings.profile.linkedin'), 'pf-linkedin', p.linkedin_url, 'url')}
                ${settingsField(t('settings.profile.github'), 'pf-github', p.github_url, 'url')}
                ${settingsField('Portfolio', 'pf-portfolio', p.portfolio_url, 'url')}
                ${settingsField('Website', 'pf-website', p.website_url, 'url')}
            </div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">Driver's License</h2>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
                ${settingsSelect(t('settings.profile.hasLicense'), 'pf-dl', p.drivers_license, [
                    {value:'',label:'Select...'},{value:'yes',label:t('actions.yes')},{value:'no',label:t('actions.no')},
                ])}
                ${settingsField('Class', 'pf-dl-class', p.drivers_license_class)}
                ${settingsField(t('settings.profile.state'), 'pf-dl-state', p.drivers_license_state)}
            </div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">Work Authorization</h2>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
                ${settingsField(t('settings.profile.countryOfCitizenship'), 'pf-citizen', p.country_of_citizenship)}
                ${settingsSelect(t('settings.profile.workAuth'), 'pf-auth-us', p.authorized_to_work_us, [
                    {value:'',label:'Select...'},{value:'yes',label:t('actions.yes')},{value:'no',label:t('actions.no')},
                ])}
                ${settingsSelect('Requires Sponsorship?', 'pf-sponsor', p.requires_sponsorship, [
                    {value:'',label:'Select...'},{value:'yes',label:t('actions.yes')},{value:'no',label:t('actions.no')},
                ])}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
                ${settingsSelect('Authorization Type', 'pf-auth-type', p.authorization_type, [
                    {value:'',label:'Select...'},{value:'citizen',label:'US Citizen'},{value:'permanent_resident',label:'Permanent Resident'},
                    {value:'h1b',label:'H-1B'},{value:'opt',label:'OPT'},{value:'ead',label:'EAD'},
                    {value:'tn',label:'TN Visa'},{value:'other',label:t('settings.profile.genderOther')},
                ])}
                ${settingsSelect('Security Clearance', 'pf-clearance', p.security_clearance, [
                    {value:'',label:t('common.none')},{value:'confidential',label:'Confidential'},{value:'secret',label:'Secret'},
                    {value:'top_secret',label:'Top Secret'},{value:'ts_sci',label:'TS/SCI'},
                ])}
                ${settingsSelect(t('settings.profile.clearanceStatus'), 'pf-clear-status', p.clearance_status, [
                    {value:'',label:'N/A'},{value:'active',label:t('status.active')},{value:'inactive',label:t('status.inactive')},{value:'expired',label:'Expired'},
                ])}
            </div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">Military Service</h2>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
                ${settingsField('Branch', 'pf-mil-branch', mil.branch)}
                ${settingsField('Rank', 'pf-mil-rank', mil.rank)}
                ${settingsField('Specialty / MOS', 'pf-mil-spec', mil.specialty)}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                ${settingsField('Start Date', 'pf-mil-start', mil.start_date, 'date')}
                ${settingsField('End Date', 'pf-mil-end', mil.end_date, 'date')}
            </div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:8px">Voluntary Self-Identification (EEO)</h2>
            <p style="color:var(--text-secondary);font-size:0.8125rem;margin-bottom:16px">${t('settings.profile.selfIdDescription')}</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                ${settingsSelect(t('settings.profile.gender'), 'pf-eeo-gender', eeo.gender, [
                    {value:'',label:t('settings.profile.declineSelfId')},{value:'male',label:t('settings.profile.genderMale')},{value:'female',label:t('settings.profile.genderFemale')},
                    {value:'non_binary',label:t('settings.profile.genderNonBinary')},{value:'other',label:t('settings.profile.genderOther')},
                ])}
                ${settingsSelect(t('settings.profile.race'), 'pf-eeo-race', eeo.race_ethnicity, [
                    {value:'',label:t('settings.profile.declineSelfId')},
                    {value:'american_indian',label:t('settings.profile.raceAmericanIndian')},
                    {value:'asian',label:t('settings.profile.raceAsian')},{value:'black',label:t('settings.profile.raceBlack')},
                    {value:'hispanic',label:t('settings.profile.raceHispanic')},{value:'native_hawaiian',label:t('settings.profile.racePacificIslander')},
                    {value:'white',label:t('settings.profile.raceWhite')},{value:'two_or_more',label:t('settings.profile.raceTwoOrMore')},
                ])}
                ${settingsSelect(t('settings.profile.disabilityStatus'), 'pf-eeo-disability', eeo.disability_status, [
                    {value:'',label:t('settings.profile.declineSelfId')},
                    {value:'yes',label:t('settings.profile.disabilityYes')},{value:'no',label:t('settings.profile.disabilityNo')},
                ])}
                ${settingsSelect(t('settings.profile.veteranStatus'), 'pf-eeo-veteran', eeo.veteran_status, [
                    {value:'',label:t('settings.profile.declineSelfId')},
                    {value:'not_veteran',label:t('settings.profile.veteranNotProtected')},
                    {value:'protected_veteran',label:t('settings.profile.veteranProtected')},
                ])}
                ${settingsSelect(t('settings.profile.sexualOrientation'), 'pf-eeo-orient', eeo.sexual_orientation, [
                    {value:'',label:t('settings.profile.declineSelfId')},
                    {value:'heterosexual',label:'Heterosexual'},{value:'gay_lesbian',label:t('settings.profile.orientationGay')},
                    {value:'bisexual',label:t('settings.profile.orientationBisexual')},{value:'other',label:t('settings.profile.genderOther')},
                ])}
            </div>
        </div>

        <button class="btn btn-primary" id="save-profile-btn" style="margin-bottom:24px">${t('settings.profile.saveProfile')}</button>
    `;

    document.getElementById('pf-same-addr')?.addEventListener('change', e => {
        document.getElementById('pf-perm-addr').style.display = e.target.checked ? 'none' : '';
    });

    document.getElementById('save-profile-btn').addEventListener('click', async () => {
        const first = document.getElementById('pf-first').value.trim();
        const middle = document.getElementById('pf-middle').value.trim();
        const last = document.getElementById('pf-last').value.trim();
        const sameAddress = document.getElementById('pf-same-addr').checked;

        const profileData = {
            full_name: [first, middle, last].filter(Boolean).join(' '),
            middle_name: middle,
            preferred_name: document.getElementById('pf-preferred').value,
            email: document.getElementById('pf-email').value,
            pronouns: document.getElementById('pf-pronouns').value,
            phone_country_code: document.getElementById('pf-phone-cc').value,
            phone: document.getElementById('pf-phone').value,
            phone_type: document.getElementById('pf-phone-type').value,
            additional_phone: document.getElementById('pf-addl-phone').value,
            date_of_birth: document.getElementById('pf-dob').value,
            location: document.getElementById('pf-location').value,
            address_street1: document.getElementById('pf-addr1').value,
            address_street2: document.getElementById('pf-addr2').value,
            address_city: document.getElementById('pf-addr-city').value,
            address_state: document.getElementById('pf-addr-state').value,
            address_zip: document.getElementById('pf-addr-zip').value,
            address_country_name: document.getElementById('pf-addr-country').value,
            perm_address_street1: sameAddress ? '' : document.getElementById('pf-perm1').value,
            perm_address_street2: sameAddress ? '' : document.getElementById('pf-perm2').value,
            perm_address_city: sameAddress ? '' : document.getElementById('pf-perm-city').value,
            perm_address_state: sameAddress ? '' : document.getElementById('pf-perm-state').value,
            perm_address_zip: sameAddress ? '' : document.getElementById('pf-perm-zip').value,
            perm_address_country_name: sameAddress ? '' : document.getElementById('pf-perm-country').value,
            linkedin_url: document.getElementById('pf-linkedin').value,
            github_url: document.getElementById('pf-github').value,
            portfolio_url: document.getElementById('pf-portfolio').value,
            website_url: document.getElementById('pf-website').value,
            drivers_license: document.getElementById('pf-dl').value,
            drivers_license_class: document.getElementById('pf-dl-class').value,
            drivers_license_state: document.getElementById('pf-dl-state').value,
            country_of_citizenship: document.getElementById('pf-citizen').value,
            authorized_to_work_us: document.getElementById('pf-auth-us').value,
            requires_sponsorship: document.getElementById('pf-sponsor').value,
            authorization_type: document.getElementById('pf-auth-type').value,
            security_clearance: document.getElementById('pf-clearance').value,
            clearance_status: document.getElementById('pf-clear-status').value,
        };
        const military = {
            branch: document.getElementById('pf-mil-branch').value,
            rank: document.getElementById('pf-mil-rank').value,
            specialty: document.getElementById('pf-mil-spec').value,
            start_date: document.getElementById('pf-mil-start').value,
            end_date: document.getElementById('pf-mil-end').value,
        };
        const eeoData = {
            gender: document.getElementById('pf-eeo-gender').value,
            race_ethnicity: document.getElementById('pf-eeo-race').value,
            disability_status: document.getElementById('pf-eeo-disability').value,
            veteran_status: document.getElementById('pf-eeo-veteran').value,
            sexual_orientation: document.getElementById('pf-eeo-orient').value,
        };
        try {
            await api.request('PUT', '/api/profile/full', { ...profileData, military, eeo: eeoData });
            settingsData.fullProfile = { ...settingsData.fullProfile, ...profileData, military, eeo: eeoData };
            settingsData.profile = { ...settingsData.profile, ...profileData };
            showToast(t('settings.profile.savedProfile'), 'success');
        } catch (err) { showToast(err.message, 'error'); }
    });
}

// === Tab 2: Work History ===
function renderTabWorkHistory(container, fp) {
    const workHistory = fp.work_history || [];
    const education = fp.education || [];
    const certs = fp.certifications || [];
    const skills = fp.skills || [];
    const languages = fp.languages || [];
    const references = fp.references || [];

    function itemCard(item, type, line1, line2, extra) {
        return `<div style="padding:12px 16px;background:var(--bg-surface-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;display:flex;justify-content:space-between;align-items:start">
            <div style="min-width:0;flex:1">
                <div style="font-weight:600;font-size:0.875rem">${escapeHtml(line1 || '(empty)')}</div>
                ${line2 ? `<div style="color:var(--text-secondary);font-size:0.8125rem">${escapeHtml(line2)}</div>` : ''}
                ${extra ? `<div style="color:var(--text-tertiary);font-size:0.75rem;margin-top:2px">${extra}</div>` : ''}
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;margin-left:8px">
                <button class="btn btn-ghost btn-sm wh-edit-btn" data-type="${type}" data-id="${item.id}">${t('actions.edit')}</button>
                <button class="btn btn-danger btn-sm wh-delete-btn" data-type="${type}" data-id="${item.id}">Delete</button>
            </div>
        </div>`;
    }

    container.innerHTML = `
        <div class="card" style="padding:24px;margin-bottom:24px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h2 style="font-size:1.125rem;font-weight:600;margin:0">Work Experience</h2>
                <button class="btn btn-primary btn-sm wh-add-btn" data-type="work-history">${t('settings.common.add')}</button>
            </div>
            <div id="wh-work-history-list">${workHistory.length ? workHistory.map(w => {
                const dates = [w.start_month ? `${w.start_month}/` : '', w.start_year || '', w.is_current ? ' - Present' : (w.end_year ? ` - ${w.end_month ? w.end_month + '/' : ''}${w.end_year}` : '')].join('');
                return itemCard(w, 'work-history', w.job_title, w.company, [w.location_city, w.location_state].filter(Boolean).join(', ') + (dates ? ' | ' + dates : ''));
            }).join('') : `<p style="color:var(--text-tertiary);font-size:0.875rem">${t('settings.common.noEntries')}</p>`}</div>
            <div id="wh-work-history-form"></div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h2 style="font-size:1.125rem;font-weight:600;margin:0">${t('settings.profile.education')}</h2>
                <button class="btn btn-primary btn-sm wh-add-btn" data-type="education">${t('settings.common.add')}</button>
            </div>
            <div id="wh-education-list">${education.length ? education.map(e => itemCard(e, 'education', e.school, [e.degree_type, e.field_of_study].filter(Boolean).join(' - '), e.grad_year ? t('settings.common.graduated', { year: e.grad_year }) : '')).join('') : `<p style="color:var(--text-tertiary);font-size:0.875rem">${t('settings.common.noEntries')}</p>`}</div>
            <div id="wh-education-form"></div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h2 style="font-size:1.125rem;font-weight:600;margin:0">${t('settings.profile.certifications')}</h2>
                <button class="btn btn-primary btn-sm wh-add-btn" data-type="certifications">${t('settings.common.add')}</button>
            </div>
            <div id="wh-certifications-list">${certs.length ? certs.map(c => itemCard(c, 'certifications', c.name, c.issuing_org, [c.cert_type, c.date_obtained].filter(Boolean).join(' | '))).join('') : `<p style="color:var(--text-tertiary);font-size:0.875rem">${t('settings.common.noEntries')}</p>`}</div>
            <div id="wh-certifications-form"></div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h2 style="font-size:1.125rem;font-weight:600;margin:0">${t('settings.profile.skills')}</h2>
                <button class="btn btn-primary btn-sm wh-add-btn" data-type="skills">${t('settings.common.add')}</button>
            </div>
            <div id="wh-skills-list">${skills.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${skills.map(s => `
                <span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg-surface-secondary);border:1px solid var(--border);padding:4px 10px;border-radius:6px;font-size:0.875rem">
                    ${escapeHtml(s.name)}${s.years_experience ? ` (${s.years_experience}yr)` : ''}${s.proficiency ? ` - ${s.proficiency}` : ''}
                    <button class="btn btn-ghost btn-sm wh-delete-btn" data-type="skills" data-id="${s.id}" style="color:var(--danger);padding:0 2px;font-size:0.75rem;min-width:auto">x</button>
                </span>
            `).join('')}</div>` : `<p style="color:var(--text-tertiary);font-size:0.875rem">${t('settings.profile.noSkillsAdded')}</p>`}</div>
            <div id="wh-skills-form"></div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h2 style="font-size:1.125rem;font-weight:600;margin:0">${t('settings.profile.languages')}</h2>
                <button class="btn btn-primary btn-sm wh-add-btn" data-type="languages">${t('settings.common.add')}</button>
            </div>
            <div id="wh-languages-list">${languages.length ? languages.map(l => itemCard(l, 'languages', l.language, l.proficiency)).join('') : `<p style="color:var(--text-tertiary);font-size:0.875rem">${t('settings.common.noEntries')}</p>`}</div>
            <div id="wh-languages-form"></div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h2 style="font-size:1.125rem;font-weight:600;margin:0">${t('settings.profile.references')}</h2>
                <button class="btn btn-primary btn-sm wh-add-btn" data-type="references">${t('settings.common.add')}</button>
            </div>
            <div id="wh-references-list">${references.length ? references.map(r => itemCard(r, 'references', r.name, [r.title, r.company].filter(Boolean).join(' at '), [r.phone, r.email].filter(Boolean).join(' | '))).join('') : `<p style="color:var(--text-tertiary);font-size:0.875rem">${t('settings.common.noEntries')}</p>`}</div>
            <div id="wh-references-form"></div>
        </div>
    `;

    const formConfigs = {
        'work-history': { endpoint: '/api/work-history', fields: [
            {key:'job_title',label:t('settings.profile.jobTitle'),type:'text'},{key:'company',label:t('settings.profile.company'),type:'text'},
            {key:'location_city',label:t('settings.profile.city'),type:'text'},{key:'location_state',label:t('settings.profile.state'),type:'text'},{key:'location_country',label:t('fields.country'),type:'text'},
            {key:'start_month',label:t('settings.profile.startMonth'),type:'number',extra:'min="1" max="12"'},{key:'start_year',label:'Start Year',type:'number',extra:'min="1950" max="2030"'},
            {key:'end_month',label:t('settings.profile.endMonth'),type:'number',extra:'min="1" max="12"'},{key:'end_year',label:t('settings.profile.endYear'),type:'number',extra:'min="1950" max="2030"'},
            {key:'is_current',label:'Current?',type:'checkbox'},
            {key:'description',label:t('fields.description'),type:'textarea'},
            {key:'salary_at_position',label:t('fields.salary'),type:'text'},
        ], listKey: 'work_history'},
        'education': { endpoint: '/api/education', fields: [
            {key:'school',label:t('settings.profile.school'),type:'text'},{key:'degree_type',label:t('settings.profile.degreeType'),type:'select',options:[
                {value:'',label:'Select...'},{value:'high_school',label:'High School'},{value:'associates',label:'Associates'},
                {value:'bachelors',label:'Bachelors'},{value:'masters',label:'Masters'},{value:'mba',label:'MBA'},
                {value:'phd',label:'PhD'},{value:'other',label:t('settings.profile.genderOther')},
            ]},
            {key:'field_of_study',label:t('settings.profile.fieldOfStudy'),type:'text'},{key:'minor',label:'Minor',type:'text'},
            {key:'start_year',label:'Start Year',type:'number'},{key:'grad_year',label:'Grad Year',type:'number'},
            {key:'gpa',label:'GPA',type:'text'},{key:'honors',label:'Honors',type:'text'},
        ], listKey: 'education'},
        'certifications': { endpoint: '/api/certifications', fields: [
            {key:'name',label:t('settings.profile.referenceName'),type:'text'},{key:'issuing_org',label:'Issuing Org',type:'text'},
            {key:'cert_type',label:t('settings.profile.certType'),type:'select',options:[{value:'certification',label:'Certification'},{value:'license',label:'License'}]},
            {key:'license_number',label:'License #',type:'text'},{key:'state',label:t('settings.profile.state'),type:'text'},
            {key:'date_obtained',label:t('settings.profile.dateObtained'),type:'date'},{key:'expiration_date',label:'Expiration',type:'date'},
        ], listKey: 'certifications'},
        'skills': { endpoint: '/api/skills', fields: [
            {key:'name',label:'Skill',type:'text'},{key:'years_experience',label:t('settings.profile.yearsExperienceShort'),type:'number'},
            {key:'proficiency',label:t('settings.profile.proficiency'),type:'select',options:[
                {value:'',label:'Select...'},{value:'beginner',label:'Beginner'},{value:'intermediate',label:'Intermediate'},
                {value:'advanced',label:'Advanced'},{value:'expert',label:'Expert'},
            ]},
        ], listKey: 'skills'},
        'languages': { endpoint: '/api/languages', fields: [
            {key:'language',label:t('settings.profile.language'),type:'text'},
            {key:'proficiency',label:t('settings.profile.proficiency'),type:'select',options:[
                {value:'conversational',label:'Conversational'},{value:'professional',label:'Professional'},
                {value:'native',label:'Native / Bilingual'},{value:'basic',label:'Basic'},
            ]},
        ], listKey: 'languages'},
        'references': { endpoint: '/api/references', fields: [
            {key:'name',label:t('settings.profile.referenceName'),type:'text'},{key:'title',label:t('settings.profile.referenceTitle'),type:'text'},
            {key:'company',label:t('settings.profile.company'),type:'text'},{key:'phone',label:t('settings.profile.phone'),type:'tel'},
            {key:'email',label:t('settings.profile.email'),type:'email'},{key:'relationship',label:'Relationship',type:'text'},
            {key:'years_known',label:'Years Known',type:'number'},
        ], listKey: 'references'},
    };

    function showForm(type, existingItem) {
        const cfg = formConfigs[type];
        const formEl = document.getElementById(`wh-${type}-form`);
        if (!formEl) return;
        const data = existingItem || {};
        const isEdit = !!data.id;
        const gridCols = cfg.fields.length <= 3 ? `repeat(${cfg.fields.length}, 1fr)` : 'repeat(auto-fill, minmax(180px, 1fr))';

        formEl.innerHTML = `
            <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-top:12px;background:var(--bg-surface-secondary)">
                <div style="display:grid;grid-template-columns:${gridCols};gap:12px;margin-bottom:12px">
                    ${cfg.fields.map(f => {
                        const id = `wh-f-${type}-${f.key}`;
                        if (f.type === 'textarea') return `<div style="grid-column:1/-1"><label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">${f.label}</label><textarea class="textarea-styled textarea-notes" id="${id}" style="width:100%;min-height:80px">${escapeHtml(String(data[f.key] || ''))}</textarea></div>`;
                        if (f.type === 'checkbox') return `<div style="display:flex;align-items:center;gap:8px;align-self:end;padding-bottom:8px"><input type="checkbox" id="${id}" ${data[f.key] ? 'checked' : ''}><label style="font-size:0.8125rem;font-weight:600;color:var(--text-tertiary)">${f.label}</label></div>`;
                        if (f.type === 'select') return settingsSelect(f.label, id, String(data[f.key] || ''), f.options);
                        return settingsField(f.label, id, data[f.key], f.type, { extra: f.extra || '' });
                    }).join('')}
                </div>
                <div style="display:flex;gap:8px">
                    <button class="btn btn-primary btn-sm" id="wh-save-${type}">${isEdit ? t('actions.update') : t('settings.common.save')}</button>
                    <button class="btn btn-secondary btn-sm" id="wh-cancel-${type}">Cancel</button>
                </div>
            </div>`;

        document.getElementById(`wh-save-${type}`).addEventListener('click', async () => {
            const entry = {};
            if (data.id) entry.id = data.id;
            cfg.fields.forEach(f => {
                const input = document.getElementById(`wh-f-${type}-${f.key}`);
                if (!input) return;
                if (f.type === 'checkbox') entry[f.key] = input.checked ? 1 : 0;
                else if (f.type === 'number') entry[f.key] = input.value ? parseInt(input.value) : null;
                else entry[f.key] = input.value;
            });
            try {
                await api.request('POST', cfg.endpoint, entry);
                showToast(isEdit ? t('toast.updated') : 'Added', 'success');
                settingsData.fullProfile = await api.request('GET', '/api/profile/full');
                renderTabWorkHistory(container, settingsData.fullProfile);
            } catch (err) { showToast(err.message, 'error'); }
        });
        document.getElementById(`wh-cancel-${type}`).addEventListener('click', () => { formEl.innerHTML = ''; });
    }

    // Add buttons
    container.querySelectorAll('.wh-add-btn').forEach(btn => {
        btn.addEventListener('click', () => showForm(btn.dataset.type, null));
    });

    // Edit buttons
    container.querySelectorAll('.wh-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            const id = parseInt(btn.dataset.id);
            const cfg = formConfigs[type];
            const items = fp[cfg.listKey] || [];
            const item = items.find(i => i.id === id);
            if (item) showForm(type, item);
        });
    });

    // Delete buttons
    container.querySelectorAll('.wh-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const type = btn.dataset.type;
            const id = btn.dataset.id;
            const ok = await showModal({
                title: t('settings.common.deleteEntry'),
                message: t('settings.common.deleteEntryConfirm'),
                confirmText: 'Delete',
                danger: true,
            });
            if (!ok) return;
            try {
                await api.request('DELETE', `/api/${type}/${id}`);
                settingsData.fullProfile = await api.request('GET', '/api/profile/full');
                renderTabWorkHistory(container, settingsData.fullProfile);
                showToast(t('toast.deleted'), 'info');
            } catch (err) { showToast(err.message, 'error'); }
        });
    });
}

// === Tab 3: Job Search ===
function renderTabJobSearch(container, config, profile, customQA) {
    const termsValue = (config.search_terms || []).join('\n');
    const excludeTermsValue = (config.exclude_terms || []).join('\n');
    const hasResume = config.resume_text && config.resume_text.length > 0;
    const jobTitles = config.job_titles || [];
    const keySkills = config.key_skills || [];
    const seniority = config.seniority || '';
    const summary = config.summary || '';
    const atsScore = config.ats_score || 0;
    const atsIssues = config.ats_issues || [];
    const atsTips = config.ats_tips || [];
    const hasAts = atsScore > 0;
    const hasAnalysis = jobTitles.length > 0 || summary;

    container.innerHTML = `
        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">${t('settings.alerts.resume')}</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.875rem">
                Upload your resume to automatically derive search terms. Supported: .pdf, .txt, .md files.
            </p>
            ${hasResume ? `<div class="status-badge status-prepared" style="margin-bottom:12px">${t('settings.resumes.uploadedChars', { count: config.resume_text.length })}</div>` : ''}
            <div style="display:flex;gap:12px;align-items:center">
                <input type="file" id="resume-file" accept=".pdf,.txt,.md,.text" style="font-size:0.875rem">
                <button class="btn btn-primary" id="upload-resume-btn">${t('settings.resumes.uploadAnalyze')}</button>
            </div>
        </div>

        ${hasAts ? `
        <div class="card" style="padding:24px;margin-bottom:24px;${atsScore < 60 ? 'border-left:4px solid var(--danger)' : atsScore < 80 ? 'border-left:4px solid var(--warning, #f59e0b)' : 'border-left:4px solid var(--success, #22c55e)'}">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
                <h2 style="font-size:1.125rem;font-weight:600;margin:0">ATS Compatibility</h2>
                <span class="score-badge ${atsScore >= 80 ? 'score-badge-green' : atsScore >= 60 ? 'score-badge-amber' : 'score-badge-gray'}" style="font-size:1.25rem;padding:8px 16px">${atsScore}/100</span>
            </div>
            ${atsIssues.length ? `<div style="margin-bottom:12px"><span style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-tertiary)">Issues Found</span><ul style="margin-top:8px;padding-left:20px;display:flex;flex-direction:column;gap:4px">${atsIssues.map(i => `<li style="font-size:0.875rem;color:var(--text-secondary)">${escapeHtml(i)}</li>`).join('')}</ul></div>` : ''}
            ${atsTips.length ? `<div><span style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-tertiary)">Suggestions</span><ul style="margin-top:8px;padding-left:20px;display:flex;flex-direction:column;gap:4px">${atsTips.map(t => `<li style="font-size:0.875rem;color:var(--text-secondary)">${escapeHtml(t)}</li>`).join('')}</ul></div>` : ''}
        </div>` : ''}

        ${hasAnalysis ? `
        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">Resume Analysis</h2>
            ${summary ? `<p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.9375rem;line-height:1.6">${escapeHtml(summary)}</p>` : ''}
            ${seniority ? `<div style="margin-bottom:16px"><span style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-tertiary)">Seniority Level</span><div style="margin-top:4px;font-weight:600">${escapeHtml(seniority)}</div></div>` : ''}
            ${keySkills.length ? `<div style="margin-bottom:16px"><span style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-tertiary)">Key Skills</span><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${keySkills.map(s => `<span style="background:var(--bg-tertiary);color:var(--text-primary);padding:4px 10px;border-radius:6px;font-size:0.8125rem">${escapeHtml(s)}</span>`).join('')}</div></div>` : ''}
            ${jobTitles.length ? `<div><span style="font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-tertiary)">Best-Fit Job Titles</span><div style="margin-top:8px;display:flex;flex-direction:column;gap:8px">${jobTitles.map(jt => {
                const title = typeof jt === 'string' ? jt : jt.title;
                const why = typeof jt === 'object' && jt.why ? jt.why : '';
                return `<div style="padding:10px 14px;border-radius:8px;background:var(--bg-tertiary)"><div style="font-weight:600;font-size:0.9375rem">${escapeHtml(title)}</div>${why ? `<div style="color:var(--text-secondary);font-size:0.8125rem;margin-top:2px">${escapeHtml(why)}</div>` : ''}</div>`;
            }).join('')}</div></div>` : ''}
        </div>` : ''}

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">${t('settings.jobSearch.searchTerms')}</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.875rem">
                These terms are used by scrapers to find relevant jobs. One per line.
            </p>
            <textarea class="textarea-styled" id="search-terms-textarea" rows="12" placeholder="e.g. senior devops engineer remote&#10;SRE remote&#10;platform engineer remote">${escapeHtml(termsValue)}</textarea>
            <div style="display:flex;gap:12px;margin-top:12px">
                <button class="btn btn-primary" id="save-terms-btn">${t('settings.jobSearch.saveSearchTerms')}</button>
            </div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">${t('settings.jobSearch.excludeTerms')}</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.875rem">
                Jobs matching any of these terms will be hidden. One per line.
            </p>
            <textarea class="textarea-styled" id="exclude-terms-textarea" rows="6" placeholder="e.g. manager&#10;director&#10;VP">${escapeHtml(excludeTermsValue)}</textarea>
            <div style="display:flex;gap:12px;margin-top:12px">
                <button class="btn btn-primary" id="save-exclude-btn">${t('settings.jobSearch.saveExcludeTerms')}</button>
            </div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">${t('settings.jobSearch.allowedRegions')}</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.875rem">
                Only jobs in these regions will be scored and shown. Jobs outside allowed regions are auto-dismissed.
            </p>
            <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:12px">
                ${[
                    { value: 'US', label: 'United States' },
                    { value: t('fields.remote'), label: 'Remote / Global' },
                    { value: 'Canada', label: 'Canada' },
                    { value: 'UK', label: 'United Kingdom' },
                    { value: 'Germany', label: 'Germany' },
                    { value: 'Ireland', label: 'Ireland' },
                    { value: 'Netherlands', label: 'Netherlands' },
                    { value: 'Australia', label: 'Australia' },
                ].map(r => `<label style="display:flex;align-items:center;gap:6px;font-size:0.875rem;cursor:pointer">
                    <input type="checkbox" class="region-checkbox" value="${r.value}" ${(config.allowed_regions || ['US',t('fields.remote')]).includes(r.value) ? 'checked' : ''}>
                    ${escapeHtml(r.label)}
                </label>`).join('')}
            </div>
            <div style="margin-bottom:12px">
                <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">Additional regions (one per line)</label>
                <textarea class="textarea-styled" id="custom-regions-textarea" rows="3" placeholder="e.g. France&#10;Singapore">${escapeHtml(
                    (config.allowed_regions || []).filter(r => !['US',t('fields.remote'),'Canada','UK','Germany','Ireland','Netherlands','Australia'].includes(r)).join('\n')
                )}</textarea>
            </div>
            <div style="display:flex;gap:12px">
                <button class="btn btn-primary" id="save-regions-btn">${t('settings.jobSearch.saveAllowedRegions')}</button>
            </div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">Remote Only</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.875rem">
                When enabled, on-site and hybrid jobs are dropped at scrape time and never stored or scored.
            </p>
            <label style="display:flex;align-items:center;gap:8px;font-size:0.875rem;cursor:pointer;margin-bottom:12px">
                <input type="checkbox" id="remote-only-checkbox" ${config.remote_only ? 'checked' : ''}>
                Remote jobs only
            </label>
            <button class="btn btn-primary" id="save-remote-only-btn">${t('settings.common.save')}</button>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">${t('settings.jobSearch.prefsTitle')}</h2>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
                ${settingsField(t('settings.jobSearch.minSalary'), 'js-sal-min', profile.desired_salary_min, 'number')}
                ${settingsField(t('settings.jobSearch.maxSalary'), 'js-sal-max', profile.desired_salary_max, 'number')}
                ${settingsSelect('Period', 'js-sal-period', profile.salary_period, [
                    {value:'',label:'Select...'},{value:'annual',label:'Annual'},{value:'hourly',label:'Hourly'},
                ])}
            </div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">Availability</h2>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
                ${settingsField(t('settings.jobSearch.availableFrom'), 'js-avail-date', profile.availability_date, 'date')}
                ${settingsSelect('Notice Period', 'js-notice', profile.notice_period, [
                    {value:'',label:'Select...'},{value:'immediate',label:'Immediate'},
                    {value:'2_weeks',label:t('settings.jobSearch.twoWeeks')},{value:'1_month',label:t('settings.jobSearch.oneMonth')},
                    {value:'2_months',label:t('settings.jobSearch.twoMonths')},{value:'3_months',label:t('settings.jobSearch.threeMonths')},
                ])}
                ${settingsSelect(t('settings.jobSearch.willingToRelocate'), 'js-relocate', profile.willing_to_relocate, [
                    {value:'',label:'Select...'},{value:'yes',label:t('actions.yes')},{value:'no',label:t('actions.no')},{value:'depends',label:'Depends'},
                ])}
            </div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">Other Defaults</h2>
            ${settingsSelect(t('settings.jobSearch.hearAboutUs'), 'js-how-heard', profile.how_heard_default, [
                {value:'',label:'Select...'},{value:'job_board',label:t('settings.jobSearch.jobBoard')},{value:'linkedin',label:t('settings.profile.linkedin')},
                {value:'referral',label:t('settings.jobSearch.referral')},{value:'company_website',label:t('settings.jobSearch.companyWebsite')},
                {value:'recruiter',label:'Recruiter'},{value:'other',label:t('settings.profile.genderOther')},
            ])}
            <div style="margin-top:12px">
                <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">${t('settings.jobSearch.coverLetterTemplate')}</label>
                <textarea class="textarea-styled textarea-notes" id="js-cover-tpl" rows="6" placeholder="Dear Hiring Manager,&#10;&#10;I am writing to express my interest..." data-i18n-audit-ignore="cover letter template content is business content">${escapeHtml(profile.cover_letter_template || '')}</textarea>
            </div>
            <button class="btn btn-primary" id="save-js-prefs-btn" style="margin-top:12px">${t('settings.jobSearch.savePreferences')}</button>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h2 style="font-size:1.125rem;font-weight:600;margin:0">${t('settings.jobSearch.qaBank')}</h2>
                <button class="btn btn-primary btn-sm" id="qa-add-btn">${t('settings.common.add')}</button>
            </div>
            <div id="qa-items">${customQA.length ? customQA.map(q => `
                <div style="padding:12px 16px;background:var(--bg-surface-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px">
                    <div style="display:flex;justify-content:space-between;align-items:start;gap:12px">
                        <div style="flex:1;min-width:0">
                            <div style="font-size:0.8125rem;font-weight:600;color:var(--text-tertiary)">Q: ${escapeHtml(q.question_pattern)}</div>
                            <div style="font-size:0.875rem;color:var(--text-secondary);margin-top:2px">${escapeHtml((q.answer || '').substring(0, 150))}${(q.answer || '').length > 150 ? '...' : ''}</div>
                        </div>
                        <div style="display:flex;gap:6px;flex-shrink:0">
                            <button class="btn btn-ghost btn-sm qa-edit-btn" data-id="${q.id}">Edit</button>
                            <button class="btn btn-danger btn-sm qa-del-btn" data-id="${q.id}">Delete</button>
                        </div>
                    </div>
                </div>
            `).join('') : `<p style="color:var(--text-tertiary);font-size:0.875rem">${t('settings.jobSearch.qaEmpty')}</p>`}</div>
            <div id="qa-form-area"></div>
        </div>

        ${config.updated_at ? `<p style="color:var(--text-tertiary);font-size:0.8125rem;margin-bottom:24px">Last updated: ${formatDate(config.updated_at)}</p>` : ''}
    `;

    document.getElementById('upload-resume-btn').addEventListener('click', async () => {
        const fileInput = document.getElementById('resume-file');
        if (!fileInput.files.length) { showToast(t('settings.resumes.selectFileFirst'), 'error'); return; }
        const btn = document.getElementById('upload-resume-btn');
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span> ${t('status.analyzing')}`;
        try {
            const result = await api.uploadResume(fileInput.files[0]);
            showToast(`Resume analyzed! ${result.search_terms.length} search terms extracted.`, 'success');
            settingsData.config = await api.getSearchConfig();
            renderTabJobSearch(container, settingsData.config, profile, customQA);
        } catch (err) { showToast(err.message, 'error'); }
        finally { btn.disabled = false; btn.textContent = t('settings.resumes.uploadAnalyze'); }
    });

    document.getElementById('save-terms-btn').addEventListener('click', async () => {
        const terms = document.getElementById('search-terms-textarea').value.split('\n').map(t => t.trim()).filter(Boolean);
        try {
            await api.updateSearchTerms(terms);
            showToast(`Saved ${terms.length} search terms`, 'success');
        } catch (err) { showToast(err.message, 'error'); }
    });

    document.getElementById('save-exclude-btn').addEventListener('click', async () => {
        const terms = document.getElementById('exclude-terms-textarea').value.split('\n').map(t => t.trim()).filter(Boolean);
        try {
            await api.request('POST', '/api/search-config/exclude-terms', { exclude_terms: terms });
            showToast(`Saved ${terms.length} exclude terms`, 'success');
        } catch (err) { showToast(err.message, 'error'); }
    });

    document.getElementById('save-regions-btn').addEventListener('click', async () => {
        const checked = Array.from(document.querySelectorAll('.region-checkbox:checked')).map(cb => cb.value);
        const custom = document.getElementById('custom-regions-textarea').value.split('\n').map(t => t.trim()).filter(Boolean);
        const regions = [...new Set([...checked, ...custom])];
        try {
            await api.request('POST', '/api/search-config/allowed-regions', { allowed_regions: regions });
            if (settingsData.config) settingsData.config.allowed_regions = regions;
            showToast(`Saved ${regions.length} allowed regions`, 'success');
        } catch (err) { showToast(err.message, 'error'); }
    });

    document.getElementById('save-remote-only-btn').addEventListener('click', async () => {
        const enabled = document.getElementById('remote-only-checkbox').checked;
        try {
            await api.request('POST', '/api/search-config/remote-only', { remote_only: enabled });
            if (settingsData.config) settingsData.config.remote_only = enabled;
            showToast(enabled ? 'Remote-only filtering enabled' : 'Remote-only filtering disabled', 'success');
        } catch (err) { showToast(err.message, 'error'); }
    });

    // Save job search preferences
    document.getElementById('save-js-prefs-btn').addEventListener('click', async () => {
        const prefs = {
            desired_salary_min: document.getElementById('js-sal-min').value ? parseInt(document.getElementById('js-sal-min').value) : null,
            desired_salary_max: document.getElementById('js-sal-max').value ? parseInt(document.getElementById('js-sal-max').value) : null,
            salary_period: document.getElementById('js-sal-period').value,
            availability_date: document.getElementById('js-avail-date').value,
            notice_period: document.getElementById('js-notice').value,
            willing_to_relocate: document.getElementById('js-relocate').value,
            how_heard_default: document.getElementById('js-how-heard').value,
            cover_letter_template: document.getElementById('js-cover-tpl').value,
        };
        try {
            await api.request('POST', '/api/profile', prefs);
            Object.assign(settingsData.fullProfile || {}, prefs);
            Object.assign(settingsData.profile || {}, prefs);
            showToast('Preferences saved', 'success');
        } catch (err) { showToast(err.message, 'error'); }
    });

    // Q&A handlers
    function showQAForm(existing) {
        const area = document.getElementById('qa-form-area');
        area.innerHTML = `
            <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-top:12px;background:var(--bg-surface-secondary)">
                <div style="margin-bottom:12px">
                    <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">Question Pattern</label>
                    <input type="text" class="search-input" id="qa-q" value="${escapeHtml(existing?.question_pattern || '')}" placeholder="${t('settings.jobSearch.questionPlaceholder')}" style="width:100%">
                </div>
                <div style="margin-bottom:12px">
                    <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">${t('fields.category')}</label>
                    <input type="text" class="search-input" id="qa-cat" value="${escapeHtml(existing?.category || '')}" placeholder="e.g. motivation, experience" style="width:100%">
                </div>
                <div style="margin-bottom:12px">
                    <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">Answer</label>
                    <textarea class="textarea-styled textarea-notes" id="qa-ans" rows="4">${escapeHtml(existing?.answer || '')}</textarea>
                </div>
                <div style="display:flex;gap:8px">
                    <button class="btn btn-primary btn-sm" id="qa-save-btn">${t('settings.common.save')}</button>
                    <button class="btn btn-secondary btn-sm" id="qa-cancel-btn">Cancel</button>
                </div>
            </div>`;
        document.getElementById('qa-save-btn').addEventListener('click', async () => {
            const entry = { question_pattern: document.getElementById('qa-q').value, category: document.getElementById('qa-cat').value, answer: document.getElementById('qa-ans').value };
            if (existing?.id) entry.id = existing.id;
            try {
                await api.request('POST', '/api/custom-qa', entry);
                showToast(t('settings.jobSearch.qaSaved'), 'success');
                const res = await api.request('GET', '/api/custom-qa');
                settingsData.customQA = res.items || [];
                renderTabJobSearch(container, settingsData.config, profile, settingsData.customQA);
            } catch (err) { showToast(err.message, 'error'); }
        });
        document.getElementById('qa-cancel-btn').addEventListener('click', () => { area.innerHTML = ''; });
    }

    document.getElementById('qa-add-btn').addEventListener('click', () => showQAForm(null));
    container.querySelectorAll('.qa-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = customQA.find(q => q.id === parseInt(btn.dataset.id));
            if (item) showQAForm(item);
        });
    });
    container.querySelectorAll('.qa-del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const ok = await showModal({
                title: t('settings.jobSearch.deleteQaTitle'),
                message: t('settings.jobSearch.deleteQaConfirm'),
                confirmText: 'Delete',
                danger: true,
            });
            if (!ok) return;
            try {
                await api.request('DELETE', `/api/custom-qa/${btn.dataset.id}`);
                showToast(t('toast.deleted'), 'info');
                const res = await api.request('GET', '/api/custom-qa');
                settingsData.customQA = res.items || [];
                renderTabJobSearch(container, settingsData.config, profile, settingsData.customQA);
            } catch (err) { showToast(err.message, 'error'); }
        });
    });
}

// === Tab 4: AI & Integrations ===
function renderTabAI(container, aiSettings, scraperKeys, emailSettings, embeddingSettings) {
    const aiProvider = aiSettings.provider || '';
    const aiKey = aiSettings.api_key || '';
    const aiModel = aiSettings.model || '';
    const aiBaseUrl = aiSettings.base_url || '';
    const aiRegion = aiSettings.region || '';
    const hasKey = aiSettings.has_key || false;
    const hasSecret = aiSettings.has_secret || false;
    const keys = scraperKeys || {};

    container.innerHTML = `
        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">AI Provider</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.875rem">
                Configure which AI backend to use for job scoring, resume analysis, and application autofill.
            </p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
                <div>
                    <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">Provider</label>
                    <select class="filter-select" id="ai-provider" style="width:100%">
                        <option value="anthropic" ${aiProvider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option>
                        <option value="openai" ${aiProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
                        <option value="google" ${aiProvider === 'google' ? 'selected' : ''}>Google (Gemini)</option>
                        <option value="openrouter" ${aiProvider === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
                        <option value="bedrock" ${aiProvider === 'bedrock' ? 'selected' : ''}>AWS Bedrock</option>
                        <option value="ollama" ${aiProvider === 'ollama' ? 'selected' : ''}>Ollama (Local)</option>
                    </select>
                </div>
                <div>
                    <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">Model</label>
                    <div id="ai-model-container">
                        <input type="text" class="search-input" id="ai-model" placeholder="e.g. custom-model" value="${escapeHtml(aiModel)}" style="width:100%;display:none">
                        <select class="filter-select" id="ai-model-dropdown" style="width:100%;${['anthropic', 'openai', 'google', 'bedrock'].includes(aiProvider) ? '' : 'display:none'}"></select>
                        <div id="ai-model-ollama" style="${aiProvider === 'ollama' ? '' : 'display:none'}">
                            <div style="display:flex;gap:8px;align-items:center">
                                <select class="filter-select" id="ai-model-select" style="flex:1">
                                    ${aiModel ? `<option value="${escapeHtml(aiModel)}" selected>${escapeHtml(aiModel)}</option>` : `<option value="">${t('settings.ai.selectModel')}</option>`}
                                </select>
                                <button class="btn btn-secondary btn-sm" id="refresh-models-btn" style="white-space:nowrap">${t('actions.refresh')}</button>
                            </div>
                        </div>
                        <div id="ai-model-openrouter" style="${aiProvider === 'openrouter' ? '' : 'display:none'}">
                            <div style="display:flex;gap:8px;align-items:center">
                                <select class="filter-select" id="ai-model-or-select" style="flex:1">
                                    ${aiModel ? `<option value="${escapeHtml(aiModel)}" selected>${escapeHtml(aiModel)}</option>` : `<option value="">${t('settings.ai.loadingModels')}</option>`}
                                </select>
                                <button class="btn btn-secondary btn-sm" id="refresh-or-models-btn" style="white-space:nowrap">${t('actions.refresh')}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="ai-key-row" style="margin-bottom:12px;${aiProvider === 'ollama' || aiProvider === 'bedrock' ? 'display:none' : ''}">
                <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px" id="ai-key-label">${t('settings.ai.apiKey')}</label>
                <input type="password" class="search-input" id="ai-api-key" placeholder="${hasKey ? 'Key configured (leave blank to keep)' : 'Enter API key'}" value="${escapeHtml(aiKey)}" style="width:100%">
            </div>
            <div id="ai-bedrock-creds" style="${aiProvider === 'bedrock' ? '' : 'display:none'}">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
                    <div>
                        <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">AWS Access Key ID</label>
                        <input type="password" class="search-input" id="ai-aws-access-key" placeholder="${hasKey ? t('settings.ai.apiKeyPlaceholder') : 'AKIA...'}" style="width:100%">
                    </div>
                    <div>
                        <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">AWS Secret Access Key</label>
                        <input type="password" class="search-input" id="ai-aws-secret-key" placeholder="${hasSecret ? t('settings.ai.apiKeyPlaceholder') : t('settings.ai.awsSecretPlaceholder')}" style="width:100%">
                    </div>
                </div>
                <div style="font-size:0.75rem;color:var(--text-tertiary);margin-bottom:12px">${t('settings.ai.bedrockHelp')}</div>
            </div>
            <div id="ai-region-row" style="margin-bottom:12px;${aiProvider === 'bedrock' ? '' : 'display:none'}">
                <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">AWS Region</label>
                <input type="text" class="search-input" id="ai-region" value="${escapeHtml(aiRegion || 'us-east-1')}" placeholder="us-east-1" style="width:100%">
            </div>
            <div id="ai-url-row" style="margin-bottom:16px;${aiProvider === 'ollama' ? '' : 'display:none'}">
                <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">Ollama URL</label>
                <input type="text" class="search-input" id="ai-base-url" placeholder="http://localhost:11434" value="${escapeHtml(aiBaseUrl)}" style="width:100%">
            </div>
            <div style="display:flex;gap:12px">
                <button class="btn btn-primary" id="save-ai-btn">${t('settings.ai.saveAiSettings')}</button>
                <button class="btn btn-secondary" id="test-ai-btn">${t('settings.ai.testConnection')}</button>
            </div>
            <div id="ai-test-result" style="margin-top:12px"></div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:8px">Scraper API Keys</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.875rem">
                Optional API keys to enable additional job sources.
            </p>
            <div style="display:flex;flex-direction:column;gap:16px">
                <div>
                    <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">USAJobs API Key</label>
                    <input type="password" class="search-input" id="scraper-key-usajobs" placeholder="API key" value="${keys.usajobs?.has_key ? '****' : ''}" style="margin-bottom:4px">
                    <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px;margin-top:4px">${t('settings.ai.usaJobsEmail')}</label>
                    <input type="email" class="search-input" id="scraper-email-usajobs" placeholder="${t('settings.ai.usaJobsEmailPlaceholder')}" value="${escapeHtml(keys.usajobs?.email || '')}">
                </div>
                <div>
                    <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">Adzuna App ID</label>
                    <input type="password" class="search-input" id="scraper-key-adzuna-id" placeholder="App ID" value="${keys['adzuna-id']?.has_key ? '****' : ''}" style="margin-bottom:4px">
                    <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px;margin-top:4px">Adzuna App Key</label>
                    <input type="password" class="search-input" id="scraper-key-adzuna" placeholder="App key" value="${keys.adzuna?.has_key ? '****' : ''}">
                </div>
                <div>
                    <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">JSearch (RapidAPI) Key</label>
                    <input type="password" class="search-input" id="scraper-key-jsearch" placeholder="RapidAPI key" value="${keys.jsearch?.has_key ? '****' : ''}">
                </div>
            </div>
            <button class="btn btn-primary" id="save-scraper-keys-btn" style="margin-top:16px">${t('settings.ai.saveScraperKeys')}</button>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:8px">${t('settings.email.title')}</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.875rem">
                Configure SMTP for sending application emails and automated job digest notifications.
            </p>
            <h3 style="font-size:0.9375rem;font-weight:600;margin-bottom:12px;color:var(--text-secondary)">SMTP Configuration</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
                ${settingsField(t('settings.email.smtpHost'), 'email-smtp-host', emailSettings.smtp_host || '', 'text', { placeholder: 'smtp.gmail.com' })}
                ${settingsField(t('settings.email.smtpPort'), 'email-smtp-port', emailSettings.smtp_port || 587, 'number')}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
                ${settingsField(t('settings.email.username'), 'email-smtp-username', emailSettings.smtp_username || '', 'text', { placeholder: t('settings.email.emailPlaceholder') })}
                ${settingsField(t('settings.email.password'), 'email-smtp-password', '', 'password', { placeholder: emailSettings.smtp_host ? 'Configured (leave blank to keep)' : 'SMTP password' })}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
                ${settingsField(t('settings.email.fromAddress'), 'email-from-address', emailSettings.from_address || '', 'email', { placeholder: 'noreply@example.com' /* i18n-audit-ignore: example address, not copy */ })}
                ${settingsField(t('settings.email.toAddress'), 'email-to-address', emailSettings.to_address || '', 'email', { placeholder: 'you@example.com' /* i18n-audit-ignore: example address, not copy */ })}
            </div>
            <div style="margin-bottom:16px">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                    <input type="checkbox" id="email-smtp-tls" ${emailSettings.smtp_use_tls !== false ? 'checked' : ''}>
                    <span style="font-size:0.875rem">Use TLS</span>
                </label>
            </div>

            <h3 style="font-size:0.9375rem;font-weight:600;margin-bottom:12px;margin-top:20px;color:var(--text-secondary)">${t('settings.email.digestTitle')}</h3>
            <div style="margin-bottom:12px">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                    <input type="checkbox" id="email-digest-enabled" ${emailSettings.digest_enabled ? 'checked' : ''}>
                    <span style="font-size:0.875rem;font-weight:600">Enable automated digest emails</span>
                </label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
                ${settingsSelect('Schedule', 'email-digest-schedule', emailSettings.digest_schedule || 'daily', [
                    { value: 'daily', label: 'Daily' },
                    { value: 'weekly', label: 'Weekly' },
                ])}
                ${settingsField(t('settings.email.sendTime'), 'email-digest-time', emailSettings.digest_time || '08:00', 'time')}
                ${settingsField(t('settings.email.minScore'), 'email-digest-min-score', emailSettings.digest_min_score || 60, 'number')}
            </div>
            <div style="display:flex;gap:12px">
                <button class="btn btn-primary" id="save-email-btn">${t('settings.email.saveEmailSettings')}</button>
                <button class="btn btn-secondary" id="test-email-btn">${t('settings.email.sendTestEmail')}</button>
                <button class="btn btn-secondary" id="test-digest-btn">Send Test Digest</button>
            </div>
            <div id="email-test-result" style="margin-top:12px"></div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:8px">${t('settings.embeddings.title')}</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.875rem">
                Configure vector embeddings for semantic job search and similar job recommendations.
            </p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
                ${settingsSelect('Provider', 'emb-provider', embeddingSettings.provider || '', [
                    { value: 'openai', label: 'OpenAI' },
                    { value: 'ollama', label: 'Ollama' },
                ])}
                <div>
                    <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">Model</label>
                    <input type="text" class="search-input" id="emb-model" value="${escapeHtml(embeddingSettings.model || '')}" placeholder="${(!embeddingSettings.provider || embeddingSettings.provider === 'openai') ? 'text-embedding-3-small' : 'nomic-embed-text'}" style="width:100%">
                </div>
            </div>
            <div id="emb-key-row" style="margin-bottom:12px;${embeddingSettings.provider === 'ollama' ? 'display:none' : ''}">
                <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">${t('settings.ai.apiKey')}</label>
                <input type="password" class="search-input" id="emb-api-key" placeholder="${embeddingSettings.has_key ? 'Key configured (leave blank to keep)' : 'Enter API key'}" style="width:100%">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
                <div id="emb-url-row" style="${embeddingSettings.provider === 'ollama' ? '' : 'display:none'}">
                    <label style="display:block;font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:4px">${t('settings.ai.baseUrl')}</label>
                    <input type="text" class="search-input" id="emb-base-url" value="${escapeHtml(embeddingSettings.base_url || '')}" placeholder="http://localhost:11434" style="width:100%">
                </div>
                ${settingsField('Dimensions', 'emb-dimensions', embeddingSettings.dimensions || (embeddingSettings.provider === 'ollama' ? 768 : 256), 'number')}
            </div>
            <div style="display:flex;gap:12px">
                <button class="btn btn-primary" id="save-emb-btn">${t('settings.embeddings.save')}</button>
                <button class="btn btn-secondary" id="backfill-emb-btn">Backfill Embeddings</button>
            </div>
            <div id="emb-result" style="margin-top:12px"></div>
        </div>
    `;

    // AI provider toggle
    const PROVIDER_MODELS = {
        anthropic: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
        openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o1-mini', 'o3-mini'],
        google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
        bedrock: [
            'us.anthropic.claude-sonnet-4-6',
            'us.anthropic.claude-opus-4-6-v1',
            'us.anthropic.claude-opus-4-5-20251101-v1:0',
            'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
            'us.anthropic.claude-opus-4-1-20250805-v1:0',
            'us.anthropic.claude-opus-4-20250514-v1:0',
            'us.anthropic.claude-sonnet-4-20250514-v1:0',
            'us.anthropic.claude-haiku-4-5-20251001-v1:0',
            'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
            'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
            'us.anthropic.claude-3-5-haiku-20241022-v1:0',
            'us.anthropic.claude-3-haiku-20240307-v1:0',
        ],
    };

    function populateModelDropdown(provider, currentModel) {
        const dropdown = document.getElementById('ai-model-dropdown');
        const models = PROVIDER_MODELS[provider] || [];
        const options = models.map(m => `<option value="${escapeHtml(m)}"${m === currentModel ? ' selected' : ''}>${escapeHtml(m)}</option>`);
        if (currentModel && !models.includes(currentModel)) {
            options.unshift(`<option value="${escapeHtml(currentModel)}" selected>${escapeHtml(currentModel)}</option>`);
        }
        if (!currentModel) {
            options.unshift(`<option value="">${t('settings.ai.selectModel')}</option>`);
        }
        dropdown.innerHTML = options.join('');
    }

    function updateModelVisibility(provider) {
        const hasDropdown = provider in PROVIDER_MODELS;
        const isOllama = provider === 'ollama';
        const isOpenRouter = provider === 'openrouter';
        document.getElementById('ai-model').style.display = (!hasDropdown && !isOllama && !isOpenRouter) ? '' : 'none';
        document.getElementById('ai-model-dropdown').style.display = hasDropdown ? '' : 'none';
        document.getElementById('ai-model-ollama').style.display = isOllama ? '' : 'none';
        document.getElementById('ai-model-openrouter').style.display = isOpenRouter ? '' : 'none';
    }

    // Initialize dropdown for current provider
    if (aiProvider in PROVIDER_MODELS) {
        populateModelDropdown(aiProvider, aiModel);
    }

    document.getElementById('ai-provider').addEventListener('change', (e) => {
        const provider = e.target.value;
        const isOllama = provider === 'ollama';
        const isBedrock = provider === 'bedrock';
        document.getElementById('ai-key-row').style.display = (isOllama || isBedrock) ? 'none' : '';
        document.getElementById('ai-url-row').style.display = isOllama ? '' : 'none';
        document.getElementById('ai-bedrock-creds').style.display = isBedrock ? '' : 'none';
        document.getElementById('ai-region-row').style.display = isBedrock ? '' : 'none';
        updateModelVisibility(provider);
        if (provider in PROVIDER_MODELS) {
            populateModelDropdown(provider, '');
        }
        if (isOllama) fetchOllamaModels();
        if (provider === 'openrouter') { _orCurrentModel = ''; fetchOpenRouterModels(); }
    });

    async function fetchOllamaModels() {
        const select = document.getElementById('ai-model-select');
        const currentVal = select.value;
        const btn = document.getElementById('refresh-models-btn');
        btn.disabled = true; btn.textContent = '...';
        try {
            const baseUrl = document.getElementById('ai-base-url').value || 'http://localhost:11434';
            const result = await api.getOllamaModels(baseUrl);
            if (result.ok && result.models.length > 0) {
                select.innerHTML = result.models.map(m => `<option value="${escapeHtml(m)}" ${m === currentVal ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');
                if (!currentVal) select.value = result.models[0];
            } else if (!result.ok) {
                select.innerHTML = `<option value="">${t('settings.ai.failedToConnect')}</option>`;
            } else {
                select.innerHTML = `<option value="">${t('settings.ai.noModelsFound')}</option>`;
            }
        } catch { select.innerHTML = `<option value="">${t('settings.ai.errorLoadingModels')}</option>`; }
        finally { btn.disabled = false; btn.textContent = t('actions.refresh'); }
    }

    document.getElementById('refresh-models-btn').addEventListener('click', fetchOllamaModels);
    if (document.getElementById('ai-provider').value === 'ollama') fetchOllamaModels();

    let _orCurrentModel = aiProvider === 'openrouter' ? aiModel : '';

    async function fetchOpenRouterModels() {
        const select = document.getElementById('ai-model-or-select');
        const currentVal = _orCurrentModel;
        const btn = document.getElementById('refresh-or-models-btn');
        btn.disabled = true; btn.textContent = '...';
        select.innerHTML = `<option value="">${t('settings.ai.loadingModels')}</option>`;
        try {
            const res = await fetch('https://openrouter.ai/api/v1/models');
            if (!res.ok) throw new Error(t('settings.ai.failedToFetch'));
            const data = await res.json();
            const models = (data.data || [])
                .map(m => ({ id: m.id, name: m.name || m.id }))
                .sort((a, b) => a.id.localeCompare(b.id));
            if (models.length > 0) {
                const opts = models.map(m => `<option value="${escapeHtml(m.id)}"${m.id === currentVal ? ' selected' : ''}>${escapeHtml(m.id)}</option>`);
                if (currentVal && !models.some(m => m.id === currentVal)) {
                    opts.unshift(`<option value="${escapeHtml(currentVal)}" selected>${escapeHtml(currentVal)}</option>`);
                }
                if (!currentVal) opts.unshift(`<option value="">${t('settings.ai.selectModel')}</option>`);
                select.innerHTML = opts.join('');
            } else {
                select.innerHTML = `<option value="">${t('settings.ai.noModelsFound')}</option>`;
            }
        } catch {
            select.innerHTML = `<option value="${escapeHtml(currentVal)}">${currentVal || 'Failed to load models'}</option>`;
            // Show fallback text input
            document.getElementById('ai-model').style.display = '';
            document.getElementById('ai-model').placeholder = 'e.g. anthropic/claude-sonnet-4';
        }
        finally { btn.disabled = false; btn.textContent = t('actions.refresh'); }
    }

    document.getElementById('refresh-or-models-btn').addEventListener('click', () => {
        _orCurrentModel = document.getElementById('ai-model-or-select').value;
        fetchOpenRouterModels();
    });
    if (document.getElementById('ai-provider').value === 'openrouter') fetchOpenRouterModels();

    function getAIFormValues() {
        const provider = document.getElementById('ai-provider').value;
        let model;
        if (provider === 'ollama') {
            model = document.getElementById('ai-model-select').value;
        } else if (provider === 'openrouter') {
            const orSelect = document.getElementById('ai-model-or-select');
            model = orSelect.value || document.getElementById('ai-model').value;
        } else if (provider in PROVIDER_MODELS) {
            model = document.getElementById('ai-model-dropdown').value;
        } else {
            model = document.getElementById('ai-model').value;
        }
        let api_key, base_url, region;
        if (provider === 'bedrock') {
            const accessKey = document.getElementById('ai-aws-access-key').value;
            const secretKey = document.getElementById('ai-aws-secret-key').value;
            api_key = accessKey || (hasKey ? '****' : '');
            base_url = secretKey || (hasSecret ? '****' : '');
            region = document.getElementById('ai-region').value;
        } else {
            api_key = document.getElementById('ai-api-key').value;
            base_url = document.getElementById('ai-base-url').value;
            region = '';
        }
        return { provider, api_key, model, base_url, region };
    }

    document.getElementById('save-ai-btn').addEventListener('click', async () => {
        const btn = document.getElementById('save-ai-btn');
        btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${t('status.saving')}`;
        try { await api.updateAISettings(getAIFormValues()); showToast('AI settings saved', 'success'); }
        catch (err) { showToast(err.message, 'error'); }
        finally { btn.disabled = false; btn.textContent = t('settings.ai.saveAiSettings'); }
    });

    document.getElementById('test-ai-btn').addEventListener('click', async () => {
        const btn = document.getElementById('test-ai-btn');
        const resultDiv = document.getElementById('ai-test-result');
        btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${t('settings.ai.testing')}`; resultDiv.innerHTML = '';
        try {
            const result = await api.testAIConnection(getAIFormValues());
            resultDiv.innerHTML = result.ok
                ? `<div style="color:var(--success, #22c55e);font-size:0.875rem;font-weight:600">Connection successful! Response: "${escapeHtml(result.response)}"</div>`
                : `<div style="color:var(--danger, #ef4444);font-size:0.875rem;font-weight:600">Connection failed: ${escapeHtml(result.error)}</div>`;
        } catch (err) { resultDiv.innerHTML = `<div style="color:var(--danger, #ef4444);font-size:0.875rem">${escapeHtml(err.message)}</div>`; }
        finally { btn.disabled = false; btn.textContent = t('settings.ai.testConnection'); }
    });

    document.getElementById('save-scraper-keys-btn').addEventListener('click', async () => {
        const payload = {
            usajobs: { api_key: document.getElementById('scraper-key-usajobs').value, email: document.getElementById('scraper-email-usajobs').value },
            'adzuna-id': { api_key: document.getElementById('scraper-key-adzuna-id').value, email: '' },
            adzuna: { api_key: document.getElementById('scraper-key-adzuna').value, email: '' },
            jsearch: { api_key: document.getElementById('scraper-key-jsearch').value, email: '' },
        };
        try { await api.request('POST', '/api/scraper-keys', payload); showToast('Scraper keys saved', 'success'); }
        catch (err) { showToast(err.message, 'error'); }
    });

    function getEmailFormValues() {
        return {
            smtp_host: document.getElementById('email-smtp-host').value,
            smtp_port: parseInt(document.getElementById('email-smtp-port').value) || 587,
            smtp_username: document.getElementById('email-smtp-username').value,
            smtp_password: document.getElementById('email-smtp-password').value,
            smtp_use_tls: document.getElementById('email-smtp-tls').checked,
            from_address: document.getElementById('email-from-address').value,
            to_address: document.getElementById('email-to-address').value,
            digest_enabled: document.getElementById('email-digest-enabled').checked,
            digest_schedule: document.getElementById('email-digest-schedule').value,
            digest_time: document.getElementById('email-digest-time').value || '08:00',
            digest_min_score: parseInt(document.getElementById('email-digest-min-score').value) || 60,
        };
    }

    document.getElementById('save-email-btn').addEventListener('click', async () => {
        const btn = document.getElementById('save-email-btn');
        btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${t('status.saving')}`;
        try {
            await api.request('POST', '/api/settings/email', getEmailFormValues());
            showToast(t('settings.email.emailSaved'), 'success');
        } catch (err) { showToast(err.message, 'error'); }
        finally { btn.disabled = false; btn.textContent = t('settings.email.saveEmailSettings'); }
    });

    document.getElementById('test-email-btn').addEventListener('click', async () => {
        const btn = document.getElementById('test-email-btn');
        const resultDiv = document.getElementById('email-test-result');
        btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending...'; resultDiv.innerHTML = '';
        try {
            const result = await api.request('POST', '/api/settings/email/test', getEmailFormValues());
            resultDiv.innerHTML = `<div style="color:var(--success, #22c55e);font-size:0.875rem;font-weight:600">${escapeHtml(result.message)}</div>`;
        } catch (err) {
            resultDiv.innerHTML = `<div style="color:var(--danger, #ef4444);font-size:0.875rem">${escapeHtml(err.message)}</div>`;
        }
        finally { btn.disabled = false; btn.textContent = t('settings.email.sendTestEmail'); }
    });

    document.getElementById('test-digest-btn').addEventListener('click', async () => {
        const btn = document.getElementById('test-digest-btn');
        const resultDiv = document.getElementById('email-test-result');
        btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending...'; resultDiv.innerHTML = '';
        try {
            const result = await api.request('POST', '/api/digest/send-test');
            resultDiv.innerHTML = `<div style="color:var(--success, #22c55e);font-size:0.875rem;font-weight:600">${escapeHtml(result.message)}</div>`;
        } catch (err) {
            resultDiv.innerHTML = `<div style="color:var(--danger, #ef4444);font-size:0.875rem">${escapeHtml(err.message)}</div>`;
        }
        finally { btn.disabled = false; btn.textContent = 'Send Test Digest'; }
    });

    // Embedding provider toggle
    const embDefaults = { openai: { model: 'text-embedding-3-small', dims: 256 }, ollama: { model: 'nomic-embed-text', dims: 768 } };
    document.getElementById('emb-provider').addEventListener('change', (e) => {
        const provider = e.target.value;
        const isOllama = provider === 'ollama';
        document.getElementById('emb-key-row').style.display = isOllama ? 'none' : '';
        document.getElementById('emb-url-row').style.display = isOllama ? '' : 'none';
        document.getElementById('emb-model').placeholder = embDefaults[provider]?.model || '';
        document.getElementById('emb-dimensions').value = embDefaults[provider]?.dims || 256;
    });

    document.getElementById('save-emb-btn').addEventListener('click', async () => {
        const btn = document.getElementById('save-emb-btn');
        const resultDiv = document.getElementById('emb-result');
        btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${t('status.saving')}`;
        try {
            const payload = {
                provider: document.getElementById('emb-provider').value,
                api_key: document.getElementById('emb-api-key').value,
                model: document.getElementById('emb-model').value,
                base_url: document.getElementById('emb-base-url').value,
                dimensions: parseInt(document.getElementById('emb-dimensions').value) || 256,
            };
            await api.request('POST', '/api/settings/embeddings', payload);
            showToast(t('settings.embeddings.saved'), 'success');
            resultDiv.innerHTML = '';
        } catch (err) {
            showToast(err.message, 'error');
            resultDiv.innerHTML = `<div style="color:var(--danger, #ef4444);font-size:0.875rem">${escapeHtml(err.message)}</div>`;
        }
        finally { btn.disabled = false; btn.textContent = t('settings.embeddings.save'); }
    });

    document.getElementById('backfill-emb-btn').addEventListener('click', async () => {
        const btn = document.getElementById('backfill-emb-btn');
        const resultDiv = document.getElementById('emb-result');
        btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Backfilling...';
        resultDiv.innerHTML = `<div style="font-size:0.875rem;color:var(--text-secondary)">${t('settings.embeddings.processing')}</div>`;
        try {
            const result = await api.request('POST', '/api/embeddings/backfill');
            resultDiv.innerHTML = `<div style="color:var(--success, #22c55e);font-size:0.875rem;font-weight:600">Backfill complete: ${result.embedded || 0}/${result.total || 0} jobs embedded${result.errors ? `, ${result.errors} errors` : ''}</div>`;
        } catch (err) {
            resultDiv.innerHTML = `<div style="color:var(--danger, #ef4444);font-size:0.875rem">${escapeHtml(err.message)}</div>`;
        }
        finally { btn.disabled = false; btn.textContent = 'Backfill Embeddings'; }
    });
}

// === Tab 5: Data Management ===
function renderTabData(container) {
    container.innerHTML = `
        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">${t('actions.export')}</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.875rem">${t('settings.data.csvDesc')}</p>
            <a href="/api/export/csv" class="btn btn-secondary" download>${t('settings.data.downloadCsv')}</a>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">${t('settings.data.profileExportTitle')}</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.875rem">
                Export your full profile data as JSON, or import from a previously exported file.
            </p>
            <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                <button class="btn btn-secondary" id="export-profile-btn">${t('settings.data.exportProfile')}</button>
                <input type="file" id="import-profile-file" accept=".json" style="font-size:0.875rem">
                <button class="btn btn-secondary" id="import-profile-btn">Import Profile</button>
            </div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">Autofill History</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.875rem">${t('settings.data.autofillDesc')}</p>
            <div id="autofill-history-list"><span class="spinner"></span></div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">Scraper Schedule</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.875rem">${t('settings.scraper.description')}</p>
            <div id="scraper-schedule-list"><span class="spinner"></span></div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px">Setup Guide</h2>
            <p style="color:var(--text-secondary);margin-bottom:16px;font-size:0.875rem">${t('settings.onboarding.description')}</p>
            <button class="btn btn-secondary" id="rerun-onboarding-btn">Launch Setup Guide</button>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px;border-left:4px solid var(--danger, #ef4444)">
            <h2 style="font-size:1.125rem;font-weight:600;margin-bottom:16px;color:var(--danger, #ef4444)">Danger Zone</h2>
            <div style="display:flex;flex-direction:column;gap:16px">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:16px">
                    <div>
                        <div style="font-weight:600;font-size:0.9375rem">${t('settings.danger.clearJobsScores')}</div>
                        <div style="color:var(--text-secondary);font-size:0.8125rem">Remove all scraped jobs, scores, and application data. Keeps your resume, search terms, and AI settings.</div>
                    </div>
                    <button class="btn btn-danger" id="clear-jobs-btn" style="white-space:nowrap">${t('settings.danger.clearJobs')}</button>
                </div>
                <div style="border-top:1px solid var(--border);padding-top:16px;display:flex;align-items:center;justify-content:space-between;gap:16px">
                    <div>
                        <div style="font-weight:600;font-size:0.9375rem">${t('settings.danger.resetEverything')}</div>
                        <div style="color:var(--text-secondary);font-size:0.8125rem">Remove all data including resume, search terms, AI settings, jobs, and scores. Returns to a fresh state.</div>
                    </div>
                    <button class="btn btn-danger" id="clear-all-btn" style="white-space:nowrap">${t('settings.danger.resetAll')}</button>
                </div>
            </div>
        </div>
    `;

    // Load autofill history
    api.request('GET', '/api/autofill/history').then(data => {
        const list = container.querySelector('#autofill-history-list');
        const items = data.items || [];
        if (!items.length) { list.innerHTML = `<p style="color:var(--text-tertiary);font-size:0.875rem">${t('settings.data.noAutofillSessions')}</p>`; return; }
        list.innerHTML = items.map(h => `
            <div style="padding:8px 12px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm);margin-bottom:6px">
                <div style="font-weight:600;font-size:0.875rem">${escapeHtml(h.job_title || 'Unknown')} at ${escapeHtml(h.company || 'Unknown')}</div>
                <div style="color:var(--text-tertiary);font-size:0.8125rem">${formatDate(h.created_at)}</div>
            </div>
        `).join('');
    }).catch(() => {
        container.querySelector('#autofill-history-list').innerHTML = '<div class="empty-state empty-state-compact"><div class="empty-state-title">Could not load history</div><div class="empty-state-desc">Try refreshing the page.</div></div>';
    });

    // Load scraper schedules
    api.request('GET', '/api/scraper-schedule').then(data => {
        const list = container.querySelector('#scraper-schedule-list');
        const schedules = data.schedules || [];
        if (!schedules.length) {
            list.innerHTML = `<p style="color:var(--text-tertiary);font-size:0.875rem">${t('settings.scraper.empty')}</p>`;
            return;
        }
        list.innerHTML = `
            <table style="width:100%;border-collapse:collapse;font-size:0.875rem">
                <thead>
                    <tr style="border-bottom:2px solid var(--border);text-align:left">
                        <th style="padding:8px 12px">${t('fields.source')}</th>
                        <th style="padding:8px 12px">${t('settings.scraper.intervalHours')}</th>
                        <th style="padding:8px 12px">Last Ran</th>
                        <th style="padding:8px 12px"></th>
                    </tr>
                </thead>
                <tbody>
                    ${schedules.map(s => `
                        <tr style="border-bottom:1px solid var(--border)" data-source="${escapeHtml(s.source_name)}">
                            <td style="padding:8px 12px;font-weight:600">${escapeHtml(s.source_name)}</td>
                            <td style="padding:8px 12px"><input type="number" min="1" value="${s.interval_hours}" style="width:80px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-surface);color:var(--text-primary)" class="schedule-interval"></td>
                            <td style="padding:8px 12px;color:var(--text-secondary)">${s.last_scraped_at ? formatDate(s.last_scraped_at) : 'Never'}</td>
                            <td style="padding:8px 12px"><button class="btn btn-secondary schedule-save-btn" style="padding:4px 12px;font-size:0.8125rem">Save</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        list.querySelectorAll('.schedule-save-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('tr');
                const source_name = row.dataset.source;
                const interval_hours = parseInt(row.querySelector('.schedule-interval').value, 10);
                if (!interval_hours || interval_hours < 1) { showToast(t('settings.scraper.intervalTooSmall'), 'error'); return; }
                try {
                    await api.request('POST', '/api/scraper-schedule', { source_name, interval_hours });
                    showToast(`Schedule updated for ${source_name}`, 'success');
                } catch (err) { showToast(err.message, 'error'); }
            });
        });
    }).catch(() => {
        container.querySelector('#scraper-schedule-list').innerHTML = '<div class="empty-state empty-state-compact"><div class="empty-state-title">Could not load scraper schedules</div><div class="empty-state-desc">Try refreshing the page.</div></div>';
    });

    document.getElementById('clear-jobs-btn').addEventListener('click', async () => {
        const ok = await showModal({
            title: t('settings.danger.clearAllTitle'),
            message: t('settings.danger.clearJobsConfirm'),
            confirmText: t('settings.danger.clearJobs'),
            danger: true,
        });
        if (!ok) return;
        try { await api.request('POST', '/api/clear-jobs'); showToast('All jobs cleared', 'info'); }
        catch (err) { showToast(err.message, 'error'); }
    });

    document.getElementById('clear-all-btn').addEventListener('click', async () => {
        const okAll = await showModal({
            title: t('settings.danger.deleteAllData'),
            message: t('settings.danger.resetConfirm'),
            confirmText: t('settings.danger.deleteEverything'),
            danger: true,
        });
        if (!okAll) return;
        try {
            await api.request('POST', '/api/clear-all');
            showToast(t('settings.danger.allReset'), 'info');
            settingsData = {};
            await renderSettings(document.getElementById('app'));
        } catch (err) { showToast(err.message, 'error'); }
    });

    // Onboarding re-entry
    document.getElementById('rerun-onboarding-btn').addEventListener('click', () => {
        localStorage.removeItem('careerpulse_onboarded');
        invalidateSetupStatus();
        showToast(t('settings.onboarding.willAppear'), 'info');
        location.reload();
    });

    // Export profile
    document.getElementById('export-profile-btn').addEventListener('click', async () => {
        try {
            const data = await api.request('GET', '/api/profile/full');
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'jobfinder-profile.json'; a.click();
            URL.revokeObjectURL(url);
            showToast('Profile exported', 'success');
        } catch (err) { showToast(err.message, 'error'); }
    });

    // Import profile
    document.getElementById('import-profile-btn').addEventListener('click', async () => {
        const fileInput = document.getElementById('import-profile-file');
        if (!fileInput.files.length) { showToast(t('settings.data.selectJsonFirst'), 'error'); return; }
        try {
            const text = await fileInput.files[0].text();
            const data = JSON.parse(text);
            await api.request('PUT', '/api/profile/full', data);
            showToast('Profile imported successfully', 'success');
            settingsData.fullProfile = await api.request('GET', '/api/profile/full');
            settingsData.profile = await api.request('GET', '/api/profile');
        } catch (err) { showToast(err.message, 'error'); }
    });
}

