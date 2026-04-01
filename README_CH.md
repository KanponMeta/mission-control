# Mission Control 完整使用指南

## 📋 项目概览

**Mission Control** 是一个开源的 AI 智能体编排仪表盘，用于管理智能体舰队、追踪任务、监控成本和编排工作流。

- **项目名称**: Mission Control
- **版本**: 2.0.1
- **许可证**: MIT
- **仓库**: https://github.com/builderz-labs/mission-control

---

## 🏗️ 技术架构

### 技术栈

| 层级 | 技术 |
|------|------|
| **框架** | Next.js 16 (App Router) |
| **UI** | React 19, Tailwind CSS 3.4 |
| **语言** | TypeScript 5.7 |
| **数据库** | SQLite (better-sqlite3, WAL 模式) |
| **状态管理** | Zustand 5 |
| **图表库** | Recharts 3 |
| **实时通信** | WebSocket + Server-Sent Events (SSE) |
| **认证** | scrypt 哈希, 会话令牌, RBAC |
| **验证** | Zod 4 |
| **测试** | Vitest (282 单元测试) + Playwright (295 E2E) |

### 项目结构

```
mission-control/
├── src/
│   ├── app/                   # Next.js App Router 页面与 API 路由
│   │   ├── page.tsx          # SPA 壳 - 路由所有面板
│   │   ├── login/page.tsx    # 登录页面
│   │   └── api/              # 101 个 REST API 路由
│   ├── components/            # UI 面板和共享组件
│   │   ├── layout/           # NavRail, HeaderBar, LiveFeed
│   │   ├── dashboard/        # 概览仪表盘
│   │   ├── panels/           # 32 个功能面板
│   │   └── chat/             # 智能体聊天 UI
│   ├── lib/                  # 核心逻辑、数据库、工具
│   │   ├── auth.ts           # 会话 + API 密钥认证, RBAC
│   │   ├── db.ts             # SQLite (better-sqlite3, WAL 模式)
│   │   ├── schedule-parser.ts # 自然语言 → cron 表达式解析器
│   │   ├── scheduler.ts      # 后台任务调度器
│   │   ├── webhooks.ts       # 出站 webhook 交付
│   │   ├── websocket.ts      # 网关 WebSocket 客户端
│   │   ├── skill-sync.ts     # 双向磁盘 ↔ DB 技能同步
│   │   ├── security-events.ts # 安全事件记录器
│   │   └── adapters/         # 框架适配器 (openclaw, crewai, langgraph, autogen, claude-sdk, generic)
│   └── store/index.ts        # Zustand 状态管理
└── .data/                    # 运行时数据 (SQLite DB, 令牌日志)
```

### 核心特性

#### ✅ 已实现

1. **智能体管理**
   - 完整生命周期 (注册、心跳、唤醒、退役)
   - 多框架支持 (OpenClaw, CrewAI, LangGraph, AutoGen, Claude SDK)
   - 本地智能体发现 (`~/.agents/`, `~/.codex/agents/`, `~/.claude/agents/`)
   - 智能体 SOUL 系统 (个性、能力、行为指南)

2. **任务管理**
   - Kanban 看板 (6 列: 收件箱 → 分配 → 进行中 → 审查 → 质量审查 → 完成)
   - 拖放、优先级、分配、线程化注释
   - 多项目组织，每项目有票证前缀
   - 自然语言循环任务 ("每天早上 9 点" → cron 模板生成)

3. **监控 & 实时**
   - WebSocket + SSE 推送更新
   - 活动源、会话检查器、日志查看器
   - 32 个功能面板 (任务、智能体、技能、日志、令牌、内存等)

4. **成本追踪**
   - 令牌使用仪表盘，按模型分解
   - 趋势图表，成本分析
   - Claude Code 会话自动扫描

5. **安全**
   - 角色访问控制 (viewer, operator, admin)
   - 会话 + API 密钥认证
   - 安全审计面板，秘密检测
   - 技能安全扫描 (提示注入、凭证泄露、数据搜集)
   - Hook profiles (minimal/standard/strict)

6. **集成**
   - 出站 webhooks (重试、指数退避、断路器)
   - GitHub Issues 同步
   - 技能 Hub (ClawdHub, skills.sh 注册表)
   - Claude Code 会话追踪和任务桥接
   - 直接 CLI 集成 (无网关)

7. **高级**
   - 自然语言循环任务调度
   - 质量审查门
   - 管道编排
   - 智能体间消息传递
   - 内存知识图浏览器
   - 智能体评估框架 (4 层)
   - 智能体优化建议

---

## 🚀 快速开始

### 前置要求

- **Node.js** >= 22 (LTS 推荐) 或 24.x
- **pnpm** (通过 corepack 自动安装)
- **Git**

### 选项 1: Docker (推荐 - 最简单)

```bash
git clone https://github.com/builderz-labs/mission-control.git
cd mission-control
bash install.sh --docker
```

打开 `http://localhost:3000` 创建管理员账号。

**Docker Compose 零配置**:
```bash
docker compose up
```

⚠️ **重要: Docker 发现宿主机智能体**

由于 Docker 容器与宿主机文件系统隔离，默认情况下 Mission Control 无法发现本地智能体目录。如果你的智能体存储在 `~/.agents/`, `~/.codex/agents/` 或 `~/.claude/agents/` 中，需要配置卷挂载。

编辑 `docker-compose.yml` 中的 `volumes` 部分，挂载你的智能体目录：

```yaml
volumes:
  - mc-data:/app/.data
  # 替换 /home/your-user 为你的实际用户主目录
  - /home/your-user/.agents:/home/nextjs/.agents:ro
  - /home/your-user/.codex/agents:/home/nextjs/.codex/agents:ro
  - /home/your-user/.claude/agents:/home/nextjs/.claude/agents:ro
```

然后重启容器：
```bash
docker compose down
docker compose up -d
```

之后访问 Dashboard → Auto-detect 即可发现宿主机上的智能体。

### 选项 2: 本地安装

```bash
git clone https://github.com/builderz-labs/mission-control.git
cd mission-control

# 使用 nvm (可选)
nvm use 22

# 安装依赖
pnpm install

# 开发模式
pnpm dev
```

访问 `http://localhost:3000/setup` 创建管理员账号。

**首次运行**:
- `AUTH_SECRET` 和 `API_KEY` 会自动生成并保存到 `.data/`
- 访问设置页面创建管理员账户
- 或使用 env vars: `AUTH_USER` 和 `AUTH_PASS`

### 选项 3: Windows PowerShell

```powershell
git clone https://github.com/builderz-labs/mission-control.git
cd mission-control
.\install.ps1 -Mode local
```

选项: `-Port 8080`, `-SkipOpenClaw`

### 选项 4: 生产环境

**直接部署**:
```bash
pnpm install --frozen-lockfile
pnpm build
PORT=3000 pnpm start
```

**独立模式** (推荐用于 VPS):
```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start:standalone
```

**Docker 硬化** (生产):
```bash
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d
```

---

## 📖 使用方法

### 登录与认证

**3 种认证方式**:
1. **会话 Cookie** - 用户名/密码登录 (`/api/auth/login`)
2. **API 密钥** - 请求头 `x-api-key`
3. **Google Sign-In** - OAuth (需管理员批准)

**3 个角色**:
- **Viewer** - 只读访问
- **Operator** - 读 + 写 (任务、智能体、聊天)
- **Admin** - 完整访问 (用户、设置、系统)

### 核心工作流

#### 1. 连接网关 (可选)

进入 **Settings → Gateways** 添加 OpenClaw 网关:
- 主机、端口、令牌
- 支持多个网关

或启用独立模式 (无网关):
```bash
NEXT_PUBLIC_GATEWAY_OPTIONAL=true
```

#### 2. 注册智能体

**自动发现** (推荐):
- Dashboard → Auto-detect 扫描 `~/.agents/`, `~/.codex/agents/`, `~/.claude/agents/`

> **Docker 用户注意**: 如果你在 Docker 中运行 Mission Control，需要在 `docker-compose.yml` 中挂载本地智能体目录 (见上面的 Docker 配置部分)。

**手动注册**:
- 通过 UI 或 API: `POST /api/agents`
- 支持自注册: `POST /api/agents/register` (速率限制)

#### 3. 创建和管理任务

**Kanban 看板** (Task Board):
1. 创建任务: "Inbox" 列 → 拖到 "Assigned"
2. 分配给智能体或用户
3. 设置优先级、截止日期
4. 添加注释和子任务
5. 拖到 "Done" 完成 (需质量审查)

**创建循环任务** (natural language):
```
"每天上午 9 点"
"每 2 小时"
"工作日午夜"
```
系统自动解析为 cron，每次生成新的日期化子任务。

#### 4. 监控成本

**Token 使用**:
- Tokens → 查看按模型分解
- 趋势图表和成本分析
- Claude Code 会话自动追踪

#### 5. 技能管理

**Skills Hub**:
1. Settings → Skills
2. 浏览 ClawdHub 或 skills.sh 注册表
3. 安装前自动安全扫描
4. 支持本地技能和注册表技能

**支持的技能根目录**:
- `~/.agents/skills`
- `~/.codex/skills`
- `./.agents/skills` (项目本地)
- `./.codex/skills` (项目本地)
- `~/.openclaw/skills` (网关模式)

#### 6. 安全审计

**Security Audit 面板**:
- 信任评分 (0-100)
- 秘密检测 (AWS, GitHub, Stripe, JWT, PEM, DB URIs)
- MCP 工具调用审计
- Hook profiles: minimal/standard/strict

### 环境变量

**关键配置**:

| 变量 | 必需 | 默认值 | 描述 |
|------|------|--------|------|
| `AUTH_USER` | 否 | `admin` | 初始管理员用户名 |
| `AUTH_PASS` | 否 | - | 初始管理员密码 |
| `AUTH_PASS_B64` | 否 | - | Base64 编码密码 (覆盖 `AUTH_PASS`) |
| `API_KEY` | 否 | - | API 密钥 |
| `PORT` | 否 | `3005` (直接) / `3000` (Docker) | 服务器端口 |
| `OPENCLAW_CONFIG_PATH` | 否 | - | openclaw.json 的绝对路径 |
| `OPENCLAW_STATE_DIR` | 否 | `~/.openclaw` | OpenClaw 状态目录 |
| `OPENCLAW_GATEWAY_HOST` | 否 | `127.0.0.1` | 网关主机 |
| `OPENCLAW_GATEWAY_PORT` | 否 | `18789` | 网关 WebSocket 端口 |
| `NEXT_PUBLIC_GATEWAY_OPTIONAL` | 否 | - | 设置 `true` 启用独立模式 |
| `MC_ALLOWED_HOSTS` | 否 | `localhost,127.0.0.1` | 生产环境允许的主机 |
| `MC_TRUSTED_PROXIES` | 否 | - | 逗号分隔的受信任代理 IP |
| `MC_CLAUDE_HOME` | 否 | `~/.claude` | Claude 目录路径 |
| `MISSION_CONTROL_DATA_DIR` | 否 | `.data/` | 数据目录 |
| `MISSION_CONTROL_DB_PATH` | 否 | `.data/mission-control.db` | SQLite 数据库路径 |

**特殊情况**:
- `AUTH_PASS` 包含 `#` → 用引号: `AUTH_PASS="my#password"` 或使用 `AUTH_PASS_B64`
- 使用网关 → 设置 `OPENCLAW_CONFIG_PATH` 或 `OPENCLAW_STATE_DIR`
- Claude Code 集成 → 检查 `MC_CLAUDE_HOME` (默认 `~/.claude`)

---

## 🔧 开发和部署

### 开发命令

```bash
# 启动开发服务器
pnpm dev

# 生产构建
pnpm build

# 运行生产服务器
pnpm start

# 测试和质量检查
pnpm lint              # ESLint
pnpm typecheck         # TypeScript
pnpm test              # Vitest 单元测试
pnpm test:watch        # 监视模式
pnpm test:e2e          # Playwright E2E
pnpm test:all          # 完整检查 (lint + typecheck + test + build + e2e)
```

### 部署选项

| 选项 | 场景 | 命令 |
|------|------|------|
| **开发** | 本地开发 | `pnpm dev` |
| **直接** | 小型生产环境 | `pnpm start` |
| **独立** | VPS (推荐) | `pnpm start:standalone` |
| **Docker** | 容器化部署 | `docker compose up` |
| **Docker 硬化** | 生产容器 | `docker-compose -f docker-compose.yml -f docker-compose.hardened.yml up -d` |

### 构建输出

- **开发**: `localhost:3000`
- **生产**: `0.0.0.0:3005` (或 `PORT` env)
- **独立**: Next.js 独立服务器 (无 node_modules 依赖)
- **Docker**: `ghcr.io/builderz-labs/mission-control` 或 `docker.io/builderz-labs/mission-control`

### 数据持久化

**SQLite 数据库**:
- 位置: `.data/mission-control.db`
- WAL 模式启用
- 自动备份: Settings → Backup
- 环境变量: `MISSION_CONTROL_DB_PATH`

**Docker 卷**:
```bash
docker run -v mission-control-data:/app/.data ...
```

---

## 🛣️ API 参考

### 认证

| 方法 | 路径 | 描述 |
|------|------|------|
| `POST` | `/api/auth/login` | 登录 |
| `POST` | `/api/auth/google` | Google Sign-In |
| `POST` | `/api/auth/logout` | 登出 |
| `GET` | `/api/auth/me` | 当前用户信息 |

### 智能体

| 方法 | 路径 | 角色 | 描述 |
|------|------|------|------|
| `GET` | `/api/agents` | viewer | 列出智能体 |
| `POST` | `/api/agents` | operator | 注册/更新智能体 |
| `GET` | `/api/agents/[id]` | viewer | 智能体详情 |
| `POST` | `/api/agents/register` | viewer | 自注册 (速率限制) |
| `POST` | `/api/agents/sync` | operator | 从 openclaw.json 同步 |
| `GET/PUT` | `/api/agents/[id]/soul` | operator | 读写 SOUL 内容 |

### 任务

| 方法 | 路径 | 角色 | 描述 |
|------|------|------|------|
| `GET` | `/api/tasks` | viewer | 列出任务 (支持过滤) |
| `POST` | `/api/tasks` | operator | 创建任务 |
| `GET` | `/api/tasks/[id]` | viewer | 任务详情 |
| `PUT` | `/api/tasks/[id]` | operator | 更新任务 |
| `DELETE` | `/api/tasks/[id]` | admin | 删除任务 |
| `GET` | `/api/tasks/queue` | operator | 轮询下一个任务 |

### 监控

| 方法 | 路径 | 角色 | 描述 |
|------|------|------|------|
| `GET` | `/api/status` | viewer | 系统状态 |
| `GET` | `/api/activities` | viewer | 活动源 |
| `GET` | `/api/tokens` | viewer | 令牌使用和成本 |
| `GET` | `/api/sessions` | viewer | 活动网关会话 |

### 安全

| 方法 | 路径 | 角色 | 描述 |
|------|------|------|------|
| `GET` | `/api/security-audit` | admin | 安全信息、事件、信任评分 |
| `GET` | `/api/security-scan` | admin | 静态安全扫描 |

### 集成

| 方法 | 路径 | 角色 | 描述 |
|------|------|------|------|
| `GET/POST/PUT/DELETE` | `/api/webhooks` | admin | Webhook 管理 |
| `GET/POST/PUT/DELETE` | `/api/alerts` | admin | 告警规则 |
| `GET/POST/PUT/DELETE` | `/api/gateways` | admin | 网关连接 |

### Claude Code

| 方法 | 路径 | 角色 | 描述 |
|------|------|------|------|
| `GET` | `/api/claude/sessions` | viewer | 发现的会话 |
| `GET` | `/api/claude-tasks` | viewer | 团队任务和配置 |

### 技能

| 方法 | 路径 | 角色 | 描述 |
|------|------|------|------|
| `GET` | `/api/skills` | viewer | 列出技能 |
| `POST` | `/api/skills` | operator | 创建技能 |
| `GET` | `/api/skills/registry` | viewer | 搜索注册表 |
| `POST` | `/api/skills/registry` | admin | 安装技能 |

### 完整参考

参见 [README.md](README.md) 的 **API Reference** 部分了解所有 101+ 端点。

---

## 🔐 安全

### 认证

- **会话**: HTTP-Only cookies (`__Host-mc-session` 用于 HTTPS, `mc-session` 用于 HTTP), 7 天过期
- **API 密钥**: `x-api-key` 请求头
- **Google OAuth**: 需管理员批准的工作流

### 授权

- **RBAC**: viewer, operator, admin 角色
- **自作用域**: 智能体只能访问自己的数据 (默认)
- **管理员覆盖**: `?privileged=1` (认证后)

### 安全头

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=63072000 (生产)
```

### 秘密检测

自动扫描 AWS, GitHub, Stripe, JWT, PEM, 数据库 URI。

### 技能安全扫描

- 提示注入检测
- 凭证泄露检测
- 数据搜集检测
- 混淆内容检测
- 危险 shell 命令检测

### Hook Profiles

调整安全严格程度:
- **Minimal** - 基本检查
- **Standard** - 推荐 (默认)
- **Strict** - 最严格验证

### 生产检查清单

- [ ] 更改所有默认凭证 (`AUTH_USER`, `AUTH_PASS`, `API_KEY`)
- [ ] 启用 TLS (使用 Caddy, nginx 或其他反向代理)
- [ ] 设置 `MC_ALLOWED_HOSTS`
- [ ] 使用硬化 Docker compose
- [ ] 运行 `bash scripts/security-audit.sh`
- [ ] 查看 [SECURITY-HARDENING.md](docs/SECURITY-HARDENING.md)

---

## 🚨 故障排除

### Docker 特定问题

**Docker 容器无法发现宿主机的智能体**

问题: Mission Control 在 Docker 中运行时，Auto-detect 找不到 `~/.agents/`, `~/.codex/agents/` 等目录中的智能体。

原因: Docker 容器与宿主机文件系统隔离，容器内的应用无法访问宿主机的主目录。

解决方案:
1. 编辑 `docker-compose.yml`，在 `volumes` 中添加卷挂载：
```yaml
volumes:
  - mc-data:/app/.data
  - /home/your-user/.agents:/home/nextjs/.agents:ro
  - /home/your-user/.codex/agents:/home/nextjs/.codex/agents:ro
  - /home/your-user/.claude/agents:/home/nextjs/.claude/agents:ro
```

2. 替换 `/home/your-user` 为你的实际用户主目录：
```bash
# 获取你的主目录
echo $HOME
```

3. 重启容器：
```bash
docker compose down
docker compose up -d
```

4. 在 Dashboard 中运行 Auto-detect，验证是否发现智能体。

### 常见问题

**"Module not found: better-sqlite3"**
```bash
sudo apt-get install -y python3 make g++
rm -rf node_modules
pnpm install
```

**AUTH_PASS 包含 "#" 无法工作**
```bash
# 选项 1: 引号
AUTH_PASS="my#password"

# 选项 2: Base64
AUTH_PASS_B64=$(echo -n 'my#password' | base64)
```

**"Invalid ELF header" 或 "Mach-O" 错误**
```bash
# 平台不匹配，重新构建
rm -rf node_modules .next
pnpm install
pnpm build
```

**网关离线 (VPS 部署)**
```bash
# 启用独立模式
NEXT_PUBLIC_GATEWAY_OPTIONAL=true

# 或配置 WebSocket 反向代理
# 见 docs/deployment.md
```

**"Gateway error: origin not allowed"**
```json
{
  "gateway": {
    "controlUi": {
      "allowedOrigins": ["http://YOUR_HOST:3000"]
    }
  }
}
```

**数据库锁定错误**
- 确保只有一个实例写入 `.data/` 目录
- SQLite WAL 模式不支持多写入器

**"Database not initialized"**
```bash
# 删除数据目录强制重新初始化
rm -rf .data/
pnpm dev
```

### 诊断工具

```bash
# 运行诊断
bash scripts/station-doctor.sh

# 安全审计
bash scripts/security-audit.sh
```

---

## 📊 监控与维护

### 后台调度器

自动运行 (可配置):
- 数据库备份 (每小时)
- 陈旧记录清理 (每天)
- 智能体心跳监控 (每 5 分钟)
- 循环任务生成 (每分钟)
- Claude Code 会话扫描 (每 60 秒)
- 技能同步 (每 60 秒)

### 手动操作

**Settings → Cron**:
- 查看调度任务
- 禁用/启用任务
- 手动触发任务

**Settings → Backup**:
- 导出数据库
- 查看备份历史

**Settings → Cleanup**:
- 删除陈旧数据
- 清理孤立记录

### 性能

- SQLite WAL 模式
- 索引创建 (主键、外键)
- 分页 API (支持 limit/offset)
- 智能轮询 (离开时暂停)

---

## 🧩 集成

### Webhooks

**设置**:
1. Settings → Webhooks
2. 输入 URL、选择事件
3. 查看交付历史和重试

**支持的事件**:
- 任务更新
- 智能体状态变化
- 成本报告

**签名验证** (HMAC-SHA256):
```python
import hmac, hashlib
expected = hmac.new(
    API_KEY.encode(),
    payload.encode(),
    hashlib.sha256
).hexdigest()
```

### GitHub Issues 同步

**Settings → Integrations → GitHub**:
1. 输入仓库 (owner/repo)
2. 配置标签和分配人映射
3. 自动同步问题到任务看板

### 告警规则

**Settings → Alerts**:
- 创建自定义规则 (条件 + 操作)
- 冷却时间防止告警风暴
- 支持 webhooks 和邮件

---

## 📚 进阶主题

### Claude Code 集成

**自动发现会话**:
- 扫描 `~/.claude/projects/` (每 60 秒)
- 提取令牌使用、模型、消息计数、成本估计
- 在 Tokens 面板显示

**任务桥接**:
- 扫描 `~/.claude/tasks/<team>/<N>.json`
- 显示团队任务 (主题、状态、所有者、阻塞器)
- 只读集成 (任务看板中的可折叠部分)

### 直接 CLI 集成

无需网关直接连接:
```bash
POST /api/connect
```
支持 Claude Code, Codex 或自定义 CLI 工具。

### 内存知识图

**Memory Browser**:
- 文件系统导航 (`OPENCLAW_MEMORY_DIR`)
- 交互关系图
- 全局搜索

设置: `OPENCLAW_MEMORY_DIR=/path/to/agents/root`

### 工作负载信号

`GET /api/workload` 返回系统建议:
- `normal` - 健康，正常提交
- `throttle` - 降低提交速率
- `shed` - 仅提交关键任务
- `pause` - 暂停直到容量恢复

### 智能体评估框架

**4 层评估栈**:
1. **Output Evals** - 任务完成评分 (vs 黄金数据集)
2. **Trace Evals** - 收敛评分 (检测循环)
3. **Component Evals** - 工具可靠性 (延迟百分位数)
4. **Drift Detection** - 10% 阈值 vs 4 周基线

### 智能体优化

`GET /api/agents/optimize`:
- 令牌效率 (vs 舰队平均)
- 工具使用模式 (成功/失败率)
- 优先级建议
- 舰队基准

---

## 🎯 常见工作流

### 工作流 1: 设置新智能体

1. **智能体注册**
   - 自动发现: Dashboard → Auto-detect
   - 或手动: UI 或 `POST /api/agents`

2. **配置 SOUL**
   - Agent Panel → SOUL 选项卡
   - 定义个性、能力、行为指南

3. **分配技能**
   - Agent Panel → Skills
   - 安装或创建新技能

4. **监控心跳**
   - Agents Panel → 查看心跳状态
   - 设置警报规则

### 工作流 2: 创建和执行任务

1. **创建任务**
   - Task Board → "+ New Task"
   - 填写标题、描述、优先级

2. **分配任务**
   - 拖到 "Assigned"
   - 选择智能体或用户

3. **任务进行中**
   - 拖到 "In Progress"
   - 添加注释，关联日志

4. **质量审查**
   - 拖到 "Quality Review"
   - 管理员审核并批准
   - 拖到 "Done" 完成

### 工作流 3: 循环任务

1. **创建模板**
   - New Task → 标题 "Daily Report" (模板)
   - 设置循环: "Every day at 9am"

2. **自动生成**
   - 系统自动生成日期化子任务
   - 每个子任务独立质量门

3. **监控**
   - Cron Management 查看计划任务
   - 调整/禁用 (Settings → Cron)

### 工作流 4: 成本追踪

1. **实时监控**
   - Tokens Panel → 查看按模型分解
   - 趋势图表和成本分析

2. **Claude Code 集成**
   - 自动追踪本地会话
   - 成本估计和聚合

3. **导出报告**
   - Settings → Export
   - 生成 CSV 成本报告

### 工作流 5: 技能安全检查

1. **浏览注册表**
   - Skills Panel → 搜索
   - 查看安全评分

2. **安装前扫描**
   - 自动检查提示注入、凭证泄露
   - 查看详细报告

3. **管理已安装**
   - Edit 内容 (UI 或磁盘)
   - 双向同步

---

## 📞 支持和反馈

- **GitHub Issues**: https://github.com/builderz-labs/mission-control/issues
- **安全报告**: 见 [SECURITY.md](SECURITY.md)
- **贡献**: 见 [CONTRIBUTING.md](CONTRIBUTING.md)

---

## 📝 约定

- **提交**: 使用 Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`)
- **包管理器**: 仅 pnpm (不支持 npm/yarn)
- **图标**: 原始文本/emoji (无图标库)
- **输出**: Next.js 独立模式 (`output: 'standalone'`)
- **无 AI 署名**: 不添加 `Co-Authored-By` 或类似的提交预告

---

## 📄 许可证

MIT © 2026 [Builderz Labs](https://github.com/builderz-labs/mission-control)

---

**最后更新**: 2026-03-19
**版本**: 2.0.1
