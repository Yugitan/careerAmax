# CareerPulse

[![CI](https://github.com/tcpsyn/CareerPulse/actions/workflows/ci.yml/badge.svg)](https://github.com/tcpsyn/CareerPulse/actions/workflows/ci.yml)

CareerPulse 是一个**说中文、面向中国求职市场**的自托管求职作战台：你在招聘平台上正常浏览，浏览器扩展把职位回传到本地服务，AI 按你的简历打分匹配，生成中文简历与求职信，并把每一份申请从「感兴趣」到「offer」全程管理起来。

**数据完全留在你自己的电脑上。** 不做 SaaS、不代投、不集中爬取平台数据。

- 中文使用文档：[`docs/USAGE.md`](docs/USAGE.md)
- 产品定位与决策记录：[`docs/plans/2026-09-10-careerpulse-china-market-prd.md`](docs/plans/2026-09-10-careerpulse-china-market-prd.md)

## 功能特性

### 数据获取（D1：扩展回传，不做服务端爬取）

- **浏览器扩展回传** — 在招聘平台页面上把职位（含 JD 全文）一键保存到 CareerPulse，服务端不集中爬取
- **平台页内注入** — 匹配分角标、保存按钮、申请队列横幅直接注入平台页面
- **自动标记已投递** — 扩展检测到表单提交后自动在 CareerPulse 里把该职位标记为已申请
- **外部职位录入** — 支持任意平台的职位通过扩展浮层或 API 手动录入

### AI 能力

- **AI 匹配打分** — 按简历 0-100 打分，给出匹配理由、顾虑点和技能差距分析
- **中文简历/求职信生成** — 按职位定制，支持 PDF 与 DOCX 输出
- **多服务商 AI** — 国内优先：DeepSeek（默认）、通义千问、Kimi、智谱 GLM；保留 Anthropic、Bedrock、OpenAI、Google Gemini、OpenRouter，以及 Ollama（本地推理，无需 API Key、数据不出网）。设置页提供申请入口、Base URL/模型预填与一键连通性测试（失败给出中文原因）
- **面试题库与模拟面试** — 按 JD + 简历生成四类中文题目（基础八股 / 项目深挖 / 场景设计 / HR 面），每题可写作答草稿、AI 补要点、标记熟练度，支持逐题模拟面试与薄弱点报告，也可从同类岗位复制题库
- **面试准备** — 按职位生成面试准备材料，记录面试轮次与结果
- **申请成功率预测** — 基于历史申请数据预测回复概率
- **职业轨迹分析** — AI 给出进阶/转型方向建议
- **Offer 对比** — 月薪口径的总包对比（月薪、年终奖、股权、签字费、年假）

### 申请管理

- **拖拽式看板** — 在「感兴趣 → 已准备 → 已投递 → 面试中 → 已拿 offer / 已拒绝 / 已撤回」各阶段间拖拽流转
- **面试轮次记录** — 每份申请记录多轮面试（轮次、面试官、时间、结果）；面试官可一键存入人脉 CRM
- **日历视图** — 月历 + 列表展示面试与截止日期；提供 iCal 订阅（Google / Outlook / Apple 日历）
- **人脉 CRM** — 记录联系人、互动历史与内推关系，并关联到职位
- **待联系清单** — 从 CareerPulse 勾选待沟通职位，扩展按顺序带你逐个填写
- **职位提醒** — 保存搜索条件，有新的高分职位时推送站内通知
- **跟进提醒** — 长时间没有回应的申请自动进入待跟进列表

### 界面

- **简体中文优先** — 默认 `zh-CN`，可切换英文；界面文案全部走 `t(key, params)`，不做浏览器语言探测
- **人民币月薪口径** — 金额一律按月薪（元）展示，支持万/K 显示，**不做币种换算**
- **引导式上手** — 首次运行 4 步向导：资料 → 简历 → AI 服务商 → 录入职位
- **快捷键与响应式** — 键盘导航（j/k、/、? 等），移动端汉堡菜单
- **CSV 导出 / 看板统计** — 申请漏斗、回复率、分数校准等分析视图

## 快速开始

### Docker（推荐）

```bash
cp .env.example .env
# API Key 可以不填，之后在设置界面配置
docker compose up -d --build
```

打开 http://localhost:8085

### 本地运行

```bash
cp .env.example .env
# uv 自动管理虚拟环境和依赖
uv run uvicorn app.main:create_app --factory --reload --host 0.0.0.0 --port 8085
```

## 配置

所有环境变量使用 `JOBFINDER_` 前缀，均可在设置界面代替：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `JOBFINDER_ANTHROPIC_API_KEY` | 空 | AI 服务的 API Key（也可在界面配置其他服务商） |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | 空 | Bedrock 服务商的 AWS 凭证（也可用 `~/.aws/credentials` 等） |
| `JOBFINDER_DB_PATH` | `data/jobfinder.db` | SQLite 数据库路径 |
| `JOBFINDER_RESUME_PATH` | `data/resume.txt` | 默认简历文件路径 |
| `JOBFINDER_HOST` | `0.0.0.0` | 服务监听地址 |
| `JOBFINDER_PORT` | `8085` | 服务端口 |

### AI 服务商

在 **设置 → AI 服务商** 中配置：

- **DeepSeek** — 需 API Key，默认服务商，中文与性价比最优
- **通义千问 / Kimi / 智谱 GLM** — 需 API Key；长简历/长 JD 建议 Kimi（32k/128k）
- **Ollama** — 本地推理，无需 Key；模型列表从本地 Ollama 服务获取（默认 `http://localhost:11434`，Docker 部署时自动把 localhost 改写为宿主机地址）
- **Anthropic / Bedrock / OpenAI / Google (Gemini) / OpenRouter** — 需自行解决网络访问；Bedrock 使用 AWS 凭证（环境变量、`~/.aws/credentials` 或实例角色均可）

> 每个服务商都可一键「测试连接」，失败时显示中文原因（密钥无效 / 额度不足 / 模型名错误 / 网络不可达）与原始报错。

## 使用流程

1. **完善资料** — 设置 → 个人资料 / 工作经历（扩展填表的数据来源）
2. **上传简历** — 设置 → 简历管理（PDF、TXT 或 MD），AI 自动提取技能并给出求职意向建议
3. **安装扩展** — 见下文，在招聘平台页面上把职位保存进 CareerPulse
4. **看匹配** — 职位按匹配分排序，结合匹配理由与技能差距决定值不值得聊
5. **准备材料** — 职位详情 → 准备申请，生成定制简历 + 求职信
6. **管流程** — 拖拽看板推进阶段，记录面试轮次，到期自动提醒跟进

## Chrome 扩展

扩展负责把你在招聘平台上看的职位回传到 CareerPulse，并用 AI 辅助填写申请表单。

### 安装

1. 确保 CareerPulse 正在运行（默认 `http://localhost:8085`）
2. Chrome 打开 `chrome://extensions/`
3. 右上角开启**开发者模式**
4. 点击**加载已解压的扩展程序**，选择本仓库的 `extension/` 目录
5. 工具栏出现 CareerPulse 图标即安装成功

### 使用

1. 打开任意招聘平台的职位页或申请表单
2. 点击 CareerPulse 扩展图标
3. 点击**填表** — 扩展读取表单，交给 CareerPulse 的 AI 映射字段并填写
4. 检查填写结果：绿色 = 有把握，黄色 = 建议人工确认
5. 提交后，扩展会提示把新填写的答案存回你的资料库

### 工作原理

- 内容脚本提取所有表单字段（label、placeholder、选项、aria 属性，含 Shadow DOM 与 iframe）
- 表单 HTML 发送到 `POST /api/autofill/analyze`，AI 把你的资料映射到字段
- 迭代式填写，兼容动态/条件表单（最多 2 轮）
- 跳过的字段从自定义问答库中模糊匹配补填
- 使用原生属性 setter 兼容 React 表单
- 电话/区号下拉框识别与防误填
- **匹配分角标** — 在平台职位列表上直接显示 AI 匹配分
- **自动标记已投递** — 检测表单提交后自动更新状态
- **队列填表** — 待联系清单里的职位按顺序逐个填写，每份都停下来等你确认，**绝不自动提交**

### 配置

点击扩展弹窗中的设置，配置 CareerPulse 服务器地址（默认 `http://localhost:8085`）。

扩展需要 CareerPulse 中已有你的资料数据，请先在 **设置 → 个人资料 / 工作经历** 中填写完整。

## 架构

```
FastAPI (async)
├── app/main.py — create_app 工厂 + lifespan
│   └── 双数据库连接：app.state.db（请求）+ app.state.bg_db（后台任务）
├── app/routers/ — 12 个 APIRouter 模块
│   ├── jobs.py, tailoring.py, pipeline.py, queue.py, contacts.py
│   ├── analytics.py, settings.py, alerts.py, scraping.py, autofill.py
│   └── interviews.py（面试轮次 + 存为人脉）, calendar.py（日程 + iCal 订阅）
├── app/database.py — SQLite via aiosqlite（37+ 张表，外键约束，WAL 模式）
│   └── jobs.last_seen_at 每轮回传时更新，驱动新鲜度过滤与 30 天自动隐藏
├── AIClient（DeepSeek | Qwen | Kimi | 智谱 | Anthropic | Bedrock | OpenAI | Google | OpenRouter | Ollama）
│   ├── JobMatcher（打分，输出中文理由）
│   ├── ResumeAnalyzer（简历分析 + ATS 分）
│   ├── Tailor（定制简历 + 求职信 + DOCX）
│   ├── InterviewPrep（四类中文题库 + 补要点）
│   ├── AutoFill 分析器（表单字段映射）
│   ├── Predictor（申请成功率）
│   ├── CareerAdvisor（职业轨迹）
│   └── OfferCalculator（Offer 对比）
├── APScheduler（4 个后台任务：打分 / 维护 / 提醒 / 摘要）
├── 原生 JS SPA
│   ├── app/static/js/i18n.js — 双语核心（默认 zh-CN）
│   ├── app/static/js/app.js — SPA 路由、移动端导航
│   ├── app/static/js/api.js — API 客户端
│   ├── app/static/js/utils.js — HTML 消毒与工具函数
│   ├── app/static/js/onboarding.js — 4 步引导向导
│   ├── app/static/js/interview-panel.js — 面试详情抽屉
│   ├── app/static/js/interview-prep.js — M9 面试题库面板（草稿 / 模拟面试 / 薄弱点报告）
│   └── app/static/js/views/ — feed, detail, pipeline, queue, stats, settings, network, triage, calendar
└── Chrome 扩展（回传 + 填表 + 队列填表）
```

### 数据模型

SQLite 核心表：`jobs`、`sources`、`job_scores`、`applications`、`app_events`、`search_config`、`ai_settings`、`user_profile`、`work_history`、`education`、`certifications`、`skills`、`languages`、`user_references`、`custom_qa`、`autofill_history`、`saved_views`、`resumes`、`job_alerts`、`application_queue`、`contacts`、`contact_interactions`、`job_contacts`、`career_suggestions`、`offers`、`interview_rounds`、`interview_prep`、`reminders`、`ical_tokens` 等。启动时自动迁移表结构。

### 后台任务

| 任务 | 间隔 | 说明 |
|------|------|------|
| 打分 | 每 1h | 对未打分的职位跑 AI 匹配 |
| 维护 | 每 24h | 清理已忽略职位与过期数据 |
| 提醒检查 | 每 12h | 对长时间无回应的申请生成跟进提醒 |
| 邮件摘要 | 每天 8 点 | 发送新职位摘要（配置了 SMTP 才生效） |

> 职位数据不再由服务端定时爬取 —— 中国版改为**浏览器扩展在用户浏览时回传**（PRD 决策 D1），服务端的爬虫调度与富化任务已移除。

## API

完整 REST API 自动文档：

- **Swagger UI**: http://localhost:8085/docs
- **ReDoc**: http://localhost:8085/redoc

主要分组：

| 分组 | 代表端点 |
|------|----------|
| 职位 | `GET /api/jobs`、`GET /api/jobs/:id`、`POST /api/jobs/save-external`（扩展回传）、`POST /api/jobs/lookup`、`POST /api/jobs/mark-applied-by-url`、`GET /api/companies/:name`（本地缓存） |
| 准备材料 | `POST /api/jobs/:id/prepare`、`GET /api/jobs/:id/resume.pdf`、`GET /api/jobs/:id/cover-letter.pdf`（另有 `.docx`）、`POST /api/resume/upload`（`.pdf`/`.docx`/`.txt`/`.md`） |
| 面试题库 | `POST/GET /api/jobs/:id/interview-prep`、`PUT /api/jobs/:id/interview-prep/questions/:index`、`POST .../questions/:index/expand`、`POST .../copy`、`GET /api/interview-prep/sources` |
| 申请管道 | `POST /api/jobs/:id/apply`、`POST /api/jobs/:id/application`、`POST /api/jobs/:id/response`、`GET /api/pipeline`、`GET /api/reminders`、`GET/POST /api/follow-up-templates` |
| 待联系清单 | `POST /api/queue/add`、`GET /api/queue`、`POST /api/queue/:id/fill-status`（扩展回报填写状态）、`DELETE /api/queue/:id` |
| 面试 | `GET/POST /api/jobs/:id/interviews`、`PUT/DELETE /api/interviews/:id`、`POST /api/interviews/:id/save-contact` |
| 日历 | `GET /api/calendar`、`GET /api/calendar/token`、`GET /api/calendar.ics` |
| 人脉 | `GET/POST /api/contacts`、`PUT/DELETE /api/contacts/:id`、`GET/POST /api/contacts/:id/interactions`、`GET/POST /api/jobs/:id/contacts` |
| 分析 | `GET /api/stats`、`GET /api/analytics`、`GET /api/skill-gaps`、`GET /api/jobs/:id/predict-success`、`GET /api/offers/compare`、`POST /api/career/analyze`、`GET /api/export/csv` |
| 提醒通知 | `GET/POST /api/alerts`、`GET /api/notifications`、`GET /api/notifications/stream`（SSE） |
| 设置 | `GET/POST /api/profile`、`GET/PUT /api/profile/full`、`POST /api/profile/learn`、`GET/POST /api/ai-settings`、`GET/POST /api/search-config/*`、简历版本、自定义问答、保存的过滤器 |
| 填表 | `POST /api/autofill/analyze`、`GET /api/autofill/history`、`GET/POST/DELETE /api/custom-qa` |
| 抓取/打分 | `POST /api/scrape`、`GET /api/scrape/progress`、`POST /api/scrape/cancel`、`POST /api/score`、`GET /api/score/progress` |
| 运维 | `GET /api/health`、`POST /api/clear-jobs`、`POST /api/clear-all`、`POST /api/dismiss-stale` |

## 国际化（i18n）

界面提供**简体中文（默认）**与英文两种语言。

- Web：主题按钮旁的 `中文 / EN` 切换；存储在 `localStorage`（`careerpulse_lang`）。切换时重渲染当前视图，有未保存的表单会先确认。
- Chrome 扩展：弹窗与填表浮层各有语言切换；存储在 `chrome.storage.local`（`language`），与 Web 互相独立。
- 两端都不做浏览器语言自动探测，默认 `zh-CN`。
- 所有界面文案走 `t(key, params)`（`app/static/js/i18n.js` / `extension/i18n.js`）。职位描述、公司名、AI 输出和邮件正文保持原文；金额保持人民币月薪口径，不做币种换算。
- 后端错误返回稳定错误码：`{ "code": "resume.not_found", "params": {} }`，由客户端翻译。

完整契约、术语表与维护规则见 [`docs/i18n.md`](docs/i18n.md)。

## 测试

```bash
# 后端（445 项）
uv run pytest

# 前端（210 项）
cd app/static && npx vitest run

# 扩展（509+ 项）
cd extension && npx vitest run
```

前端与扩展套件包含 i18n 单元测试、web ⇄ 扩展的翻译键一致性校验，以及静态硬编码文案审计（在已迁移文件里新增硬编码英文文案会导致构建失败）。

## CI

GitHub Actions 在每次 push / PR 到 `main` 时并行跑 3 个测试套件（`.github/workflows/ci.yml`）：

| 任务 | Runner | 命令 |
|------|--------|------|
| 后端测试 | ubuntu-latest | `uv run pytest` |
| 前端测试 | ubuntu-latest | `npx vitest run`（`app/static/`） |
| 扩展测试 | ubuntu-latest | `npx vitest run`（`extension/`） |

测试结果以构件上传（`test-results/*.xml`）。

## 技术栈

- **后端**: Python 3.12+、FastAPI、aiosqlite、httpx
- **前端**: 原生 JS SPA（无构建步骤），Vitest 测试
- **扩展**: Chrome Manifest V3（content script + service worker），Vitest 测试
- **AI**: Anthropic SDK（含 Bedrock）/ OpenAI SDK / Ollama REST API
- **调度**: APScheduler
- **文档**: PyMuPDF（PDF）、python-docx（DOCX）
