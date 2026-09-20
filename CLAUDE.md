# CareerPulse (JobFinder)

说中文、面向中国求职市场的自托管求职作战台：浏览器扩展在用户浏览招聘平台时把职位回传，AI 按简历打分匹配，生成中文简历/求职信，通过 CRM 管道管理每一份申请并自动跟进。

> 中国化改造的决策依据见 `docs/plans/2026-09-10-careerpulse-china-market-prd.md`（D1–D8）与
> `docs/plans/2026-09-10-china-subtraction-plan.md`。原美国市场版本的集中爬虫、税表、EEO 等
> 模块已全部移除。

## Running the App
```bash
# Development (uv auto-manages venv and deps)
uv run uvicorn app.main:create_app --factory --reload --host 0.0.0.0 --port 8085

# Docker
docker compose up -d
```

## Tech Stack
- Python (FastAPI), aiosqlite
- AI: Anthropic, Bedrock, OpenAI, Google, OpenRouter, Ollama (configurable via settings UI)
- APScheduler for maintenance tasks (scoring, cleanup, reminders, digest)
- Vanilla JS frontend (served from `app/static/`)

## Key Architecture
- `app/main.py` — FastAPI app assembler: `create_app` factory + lifespan; initializes dual DB connections: `app.state.db` for request handlers, `app.state.bg_db` for background tasks (prevents connection contention); lifespan resets `app.state.scrape_progress = None` and `app.state.scrape_task = None` on startup (stale-state guard); scheduled jobs are China-rewrite aware: `scrape_cycle` / `enrichment_cycle` / `location_classification` removed (D1 — job data comes from the extension), `embedding_cycle` deregistered (function kept for phase 2)
- `app/routers/` — API routes split into 14 modules: `jobs.py`, `tailoring.py`, `pipeline.py`, `queue.py`, `contacts.py`, `analytics.py`, `settings.py`, `alerts.py`, `scraping.py`, `autofill.py`, `interviews.py`, `calendar.py`, `salary.py`, `capture.py`
  - `capture.py`: 一键抓取桥 —— 网页的「立即抓取」不再空跑服务端流水线（那是 `scrape.no_server_scrapers`），而是 `POST /api/capture/request` 建一次采集请求；扩展的内容脚本每 3s `POST /api/capture/claim` 认领（`pending: true`，同时刷新 `extension_last_seen` 作为存活心跳），执行完 `POST /api/capture/complete` 回传 `{total, saved, skipped, failed, reason, page_url}`；采集途中 `POST /api/capture/progress` 报进度快照；网页轮询 `GET /api/capture/request`，`POST /api/capture/cancel` 取消。状态在 `app.state.capture_request`（内存态，与 `scrape_progress` 同款）；取消后到达的迟到回执会被丢弃（`ignored: true`）。**判定超时看进度而不是墙钟**：`waiting` 超 15s 没人认领 → 按 `listing_seen` 区分「扩展没响应」/「扩展在但打开的页面不是职位列表页」（`claim` 的 `has_listing: false` 不会领走请求，只当心跳）；`capturing` 只在 `progress_at` 超过 45s 没前进时才判卡住 —— 一次采集要回传几十张卡片，慢不等于坏
  - `jobs.py`: job ingestion is **extension-driven** — `POST /api/jobs/save-external` (JD captured by the extension), `POST /api/jobs/lookup`, `POST /api/jobs/mark-applied-by-url`; the payload also carries the platform's own attribute wording (`experience_req` / `education_req` / `company_size` / `company_stage` / `job_labels`), accepted on both the insert and the enrich path and never overwritten by empty values; `GET /api/companies/:name` only reads the local cache (no online company research). BOSS 直聘 is captured in two phases (listing card → detail-page JD), so the wire contract matters: the extension sends the display name `source: "BOSS直聘"` (the backend also accepts `boss`/`zhipin` aliases via `BOSS_SOURCE_ALIASES`, and re-saves of a known URL *enrich* that row instead of inserting), and URLs are stored in `stable_job_url()` form (no query/`lid`/`securityId`, no trailing slash) so both phases — and `/api/jobs/lookup` — resolve to the same row
  - `scraping.py`: server-side Scrape/Score orchestration (phase pipeline `scraping → enriching → classifying → scoring → done/error`, concurrency guard 409 `scrape_already_running`, cancel endpoint, heartbeat progress in `app.state.scrape_progress`). `POST /api/scrape` returns 409 `scrape.no_server_scrapers`（D1）—— 界面上的「立即抓取」已经改走 `capture.py` 的扩展采集路径，这套流水线保留给定时任务与异步打分链路
  - `interviews.py`: interview rounds CRUD per application; `POST /api/interviews/:id/save-contact` promotes an interviewer into the contacts CRM
  - `tailoring.py`: 简历/求职信生成 + M9 面试题库（`POST|GET /api/jobs/:id/interview-prep` 四类中文题目、`PUT .../questions/:index` 存草稿与熟练状态、`POST .../questions/:index/expand` AI 补要点、`POST .../copy` 从同类岗位复制、`GET /api/interview-prep/sources`）
  - `calendar.py`: calendar events API aggregates interviews + application deadlines; `GET /api/calendar.ics` serves a token-protected iCal feed for external calendar subscriptions
  - `settings.py`: resume upload accepts `.pdf`(需文本层)/`.docx`/`.txt`/`.md` — DOCX 走 `python-docx`（含表格单元格），`.doc`/`.rtf` 明确拒绝，扫描件 PDF 返回 `resume.no_text_layer`；AI 设置读写与连通性测试（返回可翻译的失败原因码）
- `app/database.py` — async SQLite via aiosqlite (37+ tables, FK enforcement, WAL mode); `APPLICATION_STATUSES` is an English enum whitelist (`interested/prepared/applied/interviewing/offered/rejected/withdrawn`), validated by `_validate_status()`; UI labels resolve via `pipeline.stage.*` i18n keys; `jobs.last_seen_at` drives freshness filtering and 30-day auto-dismiss
- `app/matcher.py` — AI-powered job/resume matching (supports resume override)
- `app/tailoring.py` — generates tailored resumes/cover letters + interview prep (supports resume override)
- `app/ai_client.py` — multi-provider AI client: `ALL_PROVIDERS = deepseek | qwen | kimi | zhipu | ollama | anthropic | openai | google | openrouter | bedrock` (国内四家复用 OpenAI 兼容路径，`provider_defaults()` 提供设置页预填的 Base URL/默认模型/申请入口；`classify_ai_error()` 把连通性失败归类为 `invalid_key/quota_exceeded/model_not_found/unreachable` 供设置页显示中文原因)
- `app/pdf_generator.py` — resume/cover letter PDF output (PyMuPDF)
- `app/docx_generator.py` — resume/cover letter DOCX output (python-docx)
- `app/scheduler.py` — periodic jobs wired in `main.py` lifespan: scoring (1h), maintenance (24h), reminder check (12h), digest (daily 8am, skipped when SMTP unconfigured); alert check (1h)
- `app/digest.py` / `app/emailer.py` — email digest notifications (optional)
- `app/follow_up.py` — AI-drafted follow-up emails
- `app/predictor.py` — application success prediction
- `app/career_advisor.py` — career trajectory AI analysis
- `app/salary.py` — China take-home pay engine (CNY monthly salary, 五险一金, IIT 累计预扣, year-end bonus dual method); city parameters live in `app/data/social_insurance/*.json` with `effective_year`/`source_note` and an 18-month staleness flag
- `app/offer_calculator.py` — offer comparison on the China basis; reuses `app/salary.py` for take-home pay and reads legacy offer columns as 月薪/年终奖/股权折年/签字费 (`monthly_salary`/`months_per_year`/`city_code` win when present)
- `app/static/js/i18n.js` — i18n core: `t(key, params)`, language read/save/switch (localStorage `careerpulse_lang`, default `zh-CN`, no browser auto-detect), English fallback + dev warnings, language-aware date/number helpers; catalogs in `app/static/js/locales/*.js` (both languages in one file per domain)
- `app/errors.py` — `AppError(code, status_code, params)` + English fallback catalog; `app.main` registers a handler returning `{code, params, detail}` so user-visible backend errors are translated client-side
- `app/static/js/app.js` — SPA router, mobile hamburger nav, keyboard shortcuts, nav language switcher + `rerenderForLanguage()` and unsaved-form confirmation (`confirmDiscardUnsavedChanges` in `utils.js`)
- `app/static/js/footer.js` — site footer runtime: copyright year, brand watermark `viewBox` fitted from `getBBox()` (re-measured after `document.fonts.ready` and on a rAF-debounced resize), and the calendar CTA that reuses `showIcalModal()`; footer copy is the `footer.*` namespace in `locales/shell.js`
- `app/static/js/api.js` — centralized API client
- `app/static/js/utils.js` — HTML sanitization (`escapeHtml`, `sanitizeHtml`, `sanitizeUrl`), currency helpers: `formatCurrency`/`formatSalary` are **CNY monthly-salary** based (¥ prefix, 万/K display, never converts currency)
- `app/static/js/onboarding.js` — 4-step first-run wizard (profile → resume → AI provider → add job)
- `app/static/js/views/` — 9 view modules: `feed.js`, `detail.js`, `pipeline.js`, `queue.js`, `stats.js`, `settings.js`, `network.js`, `triage.js`, `calendar.js`
  - `queue.js`: 待联系清单 (call list) — no ATS approval workflow; view details + remove only
  - `calendar.js`: monthly grid + agenda toggle; renders interview rounds and application events; iCal subscription button
  - `settings.js`: tabs = profile / resumes / work-history / job-search / alerts / integrations / data (7)
- `app/static/js/interview-panel.js` — interview detail slide-out panel; round history, outcome logging, promote-to-contact
- `app/interview_prep.py` + `app/static/js/interview-prep.js` — M9 面试题库：AI 基于公开知识与简历生成中文题（不抓取面经），`questions[]` 结构为 `{category, difficulty, question, key_points[], user_draft, star_hint, status}`，枚举（category/status/difficulty）存英文、标签走 i18n；前端含作答草稿、模拟面试逐题与薄弱点报告
- `extension/` — Chrome extension (Manifest V3): job capture/回传 on `<all_urls>`, autofill, overlay (match-score badge, save button), queue orchestration; never auto-submits
  - 弹窗与常驻面板的「填写申请表」**共用一条判据**（`content.js` 的 `pageHasApplicationForm`，弹窗通过 `detectForm` 消息询问）：服务连得上 **且** 页面上真有申请表（或 ATS 内嵌信号，表单在 iframe 里）才点亮，否则置灰并写明 `overlay.panelNoForm`；问不到页面（内容脚本不在、扩展刚更新）时不拦着用户。面板的表单可用性随页面扫描实时重判（表单晚于面板出现也能点亮），内嵌 ATS 的页面点击时走 `broadcastStartFill` 而不是顶层 `startFillFlow()`（后者会静默退出）
  - 一键抓取执行体在 `content.js`：`collectVisibleJobCards()` 只取**当前已渲染**的卡片（按 URL 去重，单次上限 100 条），`captureVisibleJobs()` 逐条走与单卡按钮完全相同的 `submitJobCard()` 回传链路（因此按钮状态、匹配分与统计口径一致），招聘站点上常驻一块**可拖动的悬浮面板**（见下条）；同时每 3s 向后台要一次认领（`claimCaptureRequest`，带 `hasListing`），认领到就在本页执行、途中 `reportCaptureProgress` 报进度、最后 `completeCaptureRequest` 回传统计与 `reason`（`no_listing` = 本页没有列表）—— 不翻页、不滚屏、不发任何平台请求。`saveJob` 回包新增 `created` 字段（`false` = 已在库里，计为 skipped）。
  - **常驻悬浮面板**（`initJobBoardOverlay()` → `showJobBoardPanel(config)`）：进了支持的招聘站点就自己浮出来（默认右下角、默认展开），用户不必再点扩展图标才看到面板。面板复用自动填表浮层 `#cp-autofill-overlay` 的元素与表头（品牌 + 语言 + 最小化 + 关闭），body 换成 `overlayMode === 'panel'` 的面板：连接状态行（background 的 `checkConnection`）、填写申请表（`detectApplicationForm() !== 'none'` 才可用，否则置灰并说明 `overlay.panelNoForm`）、一键抓取、打开设置（读 `chrome.storage.local.serverUrl`）。`paintPanel()` 是唯一渲染入口，状态集中在 `panelState`，幂等；`refreshOverlayLabels()` 在 panel 模式下整块重绘。位置与收起状态写 `chrome.storage.local.panelPosition` / `panelCollapsed`（拖动表头移动，`onDragMove` 用 `clampPanelPosition` 夹在视口内）；✕ 只关本次页面、不会因为切语言又冒出来，填表流程退出后由 `restoreJobBoardPanel()` 把面板放回来。
  - 面板上的抓取入口（三个入口共用执行体：面板那一行、`popup.js` 的「立即抓取」走 `startCapture` → `captureCurrentPage()`、以及网页「立即抓取」认领后的 `pollCaptureRequest`）：有卡片时显示 `overlay.bulkCapture` 计数，没有卡片（职位详情页/未加载出列表）时置灰并给出 `overlay.panelNoCardsHint`。
  - 这一行同时是**进度牌**：抓取途中 `beginCaptureProgress()` / `updateCaptureProgress()` 把它刷成「已回传 {done}/{total}」（`overlay.bulkProgress`，done = saved + skipped + failed），而不是停在「正在抓取…」直到结束才给结果；`endCaptureProgress()` 把最终进度留在面板上，几秒后（或下一次卡片扫描）再退回「抓取本页 N 个岗位」。文案由 `runVisibleCapture` 统一驱动，所以三个入口在页面上看到的进度一致（弹窗的详细结果仍走 toast/回包）。
  - **批量回传不用定时器做节流**（`BULK_CAPTURE_CONCURRENCY = 3` 并发）：Chrome 会把隐藏标签页的定时器降到 1 秒一次，而用户点网页上的「立即抓取」时 BOSS 标签页恰恰是隐藏的 —— 原来的 `delay(120)` 会变成 1 秒/张，45 张卡片要 41 秒，网页端等不到结果只能报超时。并发既不碰定时器又比串行快
  - `extension/i18n.js` + `extension/locales/` — extension i18n (own language setting in `chrome.storage.local.language`); `locales/common.js` is **generated** from the web catalogs via `node extension/scripts/sync-common-locale.mjs` (never hand-edit); `error-messages.js` maps backend error codes to localized text
  - `extension/tests/fixtures/boss-dom.js` + `boss-dom-fixture.test.js` — 转录的 BOSS 直聘卡片/详情页 DOM 固定样本（含 class 全改版的兜底样本）。站点改版时先更新样本、再看断言，样本文件头写了刷新方法
  - `extension/tests/fixtures/boss-api.js` + `boss-api-capture.test.js`、`boss-page-bridge.test.js` — C1 接口采集的响应样本与桥的回归测试
  - `extension/boss-page-bridge.js` — **C1 页面上下文采集桥**（`manifest.json` 里 `world: "MAIN"` + `document_start`，仅 `https://*.zhipin.com/*`）。只被动转发页面自己已发出的职位接口 JSON 响应（`/wapi/`、`/zpgeek/`、`/api/`），零额外请求、不伪造签名、不重放 HTTP 请求；与隔离世界用 `window.postMessage` 通信，页面早期响应先缓冲，等 content script 发 `__cpBossApiRequest` 时重投。隔离世界侧（`content.js` 的 `initBossApiSniffer`/`extractBossApiJob`）校验「载荷职位 id 必须等于当前页面 URL 的 id/securityId」，所以页面上的第三方脚本无法凭空写库。DOM 采不到时用接口数据兼底（`mergeBossDetailData`：DOM 优先，空字段由接口补齐）

## Environment Variables
All optional — can configure via UI instead (see `.env.example`):
- `JOBFINDER_ANTHROPIC_API_KEY` — default AI key (Anthropic); other providers via UI
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — AWS credentials for Bedrock provider (or `~/.aws/credentials`, instance profile, etc.)
- `JOBFINDER_DB_PATH` — default: `data/jobfinder.db`
- `JOBFINDER_RESUME_PATH` — default: `data/resume.txt`
- `JOBFINDER_HOST` — default: `0.0.0.0`
- `JOBFINDER_PORT` — default: `8085`

> `JOBFINDER_USAJOBS_API_KEY`, `JOBFINDER_MIN_SALARY`, `JOBFINDER_MIN_HOURLY_RATE`,
> `JOBFINDER_SCRAPE_INTERVAL_HOURS` are leftovers from the US version — they are no
> longer read anywhere (scheduled to be pruned from `app/config.py`).

## Testing
```bash
uv run pytest                             # 529 backend tests
cd app/static && npx vitest run           # 252 frontend tests
cd extension && npx vitest run            # 642 extension tests
node scripts/find-english-leaks.mjs       # catalog key drift + untranslated zh-CN values
```

The frontend and extension suites include the i18n unit tests, the web ⇄ extension
key parity check and the static hardcoded-copy audits.

Language checklist per interface change (see `docs/i18n.md`):
- web: nav language switcher → `localStorage['careerpulse_lang']`
- extension: popup control + overlay toggle → `chrome.storage.local['language']`
- both default to `zh-CN`, never auto-detect the browser locale, and store the
  setting separately from each other

CI runs all three suites in parallel on push/PR to main: `.github/workflows/ci.yml`

## Git Remote
- **GitHub**: `https://github.com/tcpsyn/CareerPulse.git` (origin)

## i18n Maintenance Rules

The interface ships in Simplified Chinese (default) and English. See
[`docs/i18n.md`](docs/i18n.md) for the full contract, glossary and test matrix.

When adding or changing any user-visible copy:

1. Never hardcode the string in a template or script — add or update a
   translation key and call `t(key, params)` (web) or `t(key, params)` from
   `extension/i18n.js` (extension).
2. Provide **both** `zh-CN` and `en` in the same catalog file
   (`app/static/js/locales/<domain>.js`, `extension/locales/extension.js`).
   Shared terminology lives in the web `locales/common.js`; regenerate the
   extension mirror with `node extension/scripts/sync-common-locale.mjs`
   (the extension copy is generated — edit the web catalog, then sync).
3. Add or update tests: an i18n unit test or the static audit
   (`app/static/tests/i18n-audit.test.js`, `extension/tests/i18n-audit.test.js`).
4. Mark dynamic content explicitly — interface copy vs. raw business content
   (job titles, company names, user input, AI output, email bodies). Raw
   business content is never translated; mark it with a `// raw business content`
   comment. Amounts stay CNY monthly (元/月薪) — never convert currency, never
   display USD annual figures.
5. Backend errors must raise `AppError("domain.code", status_code=..., params={...})`
   (never `HTTPException(status, "English text")`); the client resolves
   `errors.<camelCaseCode>`.
6. Code review must check for new hardcoded user-visible strings; the audit tests
   fail the build when copy is hardcoded in a migrated file.
