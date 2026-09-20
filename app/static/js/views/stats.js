// === Stats Dashboard View ===
async function renderStats(container) {
    container.innerHTML = `<div class="loading-container"><div class="spinner spinner-lg"></div><span>${t('stats.loading')}</span></div>`;

    try {
        const stats = await api.getStats();
        container.innerHTML = `
            <div class="stats-header">
                <h1 class="page-title">${t('stats.title')}</h1>
                <div class="stats-header-actions">
                    <button class="btn btn-primary" id="stats-scrape-btn">${t('nav.scrapeNow')}</button>
                    <button class="btn btn-secondary" id="stats-score-btn">${stats.total_jobs - stats.total_scored > 0 ? t('stats.actions.scoreUnscored', { count: stats.total_jobs - stats.total_scored }) : t('stats.actions.allScored')}</button>
                    <button class="btn btn-secondary" id="stats-rescore-btn" title="${t('stats.actions.rescoreTitle')}">${t('stats.actions.rescoreFailed')}</button>
                    <button class="btn btn-secondary" id="stats-export-btn">${t('stats.actions.exportCsv')}</button>
                </div>
            </div>
            <div class="stats-grid">
                <div class="card stat-card">
                    <div class="stat-number">${stats.total_jobs || 0}</div>
                    <div class="stat-label">${t('stats.kpi.totalJobs')}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-number">${stats.total_scored || 0}</div>
                    <div class="stat-label">${t('stats.kpi.scored')}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-number">${stats.total_applied || 0}</div>
                    <div class="stat-label">${t('stats.kpi.applied')}</div>
                </div>
                <div class="card stat-card">
                    <div class="stat-number">${stats.total_interviewing || 0}</div>
                    <div class="stat-label">${t('stats.kpi.interviewing')}</div>
                </div>
            </div>
            <div class="pipeline-section">
                <h2>${t('stats.section.pipeline')}</h2>
                <div class="pipeline-funnel">
                    <div class="card pipeline-stage">
                        <div class="stage-count">${stats.total_interested || 0}</div>
                        <div class="stage-label">${t('stats.stage.interested')}</div>
                    </div>
                    <div class="card pipeline-stage">
                        <div class="stage-count">${stats.total_prepared || 0}</div>
                        <div class="stage-label">${t('stats.stage.prepared')}</div>
                    </div>
                    <div class="card pipeline-stage">
                        <div class="stage-count">${stats.total_applied || 0}</div>
                        <div class="stage-label">${t('stats.stage.applied')}</div>
                    </div>
                    <div class="card pipeline-stage">
                        <div class="stage-count">${stats.total_interviewing || 0}</div>
                        <div class="stage-label">${t('stats.stage.interviewing')}</div>
                    </div>
                </div>
            </div>
            <div class="card" style="padding:24px;margin-top:24px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h2 style="font-size:1.125rem;font-weight:600;margin:0">${t('stats.section.digest')}</h2>
                    <button class="btn btn-secondary btn-sm" id="copy-digest-btn">${t('stats.actions.copyDigest')}</button>
                </div>
                <div id="digest-container">
                    <div class="loading-container"><span class="spinner"></span></div>
                </div>
            </div>
            <div class="card" style="padding:24px;margin-top:24px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h2 style="font-size:1.125rem;font-weight:600;margin:0">${t('stats.section.reminders')}</h2>
                </div>
                <div id="reminders-container">
                    <div class="loading-container"><span class="spinner"></span></div>
                </div>
            </div>
            <div class="card" style="padding:24px;margin-top:24px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h2 style="font-size:1.125rem;font-weight:600;margin:0">${t('stats.section.skillGaps')}</h2>
                    <button class="btn btn-primary btn-sm" id="analyze-skills-btn">${t('stats.actions.analyzeWithAI')}</button>
                </div>
                <p style="color:var(--text-secondary);font-size:0.875rem;margin-bottom:12px">${t('stats.section.skillGapsDesc')}</p>
                <div id="skill-gaps-container">
                    <div class="loading-container"><span class="spinner"></span></div>
                </div>
            </div>
            <div class="card" style="padding:24px;margin-top:24px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h2 style="font-size:1.125rem;font-weight:600;margin:0">${t('stats.section.analytics')}</h2>
                </div>
                <div id="analytics-container">
                    <div class="loading-container"><span class="spinner"></span></div>
                </div>
            </div>
            <div class="card" style="padding:24px;margin-top:24px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h2 style="font-size:1.125rem;font-weight:600;margin:0">${t('stats.section.responseTracking')}</h2>
                </div>
                <div id="response-analytics-container">
                    <div class="loading-container"><span class="spinner"></span></div>
                </div>
            </div>
            <div class="card" style="padding:24px;margin-top:24px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h2 style="font-size:1.125rem;font-weight:600;margin:0">${t('stats.section.careerAdvisor')}</h2>
                    <button class="btn btn-primary btn-sm" id="career-analyze-btn">${t('stats.actions.analyzeCareer')}</button>
                </div>
                <p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:12px">${t('stats.career.desc')}</p>
                <div id="career-advisor-container">
                    <div class="loading-container"><span class="spinner"></span></div>
                </div>
            </div>
        `;

        document.getElementById('stats-scrape-btn').addEventListener('click', handleScrape);
        const scoreBtn = document.getElementById('stats-score-btn');
        let scoringPollInterval = null;
        function stopScoringPoll() {
            if (scoringPollInterval) { clearInterval(scoringPollInterval); scoringPollInterval = null; }
        }
        registerViewCleanup(stopScoringPoll);
        function startScoringPoll() {
            stopScoringPoll();
            scoringPollInterval = setInterval(async () => {
                try {
                    const p = await api.request('GET', '/api/score/progress');
                    if (p.active && p.total > 0) {
                        const pct = Math.round((p.scored / p.total) * 100);
                        scoreBtn.innerHTML = `<span class="spinner"></span> ${p.scored}/${p.total} (${pct}%)`;
                    } else if (!p.active && p.total > 0) {
                        stopScoringPoll();
                        scoreBtn.disabled = false;
                        scoreBtn.textContent = t('stats.actions.allScored');
                        showToast(t('stats.scoring.scoredCount', { count: p.scored }), 'success');
                        handleRoute();
                    }
                } catch {}
            }, 2000);
        }
        scoreBtn.addEventListener('click', async () => {
            if (!await requireAIAndResume()) return;
            scoreBtn.disabled = true;
            scoreBtn.innerHTML = `<span class="spinner"></span> ${t('stats.scoring.starting')}`;
            try {
                await api.request('POST', '/api/score');
                startScoringPoll();
            } catch (err) {
                scoreBtn.disabled = false;
                scoreBtn.textContent = t('stats.actions.score');
                showToast(apiErrorMessage(err), 'error');
            }
        });
        document.getElementById('stats-rescore-btn').addEventListener('click', async () => {
            const btn = document.getElementById('stats-rescore-btn');
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner"></span> ${t('stats.scoring.clearing')}`;
            try {
                const res = await api.request('POST', '/api/rescore-failed');
                if (res.cleared === 0) {
                    showToast(t('stats.scoring.noFailedScores'), 'info');
                    btn.disabled = false;
                    btn.textContent = t('stats.actions.rescoreFailed');
                } else {
                    showToast(t('stats.scoring.clearedCount', { count: res.cleared }), 'success');
                    if (res.rescoring) startScoringPoll();
                    btn.disabled = false;
                    btn.textContent = t('stats.actions.rescoreFailed');
                }
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                btn.disabled = false;
                btn.textContent = t('stats.actions.rescoreFailed');
            }
        });
        // Check if scoring is already in progress
        try {
            const p = await api.request('GET', '/api/score/progress');
            if (p.active) {
                scoreBtn.disabled = true;
                scoreBtn.innerHTML = `<span class="spinner"></span> ${p.scored}/${p.total}`;
                startScoringPoll();
            }
        } catch {}
        // Check if scraping is already in progress
        try {
            const sp = await api.request('GET', '/api/scrape/progress');
            if (sp.active) {
                const scrapeBtn = document.getElementById('stats-scrape-btn');
                if (scrapeBtn) {
                    scrapeBtn.disabled = true;
                    const label = sp.current ? `${sp.current} (${sp.completed}/${sp.total})` : `${sp.completed}/${sp.total}`;
                    scrapeBtn.innerHTML = `<span class="spinner"></span> ${label}`;
                }
                startScrapePoll();
            }
        } catch {}
        document.getElementById('stats-export-btn').addEventListener('click', () => {
            window.location.href = '/api/export/csv';
        });

        // Fetch digest
        try {
            const digest = await api.request('GET', '/api/digest');
            const digestContainer = document.getElementById('digest-container');
            if (digest.job_count === 0) {
                digestContainer.innerHTML = `<div class="empty-state empty-state-compact"><div class="empty-state-title">${t('stats.digest.empty')}</div><div class="empty-state-desc">${t('stats.digest.emptyDesc')}</div></div>`;
            } else {
                digestContainer.innerHTML = `
                    <div style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:12px">${t('stats.digest.matchCount', { count: digest.job_count })}</div>
                    <div style="display:flex;flex-direction:column;gap:8px">
                        ${digest.jobs.map(j => `
                            <a href="#/job/${j.id}" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm);text-decoration:none">
                                <div>
                                    <div style="font-size:0.875rem;font-weight:500;color:var(--text-primary)">${escapeHtml(j.title)}</div>
                                    <div style="font-size:0.75rem;color:var(--text-tertiary)">${escapeHtml(j.company)}${j.location ? ' · ' + escapeHtml(j.location) : ''}</div>
                                </div>
                                <span class="score-badge ${getScoreClass(j.match_score)}" style="font-size:0.75rem">${j.match_score}</span>
                            </a>
                        `).join('')}
                    </div>
                `;
            }

            // Copy digest button
            document.getElementById('copy-digest-btn').addEventListener('click', () => {
                copyToClipboard(digest.body);
                showToast(t('stats.digest.copied'), 'success');
            });
        } catch (err) {
            document.getElementById('digest-container').innerHTML = `<div class="empty-state empty-state-compact"><div class="empty-state-title">${t('stats.digest.loadFailed')}</div><div class="empty-state-desc">${t('stats.tryRefresh')}</div></div>`;
        }

        // Fetch reminders
        try {
            const reminderData = await api.request('GET', '/api/reminders/due');
            const allReminders = await api.request('GET', '/api/reminders?status=pending');
            const due = reminderData.reminders || [];
            const upcoming = (allReminders.reminders || []).filter(r => !due.find(d => d.id === r.id));
            const remindersContainer = document.getElementById('reminders-container');
            if (due.length === 0 && upcoming.length === 0) {
                remindersContainer.innerHTML = `<div class="empty-state empty-state-compact"><div class="empty-state-title">${t('stats.reminders.empty')}</div><div class="empty-state-desc">${t('stats.reminders.emptyDesc')}</div></div>`;
            } else {
                const renderReminder = (r, isDue) => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:${isDue ? 'var(--score-red-bg, #fef2f2)' : 'var(--bg-surface-secondary)'};border-radius:var(--radius-sm);border-left:3px solid ${isDue ? 'var(--danger, #ef4444)' : 'var(--accent)'}">
                        <div>
                            <a href="#/job/${r.job_id}" style="font-size:0.875rem;font-weight:500;color:var(--text-primary);text-decoration:none">${escapeHtml(r.title || t('pipeline.offers.unknownPosition'))}</a>
                            <div style="font-size:0.75rem;color:var(--text-tertiary)">${escapeHtml(r.company || '')} &middot; ${isDue ? t('stats.reminders.overdue') : formatDate(r.remind_at)}</div>
                        </div>
                        <div style="display:flex;gap:6px">
                            <button class="btn btn-sm" onclick="completeReminder(${r.id})" style="font-size:0.75rem;padding:4px 8px">${t('actions.done')}</button>
                            <button class="btn btn-sm btn-secondary" onclick="dismissReminder(${r.id})" style="font-size:0.75rem;padding:4px 8px">${t('actions.dismiss')}</button>
                        </div>
                    </div>
                `;
                remindersContainer.innerHTML = `
                    ${due.length > 0 ? `<div style="font-size:0.8125rem;font-weight:600;color:var(--danger, #ef4444);margin-bottom:6px">${due.length} ${t('stats.reminders.overdue')}</div>` : ''}
                    <div style="display:flex;flex-direction:column;gap:6px">
                        ${due.map(r => renderReminder(r, true)).join('')}
                        ${upcoming.slice(0, 5).map(r => renderReminder(r, false)).join('')}
                    </div>
                `;
            }
        } catch {
            document.getElementById('reminders-container').innerHTML = `<div class="empty-state empty-state-compact"><div class="empty-state-title">${t('stats.reminders.loadFailed')}</div><div class="empty-state-desc">${t('stats.tryRefresh')}</div></div>`;
        }

        // Fetch skill gap data
        try {
            const gapData = await api.request('GET', '/api/skill-gaps');
            const gapsContainer = document.getElementById('skill-gaps-container');
            if (gapData.job_count === 0) {
                gapsContainer.innerHTML = `<div class="empty-state empty-state-compact"><div class="empty-state-title">${t('stats.skills.empty')}</div><div class="empty-state-desc">${t('stats.skills.emptyDesc')}</div></div>`;
            } else {
                const keywords = (gapData.top_keywords || []).slice(0, 8);
                const concerns = (gapData.top_concerns || []).slice(0, 5);
                gapsContainer.innerHTML = `
                    <div style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:12px">${gapData.job_count} ${t('stats.skills.jobsInRange')}</div>
                    ${keywords.length > 0 ? `
                        <div style="margin-bottom:12px">
                            <div style="font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:6px">${t('stats.skills.missing')}</div>
                            <div style="display:flex;flex-wrap:wrap;gap:6px">
                                ${keywords.map(([k, n]) => `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:var(--accent-surface, #eff6ff);color:var(--accent);border-radius:999px;font-size:0.8125rem;font-weight:500">${escapeHtml(k)} <span style="color:var(--text-tertiary);font-size:0.75rem">${n}</span></span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                    ${concerns.length > 0 ? `
                        <div>
                            <div style="font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:6px">${t('stats.skills.concerns')}</div>
                            <div style="display:flex;flex-direction:column;gap:4px">
                                ${concerns.map(([c, n]) => `<div style="font-size:0.8125rem;color:var(--text-secondary)">&bull; ${escapeHtml(c)} <span style="color:var(--text-tertiary)">(${n})</span></div>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                    <div id="ai-skill-analysis" style="margin-top:16px"></div>
                `;
            }
        } catch {
            document.getElementById('skill-gaps-container').innerHTML = `<div class="empty-state empty-state-compact"><div class="empty-state-title">${t('stats.skills.loadFailed')}</div><div class="empty-state-desc">${t('stats.tryRefresh')}</div></div>`;
        }

        // Analyze skills with AI button
        document.getElementById('analyze-skills-btn')?.addEventListener('click', async () => {
            const btn = document.getElementById('analyze-skills-btn');
            const resultDiv = document.getElementById('ai-skill-analysis');
            if (!resultDiv) return;
            btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${t('stats.skills.analyzing')}`;
            try {
                const result = await api.request('POST', '/api/skill-gaps/analyze');
                if (!result.skills || result.skills.length === 0) {
                    resultDiv.innerHTML = `<div style="font-size:0.875rem;color:var(--text-tertiary)">${t('stats.skills.noRecommendations')}</div>`;
                } else {
                    resultDiv.innerHTML = `
                        <div style="font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:8px">${t('stats.skills.recommended')}</div>
                        <div style="display:flex;flex-direction:column;gap:8px">
                            ${result.skills.map((s, i) => `
                                <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm);border-left:3px solid var(--accent)">
                                    <div style="font-size:1.25rem;font-weight:700;color:var(--accent);min-width:24px">${i + 1}</div>
                                    <div style="flex:1">
                                        <div style="font-weight:600;font-size:0.875rem">${escapeHtml(s.name)}</div>
                                        <div style="font-size:0.8125rem;color:var(--text-secondary);margin-top:2px">${escapeHtml(s.reason)}</div>
                                        <div style="display:flex;gap:12px;margin-top:4px;font-size:0.75rem;color:var(--text-tertiary)">
                                            <span>~${s.jobs_unlocked} jobs</span>
                                            <span>Difficulty: ${escapeHtml(s.difficulty)}</span>
                                            <span>${escapeHtml(s.time_estimate)}</span>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `;
                }
            } catch (err) {
                resultDiv.innerHTML = `<div style="color:var(--danger, #ef4444);font-size:0.875rem">${escapeHtml(apiErrorMessage(err))}</div>`;
            }
            finally { btn.disabled = false; btn.textContent = t('stats.actions.analyzeWithAI'); }
        });

        // Fetch analytics
        try {
            const analytics = await api.request('GET', '/api/analytics');
            const analyticsContainer = document.getElementById('analytics-container');
            const funnelEntries = Object.entries(analytics.funnel || {});
            const hasAnyFunnel = funnelEntries.some(([, v]) => v > 0);
            const maxFunnel = Math.max(...funnelEntries.map(([, v]) => v), 1);
            const calibration = analytics.score_calibration || {};
            const sources = analytics.sources || [];
            const maxSourceJobs = Math.max(...sources.map(s => s.jobs), 1);
            const velocity = analytics.weekly_velocity || [];
            const maxVelocity = Math.max(...velocity.map(v => v.count), 1);

            if (!hasAnyFunnel && sources.length === 0 && velocity.length === 0) {
                analyticsContainer.innerHTML = `<div class="empty-state empty-state-compact"><div class="empty-state-title">${t('stats.analytics.empty')}</div><div class="empty-state-desc">${t('stats.analytics.emptyDesc')}</div></div>`;
            } else {
                const statusColors = {
                    interested: 'var(--accent, #3b82f6)',
                    prepared: '#8b5cf6',
                    applied: '#10b981',
                    interviewing: '#f59e0b',
                    offered: '#22c55e',
                    rejected: 'var(--danger, #ef4444)',
                };
                analyticsContainer.innerHTML = `
                    ${hasAnyFunnel ? `
                        <div style="margin-bottom:24px">
                            <div style="font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:8px">${t('stats.analytics.funnel')}</div>
                            <div style="display:flex;flex-direction:column;gap:6px">
                                ${funnelEntries.map(([status, count]) => `
                                    <div style="display:flex;align-items:center;gap:8px">
                                        <div style="width:90px;font-size:0.8125rem;color:var(--text-secondary);text-transform:capitalize">${status}</div>
                                        <div style="flex:1;height:20px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm);overflow:hidden">
                                            <div style="height:100%;width:${Math.round((count / maxFunnel) * 100)}%;background:${statusColors[status] || 'var(--accent)'};border-radius:var(--radius-sm);transition:width 0.3s"></div>
                                        </div>
                                        <div style="width:30px;text-align:right;font-size:0.8125rem;font-weight:600;color:var(--text-primary)">${count}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    ${Object.values(calibration).some(v => v !== null) ? `
                        <div style="margin-bottom:24px">
                            <div style="font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:8px">${t('stats.analytics.calibration')}</div>
                            <div style="display:flex;gap:12px;flex-wrap:wrap">
                                ${Object.entries(calibration).filter(([, v]) => v !== null).map(([status, avg]) => `
                                    <div style="flex:1;min-width:120px;padding:12px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm);text-align:center">
                                        <div style="font-size:1.25rem;font-weight:700;color:${statusColors[status] || 'var(--text-primary)'}">${avg}</div>
                                        <div style="font-size:0.75rem;color:var(--text-tertiary);text-transform:capitalize;margin-top:4px">${status}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    ${sources.length > 0 ? `
                        <div style="margin-bottom:24px">
                            <div style="font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:8px">${t('stats.analytics.sourceEffectiveness')}</div>
                            <div style="display:flex;flex-direction:column;gap:6px">
                                ${sources.map(s => `
                                    <div style="display:flex;align-items:center;gap:8px">
                                        <div style="width:100px;font-size:0.8125rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(s.source)}">${escapeHtml(s.source)}</div>
                                        <div style="flex:1;height:20px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm);overflow:hidden">
                                            <div style="height:100%;width:${Math.round((s.jobs / maxSourceJobs) * 100)}%;background:var(--accent, #3b82f6);border-radius:var(--radius-sm)"></div>
                                        </div>
                                        <div style="width:70px;text-align:right;font-size:0.75rem;color:var(--text-tertiary)">${s.jobs} jobs${s.avg_score ? ' · ' + s.avg_score : ''}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    ${velocity.length > 0 ? `
                        <div>
                            <div style="font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:8px">${t('stats.analytics.velocity')}</div>
                            <div style="display:flex;align-items:flex-end;gap:4px;height:80px">
                                ${velocity.map(v => `
                                    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
                                        <div style="width:100%;background:var(--accent, #3b82f6);border-radius:var(--radius-sm) var(--radius-sm) 0 0;height:${Math.round((v.count / maxVelocity) * 100)}%;min-height:2px" title="${v.week}: ${v.count} jobs"></div>
                                        <div style="font-size:0.625rem;color:var(--text-tertiary);margin-top:4px;writing-mode:vertical-lr;transform:rotate(180deg)">${v.week.replace(/^\d{4}-/, '')}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                `;
            }
        } catch {
            document.getElementById('analytics-container').innerHTML = `<div class="empty-state empty-state-compact"><div class="empty-state-title">${t('stats.analytics.loadFailed')}</div><div class="empty-state-desc">${t('stats.tryRefresh')}</div></div>`;
        }

        // Fetch response analytics
        try {
            const ra = await api.request('GET', '/api/analytics/response-rates');
            const raContainer = document.getElementById('response-analytics-container');
            if (ra.total_applied === 0) {
                raContainer.innerHTML = `<div style="font-size:0.875rem;color:var(--text-tertiary)">${t('stats.response.empty')}</div>`;
            } else {
                const typeLabels = { interview_invite: t('stats.response.invites'), rejection: t('detail.response.type.rejection'), callback: t('detail.response.type.callback'), ghosted: t('detail.response.type.ghosted') };
                const typeColors = { interview_invite: '#22c55e', rejection: '#ef4444', callback: '#3b82f6', ghosted: '#94a3b8' };
                const breakdown = ra.type_breakdown || {};
                const maxBreakdown = Math.max(...Object.values(breakdown), 1);
                const byScore = ra.by_score_range || [];
                const maxScoreApplied = Math.max(...byScore.map(s => s.applied), 1);

                raContainer.innerHTML = `
                    <div class="stats-grid" style="margin-bottom:20px">
                        <div class="card stat-card">
                            <div class="stat-number">${ra.response_rate}%</div>
                            <div class="stat-label">${t('stats.response.rate')}</div>
                        </div>
                        <div class="card stat-card">
                            <div class="stat-number">${ra.total_responses}/${ra.total_applied}</div>
                            <div class="stat-label">${t('stats.response.perApplied')}</div>
                        </div>
                        <div class="card stat-card">
                            <div class="stat-number">${ra.avg_days_to_response != null ? ra.avg_days_to_response + 'd' : '--'}</div>
                            <div class="stat-label">${t('stats.response.avgDays')}</div>
                        </div>
                    </div>
                    ${Object.keys(breakdown).length > 0 ? `
                        <div style="margin-bottom:20px">
                            <div style="font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:8px">${t('stats.response.types')}</div>
                            <div style="display:flex;flex-direction:column;gap:6px">
                                ${Object.entries(breakdown).map(([type, count]) => `
                                    <div style="display:flex;align-items:center;gap:8px">
                                        <div style="width:120px;font-size:0.8125rem;color:var(--text-secondary);text-transform:capitalize">${typeLabels[type] || type}</div>
                                        <div style="flex:1;height:20px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm);overflow:hidden">
                                            <div style="height:100%;width:${Math.round((count / maxBreakdown) * 100)}%;background:${typeColors[type] || 'var(--accent)'};border-radius:var(--radius-sm)"></div>
                                        </div>
                                        <div style="width:30px;text-align:right;font-size:0.8125rem;font-weight:600">${count}</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    ${byScore.length > 0 ? `
                        <div>
                            <div style="font-size:0.8125rem;font-weight:600;color:var(--text-tertiary);margin-bottom:8px">${t('stats.response.byScore')}</div>
                            <div style="display:flex;flex-direction:column;gap:6px">
                                ${byScore.map(s => `
                                    <div style="display:flex;align-items:center;gap:8px">
                                        <div style="width:60px;font-size:0.8125rem;font-weight:600;color:var(--text-secondary)">${s.range}</div>
                                        <div style="flex:1;height:20px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm);overflow:hidden">
                                            <div style="height:100%;width:${Math.round((s.applied / maxScoreApplied) * 100)}%;background:var(--accent);border-radius:var(--radius-sm);position:relative">
                                                ${s.responded > 0 ? `<div style="position:absolute;right:0;top:0;bottom:0;width:${Math.round((s.responded / s.applied) * 100)}%;background:#22c55e;border-radius:var(--radius-sm)"></div>` : ''}
                                            </div>
                                        </div>
                                        <div style="width:80px;text-align:right;font-size:0.75rem;color:var(--text-secondary)">${s.responded}/${s.applied} (${s.rate}%)</div>
                                    </div>
                                `).join('')}
                            </div>
                            <div style="display:flex;gap:12px;margin-top:6px;font-size:0.75rem;color:var(--text-tertiary)">
                                <span><span style="display:inline-block;width:10px;height:10px;background:var(--accent);border-radius:2px;vertical-align:middle"></span> ${t('stats.response.applied')}</span>
                                <span><span style="display:inline-block;width:10px;height:10px;background:#22c55e;border-radius:2px;vertical-align:middle"></span> ${t('stats.response.responded')}</span>
                            </div>
                        </div>
                    ` : ''}
                `;
            }
        } catch {
            document.getElementById('response-analytics-container').innerHTML = `<div class="empty-state empty-state-compact"><div class="empty-state-title">${t('stats.response.loadFailed')}</div><div class="empty-state-desc">${t('stats.tryRefresh')}</div></div>`;
        }

        // Career Advisor
        try {
            const careerData = await api.request('GET', '/api/career/suggestions');
            const suggestions = careerData.suggestions || [];
            const careerContainer = document.getElementById('career-advisor-container');
            if (suggestions.length === 0) {
                careerContainer.innerHTML = `<div style="font-size:0.875rem;color:var(--text-tertiary)">${t('stats.career.emptyDesc')}</div>`;
            } else {
                careerContainer.innerHTML = `
                    <div style="display:flex;flex-direction:column;gap:8px">
                        ${suggestions.map(s => `
                            <div style="padding:12px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm);border-left:3px solid ${s.accepted ? '#22c55e' : 'var(--accent)'}">
                                <div style="display:flex;justify-content:space-between;align-items:flex-start">
                                    <div style="flex:1">
                                        <div style="font-weight:600;font-size:0.875rem">${escapeHtml(s.title || s.suggestion || '')}</div>
                                        ${s.reasoning ? `<div style="font-size:0.8125rem;color:var(--text-secondary);margin-top:4px">${escapeHtml(s.reasoning)}</div>` : ''}
                                        ${s.gap ? `<div style="font-size:0.75rem;color:var(--text-tertiary);margin-top:2px">Gap: ${escapeHtml(s.gap)}</div>` : ''}
                                    </div>
                                    ${!s.accepted ? `<button class="btn btn-primary btn-sm career-accept-btn" data-id="${s.id}" style="flex-shrink:0;margin-left:8px">${t('stats.actions.accept')}</button>` : `<span style="font-size:0.75rem;color:#22c55e;font-weight:600">${t('stats.career.acceptedLabel')}</span>`}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
                careerContainer.querySelectorAll('.career-accept-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        try {
                            await api.request('POST', `/api/career/suggestions/${btn.dataset.id}/accept`);
                            showToast(t('stats.career.accepted'), 'success');
                            await renderStats(container);
                        } catch (err) { showToast(apiErrorMessage(err), 'error'); }
                    });
                });
            }
        } catch {
            document.getElementById('career-advisor-container').innerHTML = `<div class="empty-state empty-state-compact"><div class="empty-state-title">${t('stats.career.loadFailed')}</div><div class="empty-state-desc">${t('stats.tryRefresh')}</div></div>`;
        }

        // Career analyze button
        document.getElementById('career-analyze-btn')?.addEventListener('click', async () => {
            if (!await requireAIAndResume()) return;
            const btn = document.getElementById('career-analyze-btn');
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner"></span> ${t('stats.skills.analyzing')}`;
            try {
                await api.request('POST', '/api/career/analyze');
                showToast(t('stats.career.complete'), 'success');
                await renderStats(container);
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                btn.disabled = false;
                btn.textContent = t('stats.actions.analyzeCareer');
            }
        });
    } catch (err) {
        showToast(apiErrorMessage(err), 'error');
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-title">${t('stats.loadFailed')}</div>
                <div class="empty-state-desc">${escapeHtml(apiErrorMessage(err))}</div>
            </div>
        `;
    }
}
