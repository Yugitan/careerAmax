// === M9 面试题库与模拟面试面板 ===
//
// 题目结构里的 category / difficulty / status 都是稳定英文枚举（存库与接口），
// 界面文案一律经 t() 映射，两者永不混用（见 i18n 铁律）。
// raw business content: question / key_points / star_hint / user_draft 是
// AI 生成或用户输入的内容，直接展示、不翻译。

const PREP_CATEGORY_ORDER = ['basics', 'project', 'design', 'hr'];

const PREP_CATEGORY_LABEL_KEYS = {
    basics: 'interviews.prep.categoryBasics',
    project: 'interviews.prep.categoryProject',
    design: 'interviews.prep.categoryDesign',
    hr: 'interviews.prep.categoryHr',
};

const PREP_DIFFICULTY_LABEL_KEYS = {
    easy: 'interviews.prep.difficultyEasy',
    medium: 'interviews.prep.difficultyMedium',
    hard: 'interviews.prep.difficultyHard',
};

const PREP_STATUS_LABEL_KEYS = {
    todo: 'interviews.prep.statusTodo',
    drafted: 'interviews.prep.statusDrafted',
    mastered: 'interviews.prep.statusMastered',
};

const PREP_VERDICT_LABEL_KEYS = {
    smooth: 'interviews.prep.verdictSmooth',
    stuck: 'interviews.prep.verdictStuck',
    unknown: 'interviews.prep.verdictUnknown',
};

function prepLabel(map, value, fallbackKey) {
    return t(map[value] || fallbackKey);
}

function renderPrepQuestion(question, index) {
    // raw business content: 题干、要点、提示与草稿
    const keyPoints = question.key_points || [];
    const isMastered = question.status === 'mastered';
    return `
        <div class="prep-question" data-index="${index}" data-status="${question.status}">
            <div class="prep-question-head">
                <span class="prep-badge prep-difficulty" data-difficulty="${question.difficulty}">${prepLabel(PREP_DIFFICULTY_LABEL_KEYS, question.difficulty, 'interviews.prep.difficultyMedium')}</span>
                <span class="prep-badge prep-status" data-status="${question.status}">${prepLabel(PREP_STATUS_LABEL_KEYS, question.status, 'interviews.prep.statusTodo')}</span>
            </div>
            <div class="prep-question-text">${escapeHtml(question.question)}</div>
            ${keyPoints.length ? `<ul class="prep-key-points">${keyPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>` : ''}
            ${question.star_hint ? `<div class="prep-hint"><strong>${t('interviews.prep.starHintLabel')}</strong>${escapeHtml(question.star_hint)}</div>` : ''}
            <textarea class="search-input prep-draft" rows="3" placeholder="${t('interviews.prep.draftPlaceholder')}">${escapeHtml(question.user_draft || '')}</textarea>
            <div class="prep-actions">
                <button class="btn btn-secondary btn-sm prep-save-btn">${t('interviews.prep.saveDraft')}</button>
                <button class="btn btn-ghost btn-sm prep-expand-btn">${t('interviews.prep.expand')}</button>
                <button class="btn btn-ghost btn-sm prep-master-btn">${isMastered ? t('interviews.prep.markTodo') : t('interviews.prep.markMastered')}</button>
            </div>
        </div>
    `;
}

function renderInterviewPrepPanel(prep, progress, jobId) {
    const questions = (prep && prep.questions) || [];
    const stats = progress || { total: 0, drafted: 0, mastered: 0, percent: 0 };
    if (questions.length === 0) {
        return `
            <div class="card sidebar-section" id="interview-prep-panel">
                <h3>${t('interviews.prep.title')}</h3>
                <button class="btn btn-primary" id="generate-interview-prep-btn" style="width:100%">${t('interviews.prep.generate')}</button>
            </div>
        `;
    }
    const groups = PREP_CATEGORY_ORDER.map(category => {
        const items = questions
            .map((question, index) => ({ question, index }))
            .filter(({ question }) => question.category === category);
        if (items.length === 0) return '';
        return `
            <details open class="prep-group">
                <summary>${t(PREP_CATEGORY_LABEL_KEYS[category])}<span class="prep-count">${items.length}</span></summary>
                ${items.map(({ question, index }) => renderPrepQuestion(question, index)).join('')}
            </details>
        `;
    }).join('');

    return `
        <div class="card sidebar-section" id="interview-prep-panel">
            <div class="prep-header">
                <h3>${t('interviews.prep.title')}</h3>
                <span class="prep-percent">${t('interviews.prep.percent', { percent: stats.percent })}</span>
            </div>
            <div class="prep-progress"><div class="prep-progress-bar" style="width:${stats.percent}%"></div></div>
            <div class="prep-summary">${t('interviews.prep.progressSummary', { total: stats.total, drafted: stats.drafted, mastered: stats.mastered })}</div>
            <button class="btn btn-primary btn-sm" id="start-mock-interview-btn" style="width:100%;margin:10px 0">${t('interviews.prep.mockStart')}</button>
            ${groups}
            <div class="prep-footer">
                <button class="btn btn-secondary btn-sm" id="generate-interview-prep-btn" style="flex:1">${t('interviews.prep.regenerate')}</button>
                <button class="btn btn-ghost btn-sm" id="copy-prep-btn" style="flex:1">${t('interviews.prep.copyButton')}</button>
            </div>
            <div id="prep-copy-row" style="display:none;margin-top:10px"></div>
        </div>
    `;
}

async function reloadInterviewPrepPanel(container, jobId) {
    try {
        const result = await api.request('GET', `/api/jobs/${jobId}/interview-prep`);
        mountInterviewPrepPanel(container, result.prep, result.progress, jobId);
    } catch (err) {
        showToast(apiErrorMessage(err), 'error');
    }
}

/** 渲染面板并把题库挂到容器上（模拟面试直接读取），再绑定交互。 */
function mountInterviewPrepPanel(container, prep, progress, jobId) {
    container.innerHTML = renderInterviewPrepPanel(prep, progress, jobId);
    container.__prepData = (prep && prep.questions) || [];
    wireInterviewPrepPanel(container, jobId);
}

function wireInterviewPrepPanel(container, jobId) {
    const panel = container.querySelector('#interview-prep-panel');
    if (!panel) return;

    container.querySelectorAll('.prep-save-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const card = btn.closest('.prep-question');
            const index = Number(card.dataset.index);
            const draft = card.querySelector('.prep-draft').value;
            // 已熟练的题保存草稿时不降级
            const status = card.dataset.status === 'mastered'
                ? 'mastered'
                : (draft.trim() ? 'drafted' : 'todo');
            btn.disabled = true;
            try {
                await api.request('PUT', `/api/jobs/${jobId}/interview-prep/questions/${index}`,
                    { user_draft: draft, status });
                showToast(t('interviews.prep.draftSaved'), 'success');
                await reloadInterviewPrepPanel(container, jobId);
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                btn.disabled = false;
            }
        });
    });

    container.querySelectorAll('.prep-master-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const card = btn.closest('.prep-question');
            const index = Number(card.dataset.index);
            const status = card.dataset.status === 'mastered' ? 'todo' : 'mastered';
            btn.disabled = true;
            try {
                await api.request('PUT', `/api/jobs/${jobId}/interview-prep/questions/${index}`, { status });
                await reloadInterviewPrepPanel(container, jobId);
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                btn.disabled = false;
            }
        });
    });

    container.querySelectorAll('.prep-expand-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const card = btn.closest('.prep-question');
            const index = Number(card.dataset.index);
            if (!await requireAI()) return;
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner"></span> ${t('status.generating')}`;
            try {
                await api.request('POST', `/api/jobs/${jobId}/interview-prep/questions/${index}/expand`);
                showToast(t('interviews.prep.expanded'), 'success');
                await reloadInterviewPrepPanel(container, jobId);
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                btn.disabled = false;
                btn.textContent = t('interviews.prep.expand');
            }
        });
    });

    const mockBtn = container.querySelector('#start-mock-interview-btn');
    if (mockBtn) {
        mockBtn.addEventListener('click', () => startMockInterview(container.__prepData || []));
    }

    const copyBtn = container.querySelector('#copy-prep-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => openPrepCopyRow(container, jobId));
    }
}

async function openPrepCopyRow(container, jobId) {
    const row = container.querySelector('#prep-copy-row');
    if (!row) return;
    row.style.display = '';
    row.innerHTML = `<div class="prep-summary">${t('status.loading')}</div>`;
    try {
        const result = await api.request('GET', '/api/interview-prep/sources');
        const options = (result.sources || []).filter(source => source.job_id !== jobId);
        if (options.length === 0) {
            row.innerHTML = `<div class="prep-summary">${t('interviews.prep.copyEmpty')}</div>`;
            return;
        }
        row.innerHTML = `
            <label for="prep-copy-source" style="display:block;font-size:0.75rem;color:var(--text-tertiary);margin-bottom:4px">${t('interviews.prep.copySource')}</label>
            <select class="filter-select" id="prep-copy-source" style="width:100%;margin-bottom:8px">
                ${options.map(source => `<option value="${source.job_id}">${escapeHtml(source.title)} — ${escapeHtml(source.company)}</option>`).join('')}
            </select>
            <button class="btn btn-secondary btn-sm" id="prep-copy-confirm" style="width:100%">${t('interviews.prep.copyButton')}</button>
        `;
        row.querySelector('#prep-copy-confirm').addEventListener('click', async (e) => {
            const sourceId = Number(row.querySelector('#prep-copy-source').value);
            e.target.disabled = true;
            try {
                const copied = await api.request('POST', `/api/jobs/${jobId}/interview-prep/copy`, { source_job_id: sourceId });
                showToast(t('interviews.prep.copied', { count: (copied.progress || {}).total || 0 }), 'success');
                await reloadInterviewPrepPanel(container, jobId);
            } catch (err) {
                showToast(apiErrorMessage(err), 'error');
                e.target.disabled = false;
            }
        });
    } catch (err) {
        row.innerHTML = `<div class="prep-summary">${escapeHtml(apiErrorMessage(err))}</div>`;
    }
}

/**
 * 模拟面试：逐题模式，全程本地记录，结束后给出薄弱点报告。
 * raw business content: 题目文本来自 AI，直接展示。
 */
function startMockInterview(questions) {
    const list = (questions || []).filter(question => question && question.question);
    if (list.length === 0) return;
    let current = 0;
    const results = [];
    const overlay = document.createElement('div');
    overlay.className = 'prep-mock-overlay';
    document.body.appendChild(overlay);
    const close = () => overlay.remove();

    const renderQuestion = () => {
        const question = list[current];
        overlay.innerHTML = `
            <div class="prep-mock-dialog" role="dialog" aria-modal="true" aria-label="${t('interviews.prep.mockTitle')}">
                <div class="prep-mock-progress">${t('interviews.prep.mockProgress', { current: current + 1, total: list.length })}</div>
                <div class="prep-mock-question">${escapeHtml(question.question)}</div>
                <div class="prep-summary">${t('interviews.prep.mockTipsHidden')}</div>
                <div class="prep-mock-actions">
                    <button class="btn btn-primary" data-verdict="smooth">${t('interviews.prep.verdictSmooth')}</button>
                    <button class="btn btn-secondary" data-verdict="stuck">${t('interviews.prep.verdictStuck')}</button>
                    <button class="btn btn-ghost" data-verdict="unknown">${t('interviews.prep.verdictUnknown')}</button>
                </div>
                <button class="btn btn-ghost btn-sm prep-mock-exit">${t('interviews.prep.mockExit')}</button>
            </div>
        `;
        overlay.querySelectorAll('[data-verdict]').forEach(btn => {
            btn.addEventListener('click', () => {
                results.push({ question: question.question, verdict: btn.dataset.verdict });
                current += 1;
                if (current >= list.length) renderReport();
                else renderQuestion();
            });
        });
        overlay.querySelector('.prep-mock-exit').addEventListener('click', close);
    };

    const renderReport = () => {
        const countOf = (verdict) => results.filter(result => result.verdict === verdict).length;
        const weak = results.filter(result => result.verdict !== 'smooth');
        overlay.innerHTML = `
            <div class="prep-mock-dialog" role="dialog" aria-modal="true" aria-label="${t('interviews.prep.reportTitle')}">
                <h3>${t('interviews.prep.reportTitle')}</h3>
                <div class="prep-mock-stats">
                    <span>${t(PREP_VERDICT_LABEL_KEYS.smooth)} ${countOf('smooth')}</span>
                    <span>${t(PREP_VERDICT_LABEL_KEYS.stuck)} ${countOf('stuck')}</span>
                    <span>${t(PREP_VERDICT_LABEL_KEYS.unknown)} ${countOf('unknown')}</span>
                </div>
                ${weak.length ? `
                    <div class="prep-mock-weak-title">${t('interviews.prep.weakTitle')}</div>
                    <ul class="prep-mock-weak">
                        ${weak.map(item => `<li>${escapeHtml(item.question)}<span class="prep-badge" data-status="todo">${t(PREP_VERDICT_LABEL_KEYS[item.verdict])}</span></li>`).join('')}
                    </ul>
                ` : `<div class="prep-mock-empty">${t('interviews.prep.noWeak')}</div>`}
                <button class="btn btn-primary prep-mock-close">${t('interviews.prep.mockDone')}</button>
            </div>
        `;
        overlay.querySelector('.prep-mock-close').addEventListener('click', close);
    };

    renderQuestion();
}
