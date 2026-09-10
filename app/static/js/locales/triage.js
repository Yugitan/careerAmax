// === Interface copy: triage ===
//
// Keys registered here become `triage.*`. Both languages are required — a key
// present in only one language fails app/static/tests/i18n.test.js.
// Never add business content (job/company/AI text) to a catalog.

i18n.register('triage', {
    en: {
        ariaLabel: 'Job triage',
        noJobs: 'No jobs to triage',
        exit: 'Exit Triage',
        backToFeed: 'Back to Feed',
        doneTitle: 'Triage complete!',
        doneDesc: 'You reviewed {count} jobs.',
        matchReasons: 'Match Reasons',
        concerns: 'Concerns',
        keep: 'Keep & Prepare',
        viewDetails: 'View Details',
        shortcutKeep: 'Keep',
        loadFailed: 'Failed to load triage: {error}',
        progress: '{current} of {total}',
        keepPrepare: 'Keep & Prepare →',
        skip: 'Skip →',
        dismiss: 'Dismiss',
        shortcutsHint: 'Keep   Dismiss   Skip   View   Undo   Exit',
        shortcutExit: 'Exit',
    },
    'zh-CN': {
        ariaLabel: '职位快速筛选',
        noJobs: '没有需要筛选的职位',
        exit: '退出快速筛选',
        backToFeed: '返回职位列表',
        doneTitle: '快速筛选完成！',
        doneDesc: '你已筛选 {count} 个职位。',
        matchReasons: '匹配理由',
        concerns: '顾虑',
        keep: '保留并准备',
        viewDetails: '查看详情',
        shortcutKeep: '保留',
        loadFailed: '筛选加载失败：{error}',
        progress: '第 {current} / 共 {total} 个',
        keepPrepare: '保留并准备 →',
        skip: '跳过 →',
        dismiss: '忽略',
        shortcutsHint: '保留   忽略   跳过   查看   撤销   退出',
        shortcutExit: '退出',
    },
});
