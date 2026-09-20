// === Calendar View ===

async function renderCalendar(container) {
    container.innerHTML = `<div class="loading-container"><div class="spinner spinner-lg"></div><span>${t('calendar.loading')}</span></div>`;

    let viewDate = new Date();
    viewDate.setDate(1);

    try {
        await renderCalendarView(container, viewDate);
    } catch (err) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-title">${t('calendar.loadFailed')}</div><div class="empty-state-desc">${escapeHtml(apiErrorMessage(err))}</div></div>`;
    }
}

async function renderCalendarView(container, viewDate) {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);

    const startStr = toDateStr(new Date(year, month, 1 - monthStart.getDay()));
    const endStr = toDateStr(new Date(year, month + 1, 6 - monthEnd.getDay()));

    let events = [];
    try {
        const data = await api.getCalendarEvents({ start: startStr, end: endStr });
        events = data.events || [];
    } catch {
        // API may not exist yet — render empty calendar
    }

    const today = new Date();
    const todayStr = toDateStr(today);
    const monthLabel = i18n.formatMonthYear(viewDate);

    // Build agenda for next 7 days
    const agendaStart = new Date(today);
    const agendaEnd = new Date(today);
    agendaEnd.setDate(agendaEnd.getDate() + 7);
    const agendaEvents = events.filter(e => {
        const d = e.date || (e.scheduled_at || '').slice(0, 10);
        return d >= toDateStr(agendaStart) && d < toDateStr(agendaEnd);
    }).sort((a, b) => (a.scheduled_at || a.date || '').localeCompare(b.scheduled_at || b.date || ''));

    container.innerHTML = `
        <div class="calendar-header">
            <h1 class="page-title">${t('calendar.title')}</h1>
            <div class="calendar-header-controls">
                <button id="cal-prev" class="btn btn-ghost btn-sm" aria-label="${t('calendar.previousMonth')}">&larr;</button>
                <span id="cal-month-label" style="font-weight:600;min-width:160px;text-align:center">${escapeHtml(monthLabel)}</span>
                <button id="cal-next" class="btn btn-ghost btn-sm" aria-label="${t('calendar.nextMonth')}">&rarr;</button>
                <button id="cal-today" class="btn btn-secondary btn-sm">${t('a11y.today')}</button>
                <button id="cal-subscribe" class="btn btn-ghost btn-sm" title="${t('calendar.subscribeTitle')}">${t('calendar.subscribe')}</button>
            </div>
        </div>
        <div class="calendar-layout">
            <div class="calendar-grid-wrapper">
                <div class="calendar-weekdays">
                    ${i18n.weekdayNames().map(d =>
                        `<div class="calendar-weekday">${d}</div>`
                    ).join('')}
                </div>
                <div id="cal-grid" class="calendar-grid">
                    ${buildCalendarGrid(year, month, events, todayStr)}
                </div>
            </div>
            <div class="calendar-sidebar">
                <h3 style="font-size:0.9375rem;font-weight:600;margin:0 0 12px">${t('calendar.next7Days')}</h3>
                <div id="cal-agenda">
                    ${renderAgenda(agendaEvents)}
                </div>
            </div>
        </div>
    `;

    // Navigation handlers
    const navHandler = (delta) => {
        viewDate.setMonth(viewDate.getMonth() + delta);
        renderCalendarView(container, viewDate);
    };

    container.querySelector('#cal-prev').addEventListener('click', () => navHandler(-1));
    container.querySelector('#cal-next').addEventListener('click', () => navHandler(1));
    container.querySelector('#cal-today').addEventListener('click', () => {
        viewDate = new Date();
        viewDate.setDate(1);
        renderCalendarView(container, viewDate);
    });

    container.querySelector('#cal-subscribe').addEventListener('click', () => showIcalModal());

    // Day cell click to expand
    container.querySelectorAll('.calendar-day[data-date]').forEach(cell => {
        cell.addEventListener('click', () => {
            const dateStr = cell.dataset.date;
            const dayEvents = events.filter(e => (e.date || (e.scheduled_at || '').slice(0, 10)) === dateStr);
            if (dayEvents.length > 0) {
                showDayDetailModal(dateStr, dayEvents);
            }
        });
    });
}

function buildCalendarGrid(year, month, events, todayStr) {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const eventsByDate = {};
    events.forEach(e => {
        const d = e.date || (e.scheduled_at || '').slice(0, 10);
        if (!d) return;
        if (!eventsByDate[d]) eventsByDate[d] = [];
        eventsByDate[d].push(e);
    });

    let cells = '';
    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

    for (let i = 0; i < totalCells; i++) {
        let dayNum, dateStr, isOtherMonth = false;

        if (i < firstDay) {
            dayNum = prevMonthDays - firstDay + i + 1;
            const prevMonth = month === 0 ? 11 : month - 1;
            const prevYear = month === 0 ? year - 1 : year;
            dateStr = toDateStr(new Date(prevYear, prevMonth, dayNum));
            isOtherMonth = true;
        } else if (i >= firstDay + daysInMonth) {
            dayNum = i - firstDay - daysInMonth + 1;
            const nextMonth = month === 11 ? 0 : month + 1;
            const nextYear = month === 11 ? year + 1 : year;
            dateStr = toDateStr(new Date(nextYear, nextMonth, dayNum));
            isOtherMonth = true;
        } else {
            dayNum = i - firstDay + 1;
            dateStr = toDateStr(new Date(year, month, dayNum));
        }

        const isToday = dateStr === todayStr;
        const dayEvents = eventsByDate[dateStr] || [];

        const chipLimit = 3;
        const visibleEvents = dayEvents.slice(0, chipLimit);
        const overflow = dayEvents.length - chipLimit;

        cells += `
            <div class="calendar-day ${isOtherMonth ? 'calendar-day-other' : ''} ${isToday ? 'calendar-day-today' : ''} ${dayEvents.length ? 'calendar-day-has-events' : ''}" data-date="${dateStr}">
                <div class="calendar-day-number">${dayNum}</div>
                <div class="calendar-day-events">
                    ${visibleEvents.map(e => {
                        const chipClass = e.type === 'interview' ? 'calendar-chip-interview' : 'calendar-chip-reminder';
                        const label = e.type === 'interview'
                            ? escapeHtml(e.company || e.label || t('calendar.interview'))
                            : escapeHtml(e.label || t('calendar.reminder'));
                        return `<div class="calendar-chip ${chipClass}" title="${escapeHtml(e.label || '')}">${label}</div>`;
                    }).join('')}
                    ${overflow > 0 ? `<div class="calendar-chip-more">+${overflow} more</div>` : ''}
                </div>
            </div>
        `;
    }
    return cells;
}

function renderAgenda(events) {
    if (!events.length) {
        return `<div class="calendar-agenda-empty">${t('calendar.emptyUpcoming')}</div>`;
    }

    return events.map(e => {
        const d = e.scheduled_at || e.date || '';
        const dateObj = d ? new Date(d) : null;
        const timeStr = dateObj && d.includes('T')
            ? i18n.formatTime(dateObj)
            : '';
        const dateLabel = dateObj
            ? i18n.formatWeekdayDate(dateObj)
            : '';
        const chipClass = e.type === 'interview' ? 'calendar-chip-interview' : 'calendar-chip-reminder';
        const label = e.type === 'interview'
            ? escapeHtml(e.company || e.label || t('calendar.interview'))
            : escapeHtml(e.label || t('calendar.reminder'));

        return `
            <div class="calendar-agenda-item">
                <div class="calendar-agenda-dot ${chipClass}"></div>
                <div class="calendar-agenda-content">
                    <div class="calendar-agenda-label">${label}</div>
                    <div class="calendar-agenda-time">${escapeHtml(dateLabel)}${timeStr ? ` at ${escapeHtml(timeStr)}` : ''}</div>
                    ${e.job_id ? `<a href="#/job/${e.job_id}" class="calendar-agenda-link">${t('calendar.viewJob')}</a>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function showDayDetailModal(dateStr, events) {
    const existing = document.getElementById('cal-day-modal');
    if (existing) existing.remove();

    const dateObj = new Date(dateStr + 'T12:00:00');
    const dateLabel = i18n.formatWeekdayDateLong(dateObj);

    const modal = document.createElement('div');
    modal.id = 'cal-day-modal';
    modal.innerHTML = `
        <div class="modal-overlay" onclick="document.getElementById('cal-day-modal')?.remove()">
            <div class="modal-content" style="max-width:480px" onclick="event.stopPropagation()">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h2 class="modal-title" style="margin:0">${escapeHtml(dateLabel)}</h2>
                    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('cal-day-modal')?.remove()">${t('actions.close')}</button>
                </div>
                <div style="display:flex;flex-direction:column;gap:10px">
                    ${events.map(e => {
                        const time = (e.scheduled_at && e.scheduled_at.includes('T'))
                            ? i18n.formatTime(e.scheduled_at)
                            : t('calendar.allDay');
                        const chipClass = e.type === 'interview' ? 'calendar-chip-interview' : 'calendar-chip-reminder';
                        return `
                            <div class="card" style="padding:12px${e.type === 'interview' ? ';cursor:pointer' : ''}"${e.type === 'interview' && e.id && e.job_id ? ` data-interview-id="${e.id}" data-job-id="${e.job_id}"` : ''}>
                                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                                    <div class="calendar-agenda-dot ${chipClass}"></div>
                                    <span style="font-weight:600;font-size:0.875rem">${escapeHtml(e.label || e.company || (e.type === 'interview' ? t('calendar.interview') : t('calendar.reminder')))}</span>
                                    <span style="margin-left:auto;font-size:0.8rem;color:var(--text-secondary)">${escapeHtml(time)}</span>
                                </div>
                                ${e.company ? `<div style="font-size:0.8rem;color:var(--text-secondary)">${escapeHtml(e.company)}</div>` : ''}
                                ${e.notes ? `<div style="font-size:0.8rem;color:var(--text-tertiary);margin-top:4px">${escapeHtml(e.notes)}</div>` : ''}
                                <div style="display:flex;gap:8px;margin-top:6px">
                                    ${e.type === 'interview' && e.id && e.job_id ? `<button class="btn btn-primary btn-sm cal-open-interview" data-interview-id="${e.id}" data-job-id="${e.job_id}" style="font-size:0.75rem">${t('calendar.viewInterview')}</button>` : ''}
                                    ${e.job_id ? `<a href="#/job/${e.job_id}" class="btn btn-ghost btn-sm" style="font-size:0.75rem" onclick="document.getElementById('cal-day-modal')?.remove()">${t('calendar.viewJob')}</a>` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Wire interview panel open buttons
    modal.querySelectorAll('.cal-open-interview').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const roundId = parseInt(btn.dataset.interviewId);
            const jobId = parseInt(btn.dataset.jobId);
            modal.remove();
            openInterviewPanel(roundId, jobId);
        });
    });
}

async function showIcalModal() {
    const existing = document.getElementById('ical-modal');
    if (existing) existing.remove();

    let tokenData = null;
    try {
        tokenData = await api.getIcalToken();
    } catch {
        // API may not exist yet
    }

    const icalUrl = tokenData?.token
        ? `${window.location.origin}/ical/${tokenData.token}.ics`
        : '';

    const modal = document.createElement('div');
    modal.id = 'ical-modal';
    modal.innerHTML = `
        <div class="modal-overlay" onclick="document.getElementById('ical-modal')?.remove()">
            <div class="modal-content" style="max-width:480px" onclick="event.stopPropagation()">
                <h2 class="modal-title">${t('calendar.subscribeModalTitle')}</h2>
                <p class="modal-message">${t('calendar.subscribeHelp')}</p>
                ${icalUrl ? `
                    <div style="display:flex;gap:8px;margin-bottom:12px">
                        <input type="text" class="form-input" id="ical-url" value="${escapeHtml(icalUrl)}" readonly style="font-size:0.8rem">
                        <button id="ical-copy-btn" class="btn btn-primary btn-sm">${t('calendar.copy')}</button>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <button id="ical-regen-btn" class="btn btn-ghost btn-sm" style="color:var(--danger)">${t('calendar.regenerate')}</button>
                        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('ical-modal')?.remove()">${t('actions.close')}</button>
                    </div>
                ` : `
                    <div class="empty-state-compact" style="margin-bottom:16px">
                        <div class="empty-state-desc">Calendar subscription is not available yet. Please check back later.</div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('ical-modal')?.remove()">${t('actions.close')}</button>
                    </div>
                `}
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    if (icalUrl) {
        modal.querySelector('#ical-copy-btn').addEventListener('click', () => {
            const input = modal.querySelector('#ical-url');
            navigator.clipboard.writeText(input.value).then(() => {
                showToast(t('calendar.icalCopied'), 'success');
            }).catch(() => {
                input.select();
                showToast(t('calendar.icalCopyManual'), 'info');
            });
        });

        modal.querySelector('#ical-regen-btn').addEventListener('click', async () => {
            const ok = await showModal({
                title: t('calendar.regenerate'),
                message: t('calendar.regenerateConfirm'),
                confirmText: t('actions.regenerate'),
                danger: true,
            });
            if (!ok) return;
            try {
                const newData = await api.regenerateIcalToken();
                const newUrl = `${window.location.origin}/ical/${newData.token}.ics`;
                const input = modal.querySelector('#ical-url');
                if (input) input.value = newUrl;
                showToast(t('calendar.regenerated'), 'success');
            } catch (err) {
                showToast(t('calendar.regenerateFailed', { error: err.message }), 'error');
            }
        });
    }
}

function toDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
