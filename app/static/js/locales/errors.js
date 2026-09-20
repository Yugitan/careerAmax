// === Interface copy: backend error codes ===
//
// One key per stable backend error code in `app/errors.py`. The frontend
// derives the key from the code (`resume.not_found` -> `errors.resumeNotFound`,
// see `errorKeyFromCode` in app/static/js/api.js), so key names must follow
// that derivation exactly. `tests/test_i18n_error_codes.py` and
// app/static/tests/i18n.test.js fail when a code has no translation.
//
// Placeholders mirror the backend `params` (snake_case).

i18n.register('errors', {
    en: {
        // jobs
        jobTitleAndCompanyRequired: 'Job title and company are required',
        jobDetailRequired: 'Details are required',
        jobInvalidEventType: 'Invalid event type: {event_type}',
        jobUrlRequired: 'A URL is required',
        jobInvalidTransition: 'Cannot update this application: {error}',
        jobInvalidStatus: 'Invalid application status: {status}',

        // AI providers
        aiGenerationFailed: 'AI generation failed: {error}',
        aiAnalysisFailed: 'AI analysis failed: {error}',
        aiInvalidProvider: 'Provider must be one of: {providers}',
        aiProviderUnsupported: "Provider must be 'openai' or 'ollama'",
        aiEmbeddingsNotConfigured: 'Embeddings are not configured',
        aiModelsFailed: 'Could not fetch models: {error}',
        aiConnectionFailed: 'Connection test failed: {error}',

        // autofill (extension overlay)
        autofillAiUnavailable: 'No AI provider available for the remaining fields',
        autofillAnalysisTimeout: 'AI analysis timed out after {seconds}s',
        autofillParseFailed: 'Failed to parse the AI response',

        // resumes
        resumeNameRequired: 'Resume name is required',
        resumeNameEmpty: 'Resume name cannot be empty',
        resumeUnsupportedFileType: 'Unsupported file type: {ext}. Allowed: {allowed}',
        resumeLegacyFormat: 'Legacy format {ext} is not supported — save the file as .docx and upload again',
        resumeParseFailed: 'Could not read the {ext} file — it may be corrupted or password protected',
        resumeNoTextLayer: 'No text found in the file. If it is a scanned document, upload a version with selectable text',
        resumeFileTooLarge: 'File too large ({size} bytes). Maximum: {max_mb}MB',

        // tailored documents
        tailoringResumeMissing: 'No tailored resume has been prepared for this job',
        tailoringCoverLetterMissing: 'No cover letter has been prepared for this job',
        tailoringEmailDraftMissing: 'No email draft for this job',
        tailoringInterviewPrepMissing: 'No interview prep found',
        tailoringAnalysisFailed: 'Analysis failed: {error}',
        tailoringNoContactEmail: 'No contact email available for this job',
        tailoringInvalidResponseType: 'response_type must be one of: {types}',

        // pipeline
        pipelineRemindAtRequired: 'A reminder time is required',
        pipelineTemplateNameRequired: 'Template name is required',
        suggestionNotFound: 'Suggestion not found',
        offerNotFound: 'Offer not found',
        linkNotFound: 'Link not found',

        // queue
        queueJobIdRequired: 'A job is required',

        // contacts
        contactNameRequired: 'Contact name is required',
        contactIdRequired: 'A contact is required',

        // analytics
        analyticsDigestFailed: 'Digest not sent — check email settings and digest configuration',

        // saved views / settings
        viewNameRequired: 'View name is required',
        viewNameEmpty: 'View name cannot be empty',
        settingsSearchTermsInvalid: 'Search terms must be a list',
        settingsExcludeTermsInvalid: 'Exclude terms must be a list',
        settingsAllowedRegionsInvalid: 'Allowed regions must be a list',
        settingsRemoteOnlyInvalid: 'remote_only must be a boolean',
        settingsSourceConfigRequired: 'Source name and interval hours are required',

        // email
        emailSmtpNotConfigured: 'SMTP is not configured',
        emailFromRequired: 'A from address is required for the test',
        emailSendFailed: 'Failed to send email',
        emailTestFailed: 'Failed to send test email — check SMTP settings',

        // alerts
        alertNameRequired: 'Alert name is required',

        // interviews
        interviewRoundNotFound: 'Interview round not found',
        interviewInterviewerNameRequired: 'No interviewer name to promote',
        interviewQuestionNotFound: 'Question {index} not found in this question bank',
        interviewSourceRequired: 'Pick a source job to copy the question bank from',
        interviewSourceEmpty: 'The source job has no question bank to copy',

        // calendar
        calendarTokenRequired: 'Token required',
        calendarInvalidToken: 'Invalid token',

        // salary
        salaryInvalidInput: 'Check the salary calculator input',
        salaryOffersRequired: 'Add at least one offer before comparing',

        // scraping (China edition: no server-side scrapers)
        scrapeNoServerScrapers: 'Jobs are captured by the browser extension while you browse — there are no server-side scrapers. Open jobs on BOSS Zhipin with the extension installed to save them.',

        // generic validation
        validationNoFieldsToUpdate: 'No fields to update',
    },
    'zh-CN': {
        // jobs
        jobTitleAndCompanyRequired: '职位名称和公司为必填项',
        jobDetailRequired: '请填写详细内容',
        jobInvalidEventType: '无效的事件类型：{event_type}',
        jobUrlRequired: '请填写链接',
        jobInvalidTransition: '无法更新该申请：{error}',
        jobInvalidStatus: '申请状态无效：{status}',

        // AI providers
        aiGenerationFailed: 'AI 生成失败：{error}',
        aiAnalysisFailed: 'AI 分析失败：{error}',
        aiInvalidProvider: 'AI 服务商必须是以下之一：{providers}',
        aiProviderUnsupported: "服务商必须是 'openai' 或 'ollama'",
        aiEmbeddingsNotConfigured: '尚未配置向量嵌入（Embeddings）',
        aiModelsFailed: '无法获取模型列表：{error}',
        aiConnectionFailed: '连接测试失败：{error}',

        // autofill (extension overlay)
        autofillAiUnavailable: '剩余字段没有可用的 AI 服务',
        autofillAnalysisTimeout: 'AI 分析超时（{seconds} 秒）',
        autofillParseFailed: '无法解析 AI 返回内容',

        // resumes
        resumeNameRequired: '简历名称为必填项',
        resumeNameEmpty: '简历名称不能为空',
        resumeUnsupportedFileType: '不支持的文件类型：{ext}。允许的类型：{allowed}',
        resumeLegacyFormat: '{ext} 为旧式格式，暂不支持——请另存为 .docx 后重新上传',
        resumeParseFailed: '无法读取 {ext} 文件——文件可能已损坏或有密码保护',
        resumeNoTextLayer: '未能从文件中提取到文字。若是扫描件，请上传可复制文本的版本',
        resumeFileTooLarge: '文件过大（{size} 字节），上限为 {max_mb}MB',

        // tailored documents
        tailoringResumeMissing: '该职位还没有定制简历',
        tailoringCoverLetterMissing: '该职位还没有求职信',
        tailoringEmailDraftMissing: '该职位还没有邮件草稿',
        tailoringInterviewPrepMissing: '没有找到面试准备内容',
        tailoringAnalysisFailed: '分析失败：{error}',
        tailoringNoContactEmail: '该职位没有可用的联系邮箱',
        tailoringInvalidResponseType: 'response_type 必须是以下之一：{types}',

        // pipeline
        pipelineRemindAtRequired: '请填写提醒时间',
        pipelineTemplateNameRequired: '模板名称为必填项',
        suggestionNotFound: '建议不存在',
        offerNotFound: '录用通知不存在',
        linkNotFound: '关联记录不存在',

        // queue
        queueJobIdRequired: '请选择一个职位',

        // contacts
        contactNameRequired: '联系人姓名为必填项',
        contactIdRequired: '请选择一个联系人',

        // analytics
        analyticsDigestFailed: '摘要邮件未发送 — 请检查邮箱设置与摘要配置',

        // saved views / settings
        viewNameRequired: '视图名称为必填项',
        viewNameEmpty: '视图名称不能为空',
        settingsSearchTermsInvalid: '搜索关键词必须是列表',
        settingsExcludeTermsInvalid: '排除关键词必须是列表',
        settingsAllowedRegionsInvalid: '允许的地区必须是列表',
        settingsRemoteOnlyInvalid: 'remote_only 必须是布尔值',
        settingsSourceConfigRequired: '请填写来源名称和抓取间隔小时数',

        // email
        emailSmtpNotConfigured: '尚未配置 SMTP',
        emailFromRequired: '测试需要填写发件人地址',
        emailSendFailed: '邮件发送失败',
        emailTestFailed: '测试邮件发送失败 — 请检查 SMTP 设置',

        // alerts
        alertNameRequired: '提醒规则名称为必填项',

        // interviews
        interviewRoundNotFound: '面试轮次不存在',
        interviewInterviewerNameRequired: '没有可转为联系人的面试官姓名',
        interviewQuestionNotFound: '题库中没有第 {index} 题',
        interviewSourceRequired: '请选择要复制题库的来源职位',
        interviewSourceEmpty: '来源职位还没有题库可复制',

        // calendar
        calendarTokenRequired: '缺少令牌',
        calendarInvalidToken: '令牌无效',

        // salary
        salaryInvalidInput: '请检查薪资测算的输入',
        salaryOffersRequired: '请先添加至少一个录用通知再对比',

        // scraping (China edition: no server-side scrapers)
        scrapeNoServerScrapers: '职位由浏览器扩展在浏览时自动回传，服务端没有爬虫。请在安装扩展后打开 BOSS 直聘的职位页面保存职位。',

        // generic validation
        validationNoFieldsToUpdate: '没有需要更新的字段',
    },
});
