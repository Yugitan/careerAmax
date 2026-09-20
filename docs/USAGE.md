# CareerPulse 使用文档

CareerPulse 是一个自托管的求职作战台：你在招聘平台上正常浏览，浏览器扩展把职位（含 JD 全文）回传到本地服务，AI 根据简历进行匹配和评分，生成针对职位的中文简历与求职信，并通过 CRM 管道管理每一份申请。

本文面向第一次部署和使用 CareerPulse 的用户。项目介绍、架构说明和完整 API 列表请参考根目录的 [README.md](../README.md)。

## 1. 准备环境

推荐使用 Docker：

- Docker Engine
- Docker Compose v2（命令为 `docker compose`）
- Chrome 或 Chromium（使用浏览器扩展时需要）

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

进入 **设置 → 个人资料**，填写姓名、邮箱、电话、地点等信息；在 **工作经历** 中补充工作经历、教育背景、技能、证书和语言。

这些信息会用于简历分析、职位匹配和浏览器扩展自动填表。请先保存资料，再使用自动填表功能。

### 3.2 配置 AI

进入 **设置 → AI 服务商**，选择一个 AI Provider，然后点击 **测试连接**。

支持的 Provider：

| Provider | 必需配置 | 适用场景 |
| --- | --- | --- |
| Anthropic | API Key | Claude 模型 |
| AWS Bedrock | AWS 凭证和 Region | AWS 环境 |
| OpenAI | API Key | GPT 模型 |
| Google | API Key | Gemini 模型 |
| OpenRouter | API Key | 多种第三方模型 |
| Ollama | 本地 Ollama 地址和模型 | 完全本地运行 |

AI 用于简历分析、职位评分、申请材料生成、表单字段映射等功能。没有配置 AI 时，应用仍可以保存资料和职位，但无法完成这些 AI 操作。

使用 Ollama 时，默认地址为 `http://localhost:11434`。如果 CareerPulse 在 Docker 中运行，程序会自动将这个地址转换为 `host.docker.internal`，前提是宿主机上的 Ollama 正在运行并监听可访问地址。

### 3.3 上传简历

进入 **设置 → 简历管理** 或首次启动向导，上传简历。支持：

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

进入 **设置 → 求职意向**，检查或修改：

- 搜索关键词和目标职位
- 排除关键词

也可以在职位列表使用搜索框、匹配分、工作方式、雇佣类型和发布时间筛选器，并保存为 Saved View 或 Job Alert。

## 4. 日常使用流程

推荐的工作流如下：

1. 安装 Chrome 扩展（见第 5 节），在招聘平台的职位页上把职位保存进 CareerPulse。
2. 等待 AI 评分完成（也可以在 Jobs 页面手动触发重新评分）。
3. 按匹配分、工作方式、发布时间等筛选职位，结合匹配理由与技能缺口判断值不值得聊。
4. 点击职位卡片查看职位详情、匹配理由、技能缺口和薪资信息（月薪人民币口径）。
5. 点击 **准备申请** 生成针对该职位的简历和求职信，下载 PDF 或 DOCX。
6. 在职位详情或 **看板（Pipeline）** 中更新申请状态、记录备注和跟进事件。

### 4.1 主要页面

| 页面 | 用途 |
| --- | --- |
| 职位列表 | 浏览、筛选、比较、保存和准备职位 |
| 统计 | 查看申请漏斗、转化率、技能缺口和预测 |
| 看板 | 按申请阶段拖拽管理职位 |
| 日历 | 查看面试轮次和申请相关日程，可订阅 iCal |
| 待联系清单 | 挑出待沟通职位，扩展按顺序带你逐个处理 |
| 人脉 | 管理招聘经理、面试官和其他联系人 |
| 设置 | 管理个人资料、简历、求职意向、提醒和数据 |

### 4.2 待联系清单

在职位列表中把职位加入待联系清单，然后从扩展按顺序逐个打开和处理。CareerPulse **不会自动提交**任何申请；每一步都需要你确认。

### 4.3 面试和 Offer

申请后可以在职位详情中记录多个面试轮次、面试官、时间和结果。面试官可以一键存入 **人脉** CRM。Offer 信息可以在统计页录入并使用 Offer 对比功能比较总包（月薪、年终奖、股权、签字费、年假）。

## 5. Chrome 扩展

扩展负责在招聘平台页面上回传职位、显示匹配分角标和保存按钮，并用 AI 辅助填写申请表单。

### 安装

1. 确认 CareerPulse 正在运行。
2. 在 Chrome 打开 `chrome://extensions/`。
3. 打开右上角的 **开发者模式**。
4. 点击 **加载已解压的扩展程序**。
5. 选择仓库中的 `extension/` 目录。

### 使用

1. 打开招聘平台的职位页或申请表单。
2. 点击浏览器工具栏中的 CareerPulse 图标。
3. 确认 Server URL，默认是 `http://localhost:8085`。
4. 点击 **填表**。
5. 检查自动填写结果：绿色字段通常置信度较高，黄色字段需要人工确认。
6. 仔细检查所有字段后，再由用户手动提交表单。

扩展会读取表单字段并请求 CareerPulse 分析映射关系。请不要在不信任的公共电脑上使用，也不要把 API Key 填入招聘网站表单。

如果使用远程 CareerPulse 地址，需要将该地址加入 `extension/manifest.json` 的 `host_permissions`，然后在 `chrome://extensions/` 中重新加载扩展。

### 悬浮面板与按钮状态

打开支持的招聘站点（如 BOSS 直聘）时，页面上会自己浮出一块面板，不用再去点工具栏图标：连接状态、**填写申请表**、**一键抓取**、打开设置都在这里。面板可以拖（表头就是把手）、可以收起，位置与收起状态记在本地，下次打开还在原地；点 ✕ 只关掉当前这个页面。

**「填写申请表」什么时候是灰的**，只有两种情况：

1. 连不上 CareerPulse —— 面板顶部的状态行是红点，服务起来后面板会自己复检；
2. 当前页面确实没有可填写的申请表（招聘列表页，或者 BOSS 这类只能聊天沟通的页面）—— 按钮置灰并说明「本页没有可填写的申请表」。

工具栏弹窗里的按钮与面板同一判据、同一时刻一致。如果表单是点了「立即申请」之后才出现的，页面一变，按钮会自己变蓝，不需要刷新或重开面板。

**「一键抓取」这一行同时是进度牌**：抓取途中显示「已回传 X/N」，抓完把最终结果留几秒，再退回「抓取本页 N 个岗位」；页面上没有职位列表时置灰，并提示先打开列表页。网页上的「立即抓取」、面板这一行、弹窗里的「立即抓取」共用同一条执行链路，看到的进度一致。

## 6. 可选集成

### 6.1 邮件和每日摘要

在 **设置 → 集成** 中填写 SMTP Host、Port、用户名、密码、发件地址和收件地址，然后点击 **发送测试邮件** 验证配置。

配置完成后可以启用每日职位摘要，并设置发送时间和最低匹配分。发送时间以运行 CareerPulse 的服务器时间为准。未配置 SMTP 时，摘要任务会自动跳过。

## 7. 自动任务

应用启动后会运行后台调度任务：

| 任务 | 默认频率 |
| --- | --- |
| AI 评分 | 每 1 小时 |
| 数据维护 | 每 24 小时 |
| 跟进提醒 | 每 12 小时 |
| 邮件摘要 | 每天 08:00，配置 SMTP 后生效 |
| Job Alert 检查 | 每 1 小时 |

> 职位数据由浏览器扩展在用户浏览时回传，服务端不再定时集中抓取。

## 8. 配置文件和数据

环境变量统一使用 `JOBFINDER_` 前缀。常用配置如下：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `JOBFINDER_DB_PATH` | `data/jobfinder.db` | SQLite 数据库路径 |
| `JOBFINDER_RESUME_PATH` | `data/resume.txt` | 默认简历文本路径 |
| `JOBFINDER_HOST` | `0.0.0.0` | 服务监听地址 |
| `JOBFINDER_PORT` | `8085` | 服务端口 |
| `JOBFINDER_ANTHROPIC_API_KEY` | 空 | 默认 AI Key，可改在网页中配置其他服务商 |

优先使用网页设置保存 AI 和资料配置；`.env` 适合部署时设置基础环境变量。

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

网页的 **设置 → 数据管理** 还支持导出 Profile JSON 和职位 CSV。数据库备份建议保留多份，并与 `.env` 分开保护；不要将包含 API Key 的 `.env` 提交到 Git。

## 10. API 和健康检查

启动后可访问：

- Swagger UI：<http://localhost:8085/docs>
- ReDoc：<http://localhost:8085/redoc>
- 健康检查：<http://localhost:8085/api/health>

示例：

```bash
curl http://localhost:8085/api/health
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

## 12. 常见问题

### 页面打不开

检查容器和端口：

```bash
docker compose ps
docker compose logs --tail=200 careerpulse
curl http://localhost:8085/api/health
```

如果端口冲突，修改 `docker-compose.yml` 左侧端口，例如 `8090:8085`，然后访问 <http://localhost:8090>。

### 职位没有匹配分数

确认已经上传简历并在 **AI 服务商** 中配置 AI Provider。可以点击 **测试连接**，修复连接后在职位列表触发重新评分。

### Ollama 无法连接

先确认宿主机上的 Ollama 正常运行，并检查模型是否已下载：

```bash
ollama list
curl http://localhost:11434/api/tags
```

在 Docker 中不要把 Ollama 服务地址写成容器内部不存在的地址；通常使用 `http://localhost:11434` 即可让 CareerPulse 自动转换。

### 扩展提示无法连接服务器

确认扩展中的 Server URL 与 CareerPulse 地址一致，先在浏览器访问该地址的 `/api/health`。修改扩展代码或 Manifest 后，需要在 `chrome://extensions/` 点击 **重新加载**。

### 需要清空数据

优先使用 **设置 → 数据管理**。API 还提供 `POST /api/clear-jobs` 和 `POST /api/clear-all`；后者是完整重置，会删除所有资料、职位和配置，执行前请先备份 `data/`。
