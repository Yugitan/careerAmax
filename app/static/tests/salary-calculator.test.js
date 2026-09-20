import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScripts } from './setup.js';

// Interface copy is exercised in English by default (see tests/setup.js).
const CITY = {
    city_code: 'shanghai',
    city_name: '上海',
    effective_year: 2025,
    updated_at: '2025-07-01',
    source_note: 'Reference data for demos.',
    stale: false,
    social_insurance_base_min: 7384,
    social_insurance_base_max: 36921,
    housing_fund_base_min: 2690,
    housing_fund_base_max: 36921,
    housing_fund_rate_min: 0.05,
    housing_fund_rate_max: 0.07,
    housing_fund_rate_default: 0.07,
};

function buildSchedule() {
    return Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        gross: 30000,
        social_insurance: 5250,
        taxable: 19750 * (index + 1),
        tax_rate: index < 7 ? 0.1 : 0.2,
        tax: 1975,
        net: 22775,
    }));
}

function buildResult(overrides = {}) {
    return {
        city: { ...CITY },
        input: {
            monthly_salary: 30000, months_per_year: 13, housing_fund_rate: 0.07,
            special_additional_deduction: 0, year_end_bonus: 100000,
            equity_annual: 0, sign_on_bonus: 0, subsidy_annual: 0,
        },
        insurance: {
            social_insurance_base: 30000,
            housing_fund_base: 30000,
            housing_fund_rate: 0.07,
            base_clamped: false,
            employee: { pension: 2400, medical: 600, unemployment: 150, injury: 0, maternity: 0, housing_fund: 2100, total: 5250 },
            employer: { pension: 4800, medical: 2850, unemployment: 150, injury: 48, maternity: 300, housing_fund: 2100, total: 10248 },
        },
        schedule: buildSchedule(),
        summary: {
            monthly_gross: 30000,
            first_month_net: 24222.5,
            steady_month_net: 22775,
            annual_salary: 390000,
            annual_social_insurance: 63000,
            annual_tax: 30480,
            annual_net_salary: 296520,
            annual_net_income: 386730,
            total_package: 490000,
            employer_cost: 512976,
            effective_tax_rate: 0.0782,
        },
        year_end_bonus: {
            bonus: 100000,
            separate: { tax: 9790, net: 90210, rate: 0.1 },
            combined: { tax: 21850, net: 78150 },
            best: 'separate',
            saving: 12060,
        },
        ...overrides,
    };
}

function mockFetch(cities, result) {
    globalThis.fetch = vi.fn((url) => {
        const payload = String(url).includes('/api/salary/cities')
            ? { cities }
            : result;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
    });
}

let renderSalaryCalculator;
let updateCalculator;

beforeAll(() => {
    document.body.innerHTML = `
        <div id="toast-container"></div>
        <div id="app"></div>
    `;
    globalThis.showToast = vi.fn();
    // Chart.js is loaded from a CDN in the browser; the tests only need the API.
    globalThis.Chart = class { constructor() {} destroy() {} };
    loadScripts('utils.js', 'api.js', 'salary-calculator.js');
    renderSalaryCalculator = globalThis.renderSalaryCalculator;
    updateCalculator = globalThis.updateCalculator;
});

beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem('careerpulse_calc_settings');
    document.getElementById('app').innerHTML = '';
    mockFetch([CITY], buildResult());
});

async function render() {
    const app = document.getElementById('app');
    await renderSalaryCalculator(app);
    return app;
}

describe('take-home pay calculator', () => {
    it('renders the city selector and the monthly salary input', async () => {
        const app = await render();
        const citySelect = app.querySelector('#calc-city');
        expect(citySelect).not.toBeNull();
        expect(citySelect.value).toBe('shanghai');
        expect(citySelect.textContent).toContain('上海');
        expect(app.querySelector('#calc-salary')).not.toBeNull();
        expect(app.querySelector('#calc-months').value).toBe('12');
        // Housing fund rates come from the city range (5%–7%).
        const rateOptions = [...app.querySelectorAll('#calc-fund-rate option')].map((o) => o.value);
        expect(rateOptions).toEqual(['5', '6', '7']);
    });

    it('shows the empty state until a salary is entered', async () => {
        const app = await render();
        expect(app.querySelector('#calc-stats').textContent).toContain('Enter a monthly salary');
        expect(app.querySelector('#calc-schedule-body').innerHTML).toBe('');
    });

    it('renders take-home stats, insurance detail and the monthly schedule', async () => {
        const app = await render();
        app.querySelector('#calc-salary').value = '30000';
        await updateCalculator(app);

        const stats = app.querySelector('#calc-stats').textContent;
        expect(stats).toContain('First Month Take-Home');
        expect(stats).toContain('Annual Package');
        expect(stats).toContain('Employer Cost');

        const insurance = app.querySelector('#calc-insurance-body').textContent;
        expect(insurance).toContain('Pension');
        expect(insurance).toContain('Housing Fund');
        expect(insurance).toContain('Employer');

        const rows = app.querySelectorAll('#calc-schedule-body tr');
        expect(rows.length).toBe(12);
        expect(rows[0].textContent).toContain('22,775');
    });

    it('shows the year-end bonus comparison and the cheaper option', async () => {
        const app = await render();
        app.querySelector('#calc-salary').value = '30000';
        await updateCalculator(app);

        const bonusCard = app.querySelector('#calc-bonus-card');
        expect(bonusCard.style.display).not.toBe('none');
        expect(bonusCard.textContent).toContain('Taxed separately');
        expect(bonusCard.textContent).toContain('Better option');
        expect(bonusCard.textContent).toContain('12,060');
    });

    it('hides the bonus card when no bonus is entered', async () => {
        mockFetch([CITY], buildResult({
            year_end_bonus: { bonus: 0, separate: { tax: 0, net: 0, rate: 0 }, combined: { tax: 0, net: 0 }, best: 'separate', saving: 0 },
        }));
        const app = await render();
        app.querySelector('#calc-salary').value = '30000';
        await updateCalculator(app);
        expect(app.querySelector('#calc-bonus-card').style.display).toBe('none');
    });

    it('flags stale social insurance data', async () => {
        mockFetch([{ ...CITY, stale: true }], buildResult());
        const app = await render();
        const banner = app.querySelector('.calc-stale-banner');
        expect(banner).not.toBeNull();
        expect(banner.textContent).toContain('may be out of date');
    });

    it('explains when the salary falls below the city floor', async () => {
        const result = buildResult();
        result.insurance.base_clamped = true;
        result.insurance.social_insurance_base = 7384;
        mockFetch([CITY], result);
        const app = await render();
        app.querySelector('#calc-salary').value = '3000';
        await updateCalculator(app);
        expect(app.querySelector('#calc-base-hint').textContent).toContain('below the city floor');
    });

    it('persists the inputs so the calculator reopens with the same values', async () => {
        const app = await render();
        app.querySelector('#calc-salary').value = '35000';
        app.querySelector('#calc-months').value = '14';
        await updateCalculator(app);

        const saved = JSON.parse(localStorage.getItem('careerpulse_calc_settings'));
        expect(saved['calc-salary']).toBe('35000');
        expect(saved['calc-months']).toBe('14');
    });

    it('always shows the CNY disclaimer with the data year', async () => {
        const app = await render();
        app.querySelector('#calc-salary').value = '30000';
        await updateCalculator(app);
        expect(app.querySelector('#calc-disclaimer').textContent).toContain('2025');
        expect(app.querySelector('#calc-disclaimer').textContent).toContain('Estimate only');
    });
});
