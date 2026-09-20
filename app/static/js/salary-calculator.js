// === 到手工资计算器（中国口径）===
//
// 金额一律为人民币月薪口径（元/月），不做任何币种换算。
// 五险一金与个税累计预扣的算法在 app/salary.py 中实现，界面只负责收集输入
// 并展示 /api/salary/calculate 的返回结果，避免前后端两套口径。

const CALC_STORAGE_KEY = 'careerpulse_calc_settings';

let calcCities = [];
let calcDonutChart = null;
let calcBarChart = null;

function loadCalcSettings() {
    try {
        return JSON.parse(localStorage.getItem(CALC_STORAGE_KEY)) || {};
    } catch { return {}; }
}

function saveCalcSettings(settings) {
    try {
        localStorage.setItem(CALC_STORAGE_KEY, JSON.stringify(settings));
    } catch { /* storage unavailable */ }
}

async function fetchSalaryCities() {
    // Fetched on every render so a refreshed city dataset is picked up without
    // a full page reload; the payload is small.
    const res = await api.request('GET', '/api/salary/cities');
    calcCities = res.cities || [];
    return calcCities;
}

function calcMoney(value) {
    return formatCurrency(Math.round(Number(value) || 0));
}

function calcPercent(value) {
    return i18n.formatPercent(Number(value) || 0);
}

/** 城市下拉框：显示城市名，值为 city_code。 */
function buildCityOptions(cities, selected) {
    return cities.map((city) => {
        const chosen = city.city_code === selected ? ' selected' : '';
        return `<option value="${escapeHtml(city.city_code)}"${chosen}>${escapeHtml(city.city_name)}</option>`;
    }).join('');
}

/** 公积金比例下拉框：按城市允许的区间生成。 */
function buildFundRateOptions(city, selected) {
    const min = Math.round((city?.housing_fund_rate_min ?? 0.05) * 100);
    const max = Math.round((city?.housing_fund_rate_max ?? 0.12) * 100);
    const options = [];
    for (let rate = min; rate <= max; rate += 1) {
        options.push(`<option value="${rate}"${rate === selected ? ' selected' : ''}>${rate}%</option>`);
    }
    if (!options.length) options.push(`<option value="${min}" selected>${min}%</option>`);
    return options.join('');
}

function renderCalcSelect(id, label, options, hint) {
    return `
        <div class="calc-input-group">
            <label for="${id}">${label}</label>
            <select id="${id}">${options}</select>
            ${hint ? `<div class="calc-hint">${hint}</div>` : ''}
        </div>`;
}

function renderCalcNumber(id, label, value, opts = {}) {
    const placeholder = opts.placeholder ? ` placeholder="${escapeHtml(opts.placeholder)}"` : '';
    const suffix = opts.suffix ? `<span class="calc-suffix">${opts.suffix}</span>` : '';
    return `
        <div class="calc-input-group">
            <label for="${id}">${label}</label>
            <div class="calc-input-wrap">
                <input type="number" id="${id}" min="0" step="${opts.step || 100}" value="${escapeHtml(String(value ?? ''))}"${placeholder}>
                ${suffix}
            </div>
        </div>`;
}

function getCalcNumber(container, id) {
    const el = container.querySelector(`#${id}`);
    if (!el) return 0;
    const value = parseFloat(el.value);
    return Number.isFinite(value) ? value : 0;
}

function gatherCalcInputs(container) {
    const cityEl = container.querySelector('#calc-city');
    const fundEl = container.querySelector('#calc-fund-rate');
    const monthsEl = container.querySelector('#calc-months');
    return {
        city_code: cityEl ? cityEl.value : 'shanghai',
        monthly_salary: getCalcNumber(container, 'calc-salary'),
        months_per_year: monthsEl ? parseInt(monthsEl.value, 10) || 12 : 12,
        housing_fund_rate: fundEl ? (parseInt(fundEl.value, 10) || 0) / 100 : null,
        social_insurance_base: getCalcNumber(container, 'calc-si-base') || null,
        special_additional_deduction: getCalcNumber(container, 'calc-special'),
        year_end_bonus: getCalcNumber(container, 'calc-bonus'),
        equity_annual: getCalcNumber(container, 'calc-equity'),
        sign_on_bonus: getCalcNumber(container, 'calc-signon'),
        subsidy_annual: getCalcNumber(container, 'calc-subsidy'),
    };
}

const CALC_INPUT_IDS = [
    'calc-city', 'calc-salary', 'calc-months', 'calc-fund-rate', 'calc-si-base',
    'calc-special', 'calc-bonus', 'calc-equity', 'calc-signon', 'calc-subsidy',
];

function persistCalcInputs(container) {
    const saved = {};
    CALC_INPUT_IDS.forEach((id) => {
        const el = container.querySelector(`#${id}`);
        if (el) saved[id] = el.value;
    });
    saveCalcSettings(saved);
}

async function renderSalaryCalculator(container) {
    const saved = loadCalcSettings();
    let cities = [];
    try {
        cities = await fetchSalaryCities();
    } catch { /* handled below */ }

    if (!cities.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-title">${t('calculator.title')}</div><div class="empty-state-desc">${t('errors.loadFailed')}</div></div>`;
        return;
    }

    const cityCode = saved['calc-city'] || cities[0].city_code;
    const city = cities.find((item) => item.city_code === cityCode) || cities[0];
    const fundRate = parseInt(saved['calc-fund-rate'] || Math.round((city.housing_fund_rate_default ?? 0.07) * 100), 10);
    const months = String(saved['calc-months'] || 12);
    const stale = cities.some((item) => item.stale);

    container.innerHTML = `
        <div class="page-header page-header-stacked">
            <h1 class="page-title">${t('calculator.title')}</h1>
            <p class="page-description">${t('calculator.description')}</p>
        </div>

        ${stale ? `
        <div class="calc-stale-banner" role="status">
            <span>${t('calculator.staleWarning')}</span>
        </div>` : ''}

        <div class="calc-chart-card" style="margin-bottom:24px">
            <div class="calc-input-grid">
                ${renderCalcSelect('calc-city', t('calculator.inputs.city'), buildCityOptions(cities, city.city_code))}
                ${renderCalcNumber('calc-salary', t('calculator.inputs.monthlySalary'), saved['calc-salary'] || '', { step: 1000, placeholder: '30000' })}
                ${renderCalcSelect('calc-months', t('calculator.inputs.monthsPerYear'),
                    [12, 13, 14, 15, 16].map((n) => `<option value="${n}"${String(n) === months ? ' selected' : ''}>${t('calculator.inputs.monthsValue', { n })}</option>`).join(''))}
                ${renderCalcSelect('calc-fund-rate', t('calculator.inputs.housingFundRate'), buildFundRateOptions(city, fundRate))}
            </div>
            <div class="calc-input-grid calc-input-grid-secondary">
                ${renderCalcNumber('calc-si-base', t('calculator.inputs.socialInsuranceBase'), saved['calc-si-base'] || '', { placeholder: t('calculator.inputs.socialInsuranceBasePlaceholder'), step: 100 })}
                ${renderCalcNumber('calc-special', t('calculator.inputs.specialDeduction'), saved['calc-special'] || '', { step: 100 })}
                ${renderCalcNumber('calc-bonus', t('calculator.inputs.yearEndBonus'), saved['calc-bonus'] || '', { step: 1000 })}
                ${renderCalcNumber('calc-equity', t('calculator.inputs.equityAnnual'), saved['calc-equity'] || '', { step: 1000 })}
                ${renderCalcNumber('calc-signon', t('calculator.inputs.signOnBonus'), saved['calc-signon'] || '', { step: 1000 })}
                ${renderCalcNumber('calc-subsidy', t('calculator.inputs.subsidyAnnual'), saved['calc-subsidy'] || '', { step: 1000 })}
            </div>
            <div class="calc-base-hint" id="calc-base-hint"></div>
        </div>

        <div class="calc-stat-grid" id="calc-stats"></div>

        <div class="calc-chart-row" style="margin-bottom:24px">
            <div class="calc-chart-card">
                <h3>${t('calculator.chart.composition')}</h3>
                <div style="height:280px"><canvas id="calc-donut"></canvas></div>
            </div>
            <div class="calc-chart-card">
                <h3>${t('calculator.chart.monthlyNet')}</h3>
                <div style="height:280px"><canvas id="calc-bar"></canvas></div>
            </div>
        </div>

        <div class="calc-chart-card" style="margin-bottom:24px">
            <h3 style="font-size:0.9375rem;font-weight:600;margin-bottom:16px">${t('calculator.breakdown.title')}</h3>
            <div class="calc-breakdown-table-wrap">
                <table class="calc-breakdown-table"><tbody id="calc-insurance-body"></tbody></table>
            </div>
        </div>

        <div class="calc-chart-card" style="margin-bottom:24px">
            <h3 style="font-size:0.9375rem;font-weight:600;margin-bottom:8px">${t('calculator.schedule.title')}</h3>
            <div class="calc-breakdown-table-wrap">
                <table class="calc-breakdown-table"><thead id="calc-schedule-head"></thead><tbody id="calc-schedule-body"></tbody></table>
            </div>
            <button class="btn btn-secondary btn-sm" id="calc-export-csv" style="margin-top:12px">${t('calculator.actions.exportCsv')}</button>
        </div>

        <div class="calc-chart-card" id="calc-bonus-card" style="margin-bottom:24px;display:none"></div>

        <p class="calc-disclaimer" id="calc-disclaimer"></p>
    `;

    const debounce = { id: null };
    const recalc = () => {
        clearTimeout(debounce.id);
        debounce.id = setTimeout(() => { updateCalculator(container); }, 200);
    };

    container.querySelectorAll('input, select').forEach((el) => {
        el.addEventListener('input', recalc);
        el.addEventListener('change', recalc);
    });

    // 换城市时按新城市的默认公积金比例刷新下拉框。
    const citySelect = container.querySelector('#calc-city');
    if (citySelect) {
        citySelect.addEventListener('change', () => {
            const next = cities.find((item) => item.city_code === citySelect.value);
            const rateSelect = container.querySelector('#calc-fund-rate');
            if (next && rateSelect) {
                rateSelect.innerHTML = buildFundRateOptions(next, Math.round((next.housing_fund_rate_default ?? 0.07) * 100));
            }
            recalc();
        });
    }

    container.querySelector('#calc-export-csv').addEventListener('click', () => {
        if (lastCalcResult) exportCalcCsv(lastCalcResult);
    });

    updateCalculator(container);
}

// 最近一次测算结果，供导出 CSV 使用。
let lastCalcResult = null;

function renderCalcStats(summary, input) {
    return `
        <div class="calc-stat-card"><div class="stat-number">${calcMoney(summary.first_month_net)}</div><div class="stat-label">${t('calculator.summary.firstMonthNet')}</div></div>
        <div class="calc-stat-card"><div class="stat-number">${calcMoney(summary.steady_month_net)}</div><div class="stat-label">${t('calculator.summary.steadyMonthNet')}</div></div>
        <div class="calc-stat-card"><div class="stat-number">${calcMoney(summary.annual_net_income)}</div><div class="stat-label">${t('calculator.summary.annualNetIncome')}</div></div>
        <div class="calc-stat-card"><div class="stat-number">${calcMoney(summary.total_package)}</div><div class="stat-label">${t('calculator.summary.totalPackage')}</div></div>
        <div class="calc-stat-card"><div class="stat-number">${calcMoney(summary.annual_tax)}</div><div class="stat-label">${t('calculator.summary.annualTax')}</div></div>
        <div class="calc-stat-card"><div class="stat-number">${calcMoney(summary.annual_social_insurance)}</div><div class="stat-label">${t('calculator.summary.annualSocialInsurance')}</div></div>
        <div class="calc-stat-card"><div class="stat-number">${calcPercent(summary.effective_tax_rate)}</div><div class="stat-label">${t('calculator.summary.effectiveTaxRate')}</div></div>
        <div class="calc-stat-card"><div class="stat-number">${calcMoney(summary.employer_cost)}</div><div class="stat-label">${t('calculator.summary.employerCost')}</div></div>
    `;
}

function renderInsuranceTable(insurance) {
    const rows = [
        ['pension', insurance.employee.pension, insurance.employer.pension],
        ['medical', insurance.employee.medical, insurance.employer.medical],
        ['unemployment', insurance.employee.unemployment, insurance.employer.unemployment],
        ['injury', insurance.employee.injury, insurance.employer.injury],
        ['maternity', insurance.employee.maternity, insurance.employer.maternity],
        ['housingFund', insurance.employee.housing_fund, insurance.employer.housing_fund],
    ];
    return `
        <tr><th style="text-align:left">${t('calculator.breakdown.item')}</th><th style="text-align:right">${t('calculator.breakdown.employee')}</th><th style="text-align:right">${t('calculator.breakdown.employer')}</th></tr>
        ${rows.map(([key, employee, employer]) => `
            <tr>
                <td>${t(`calculator.breakdown.${key}`)}</td>
                <td style="text-align:right">${calcMoney(employee)}</td>
                <td style="text-align:right">${calcMoney(employer)}</td>
            </tr>`).join('')}
        <tr style="font-weight:600">
            <td>${t('calculator.breakdown.total')}</td>
            <td style="text-align:right">${calcMoney(insurance.employee.total)}</td>
            <td style="text-align:right">${calcMoney(insurance.employer.total)}</td>
        </tr>`;
}

function renderScheduleTable(result) {
    const head = `
        <tr>
            <th style="text-align:left">${t('calculator.schedule.month')}</th>
            <th style="text-align:right">${t('calculator.schedule.gross')}</th>
            <th style="text-align:right">${t('calculator.schedule.socialInsurance')}</th>
            <th style="text-align:right">${t('calculator.schedule.taxable')}</th>
            <th style="text-align:right">${t('calculator.schedule.taxRate')}</th>
            <th style="text-align:right">${t('calculator.schedule.tax')}</th>
            <th style="text-align:right">${t('calculator.schedule.net')}</th>
        </tr>`;
    const body = result.schedule.map((row) => `
        <tr>
            <td>${row.month}</td>
            <td style="text-align:right">${calcMoney(row.gross)}</td>
            <td style="text-align:right">${calcMoney(row.social_insurance)}</td>
            <td style="text-align:right">${calcMoney(row.taxable)}</td>
            <td style="text-align:right">${calcPercent(row.tax_rate)}</td>
            <td style="text-align:right">${calcMoney(row.tax)}</td>
            <td style="text-align:right;font-weight:600">${calcMoney(row.net)}</td>
        </tr>`).join('');
    return { head, body };
}

function renderBonusCard(bonus) {
    if (!bonus || !bonus.bonus) return '';
    const method = bonus.best === 'separate'
        ? t('calculator.bonus.methodSeparate')
        : t('calculator.bonus.methodCombined');
    return `
        <h3 style="font-size:0.9375rem;font-weight:600;margin-bottom:12px">${t('calculator.bonus.title')}</h3>
        <table class="calc-breakdown-table">
            <thead>
                <tr>
                    <th style="text-align:left">${t('calculator.bonus.amount')}</th>
                    <th style="text-align:right">${t('calculator.bonus.separate')}</th>
                    <th style="text-align:right">${t('calculator.bonus.combined')}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>${t('calculator.bonus.tax')}</td>
                    <td style="text-align:right">${calcMoney(bonus.separate.tax)}</td>
                    <td style="text-align:right">${calcMoney(bonus.combined.tax)}</td>
                </tr>
                <tr style="font-weight:600">
                    <td>${t('calculator.bonus.net')}</td>
                    <td style="text-align:right">${calcMoney(bonus.separate.net)}</td>
                    <td style="text-align:right">${calcMoney(bonus.combined.net)}</td>
                </tr>
            </tbody>
        </table>
        <div class="calc-best-option">${t('calculator.bonus.best', { method, amount: i18n.formatNumber(Math.round(bonus.saving)) })}</div>`;
}

function renderDonutChart(canvas, result) {
    if (calcDonutChart) { calcDonutChart.destroy(); calcDonutChart = null; }
    const steady = result.schedule[result.schedule.length - 2] || result.schedule[result.schedule.length - 1];
    const segments = [
        { label: t('calculator.chart.compositionNet'), value: steady.net, color: '#16a34a' },
        { label: t('calculator.chart.compositionTax'), value: steady.tax, color: '#f59e0b' },
        { label: t('calculator.chart.compositionInsurance'), value: steady.social_insurance, color: '#6366f1' },
    ].filter((segment) => segment.value > 0);

    calcDonutChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: segments.map((segment) => segment.label),
            datasets: [{
                data: segments.map((segment) => segment.value),
                backgroundColor: segments.map((segment) => segment.color),
                borderWidth: 2,
                borderColor: 'transparent',
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (ctx) => t('calculator.chart.tooltip', {
                            label: ctx.label,
                            amount: calcMoney(ctx.raw),
                            pct: ((ctx.raw / steady.gross) * 100).toFixed(1),
                        }),
                    },
                },
            },
        },
    });
}

function renderBarChart(canvas, result) {
    if (calcBarChart) { calcBarChart.destroy(); calcBarChart = null; }
    calcBarChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: result.schedule.map((row) => String(row.month)),
            datasets: [{
                label: t('calculator.chart.monthlyNetAxis'),
                data: result.schedule.map((row) => row.net),
                backgroundColor: '#16a34a',
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { display: false } },
                y: { ticks: { callback: (value) => calcMoney(value) } },
            },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => calcMoney(ctx.raw) } },
            },
        },
    });
}

async function updateCalculator(container) {
    const inputs = gatherCalcInputs(container);
    persistCalcInputs(container);

    const statsEl = container.querySelector('#calc-stats');
    const baseHintEl = container.querySelector('#calc-base-hint');
    const disclaimerEl = container.querySelector('#calc-disclaimer');

    if (!inputs.monthly_salary || inputs.monthly_salary <= 0) {
        statsEl.innerHTML = `<div class="calc-empty">${t('calculator.empty')}</div>`;
        container.querySelector('#calc-insurance-body').innerHTML = '';
        container.querySelector('#calc-schedule-head').innerHTML = '';
        container.querySelector('#calc-schedule-body').innerHTML = '';
        container.querySelector('#calc-bonus-card').style.display = 'none';
        if (baseHintEl) baseHintEl.textContent = '';
        if (disclaimerEl) disclaimerEl.textContent = '';
        if (calcDonutChart) { calcDonutChart.destroy(); calcDonutChart = null; }
        if (calcBarChart) { calcBarChart.destroy(); calcBarChart = null; }
        lastCalcResult = null;
        return;
    }

    let result;
    try {
        result = await api.request('POST', '/api/salary/calculate', inputs);
    } catch (err) {
        statsEl.innerHTML = `<div class="calc-empty">${escapeHtml(apiErrorMessage(err))}</div>`;
        return;
    }
    lastCalcResult = result;

    statsEl.innerHTML = renderCalcStats(result.summary, result.input);
    if (baseHintEl) {
        const city = calcCities.find((item) => item.city_code === result.city.city_code);
        baseHintEl.textContent = result.insurance.base_clamped
            ? t('calculator.inputs.baseClamped', { base: calcMoney(result.insurance.social_insurance_base) })
            : (city ? t('calculator.inputs.baseHint', {
                min: calcMoney(city.social_insurance_base_min),
                max: calcMoney(city.social_insurance_base_max),
            }) : '');
    }
    container.querySelector('#calc-insurance-body').innerHTML = renderInsuranceTable(result.insurance);
    const schedule = renderScheduleTable(result);
    container.querySelector('#calc-schedule-head').innerHTML = schedule.head;
    container.querySelector('#calc-schedule-body').innerHTML = schedule.body;

    const bonusCard = container.querySelector('#calc-bonus-card');
    const bonusHtml = renderBonusCard(result.year_end_bonus);
    bonusCard.style.display = bonusHtml ? '' : 'none';
    bonusCard.innerHTML = bonusHtml;

    if (disclaimerEl) {
        disclaimerEl.textContent = t('calculator.disclaimer', {
            year: result.city.effective_year || '',
        }) + (result.city.source_note ? ' ' + result.city.source_note : '');
    }

    const donutCanvas = container.querySelector('#calc-donut');
    if (donutCanvas) renderDonutChart(donutCanvas, result);
    const barCanvas = container.querySelector('#calc-bar');
    if (barCanvas) renderBarChart(barCanvas, result);
}

function exportCalcCsv(result) {
    const header = [
        t('calculator.schedule.month'), t('calculator.schedule.gross'),
        t('calculator.schedule.socialInsurance'), t('calculator.schedule.taxable'),
        t('calculator.schedule.taxRate'), t('calculator.schedule.tax'), t('calculator.schedule.net'),
    ];
    const lines = [header.join(',')];
    result.schedule.forEach((row) => {
        lines.push([
            row.month, row.gross, row.social_insurance, row.taxable,
            row.tax_rate, row.tax, row.net,
        ].join(','));
    });
    lines.push('');
    lines.push([t('calculator.summary.annualSalary'), result.summary.annual_salary].join(','));
    lines.push([t('calculator.summary.annualTax'), result.summary.annual_tax].join(','));
    lines.push([t('calculator.summary.annualNetIncome'), result.summary.annual_net_income].join(','));
    lines.push([t('calculator.summary.totalPackage'), result.summary.total_package].join(','));

    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'careerpulse-take-home.csv';
    anchor.click();
    URL.revokeObjectURL(url);
}
