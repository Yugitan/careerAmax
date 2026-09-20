import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadScripts } from './setup.js';

// 岗位属性（经验/学历/公司规模/融资阶段/福利标签）由扩展采集后落库，
// 详情页只负责展示：字段名走 i18n，值保留招聘平台原文。

beforeAll(() => {
    document.body.innerHTML = `
        <div id="toast-container"></div>
        <div id="app"></div>
    `;
    loadScripts('utils.js', 'api.js', 'views/detail.js');

    // 内容渲染只用到 utils 的格式化函数；其余交互函数在点击回调里才被调用
    globalThis.navigate = () => {};
    globalThis.showToast = () => {};
    globalThis.requireAI = async () => true;
    globalThis.apiErrorMessage = (err) => String(err?.message || err);
    globalThis.copyToClipboard = () => {};
});

beforeEach(() => {
    document.getElementById('app').innerHTML = '';
});

// raw business content —— 标题/公司/薪资/岗位属性都来自招聘平台原文
const BASE_JOB = {
    id: 7,
    title: '资深后端开发工程师',
    company: '某某科技有限公司',
    location: '深圳·南山区',
    url: 'https://www.zhipin.com/job_detail/8f3c.html',
    description: '岗位职责：负责核心交易链路',
    created_at: '2026-09-01T00:00:00Z',
    sources: [{ source_name: 'BOSS直聘', source_url: 'https://www.zhipin.com/job_detail/8f3c.html' }],
    score: null,
    application: null,
};

describe('job detail facts', () => {
    it('renders experience, education, company size and funding stage', () => {
        const container = document.getElementById('app');
        renderJobDetailContent(container, {
            ...BASE_JOB,
            experience_req: '5-10年',
            education_req: '本科',
            company_size: '1000-9999',
            company_stage: '已上市',
        }, null, null, []);

        const facts = container.querySelector('.detail-facts');
        expect(facts).not.toBeNull();
        expect(facts.textContent).toContain('Experience');
        expect(facts.textContent).toContain('5-10年');
        expect(facts.textContent).toContain('本科');
        expect(facts.textContent).toContain('1000-9999');
        expect(facts.textContent).toContain('已上市');
    });

    it('renders welfare labels from the stored JSON column', () => {
        const container = document.getElementById('app');
        renderJobDetailContent(container, {
            ...BASE_JOB,
            job_labels: '["五险一金","弹性工作"]',
        }, null, null, []);

        const labels = container.querySelector('.detail-facts-labels');
        expect(labels).not.toBeNull();
        expect(labels.querySelectorAll('.job-label')).toHaveLength(2);
        expect(labels.textContent).toContain('五险一金');
        expect(labels.textContent).toContain('弹性工作');
    });

    it('renders labels that arrive as a real array', () => {
        const container = document.getElementById('app');
        renderJobDetailContent(container, {
            ...BASE_JOB,
            job_labels: ['补充医疗保险'],
        }, null, null, []);

        expect(container.querySelectorAll('.detail-facts-labels .job-label')).toHaveLength(1);
    });

    it('omits the facts row for jobs captured without platform attributes', () => {
        const container = document.getElementById('app');
        renderJobDetailContent(container, { ...BASE_JOB }, null, null, []);

        expect(container.querySelector('.detail-facts')).toBeNull();
    });

    it('escapes captured labels instead of injecting markup', () => {
        const container = document.getElementById('app');
        renderJobDetailContent(container, {
            ...BASE_JOB,
            job_labels: '["<img src=x onerror=alert(1)>"]',
        }, null, null, []);

        const labels = container.querySelector('.detail-facts-labels');
        expect(labels.querySelector('img')).toBeNull();
        expect(labels.textContent).toContain('<img src=x onerror=alert(1)>');
    });
});
