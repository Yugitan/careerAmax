// === Contact List (formerly Application Queue) ===
// Simplified for China market: BOSS direct chat replaces ATS auto-fill.
// This view is now a "to-contact" bookmark list with remove-only actions.

async function renderQueue(container) {
    container.innerHTML = `<div class="loading-container"><div class="spinner spinner-lg"></div><span>${t('queue.loading')}</span></div>`;

    try {
        const [queueData] = await Promise.all([
            api.request('GET', '/api/queue'),
        ]);
        const queue = queueData.queue || [];

        container.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">${t('queue.contactList')}</h1>
            </div>
            ${queue.length === 0 ? `
                <div class="empty-state">
                    <div class="empty-state-icon">&#128203;</div>
                    <div class="empty-state-title">${t('queue.emptyTitle')}</div>
                    <div class="empty-state-desc">${t('queue.emptyDesc')}</div>
                </div>
            ` : `
                <div style="display:flex;flex-direction:column;gap:8px" id="queue-items">
                    ${queue.map(item => renderQueueItem(item)).join('')}
                </div>
            `}
        `;

        // Per-item: Remove
        container.querySelectorAll('.queue-remove-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api.request('DELETE', `/api/queue/${btn.dataset.id}`);
                    showToast(t('queue.removed'), 'success');
                    await renderQueue(container);
                } catch (err) { showToast(apiErrorMessage(err), 'error'); }
            });
        });
    } catch (err) {
        showToast(apiErrorMessage(err), 'error');
        container.innerHTML = `<div class="empty-state"><div class="empty-state-title">${t('queue.loadFailed')}</div></div>`;
    }
}

function renderQueueItem(item) {
    return `
        <div class="card queue-item" style="padding:16px" data-queue-id="${item.id}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
                <div style="flex:1;min-width:0">
                    <a href="#/job/${item.job_id}" style="font-weight:600;font-size:0.9375rem">${escapeHtml(item.title || t('queue.jobNumber', { id: item.job_id }))}</a>
                    <div style="font-size:0.8125rem;color:var(--text-secondary)">${escapeHtml(item.company || '')}</div>
                    <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
                        ${item.match_score != null ? `<span class="score-badge ${getScoreClass(item.match_score)}" style="font-size:0.75rem">${item.match_score}</span>` : ''}
                    </div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0">
                    <a href="#/job/${item.job_id}" class="btn btn-secondary btn-sm">${t('queue.viewDetails')}</a>
                    <button class="btn btn-danger btn-sm queue-remove-btn" data-id="${item.id}">${t('actions.remove')}</button>
                </div>
            </div>
        </div>
    `;
}
