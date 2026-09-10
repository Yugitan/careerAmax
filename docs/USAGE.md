# CareerPulse 使用文档

CareerPulse 是一个自托管的求职管理工具：它可以抓取多个招聘网站的职位，根据简历进行 AI 匹配和评分，生成针对职位的简历与求职信，并通过 Chrome 扩展辅助填写申请表单。

本文面向第一次部署和使用 CareerPulse 的用户。项目介绍、架构说明和完整 API 列表请参考根目录的 [README.md](../README.md)。

## 1. 准备环境

推荐使用 Docker：

- Docker Engine
- Docker Compose v2（命令为 `docker compose`）
- Chrome 或 Chromium（仅使用自动填表扩展时需要）

本地运行需要：

- Python 3.12 或更高版本
- [uv](https://docs.astral.sh/uv/)
- Node.js 和 npm（仅运行前端或扩展测试时需要）

## 2. 启动项目

### 2.1 Docker 启动（推荐）

在项目根目录执行：

```bash
cp .env.example .env
docker compose up -d --build
```

打开 <http://localhost:8085>。查看容器状态和日志：

```bash
docker compose ps
docker compose logs -f careerpulse
```

停止服务：

```bash
docker compose down
```

`docker-compose.yml` 将本地 `data/` 挂载到容器中的 `/app/data`，因此停止或重新构建容器不会自动删除数据库和简历文件。

### 2.2 本地启动

```bash
cp .env.example .env
uv run uvicorn app.main:create_app --factory --reload --host 0.0.0.0 --port 8085
```

如果端口被占用，可以通过环境变量修改端口：

```bash
JOBFINDER_PORT=8090 uv run uvicorn app.main:create_app --factory --reload --host 0.0.0.0 --port 8090
```

## 3. 首次配置

首次打开网页后，建议按以下顺序配置：

### 3.1 填写个人资料

进入 **Settings → Profile**，填写姓名、邮箱、电话、地点、链接等信息；在 **Work History** 中补充工作经历、教育背景、技能、证书和语言。

这些信息会用于简历分析、职位匹配和浏览器扩展自动填表。请先保存资料，再使用自动填表功能。

### 3.2 配置 AI

进入 **Settings → AI & Integrations**，选择一个 AI Provider，然后点击 **Test Connection**。

支持的 Provider：

| Provider | 必需配置 | 适用场景 |
| --- | --- | --- |
| Anthropic | API Key | Claude 模型 |
| OpenAI | API Key | GPT 模型 |
| Google | API Key | Gemini 模型 |
| OpenRouter | API Key | 多种第三方模型 |
| AWS Bedrock | AWS 凭证和 Region | AWS 环境 |
| Ollama | 本地 Ollama 地址和模型 | 完全本地运行 |

AI 用于简历分析、职位评分、应用材料生成、表单字段映射等功能。没有配置 AI 时，应用仍可以保存资料和职位，但无法完成这些 AI 操作。

使用 Ollama 时，默认地址为 `http://localhost:11434`。如果 CareerPulse 在 Docker 中运行，程序会自动将这个地址转换为 `host.docker.internal`，前提是宿主机上的 Ollama 正在运行并监听可访问地址。

### 3.3 上传简历

进入 **Settings → Profile** 或首次启动向导，上传简历。支持：

- PDF
- TXT
- Markdown
- DOC、DOCX
- RTF

单个文件最大 10 MB。上传后，CareerPulse 会尝试生成：

- ATS 兼容性评分
- 推荐职位名称
- 搜索关键词
- 关键技能
- 简历摘要
- 结构化的个人资料、工作经历和教育信息

分析完成后，请检查自动解析的内容，尤其是联系方式、日期、技能和工作经历。

### 3.4 设置求职搜索条件

进入 **Settings → Job Search**，检查或修改：

- 搜索关键词和目标职位
- 排除关键词
- 允许的地区
- 是否只看远程职位
- 薪资和时薪过滤条件
- Clearance/Visa 相关职位过滤条件

也可以在 **Jobs** 页面使用搜索框、分数、工作方式、雇佣类型、地点、地区、发布时间和 clearance 筛选器，并保存为 Saved View 或 Job Alert。

## 4. 日常使用流程

推荐的工作流如下：

1. 在 **Jobs** 页面点击 **Scrape Now**，抓取职位并进行后续处理。
2. 等待抓取、详情补全、地点分类和 AI 评分完成。
3. 按匹配分数、工作方式、地点和发布时间筛选职位。
4. 点击职位卡片查看职位详情、匹配理由、技能缺口、薪资和公司信息。
5. 点击 **Prepare Application** 生成针对该职位的简历和求职信。
6. 下载 PDF 或 DOCX，打开职位原始链接完成申请。
7. 在职位详情或 **Pipeline** 中更新申请状态、记录备注和跟进事件。

### 4.1 主要页面

| 页面 | 用途 |
| --- | --- |
| Jobs | 浏览、筛选、比较、保存和准备职位 |
| Dashboard | 查看职位统计、申请转化、技能缺口和预测 |
| Pipeline | 按申请阶段管理职位 |
| Calendar | 查看面试轮次和申请相关日程，可订阅 iCal |
| Queue | 批量准备申请材料并按顺序处理 |
| Network | 管理招聘经理、面试官和其他联系人 |
| Calculator | 比较 W2、1099、C2C 和不同 offer 的收入 |
| Settings | 管理个人资料、简历、搜索条件、集成和数据 |

### 4.2 申请队列

在职位详情中点击 **Add to Queue**，然后进入 **Queue** 页面批量准备申请材料。队列会按顺序处理，并在每个申请页面等待人工确认；CareerPulse 不会自动提交申请。

### 4.3 面试和 Offer

申请后可以在职位详情中记录多个面试轮次、面试官、时间和结果。面试官可以保存到 **Network**。Offer 信息可以在 Dashboard 中录入并使用 Offer Comparison 比较总薪酬和生活成本差异。

## 5. Chrome 自动填表扩展

扩展支持 Workday、Greenhouse、Lever、iCIMS、Taleo、Google Forms 等常见表单，也会在部分招聘网站显示保存按钮和匹配分数。

### 安装

1. 确认 CareerPulse 正在运行。
2. 在 Chrome 打开 `chrome://extensions/`。
3. 打开右上角的 **Developer mode**。
4. 点击 **Load unpacked**。
5. 选择仓库中的 `extension/` 目录。

### 使用

1. 打开职位申请页面。
2. 点击浏览器工具栏中的 CareerPulse 图标。
3. 确认 Server URL，默认是 `http://localhost:8085`。
4. 点击 **Fill Application**。
5. 检查自动填写结果：绿色字段通常置信度较高，黄色字段需要人工确认。
6. 仔细检查所有字段后，再由用户手动提交表单。

扩展会读取表单字段并请求 CareerPulse 分析映射关系。请不要在不信任的公共电脑上使用，也不要把 API Key 填入招聘网站表单。

如果使用远程 CareerPulse 地址，需要将该地址加入 `extension/manifest.json` 的 `host_permissions`，然后在 `chrome://extensions/` 中重新加载扩展。

## 6. 可选集成

### 6.1 招聘网站 API Key

进入 **Settings → AI & Integrations → Scraper API Keys**，可以配置：

- USAJobs API Key 和注册邮箱
- Adzuna App ID 和 App Key
- JSearch/RapidAPI Key

这些配置是可选的；没有 Key 时，其他不依赖该 Key 的来源仍可运行。

### 6.2 邮件和每日摘要

在 **Settings → AI & Integrations → Email & Digest Settings** 中填写 SMTP Host、Port、用户名、密码、发件地址和收件地址，然后点击 **Send Test Email** 验证配置。

配置完成后可以启用每日或每周职位摘要，并设置发送时间和最低匹配分数。发送时间以运行 CareerPulse 的服务器时间为准。

### 6.3 语义搜索和相似职位

在 **Embedding Settings** 中选择 OpenAI 或 Ollama 的 embedding 模型并保存，然后使用 **Backfill Embeddings** 为已有职位生成向量。该功能是可选的，适合需要语义搜索和相似职位推荐的场景。

## 7. 自动任务

应用启动后会运行后台调度任务：

| 任务 | 默认频率 |
| --- | --- |
| 抓取职位 | 每 6 小时，可通过 `JOBFINDER_SCRAPE_INTERVAL_HOURS` 修改 |
| 补全职位详情 | 每 2 小时 |
| AI 评分 | 每 1 小时 |
| 数据维护 | 每 24 小时 |
| 跟进提醒 | 每 12 小时 |
| 邮件摘要 | 每天 08:00，启用后生效 |
| Job Alert 检查 | 每 1 小时 |
| Embedding 生成 | 每 2 小时，启用后生效 |

手动点击 **Scrape Now** 会立即启动一次抓取、补全和评分流程。抓取期间可以在页面中查看进度或取消任务。

## 8. 配置文件和数据

环境变量统一使用 `JOBFINDER_` 前缀。常用配置如下：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `JOBFINDER_DB_PATH` | `data/jobfinder.db` | SQLite 数据库路径 |
| `JOBFINDER_RESUME_PATH` | `data/resume.txt` | 默认简历文本路径 |
| `JOBFINDER_SCRAPE_INTERVAL_HOURS` | `6` | 自动抓取间隔 |
| `JOBFINDER_MIN_SALARY` | `150000` | 年薪职位最低薪资过滤值 |
| `JOBFINDER_MIN_HOURLY_RATE` | `95` | 时薪职位最低时薪过滤值 |
| `JOBFINDER_HOST` | `0.0.0.0` | 服务监听地址 |
| `JOBFINDER_PORT` | `8085` | 服务端口 |
| `JOBFINDER_ANTHROPIC_API_KEY` | 空 | Anthropic API Key，可改在网页中配置 |
| `JOBFINDER_USAJOBS_API_KEY` | 空 | USAJobs API Key |

优先使用网页 Settings 保存 AI、爬虫 Key、邮件和 Profile 配置；`.env` 适合部署时设置基础环境变量。

## 9. 备份和恢复

Docker 部署时，重要数据位于项目目录的 `data/`：

```text
data/
├── jobfinder.db
└── resume.txt
```

停止写入后备份整个目录即可：

```bash
docker compose stop
cp -a data data.backup
docker compose start
```

网页的 **Settings → Data Management** 还支持导出 Profile JSON 和职位 CSV。数据库备份建议保留多份，并与 `.env` 分开保护；不要将包含 API Key 的 `.env` 提交到 Git。

## 10. API 和健康检查

启动后可访问：

- Swagger UI：<http://localhost:8085/docs>
- ReDoc：<http://localhost:8085/redoc>
- 健康检查：<http://localhost:8085/api/health>

示例：

```bash
curl http://localhost:8085/api/health
curl -X POST http://localhost:8085/api/scrape
curl http://localhost:8085/api/scrape/progress
curl -o jobs.csv http://localhost:8085/api/export/csv
```

## 11. 开发和测试

运行后端测试：

```bash
uv run pytest
```

运行前端测试：

```bash
cd app/static
npm install
npx vitest run
```

运行扩展测试：

```bash
cd extension
npm install
npx vitest run
```

如果需要浏览器自动化相关能力，可安装可选依赖和 Chromium：

```bash
uv sync --extra playwright
uv run playwright install chromium
```

## 12. 常见问题

### 页面打不开

检查容器和端口：

```bash
docker compose ps
docker compose logs --tail=200 careerpulse
curl http://localhost:8085/api/health
```

如果端口冲突，修改 `docker-compose.yml` 左侧端口，例如 `8090:8085`，然后访问 <http://localhost:8090>。

### 职位抓取为空

确认 **Settings → Job Search** 中已经有搜索词；检查过滤条件是否过窄；然后查看日志中各 scraper 的错误。部分招聘网站有反爬或访问限制，单个来源失败不会阻止其他来源继续运行。

### 职位没有匹配分数

确认已经上传简历并在 **AI & Integrations** 中配置 AI Provider。可以点击 **Test Connection**，修复连接后再点击 **Scrape Now** 或重新评分。

### Ollama 无法连接

先确认宿主机上的 Ollama 正常运行，并检查模型是否已下载：

```bash
ollama list
curl http://localhost:11434/api/tags
```

在 Docker 中不要把 Ollama 服务地址写成容器内部不存在的地址；通常使用 `http://localhost:11434` 即可让 CareerPulse 自动转换。

### 扩展提示无法连接服务器

确认扩展中的 Server URL 与 CareerPulse 地址一致，先在浏览器访问该地址的 `/api/health`。修改扩展代码或 Manifest 后，需要在 `chrome://extensions/` 点击 **Reload**。

### 需要清空数据

优先使用 **Settings → Data Management**。API 还提供 `POST /api/clear-jobs` 和 `POST /api/clear-all`；后者是完整重置，会删除所有资料、职位和配置，执行前请先备份 `data/`。
