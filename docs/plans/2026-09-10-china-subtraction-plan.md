# CareerPulse 中国化「减法清单」

**文档状态**：待评审（v0.1 草案）
**日期**：2026-09-10
**配套文档**：`docs/plans/2026-09-10-careerpulse-china-market-prd.md`（中国版 PRD）
**方法**：对 `app/`（Python 约 7,300 行）、`app/static/js/`（约 9,800 行）、`extension/`（约 12,400 行）、`tests/`（约 7,600 行）做只读审计，逐项标注行号、依赖、拆卸成本。所有数字为实测。

---

## 0. 为什么必须做减法

这位用户的一句话最准确：**"让它能够搜索 BOSS 直聘"**。但真实情况是——现在的 CareerPulse 是一座美国求职自动化的完整建筑，中国化不是"加一个爬虫"，而是"换地基"。

规模对比：

| 维度 | 现状 | 中国版一期目标 | 结论 |
| --- | --- | --- | --- |
| 招聘源 | 14 个美国源（`app/scrapers/` 2,431 行） | 1 个平台（BOSS 直聘，经扩展采集） | 删 2,431 行 |
| 采集触发 | 服务端 APScheduler 定时爬取（10 个定时任务） | 用户浏览时扩展主动回传 | 删 9 个定时任务 |
| 薪资模型 | 美元/年 + 50 州税率（`tax-data.js` 273 行） | 人民币/月 + 五险一金 | 整体重写 |
| 投递方式 | 邮件 + 美国 ATS 自动填表（6 个适配器） | BOSS 站内沟通（生成话术 + 手动复制） | 删自动填表全链路 |
| 用户画像 | 40 个迁移列（含美军服役、EEO、驾照、两个美国地址） | 中国简历字段 | 删 34 个列 |
| 表结构 | 39 张表 | 约 26 张 | 删 13 张 |

**减法的三个理由**（缺一不可）：

1. **场景不成立**：美国功能在中国无对应场景（EEO 问卷、安全许可、H1B、W2/1099/C2C、Glassdoor）。
2. **通道不成立**：依赖美国服务的功能在中国不可用或不可靠（DuckDuckGo 公司研究、LinkedIn 招聘经理查找、SMTP 邮件摘要、USAJobs/Adzuna API）。
3. **方向相反**：有些功能不仅无用，还会误导（Remote Only 硬过滤、USD 金额、Annual/Hourly 计薪周期、"年薪 $150k 起"过滤器）。

---

## 1. 审计发现的**结构性障碍**（必须先解决，否则减法做不干净）

这四条是本次审计最重要的产出。它们不是"某个功能要不要删"，而是**现有代码结构让减法本身变得危险**。

### 障碍 A：`utils.js` 是美元金额的全局单点（30+ 处引用）

| 位置 | 内容 |
| --- | --- |
| `utils.js:12-13` | 注释明写 `Money stays USD — CareerPulse is a US job market product and does not convert amounts` |
| `utils.js:16` | `return '$' + Number(val).toLocaleString();` |
| `utils.js:56` | 注释明写 `Salary amounts are USD and are never converted` |
| `utils.js:62-63` | `` `$${Math.round(n / 1000)}k` `` / `` `$${n}` `` |

被 **30+ 处**调用：`salary-calculator.js:192,225,231,379,551-553,570-571`、`views/pipeline.js:320-323,535,545,568`、`views/detail.js:931,975,979,983,1037,1064-1066`；`formatSalary` 另有 9 处（`feed.js:398,400,507,528`、`triage.js:71`、`detail.js:33,41,46,339`）。

**结论**：`formatCurrency` / `formatSalary` 必须**先重写为人民币月薪口径**，再动任何其它金额相关代码。否则每改一处视图都会引入不一致。

### 障碍 B：薪资计算引擎与 `detail.js` 跨文件耦合，且失败会**静默**

- `salary-calculator.js`（603 行）引擎（:6-134）与 UI（:249-603）分离，但**两个文件都是全局脚本**（`index.html:78,81`），无模块边界。
- `detail.js:918,929-930,1060` 跨文件调用 `calculateSalary` / `compareEmploymentTypes`；`detail.js:913` 调用 `loadCalcSettings()`（定义在 `salary-calculator.js:239-243`）。
- **致命点**：`detail.js:918` 和 `:1012` 用 `typeof calculateSalary === 'function'` 做守卫 —— 换掉引擎后守卫为假，薪酬卡会**直接消失且不报错**，看起来像"功能没做"。

**结论**：替换薪资引擎时，必须先把 `detail.js` 的 202 行 comp 区块（`:886-1087`）**整块删除**，而不是让它静默降级。

### 障碍 C：i18n 与状态机耦合，**中文下已经写坏数据**（现存 bug）

审计实测确认（非推测）：

| 位置 | 现象 |
| --- | --- |
| `locales/detail.js:365-371` | 中文状态值：`applied: '已申请'`、`interviewing: '面试中'`（英文版 `:124-130` 的值恰好等于后端枚举 `'applied'`，所以英文下"碰巧能用"） |
| `detail.js:141-143` | 状态下拉的 `<option value="${s}">` 用的是**翻译结果**当 value |
| `detail.js:440` | `const status = document.getElementById('status-select').value;` → 拿到的是 `'已申请'` |
| `detail.js:442` | `await api.updateApplication(job.id, status)` → 把 `'已申请'` 写进数据库 |
| `database.py:1088-1094` | `update_application` **无枚举校验、无状态转换校验**，`UPDATE applications SET status = ?` 盲写 → 中文字符串成功落库 |
| `detail.js:148` | `appStatus === t('detail.status.applied')` 恒为假，导致「Log Response」区块永不显示 |
| `detail.js:87` | 同类比较（英文值混用 `'offered'`），comp 区块门控实际失效 |

**结论**：中国版状态机（`queued/contacted/awaiting_reply/replied/...`）必须遵守一条铁律 —— **下拉框的 `value` 用稳定英文枚举，`label` 用 `t()` 翻译，两者永不混用**；后端 `update_application` 必须补上枚举白名单校验。这条如果不先立规，M7 投递看板做完就是错的。

### 障碍 D：`settings.js` 外壳三处硬编码，任何 tab 增删都要动

| 位置 | 内容 |
| --- | --- |
| `settings.js:9-19` | `Promise.all` 一次拉 **9 个接口**（删 tab 必须同步收缩） |
| `settings.js:29-38` | `tabs` 数组硬编码 8 项（其中 `'Profile'` :30、`'AI & Integrations'` :36、`'Data Management'` :37 **未走 `t()`**，是漏翻译） |
| `settings.js:69-78` | `renderActiveTab` 的 `switch` 硬编码 8 个 case |

另外 `renderTabProfile`（239 行）内 7 个卡片**共用一次 `PUT /api/profile/full` 提交**（:612-676 一次性读取 30+ 个 `getElementById`），删任何一张卡都必须同步改这个取值对象，否则 `getElementById(...).value` 抛 TypeError。

### 障碍 E（附带发现，与国别无关但影响拆卸安全）

| 位置 | 现象 |
| --- | --- |
| `settings.js:43,164,170,244,933` | 5 处 `map(t => ...)` / `const t = ...` **遮蔽全局 `t()` 翻译函数** |
| `settings.js:92` | 空状态文案直接写着 `Use t('settings.alerts.create') on the Jobs page` —— **翻译函数调用被当作用户可见文案写进了字面量** |
| `settings.js:1858` | 导出文件名 `jobfinder-profile.json`（旧产品名残留） |
| `salary-calculator.js:1012-1014` | 图表回退色板含 `federal`/`state`/`ss`/`medicare`/`seTax` 五键，换税制需同步 |

---

## 2. 减法清单总账

### 2.1 判定标准

| 判定 | 含义 | 处理 |
| --- | --- | --- |
| 🔴 **删除** | 中国无场景 / 通道不可用 / 方向相反 | 代码、数据、文案、测试一并删除 |
| 🟠 **重写** | 中国有同等需求，但实现完全不同 | 保留场景与数据结构，重写实现 |
| 🟡 **隐藏** | 中国低频，但删掉会牵动共享渲染结构 | 界面移除入口，代码保留并标记 `// deprecated: US-only` |
| 🟢 **保留** | 与国别无关 | 仅需文案中文化 |

### 2.2 后端模块（`app/`）

| # | 模块 | 行数 | 判定 | 依据（实测） |
| --- | --- | --- | --- | --- |
| 1 | `scrapers/`（14 个美国源 + base） | 2,431 | 🔴 删除 14 源，保留 `base.py` 契约 | 美国源在中国无内容；`base.py` 的重试/限流/UA 轮换可被扩展桥复用 |
| 2 | `enrichment.py` | 200 | 🔴 删除 | 函数清单全是 `fetch_linkedin_guest_api`(:32)、`fetch_linkedin_playwright`(:52)、`_extract_linkedin`(:150)、`_extract_dice`(:155) —— 整模块服务 LinkedIn/Dice；BOSS 详情页由扩展直接抓完整 JD |
| 3 | `browser_pool.py` | 135 | 🔴 删除（有保留价值，见注） | **不是"美国 ATS 池"**，是 Playwright **反爬池**（stealth + cookie 持久化到 `data/cookies/`），Indeed 是唯一消费者（`scrapers/indeed.py:15`）+ `main.py:257` 关闭钩子。硬编码 `locale="en-US"`、`timezone_id="America/New_York"`（:70-71）。**注**：其"cookie 持久化 + stealth"能力对未来服务端兜底采集有价值，若要保留必须先删 `:70-71` 的硬编码 |
| 4 | `location_classifier.py` | 288 | 🔴 删除 | 模块内 `_NON_US_COUNTRIES` 是 100+ 国家的枚举；`:80-84` 直接 `from app.database import _US_STATES`；职责是 US/Europe/APAC 区域 + clearance 分类 |
| 5 | `salary_estimator.py` | 34 | 🔴 删除（由 M10 取代） | prompt 硬编码 `estimate the annual salary range in USD` + 示例 `{"min": 80000, "max": 120000}` |
| 6 | `offer_calculator.py` | 47 | 🟠 重写 | 生活成本归一化 + 州税口径 → 改为五险一金 + 个税到手对比 |
| 7 | `company_research.py` | 43 | 🔴 删除 | 依赖 `api.duckduckgo.com`（中国不可用）+ 抓 Glassdoor 评分（中国无此站） |
| 8 | `contact_finder.py` | 70 | 🔴 删除 | DuckDuckGo 搜 "hiring manager" 邮箱；BOSS 场景 HR 就是唯一联系人 |
| 9 | `apply_link_finder.py` | 45 | 🔴 删除 | `APPLY_PATTERNS` 全英文（`apply now` / `easy apply` / `submit application`）；BOSS 在站内投递 |
| 10 | `emailer.py` + `digest.py` | 98+142 | 🟡 隐藏 | 依赖 `aiosmtplib`；中国求职入口是 BOSS 站内消息 |
| 11 | `follow_up.py` | 40 | 🟠 重写 | prompt 是 `Draft a brief, professional follow-up email`；中国版改为 M8 站内招呼/跟进话术 |
| 12 | `predictor.py` | 43 | 🟢 保留（后置） | AI 能力与国别无关，但需累计投递历史才有意义 |
| 13 | `career_advisor.py` | 52 | 🟢 保留 | 与国别无关 |
| 14 | `resume_analyzer.py` | 169 | 🟠 重写 | 现为美式 ATS 评分口径 → 改中文简历健康度（M5） |
| 15 | `ai_client.py` | 349 | 🟠 扩展 | 新增 deepseek/qwen/kimi/zhipu，保留 5 家国际 provider |
| 16 | `matcher.py` / `tailoring.py` | 289+58 | 🟠 重写 prompt | 需引用中国招聘语境，输出中文 |
| 17 | `embeddings.py` | 246 | 🟡 隐藏（一期不做） | 依赖 `sqlite-vec`；自用库量级（数百条）用关键词检索足够。**关键**：所有消费点都套了 `getattr(db, "_vec_loaded", False)` 门禁（`database.py:202-211`）且都有非向量降级路径，所以关闭**不会破坏功能、只会降级** —— 这是"删"的低风险依据。但 `run_context_embedding_cycle` 另有**副作用**：它同时负责把 `work_history`、`contact_interactions` 同步进 `context_items`（`scheduler.py:408-443`），删掉后 `context_items`/`vec_context`/`embedding_settings` 一并成为无用件 |
| 18 | `rate_limiter.py` / `circuit_breaker.py` | 83+54 | 🟢 **不要删** | ⚠️ **审计纠正**：`circuit_breaker` 不是爬虫件 —— 它包的是 **AI 客户端**（`ai_client.py:16`），换 DeepSeek 同样需要；`rate_limiter` 被 `enrichment.py:8` 使用。**只需把 `rate_limiter.py:44-65` 的 `DOMAIN_LIMITS` 美国域名表换掉/清空** |
| 21 | `scrapers/weworkremotely.py` | 49 | 🔴 删除（**已是死代码**） | 审计实测：**未注册进 `ALL_SCRAPERS`**（`scrapers/__init__.py:16-30` 只列 14 个，无 WeWorkRemotely），仅 `tests/test_scrapers/test_weworkremotely.py`（3 测试）引用 → 属模块级死代码，删除零影响 |
| 19 | `pdf_generator.py` / `docx_generator.py` | 235+153 | 🟠 重写排版 | 输出中文简历（照片位/单页/中文区块名），DOCX 优先 |
| 20 | `scheduler.py` | 512 | 🟠 大幅删减 | 8 个注册 job / 10 个 `run_*` 函数 → 见 2.2.1 |

#### 2.2.1 `scheduler.py`：**实际注册 8 个 job，文件里有 10 个 `run_*` 函数**

修正说明：审计实测 `app/main.py:202-241` 只有 **8 次 `scheduler.add_job`**。所谓"10 个定时任务"是把 `scheduler.py` 里的 `run_*` 函数数当成了 job 数 —— `run_location_classification` **没有独立 job**，它被 `scoring_cycle` 内部调用（`main.py:161`）。

| 注册的 job | 触发 | 内部调用 | 判定 | 理由 |
| --- | --- | --- | --- | --- |
| `scrape_cycle` | 6h | `run_scrape_cycle` | 🟠 改造 | 核心循环（去重/入库/进度心跳）**可复用**；`:114-134` 的美国 region/work_type 前置过滤整段删除 |
| `scoring_cycle` | 1h | `state.score_unscored` + **`run_location_classification`** | 🟠 改造 | 评分保留；内嵌的地点分类删除 |
| `enrichment_cycle` | 2h | `run_enrichment_cycle` | 🔴 删除 | 批量补 LinkedIn/Dice 详情（每轮 30 条） |
| `maintenance_cycle` | 24h | `run_maintenance_cycle` | 🟢 保留 | 陈旧职位自动清理，逻辑通用（"岗位已关闭"同样需要） |
| `reminder_check` | 12h | `run_reminder_check` | 🟢 保留 + 改造 | **M7/M8 跟进提醒的地基**；`:347-392` 的 AI 自动起草要改成站内沟通语气（`:349` 调 `follow_up.draft_follow_up`） |
| `digest_cycle` | cron 08:00 | `run_digest_cycle` | 🟡 隐藏 | 邮件摘要 + `digest.py` 硬编码 `$` 格式 |
| `alert_check` | 1h | `run_alert_check` | 🟢 保留 | 保存搜索提醒，`job_alerts` 表通用 |
| `embedding_cycle` | 2h | `run_job_embedding_cycle` + `run_context_embedding_cycle` | 🟡 隐藏 | 见上表 #17 的副作用说明 |

**结果**：8 个 job → 保留 3 个（maintenance / reminder / alert）+ 改造 2 个（scrape / scoring），隐藏 3 个（digest / embedding×2，注意 embedding_cycle 内含 2 个函数），删除 1 条内嵌调用（location classification）。

**未注册的死函数**：`run_location_classification`（`:221-285`，纯美国 region 分类，`:281` 直接 `dismiss_jobs_outside_regions(allowed + ["Unknown"])` 按地区丢弃职位）；`run_job_embedding_cycle` 与 `run_context_embedding_cycle` 同属一个 job。

### 2.3 数据库（`app/database.py`，3,218 行 / 39 张表）

现有 39 张表（实测 `CREATE TABLE` 计数）。判定如下：

| 判定 | 表 | 数量 |
| --- | --- | --- |
| 🔴 删除 | `eeo_responses`、`military_service`、`autofill_history`、`scraper_keys`、`scraper_schedule`、`embedding_settings`、`context_items`、`email_settings`、`user_references` | 9 |
| 🟠 改造 | `jobs`（+15 列）、`sources`（+platform）、`applications`（中国状态机）、`user_profile`（删 34 列/增 9 列）、`education`、`work_history`、`offers`（中国总包字段）、`search_config`（去 allowed_regions/remote_only）、`interview_prep`（改 `questions[]`）、`companies`（去 glassdoor） | 10 |
| 🟢 保留 | `job_scores`、`app_events`、`contacts`、`contact_interactions`、`job_contacts`、`custom_qa`、`resumes`、`reminders`、`notifications`、`saved_views`、`job_alerts`、`follow_up_templates`、`interview_rounds`、`ical_tokens`、`career_suggestions`、`skills`、`languages`、`certifications`、`application_queue`、`ai_settings`（+4 provider） | 20 |

#### 2.3.1 `user_profile` 的 40 个迁移列 —— 最少改动量的账

`database.py:644-690` 的 `profile_migrations` 一次性定义了 **40 个 `ALTER TABLE ADD COLUMN`**（实测）。逐列判定：

| 判定 | 列 | 数量 |
| --- | --- | --- |
| 🔴 删除 | `middle_name`、`preferred_name`、`phone_country_code`、`phone_type`、`additional_phone`、`address_street1`、`address_street2`、`address_city`、`address_state`、`address_zip`、`address_country_code`、`address_country_name`、`perm_address_street1`、`perm_address_street2`、`perm_address_city`、`perm_address_state`、`perm_address_zip`、`perm_address_country_code`、`perm_address_country_name`、`date_of_birth`（保留？）、`pronouns`、`drivers_license`、`drivers_license_class`、`drivers_license_state`、`country_of_citizenship`、`authorized_to_work_us`、`requires_sponsorship`、`authorization_type`、`security_clearance`、`clearance_status`、`background_check_consent`、`cover_letter_template`、`how_heard_default` | 33 |
| 🟠 改造 | `desired_salary_min`、`desired_salary_max`、`salary_period`（→月薪）、`notice_period`（→到岗时间） | 4 |
| 🟢 保留 | `website_url`（作为个人主页/博客）、`availability_date`、`willing_to_relocate` | 3 |

**⚠️ 关键工程约束（实测）**：迁移框架是**幂等的前向迁移**，`database.py:686-689` 的循环只在列不存在时才执行 ——

```python
if col not in profile_columns:
    await self.db.execute(sql)   # sql 恒为 "ALTER TABLE user_profile ADD COLUMN ..."
```

且全文件 **`grep -c "DROP COLUMN\|DROP TABLE\|RENAME TO"` = 0** —— **零删除先例**。

因此"删 33 列"只有两条路：

| 方案 | 做法 | 成本 | 风险 |
| --- | --- | --- | --- |
| **L1 惰性废弃**（推荐一期） | 列保留在库里，UI 全部移除，`database.py` 加注释标记 `-- deprecated: US-only, remove in v2` | 低 | 库里有 33 个死列（自用可接受） |
| **L2 表重建** | 扩展迁移框架支持 `CREATE TABLE new → INSERT SELECT → DROP → RENAME`，重建 `user_profile` | 中（需先给迁移框架加删除能力） | 需备份 + 事务 + 回滚 |

**建议**：一期走 L1（把工程预算留给 M4 采集），PRD 里登记为技术债；二期做 L2 时一并处理 `eeo_responses` / `military_service` 的 `DROP TABLE`。

### 2.4 🔴 新发现的**真实缺陷**：中文简历上传（M5 的地基）根本不能用

审计实测 `app/routers/settings.py` 的 `POST /resume/upload`：

```python
610: _ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".doc", ".docx", ".rtf"}
617: if ext not in _ALLOWED_EXTENSIONS: raise ...
623:     import fitz                              # ← 只有 PDF 走真正的文本抽取
624:     doc = fitz.open(stream=content, filetype="pdf")
628:     resume_text = content.decode("utf-8", errors="replace")   # ← 其他格式全走这里
```

**后果**：`.docx` / `.doc` / `.rtf` 是 ZIP / 二进制容器，`utf-8` 解码得到的是二进制垃圾而非简历文本 —— 上传看似成功，解析出的是乱码，AI 再从乱码里"猜"出一份画像。

**为什么这是阻塞项**：PRD §M5 明确要求 **DOCX 优先**（国内 HR 与内推最常要求 Word 格式）。如果不修，中国用户的第一件事（上传简历）就是坏的，而且**不会报错**。

**修法**：新增 `python-docx` 解析分支（依赖已在 `pyproject.toml`），并加 `.doc`/`.rtf` 的明确拒绝提示（或引入转换）。验收：上传一份真实中文简历 DOCX，姓名/手机/邮箱/教育/工作经历全部正确抽取（PRD §11 P0 已列此条）。

### 2.5 其他新发现的既存缺陷（顺手清掉，不必单独修）

| # | 缺陷 | 位置 | 证据 | 影响 |
| --- | --- | --- | --- | --- |
| 1 | **学习回路写入无效** | `content.js:2033-2036` 发 `data: { learned_fields }` vs `settings.py:56` 读 `body.get("new_data", {})` | 已实测两端源码 | 用户勾选的新数据被丢弃，只写了一条 `autofill_history` → 「学习回路」当前是**半失效**功能 |
| 2 | **`lookupJob` 消费者读错字段** | `content.js:2285` 读 `lookupResult.data?.id` vs `jobs.py:118-125` 返回 `job_id` | 已实测两端源码 | `currentJobId` 不会被赋值 → 简历/求职信下载链路第一跳就拿不到 jobId |
| 3 | **`settings.js:92` 文案泄漏** | 空状态直接写着 `Use t('settings.alerts.create') on the Jobs page` | 已实测 | 用户可见处露出翻译函数调用 |
| 4 | **5 处 `t` 遮蔽全局 `t()`** | `settings.js:43,164,170,244,933` | 已实测 | 作用域内 `t()` 失效 |
| 5 | **状态值被翻译污染** | `detail.js:141-143,440-442` + `database.py:1088-1094` | 已实测 | 中文下把 `'已申请'` 盲写进 `applications.status`（障碍 C） |
| 6 | **`weworkremotely.py` 死代码** | `app/scrapers/weworkremotely.py`（49 行） | `scrapers/__init__.py:16-30` 的 `ALL_SCRAPERS` 只列 14 个，无它 | 模块级死代码 |
| 7 | **旧产品名残留** | `settings.js:1858` 导出文件名 `jobfinder-profile.json` | 已实测 | 品牌不一致 |

#1 与 #2 有个共同点值得注意：**美国 ATS 这条链路本身已经带着未修的集成缺陷在运行** —— 这反过来降低了"删除它"的沉没成本。

### 2.6 前端（`app/static/js/`，约 9,800 行）

#### 2.6.1 文件级判定

| 文件 | 行数 | 判定 | 说明 |
| --- | --- | --- | --- |
| `tax-data.js` | 273 | 🔴 删除 | 2025 美国联邦+50 州税率，全文件删除；同步 `index.html:78` |
| `salary-calculator.js` | 603 | 🟠 重写 | 引擎与 UI 全美式（W2/1099/C2C、联邦/州/FICA、40×52 小时假设） |
| `utils.js` | 357 | 🟠 改 2 个函数 | `formatCurrency`(:12-17) / `formatSalary`(:56-68)，但牵连 30+ 调用点（障碍 A） |
| `views/settings.js` | 1,878 | 🟠 大改 | 8 tab → 6 tab；删约 330 行美国面 |
| `views/detail.js` | 1,569 | 🟠 大改 | 删约 480 行（comp 202 + CRM 175 + email 35 + cover letter 62 + 联系人 60 + glassdoor 11） |
| `views/pipeline.js` | 784 | 🟠 大改 | 删约 420 行（offers 331 + 状态枚举 + 美式表单字段） |
| `views/feed.js` | 592 | 🟠 小改 | 删约 20 行（地区 9 + clearance 10） |
| `views/stats.js` | 559 | 🟠 中改 | 删约 40 行（美式状态枚举/颜色/KPI 标签）；`stats.js:28,32,48,52` KPI 标签未 i18n |
| `views/triage.js` | 162 | 🟠 小改 | `:71` 用 `formatSalary` |
| `views/calendar.js` | 336 | 🟢 保留 | iCal 可同步到系统日历；仅文案 |
| `views/network.js` | 210 | 🟢 保留 | 人脉 CRM 通用 |
| `views/queue.js` | 249 | 🟠 改造 | 队列语义改为"待联系" |
| `interview-panel.js` | 205 | 🟠 改造 | 内嵌薪资计算器需换引擎 |
| `onboarding.js` | 408 | 🟠 改造 | 5 个 provider 列表 → 国内优先；第 4 步 scrape CTA 失效（`onboarding.js:199-212`） |
| `app.js` | 936 | 🟠 小改 | `#/calculator` 路由(:37,82-83)保留但指向新计算器 |
| `i18n.js` | 461 | 🟢 保留 | `i18n.js:10` 注释 "Money is always USD" 需改 |
| `api.js` / `utils.js` 其余 | — | 🟢 保留 | — |

#### 2.6.2 `settings.js` 8 tab → 6 tab

| 现 tab | 行数 | 判定 | 处理 |
| --- | --- | --- | --- |
| `profile`（`renderTabProfile` :439-677） | 239 | 🟠 重写 | 7 卡 → 3 卡（个人信息/求职意向/在线链接）；删 EEO(:573-603)、Work Auth(:533-558)、Military(:560-571)、驾照(:522-531)、美国地址(:482-510)；姓名不再按空格拆 First/Middle/Last |
| `resumes`（:276-414） | 139 | 🟢 保留 | 多简历管理中国同样需要 |
| `work-history`（:680-896） | 217 | 🟢 保留 | 删 `references` 卡(:756-763 + :806-811) |
| `job-search`（:899-1211） | 313 | 🟠 大改 | 删 allowed-regions(:971-1000 + handler :1110-1119)、remote-only(:1002-1012 + :1121-1128)、Annual/Hourly(:1019-1021)、美式 notice period(:1029-1033)、美式 cover letter 模板(:1047-1050)；新增城市分级多选、经验/学历/公司规模/融资阶段过滤器 |
| `alerts`（:81-145） | 65 | 🟢 保留 | + 修 `:92` 的字面量 bug |
| `follow-ups`（:147-274） | 128 | 🟠 重写 | 邮件模板 → BOSS 招呼/跟进话术库（M8，结构与语义都变） |
| `integrations`（`renderTabAI` :1214-1692） | 479 | 🟠 大改 | 删 Scraper Keys 卡(:1298-1322，含 USAJobs/Adzuna/JSearch)、Bedrock 块(:1270-1286 + :1411-1424 + :1548-1553，牵连 7 处分支)、Email/SMTP 卡(:1324-1370，96 行)；新增 4 个国内 provider + 连通性测试 |
| `data`（:1695-1877） | 183 | 🟠 中改 | 删 scraper schedule 卡(:1721-1725 + :1769-1813)、autofill history 卡(:1715-1719 + :1754-1767)；保留 CSV/Profile 导入导出、Danger Zone |
| — | — | 🆕 新增 | 「采集」tab（节流间隔、单会话上限、角标开关、暂停采集） |

### 2.7 Chrome 扩展（`extension/`，约 12,400 行）

#### 2.7.1 文件级判定（含审计实测的精确删除量）

| 文件 | 行数 | 判定 | 实测删除量 |
| --- | --- | --- | --- |
| `content.js` | 3,303 | 🟠 重写为主 | **删除约 2,400 行（73%）**；建议删除区间：`:103-1700` 引擎+浮层、`:1969-2056` 学习回路、`:2114-2262` 提交检测+Q&A、`:2264-2423` `startFillFlow`、`:2424-2772` ATS 检测/角标/多页、`:2773-2876` 队列编排。**剩余约 600-900 行** |
| `ats-adapters.js` | 624 | 🔴 删除 | 全部。6 个适配器 = **546 行**：Workday `:20-112`(93) / Greenhouse `:116-210`(95) / Lever `:214-265`(52) / iCIMS `:269-332`(64) / Taleo `:336-413`(78) / Google Forms `:417-580`(164，其中 142 行是手写控件解析) |
| `normalize.js` | 389 | 🔴 删除 | 8 张表 + 5 条 FIELD_PATTERN 是美国专属：`US_STATES`:11-68、`CA_PROVINCES`:70-84、`RACE_ETHNICITY`:138-147、`DISABILITY_STATUS`:149-153、`VETERAN_STATUS`:155-159、`WORK_AUTH`:161-166、`SPONSORSHIP`:168-171。**仅 `DEGREES`:119-128 与 `BOOLEAN_YES_NO`:173-178 值得内联保留**。另 `formatPhoneLike`:317-364 默认美式 `(555) 123-4567`，中国 11 位手机号会掉进 `:{d}` 分支输出 `+13800138000`（**错误格式**），必须重写 |
| `background.js` | 427 | 🟠 重写 | 删约 **230 行（54%）**：队列编排(`:170-358`)+ATS 消息分支 |
| `styles.css` | 703 | 🟠 部分重写 | 删 `:4-518`（约 515 行 ATS 样式）；**保留 `:520-609`（89 行，收藏按钮 + 分数角标）与 `:610-703`（94 行，横幅）** |
| `popup.js` / `popup.html` / `popup.css` | 112+48+195 | 🟠 重写 | 删 `Fill Application` 按钮（`popup.html:21` + `popup.js:73-91`，约 25 行）；保留连接检测(`:47-71`)、服务器地址(`:93-104`)、语言切换(`:30-37`) |
| `manifest.json` | 40 | 🟠 收窄 | **`matches: ["<all_urls>"]`(L17) → `*.zhipin.com`（必须）**；`host_permissions: ["http://localhost:8085/*"]`(L7) 需支持动态端口（PRD §5.3 端口探测），否则用户改端口即断连；`downloads`(L6) **不可删**（导出定制简历仍需），但触发点从"填表时自动下载"改为"手动导出"，且文件名要改中文 |
| `i18n.js` + `locales/` | 427+1,040 | 🟢 保留 | `locales/extension.js` 是 6 命名空间 82 键；需清理 `upload.*`(11) + `queue.*`(12) + 部分 `overlay.*` ≈ **35/82 键（43%）** |
| `error-messages.js` | 58 | 🟢 保留 | 错误码映射 |

#### 2.7.2 `background.js` 的消息类型（审计纠正：项目字段名是 `type` 不是 `action`）

审计实测：项目用 `type` 字段（唯一例外是 `fillField` 的**返回值**里有 `action`，`content.js:1487,1493,2256`，那是填表动作名不是消息类型）。

**`background.js:373-418` 接收 19 个** + **`content.js:2924-2948` 接收 3 个**（`startFill`/`queueFill`/`getStatus`）+ `popup.js` 发出 2 个。

| 判定 | type | 数量 |
| --- | --- | --- |
| 🔴 删除 | `getFullProfile`、`analyzeForm`、`getResumeForJob`、`saveLearnedData`、`getCustomQA`、`downloadResume`、`downloadCoverLetter`、`markAppliedByUrl`、`fillFromQueue`、`queueUserAction`、`cancelQueue`、`getQueueStatus`、`reportFillStatus`、`broadcastStartFill`、`startFill`、`queueFill` | 16 |
| 🟠 保留改造 | `checkConnection`（→ 握手+鉴权）、`downloadResume`/`downloadCoverLetter`（→ 手动导出、中文文件名） | 3 |
| 🟢 保留 | `lookupJob`、`saveJob`、`getScoreForUrl`、`getStatus` | 4 |
| 🆕 新增 | `captureJob`、`syncPendingQueue`、`batchCapture`、`getCaptureState` | 4 |

**注**：`saveLearnedData` 与 `markAppliedByUrl` 是"学习回路"与"自动追踪投递"的实现 —— 它们依赖检测美国 ATS 表单提交。BOSS 是聊天式沟通，`detectSubmission()` 的唯一调用点就在填表流程内（`content.js:2406`），**该能力在中国场景下没有触发点**，属必须删除。且学习回路当前已因字段名不匹配而半失效（见 2.5 #1）。

**安全提示（审计实测）**：`content.js:2921` 校验了 `sender.id !== chrome.runtime.id`，但 **`background.js:370` 的监听器没有做 sender 校验** —— 新增采集消息时应一并补上。

#### 2.7.3 `content.js` 可复用 vs 必须重写（这是扩展改造的核心账）

审计实测：**直接复用约 290 行（8.8%）+ 改造复用约 180 行（5.5%）= 约 14%**，其余 73% 删除、13% 为填表引擎自留。

| 区块 | 行号 | 判定 | 说明 |
| --- | --- | --- | --- |
| **`JOB_BOARD_CONFIGS` 配置化模式** | 2,977-3,046 | 🟢 **架构级复用** | 结构 = `{域名: {name, listingSelector, titleSelector, companySelector, locationSelector, getJobUrl(card)}}`，已支持 4 站点。**BOSS 只需新增 `'zhipin.com'` 条目、替换选择器** —— 这是本次审计最重要的发现：中国化不需要从零写注入层 |
| `detectJobBoard()` | 3,048-3,056 | 🟢 直接复用 | 逐域名 `hostname.includes(domain)`，零改动 |
| **`createSaveButton()`** | 3,075-3,128 | 🟢 近乎直接复用 | 已实现去重(:3076)、`preventDefault+stopPropagation` 防误触跳转(:3085-3086)、三态机 saving/saved/error(:3090-3118)、`position:relative` 兜底(:3124)。仅需改文案键与常驻位置 |
| **`showScoreBadge()`** | 3,130-3,156 | 🟢 直接复用 | 分数取整 + `title` 提示 + 三档色阶(:3149-3155)。按 PRD 把阈值 75/50 改为 85/70/50 并加中文标签 |
| `processJobCards()` | 3,158-3,191 | 🟢 直接复用 | 含 `card.dataset.cpProcessed` 幂等标记(:3163-3164)、先查分再渲染(:3170-3186)。唯一改动：`getScoreForUrl` 需改为按 `external_id` 查或加本地粗排分分支 |
| `scheduleScan` + `initJobBoardOverlay` + MutationObserver | 3,193-3,215 | 🟢 直接复用 | 含 1500ms 防抖（`SCAN_DEBOUNCE_MS` L12）应对 BOSS 无限滚动 |
| `history` 拦截器 | 19-32 | 🟢 直接复用 | 单次 patch `pushState`/`replaceState`；BOSS 站内切换搜索条件是 SPA 路由变化，**必须靠它触发重扫** |
| `escapeHtml` / `showToast` / `sleep` / `withTimeout` | 2,052-2,056 / 2,060-2,093 / 36-48 | 🟢 直接复用 | toast 自带 `role=status`+`aria-live`(:2066-2067) |
| Escape 关闭浮层 | 2,957-2,973 | 🟢 直接复用 | 含"焦点在输入框时不拦截"的正确守卫(:2960-2966) |
| `createOverlay` 头部 + 拖拽 | 1,705-1,793 | 🟡 部分复用 | 拖拽与"最小化/关闭/语言切换"头部可搬到详情页浮层；**body 需完全重写**（现渲染填表结果 → 未来渲染匹配理由/技能缺口/招呼语） |
| `deepQuerySelectorAll/Selector` | 51-101 | 🟡 保留（低成本） | 53 行工具函数，BOSS 目前不用 Shadow DOM，但抗改版保险且成本极低 |
| ATS 填表全套（其余） | — | 🔴 删除 | `extractFormData`/`fillField` 20 个 action(:248-321,1239-1499)、`serializeFormHtml`(:341-379)、`fuzzyMatchOption`/`findTypeaheadDropdown`/`handleCustomDropdown`(:565-1079)、`fillDateField`(:1163-1236)、`fillRichText`(:1116-1146)、`showLearnPrompt`(:1988-2051)、`detectSubmission`(:2116-2161)、`detectApplicationForm`(:2467-2558，其正则含 `work.?auth\|visa\|eeo\|security.?clearance` 等美国信号)、文件上传辅助(:1500-1615)、多页表单追踪(:2661-2772) |
| 队列编排（content 侧） | 2,773-2,876 | 🔴 删除 | 队列语义是"开标签页→自动填表→等提交"，**完全依附自动填表** |
| **新增需从零写** | — | 🆕 | BOSS 页面上下文 `fetch` 采集（PRD §5.2 C1 路径）、`external_id` 提取、本地粗排打分、招呼语浮层、token 握手 |

### 2.8 测试（后端 679 个 / 前端 2,561 行 / 扩展 509 个）

#### 2.8.1 后端：直接删除的测试文件（实测）

| 测试文件 | 对应删除的模块 |
| --- | --- |
| `tests/test_apply_link.py` | `apply_link_finder.py`（实测头部即 `from app.apply_link_finder import find_apply_url`） |
| `tests/test_browser_pool.py` | `browser_pool.py` |
| `tests/test_salary.py` | `salary_estimator.py`（实测断言 `{"min": 120000, "max": 160000}`） |
| `tests/test_company_research.py` | `company_research.py` |
| `tests/test_contact_finder.py` | `contact_finder.py` |
| `tests/test_digest.py` + `tests/test_email_digest.py` + `tests/test_emailer.py` | `digest.py` / `emailer.py`（隐藏后仍可保留，建议一期保留） |
| `tests/test_location_classifier.py`（24 个测试） | `location_classifier.py` |
| `tests/test_offer_calculator_edge.py` | `offer_calculator.py`（重写后需新测试代替） |
| `tests/test_embeddings.py` + `tests/test_rag_context.py` + `tests/test_rag_similar.py` | `embeddings.py`（隐藏） |
| `tests/test_scrapers/`（13 个平台文件，2,440 行） | 14 个美国源 |
| `tests/test_apply.py`、`tests/test_auto_track_alerts_queue.py` | 部分用例依赖美国投递链路，需逐用例筛 |

**删除规模**：62 个文件 → 约 45 个；7,601 行 → 约 5,000 行。

**必须保留并扩充**：`test_database.py`（迁移）、`test_dedup.py`（改平台去重）、`test_matcher*.py`（中文 prompt）、`test_profile_extended.py`（画像改造）、`test_i18n_error_codes.py`、`test_saved_views.py`、`test_reminders.py`、`test_external_jobs.py`（手动录入仍有价值）、`test_pipeline.py`（中国状态机）。

#### 2.8.2 前端 / 扩展（数字为审计实跑结果，非估算）

审计实跑 `vitest run --reporter=json`：扩展套件 **509 个测试通过 / 0 失败 / 127 个 suite**。项目文档写的 "506" 是静态 `it(` 调用数 —— `i18n-audit.test.js:122-123` 的 `for` 循环把 1 个 `it(` 展开成 4 个测试，故 506 − 1 + 4 = 509。

| 文件 | 行数 | 测试数 | 判定 |
| --- | --- | --- | --- |
| `extension/tests/ats-adapters.test.js` | 582 | 68 | 🔴 全删 |
| `extension/tests/normalize.test.js` | 472 | 82 | 🔴 全删 |
| `extension/tests/content.test.js` | 2,232 | 207 | 🟠 删 197（48 个纯 ATS 块 + 149 个填表引擎块），**保留 10**（`showToast` 5 + `autoTrackApplied` 5） |
| `extension/tests/background.test.js` | 595 | 41 | 🟠 删 7（`analyzeForm`×3、`getCustomQA`、startFill 快捷键、`broadcastStartFill`×2），保留 34 |
| `extension/tests/popup.test.js` | 436 | 19 | 🟠 删 6（Fill 按钮相关），保留 13 |
| `extension/tests/queue-fill.test.js` | 324 | 21 | 🟡 视队列去留（若队列降级为"待联系清单"，横幅块需重写） |
| `extension/tests/job-board-overlay.test.js` | 500 | 31 | 🟢 **最有价值，必须保留** —— 直接对应要复用到 BOSS 的角标子系统，**建议以此文件为模板新增 `boss-capture.test.js`** |
| `extension/tests/i18n.test.js` | 287 | 27 | 🟢 保留 |
| `extension/tests/i18n-audit.test.js` | 163 | 7 | 🟢 保留，**并扩展断言：不得出现 `$`、`EEO`、`work authorization` 残留** |
| `extension/tests/i18n-parity.test.js` | 113 | 6 | 🟢 **保留（唯一防线）** —— 校验 Web⇄扩展共享键逐字相同 + `app/errors.py` 错误码覆盖 |
| `app/static/tests/salary-calculator.test.js` | 186 | — | 🟠 整体重写（中国口径） |
| `app/static/tests/scrape.test.js` | 402 | — | 🟠 重写为扩展回传链路 |
| `app/static/tests/i18n-audit.test.js` | 192 | — | 🟢 保留 + 加术语断言 |
| `app/static/tests/{api,calendar,external-job,interviews,i18n,router,utils}.test.js` | — | — | 🟢 保留 |

**扩展测试结果**：**509 → 删 360 → 剩 149**（方案 A，激进）；若走方案 B（只删适配器，保留填表引擎）则剩 307。**推荐方案 A**。

**删除友好性（审计实测的有利条件）**：`job-board-overlay.test.js:11` 与 `queue-fill.test.js:11` **只加载 `content.js`**，不加载 `normalize.js`/`ats-adapters.js`，且 `content.js` 对两者都做了守卫（normalize：`:579,776,849,1308,1455`；adapters：`:2293`）。**只要保留守卫写法，删掉这两个文件不会连带打断角标与队列测试。**

**后端测试（679 个，pytest 实收）**：约 **250-265 个（37-39%）** 专测美国功能可整删。最大单项是 `tests/test_location_classifier.py` —— **102 个测试，占全套 15%**（15 个 `parametrize` 展开）；`tests/test_scrapers/` 14 个文件共 **101 个测试**。另有 9 个文件需改造（`test_phase4_backend.py` 19、`test_profile_extended.py` 18、`test_database.py` 15、`test_autofill_timeout.py` 7、`test_scraper_schedule.py` 4、`test_api.py` 24、`test_scheduler.py` 8、`test_stale_jobs.py` 12、`test_dedup.py` 4），**35 个文件完全不受影响**。

**⚠️ 两个必须保留的通用件**（易被误删）：`tests/test_circuit_breaker.py`(7) 与 `tests/test_rate_limiter.py`(10) —— 前者包的是 AI 客户端，后者只需改 `DOMAIN_LIMITS` 断言。

### 2.9 依赖（`pyproject.toml`，实测使用点）

| 依赖 | 使用点 | 判定 |
| --- | --- | --- |
| `feedparser>=6.0.0` | 1 个文件（美国 RSS 源） | 🔴 删除 |
| `aiosmtplib>=3.0.0` | 1 个文件（`emailer.py`） | 🟡 隐藏后可删 |
| `sqlite-vec>=0.1.6` | 1 个文件（`embeddings.py`） | 🟡 一期不做则删 |
| `anthropic[bedrock]` | 5 个文件 | 🟢 保留（降为可选 provider） |
| `openai` | 5 个文件 | 🟢 保留（DeepSeek/Qwen/Kimi 均兼容 OpenAI 协议 → **复用此客户端，无需新依赖**） |
| `beautifulsoup4` / `httpx` / `tenacity` | 多处 | 🟢 保留（扩展桥与 AI 重试仍需） |
| `pymupdf` / `python-docx` | 2-3 处 | 🟢 保留（中文简历 PDF/DOCX） |

---

## 3. 减法执行顺序（关键：顺序错了会返工）

审计暴露的耦合关系决定了必须按这个顺序做，否则会出现"改了三遍同一处"：

```
阶段 0：立规矩（先做，1-2 天）
  ① 定「枚举 vs 标签」铁律（障碍 C）→ 后端补 status 白名单校验
  ② 重写 utils.js 的 formatCurrency / formatSalary 为人民币月薪口径（障碍 A）
  ③ 扩展迁移框架支持删表/删列（或决定走 L1 惰性废弃）

阶段 1：删数据与源（低耦合，可并行）
  ④ 删 14 个美国源 + enrichment/browser_pool/location_classifier/
     salary_estimator/company_research/contact_finder/apply_link_finder
  ⑤ 删 scheduler 的 4 个任务
  ⑥ 删对应测试 + 依赖（feedparser 等）

阶段 2：前端减法（依赖阶段 0 的 formatCurrency）
  ⑦ 删 tax-data.js，整块删 detail.js 的 comp 区块（障碍 B，必须整块删不能留）
  ⑧ 删 settings.js 三张卡 + Bedrock 块（注意 7 处分支）
  ⑨ 删 feed.js 的地区/clearance 过滤器
  ⑩ 改 settings.js 外壳三处硬编码（障碍 D）

阶段 3：重写为能力（真正的活）
  ⑪ 扩展：删 ATS 全套，复用浮层机制搭 BOSS 采集
  ⑫ 后端：扩展桥 + 4 个国内 AI provider
  ⑬ 数据模型：月薪 + 城市分级 + 中国状态机
  ⑭ 新功能：M8 话术、M9 题库、M10 工资计算
```

**为什么阶段 0 必须在最前**：`formatCurrency` 被 30+ 处引用，如果先删视图再改金额函数，会对着"已经删掉一半"的调用点做两次改动。同理 `detail.js:148` 的状态比较 bug 如果不先立"枚举 vs 标签"规矩，中国版看板做完还是要推倒。

---

## 4. 减法后的产品形态（一屏看懂）

| 维度 | 删除前 | 删除后 |
| --- | --- | --- |
| 招聘平台 | 14 个美国源（`ALL_SCRAPERS` 注册 14，另 1 个死代码） | BOSS 直聘 1 个 |
| 采集方式 | 服务端定时爬取 | 用户浏览时扩展回传 |
| 采集触发 | 每 6/12 小时自动 | 用户点收藏时 |
| 定时任务 | **8 个注册 job** | 3 个（maintenance / reminder / alert） |
| 数据库表 | **39 张** | 约 26 张 |
| 用户画像列 | 40 个迁移列 | 约 26 个（含新增 9 个中国字段） |
| 薪资模型 | USD 年薪 + 50 州税 | CNY 月薪 + 五险一金 + 个税 |
| 投递方式 | 邮件 + 6 个美国 ATS 自动填表 | 站内沟通 + 话术生成 |
| 状态机 | 6 个美式阶段（**无后端校验**） | 11 个中国阶段（**含枚举校验**） |
| 扩展消息类型 | 22 个（19 background + 3 content） | 8 个 |
| 扩展代码 | 12,406 行 | 约 8,200 行（删约 4,200） |
| 扩展测试 | 509 个 | 149 个 |
| AI provider | 5 家国际 | 5 家国内 + 5 家国际 |
| 后端测试 | 679 个 | 约 420 个（删约 255） |
| 代码净减少 | — | **约 10,000-11,000 行**（含测试） |

---

## 5. 减法中的六个陷阱（审计实测）

| # | 陷阱 | 后果 | 规避 |
| --- | --- | --- | --- |
| 1 | `detail.js:918,1012` 的 `typeof calculateSalary === 'function'` 守卫 | 换薪资引擎后薪酬卡**静默消失**，看起来像"没做" | 整块删除 comp 区块（`:886-1087`），不留降级路径 |
| 2 | `renderTabProfile` 的 7 卡共用一次 `PUT /api/profile/full`（`:612-676`） | 删卡不同步改取值对象 → `getElementById(...).value` 抛 TypeError | 删卡必须同步改 `:612-676`；建议重构为按卡独立提交 |
| 3 | `settings.js` 三处硬编码（`:9-19`/`:29-38`/`:69-78`） | 删 tab 漏改一处 → 空 tab 或拉取无用接口 | 先重构为数据驱动（tab 定义含 loader），再删 |
| 4 | Bedrock 分支散布 7 处（`:1246,1266,1270-1286,1411-1424,1441,1458-1462,1548-1553`） | 删 Bedrock 漏一处 → provider 切换泄漏 | 用 `PROVIDER_MODELS` 单一配置源重构后再删 |
| 5 | `feed.js` clearance 过滤器散落 4 处（`:54-58,86,126,238`） | 删 UI 留参数 → 请求仍带 `clearance` | 一并删；后端 `GET /api/jobs` 同步移除该参数 |
| 6 | **`/resume/upload` 的 docx 假解析**（`settings.py:610-628`） | 上传"成功"但解析出乱码 → M5 地基就是坏的 | P0 必修：补 `python-docx` 分支 |

**⚠️ 反向陷阱：三个"看起来像美国件、实则不能删"的模块**

| 模块 | 误判 | 事实 |
| --- | --- | --- |
| `circuit_breaker.py` | "爬虫专用熔断器" | 它包的是 **AI 客户端**（`ai_client.py:16`），换 DeepSeek 仍需要 |
| `rate_limiter.py` | "爬虫专用限流器" | 被 `enrichment.py:8` 使用；**只需换掉 `:44-65` 的 `DOMAIN_LIMITS` 美国域名表** |
| `browser_pool.py` | "美国 ATS 浏览器池" | 是 Playwright **反爬池**（cookie 持久化 + stealth）；Indeed 是唯一消费者，可随其删除，**但其能力对未来服务端兜底有价值** |

---

## 6. 待确认（需你拍板）

| # | 问题 | 建议 | 影响 |
| --- | --- | --- | --- |
| S1 | `user_profile` 的 33 个美国列：走 L1 惰性废弃还是 L2 表重建？ | **L1**（一期），二期做 L2 | 迁移框架是否要先加删除能力 |
| S2 | 邮件/SMTP/Digest（约 120 行 + 3 个测试文件）：删除还是隐藏？ | **隐藏**（代码留、界面去） | 是否去掉 `aiosmtplib` 依赖 |
| S3 | `embeddings.py` + `sqlite-vec`（语义检索/相似职位）：一期真不做？ | **一期不做**，二期再评估 | 少 3 个定时任务、1 张表、1 个依赖；相似职位功能暂缺 |
| S4 | CRM 的 Call/Email 分支（175 行）：删还是留 Note？ | **留 Note，删 Call/Email 分支** | `getCrmFormHtml` 是共用函数，需重构后删 |
| S5 | `application_queue`（批量排队 + 审批流，12 处引用）：删还是改？ | **改造**：审批流对美国"代为申请"合理，中国站内沟通下应简化为"待联系清单" | 是否保留 `queue/approve-all` 等 11 个端点 |
| S6 | `user_references`（推荐人）：删除还是隐藏？ | **隐藏** | 中国社招基本不用 |
| S7 | `predictor.py`（成功预测）：一期做吗？ | **一期隐藏**，需累计历史才有意义 | 少一个 AI 端点 |
| S8 | 是否保留 `#/calculator` 独立路由，还是只留 offer 对比？ | **保留**（中国用户算到手工资是高频独立需求） | 路由与导航结构 |
