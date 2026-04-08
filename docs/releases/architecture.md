# Mission Control 系统架构

最后更新: 2026-04-08

## 概述

Mission Control 是一个开源的 AI Agent 编排控制台，基于 **Next.js 16 (App Router)** 构建。提供 Agent 舰队管理、任务调度与自动化质量审核、实时可观测性、成本追踪及多租户工作空间隔离等能力。所有数据存储于本地 SQLite，面向自托管部署场景设计。

## 技术栈

| 层级 | 技术选型 |
|------|---------|
| 前端框架 | React 19, TypeScript 5, Tailwind CSS 3, Radix UI |
| 状态管理 | Zustand 5 |
| 应用框架 | Next.js 16 (App Router, standalone 输出) |
| 数据库 | SQLite via better-sqlite3 (WAL 模式) |
| Agent 引擎 | Claude Agent SDK, OpenClaw Gateway |
| 实时通信 | WebSocket (ws), Server-Sent Events |
| 可视化 | React Flow, Reagraph (WebGL) |
| 日志 | Pino |
| 包管理 | pnpm |
| 运行时 | Node.js >= 22 |

## 分层架构

```
                        +-----------------------+
                        |     浏览器 / 客户端     |
                        |  30+ 管理面板 (React)   |
                        |  Zustand 状态管理       |
                        |  WebSocket + SSE       |
                        +-----------+-----------+
                                    |
                        +-----------v-----------+
                        |   Next.js API 路由层   |
                        |   (/api/*)            |
                        |   认证 + RBAC 鉴权     |
                        +-----------+-----------+
                                    |
                 +------------------+------------------+
                 |                                     |
     +-----------v-----------+           +-------------v-----------+
     |     核心业务库         |           |   Agent 后端抽象层       |
     |   db.ts, auth.ts,     |           |   (agent-backend.ts)    |
     |   scheduler.ts,       |           +------+----------+-------+
     |   event-bus.ts,       |                  |          |
     |   webhooks.ts         |        +---------v--+  +----v-----------+
     +-----------+-----------+        | Agent SDK  |  | OpenClaw       |
                 |                    | (Claude    |  | Gateway        |
                 |                    |  API)      |  | (CLI RPC /     |
     +-----------v-----------+        +------------+  |  WebSocket)    |
     |   SQLite 数据库        |                        +----------------+
     |   (.data/)            |
     +---+---+---+---+------+
         |   |   |   |
    tasks agents users audit ...
```

## 数据库层

### 连接配置

- 路径: `$MISSION_CONTROL_DB_PATH` 或 `.data/mission-control.db`
- 模式: WAL (Write-Ahead Logging)，支持并发读取
- Pragmas: `foreign_keys=ON`, `busy_timeout=5000`, `cache_size=1000`
- 启动时自动运行迁移 (`src/lib/migrations.ts`)

### 核心表

| 表名 | 用途 |
|------|------|
| `tasks` | 看板任务管理，状态流转: inbox -> assigned -> in_progress -> review -> quality_review -> done |
| `agents` | Agent 注册表: 名称、状态、后端类型、会话密钥、配置 (JSON) |
| `users` / `user_sessions` | 用户认证、角色、会话令牌 |
| `quality_reviews` | Aegis 质量门禁审核记录 (approved/rejected) |
| `comments` | 任务讨论线程，支持 @提及 |
| `activities` | 活动事件流 |
| `notifications` | @提及通知和状态变更通知 |
| `token_usage` | API 调用成本追踪 (按 Agent/任务) |
| `audit_log` | 安全审计日志 (登录、变更、Agent 操作) |
| `workspaces` / `tenants` | 多租户工作空间隔离 |
| `webhook_deliveries` | 出站 Webhook 投递记录 |
| `task_subscriptions` | Agent 对任务通知的订阅关系 |
| `mcp_call_log` | 工具调用审计记录 |
| `projects` / `project_agent_assignments` | 项目级工作空间组织 |

## Agent 后端抽象层

Agent 后端层 (`src/lib/agent-backend.ts`) 对两种执行引擎提供统一接口:

```typescript
interface AgentBackend {
  dispatch(prompt, options?) -> QueryResult
  sendMessage(sessionKey, message, options?) -> QueryResult
  killSession(sessionKey) -> void
  getHistory(sessionKey) -> Messages[]
  stream?(prompt, options?) -> AsyncGenerator<StreamEvent>
}
```

### Agent SDK 后端 (`src/lib/agent-sdk.ts`)

主要后端，使用 `@anthropic-ai/claude-agent-sdk`。

- **模型分层**: `light` (Haiku) / `default` (Sonnet) / `heavy` (Opus) 三级路由
- **会话持久化**: 本地磁盘 JSONL 文件
- **会话恢复**: 通过 `resume` 标志重新进入已有会话
- **流式响应**: `runAgentStream()` 支持 SSE 实时输出
- **约束限制**: 默认最大 30 轮对话，$5 USD 预算上限 (可配置)

### OpenClaw 后端

网关模式下的遗留后端。

- 通过 CLI 调用网关 RPC: `openclaw gateway call <method> --json`
- 不支持流式响应
- 当 Agent 配置指定 `backend: 'openclaw'` 时启用
- 保留用于基础设施管理路由 (诊断、更新、备份)

### 环境变量配置 (`src/lib/config.ts`)

```
Agent SDK:
  AGENT_SDK_API_KEY           Anthropic API 密钥 (必填)
  AGENT_SDK_BASE_URL          API 端点 (默认: https://api.anthropic.com)
  AGENT_SDK_MODEL             默认模型 (claude-sonnet-4-6)
  AGENT_SDK_MODEL_LIGHT       轻量模型 (claude-haiku-4-5)
  AGENT_SDK_MODEL_HEAVY       重型模型 (claude-opus-4-6)
  AGENT_SDK_MAX_TURNS         每次调用最大轮次 (30)
  AGENT_SDK_MAX_BUDGET        预算上限，单位 USD (5.0)
  AGENT_SDK_PERMISSION_MODE   权限模式 (acceptEdits)

OpenClaw:
  OPENCLAW_BIN                openclaw 二进制路径
  OPENCLAW_STATE_DIR          状态目录 (~/.openclaw)
  OPENCLAW_CONFIG_PATH        配置文件 (~/.openclaw/openclaw.json)
  GATEWAY_HOST / GATEWAY_PORT 网关端点 (127.0.0.1:18789)
```

## 任务调度系统

`src/lib/task-dispatch.ts` 实现了**两阶段自动化工作流**:

```
                      +-----------+
                      |  assigned |
                      | (已分配)   |
                      +-----+-----+
                            |
                 第一阶段: Agent 执行
              (根据任务复杂度选择模型)
                            |
                      +-----v-----+
                      |  review   |
                      | (待审核)   |
                      +-----+-----+
                            |
               第二阶段: Aegis 质量门禁
              (轻量模型, 最多 5 轮)
                            |
                  +---------+---------+
                  |                   |
            +-----v-----+      +-----v-------+
            |   done     |      | in_progress |
            | (已完成)    |      | (被拒绝     |
            | 审核通过    |      |  附带反馈)   |
            +------------+      +------+------+
                                       |
                                    重新分配
                                  (携带反馈)
```

### 第一阶段: Agent 执行

1. 轮询 `status='assigned'` 的任务
2. 根据关键词分类任务复杂度 -> 选择模型层级 (light/default/heavy)
3. 构建提示词: 标题、描述、优先级、工单引用
4. 通过 `backend.dispatch()` 调用 Agent (最多 30 轮, $3 预算)
5. 将执行结果存入 `tasks.resolution`，状态推进至 `status='review'`

### 第二阶段: Aegis 质量审核

1. 轮询 `status='review'` 的任务
2. 构建审核提示词: 原始任务 + Agent 执行结果
3. 调用 Aegis 审核员 (轻量模型, 最多 5 轮)
4. 解析裁决: `VERDICT: APPROVED|REJECTED` + `NOTES: <原因>`
5. 通过 -> `status='done'`; 拒绝 -> `status='in_progress'` 并附带反馈评论
6. 拒绝反馈在下一次调度周期中对 Agent 可见，形成闭环改进

## 实时事件系统

通过两条并行通道向客户端推送实时更新:

```
  数据库变更 (API 处理器)
       |
  db_helpers.logActivity()
       |
  eventBus.broadcast(type, data)
       |
  +----+----+
  |         |
  v         v
 SSE     WebSocket
 (/api/   (OpenClaw
  events)  Gateway)
  |         |
  v         v
 Zustand 状态更新 -> React 重新渲染
```

- **SSE** (`/api/events`): 标准 HTTP 客户端的 Server-Sent Events 推送
- **WebSocket** (`src/lib/websocket.ts`): OpenClaw Gateway v3 协议，支持 WebCrypto 设备身份签名、30s 心跳、指数退避自动重连、消息序列号

## 定时调度器

`src/lib/scheduler.ts` 在启动时运行后台任务 (构建和测试阶段跳过):

| 任务 | 间隔 | 说明 |
|------|------|------|
| `dispatchAssignedTasks()` | 10-60s | 通过 Agent 后端执行已分配的任务 |
| `runAegisReviews()` | 30s | 对已完成任务运行质量门禁审核 |
| `syncAgentsFromConfig()` | 5 分钟 | 从配置文件同步 Agent 注册表 |
| `syncClaudeSessions()` | 1 分钟 | 镜像 Claude SDK 会话状态 |
| `runHeartbeatCheck()` | 5 分钟 | 将失联 Agent 标记为离线 |
| `runBackup()` | 1 小时 | SQLite 备份到 `.data/backups/` |
| `runCleanup()` | 1 小时 | 清理过期的活动记录和通知 |
| `processWebhookRetries()` | 5 分钟 | 指数退避重试失败的 Webhook 投递 |
| `spawnRecurringTasks()` | 5 分钟 | 执行 cron 定时的周期性任务 |

调度间隔和数据保留策略可通过 `settings` 表由管理员配置。

## 认证与授权

### 认证模型 (`src/lib/auth.ts`)

- **角色**: `viewer` < `operator` < `admin` (三级 RBAC)
- **会话**: 32 字节十六进制令牌, httpOnly cookie, 7 天过期
- **认证方式**: `local` (密码) / `google` (OAuth) / `proxy` (受信反向代理)
- **首次运行**: 重定向至 `/setup` 向导; 或通过 `AUTH_USER`/`AUTH_PASS` 环境变量预置

### 请求鉴权流程

```
HTTP 请求 -> requireRole(request, 'viewer'|'operator'|'admin')
  -> 从 Authorization 头或 Cookie 提取令牌
  -> validateSession(token) -> 返回 User 对象 (含角色 + 工作空间 + 租户)
  -> 角色权限校验 -> 通过或返回 403
```

### 安全机制

- 所有 API 输入使用 Zod 模式验证
- 参数化 SQL 查询 (杜绝字符串拼接)
- 基于 nonce 的 Content Security Policy 头 (无 `unsafe-inline`)
- 时序安全的密码比对 (`safeCompare()`)
- 变更操作的速率限制
- 密钥扫描 (`secret-scanner.ts`)
- 注入防护 (`injection-guard.ts`)
- 所有敏感操作的审计日志

## 前端架构

### 页面路由 (App Router)

| 路由 | 用途 |
|------|------|
| `/` 或 `/[[...panel]]` | 主控制台，动态面板路由 |
| `/login` | 登录页 |
| `/setup` | 首次配置向导 |
| `/docs` | API 文档 (Scalar) |

### 管理面板 (`src/components/panels/`)

30+ 操作面板，主要包括:

- **task-board-panel** — 看板任务面板
- **agent-squad-panel** — Agent 编队管理
- **chat-panel** — 多 Agent 对话工作区
- **activity-feed-panel** — 实时活动流
- **cost-tracker-panel** — Token 用量与成本追踪
- **gateway-config-panel** — OpenClaw 网关配置
- **webhook-panel** — Webhook 管理
- **user-management-panel** — 用户与角色管理
- **audit-trail-panel** — 安全审计日志
- **memory-browser-panel** — 知识库浏览器 (Obsidian 风格)
- **cron-management-panel** — 定时任务管理
- **skills-panel** — 技能注册与调用
- **standup-panel** — 每日站会报告生成

### 状态管理 (`src/store/index.ts`)

单一 Zustand Store，按领域切片:

- `agents`, `sessions`, `tasks` — 核心业务状态
- `activities`, `notifications` — 实时信息流
- `currentUser`, `connection` — 认证与连接状态
- `chatMessages`, `execApprovals` — 通信与审批
- `tokenUsage`, `cronJobs` — 运维数据
- `capabilities` — 运行时能力检测 (网关、本地、多租户)

### 客户端 Hooks

- `useMissionControl()` — 访问全局 Store
- `useWebSocket()` — 管理网关 WebSocket 连接
- `useServerEvents()` — 订阅 `/api/events` 的 SSE 事件流

## 外部集成

### GitHub 同步 (`src/lib/github-sync-engine.ts`)

- Issue/PR 双向同步
- 标签映射: 任务状态 <-> GitHub Labels
- GNAP (Git Namespace Auto Provisioner) 仓库管理
- 入站触发: GitHub Webhook -> `/api/github/webhook`

### Webhook (`src/lib/webhooks.ts`)

- 出站事件投递至外部服务
- 事件过滤: `task.created`, `agent.status_changed` 等
- 指数退避重试机制

### 多网关 (`src/lib/gateway-runtime.ts`)

- 支持多个 OpenClaw 网关实例
- 主/备切换路由
- 健康探测与延迟度量

## 部署模式

| 模式 | 命令 | 说明 |
|------|------|------|
| 开发 | `pnpm dev` | 热重载, localhost:3000 |
| 生产 | `pnpm start` | 需要完整 node_modules |
| 独立部署 | `node .next/standalone/server.js` | `pnpm build` 后自包含运行 |
| Docker | `docker compose up` | 零配置容器化 |
| 安全加固 | `docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d` | 生产安全配置 |

### 数据目录

- 默认: `.data/`
- 覆盖: `MISSION_CONTROL_DATA_DIR` 环境变量
- 内容: SQLite 数据库、备份、运行时状态
- 已 gitignore，跨重启持久化

## 启动流程

1. **构建阶段** (`next build`): 编译 TypeScript，跳过数据库初始化 (使用临时 `/tmp/` 目录)
2. **运行时初始化** (首次 `getDatabase()` 调用):
   - 确保 `.data/` 目录存在
   - 以 WAL 模式打开 SQLite 并设置 pragmas
   - 执行数据库迁移
   - 若设置了 `AUTH_PASS` 则预置管理员账户
3. **调度器启动**: 后台任务开始定时执行
4. **首个客户端连接**:
   - 重定向至 `/login` (若无用户则重定向至 `/setup`)
   - 创建会话 -> 加载控制台
   - 建立 WebSocket/SSE 连接 -> 水合 Zustand Store

## 核心目录结构

```
src/
  app/                Next.js 页面 + API 路由 (App Router)
    api/              ~25 个路由组
    [[...panel]]/     动态面板路由
  components/
    layout/           顶栏、侧边导航、实时信息条
    panels/           30+ 操作面板
    ui/               基于 Radix 的共享 UI 组件
  lib/                核心业务逻辑
    db.ts             数据库连接与辅助函数
    auth.ts           认证与会话管理
    agent-backend.ts  Agent 后端抽象层
    agent-sdk.ts      Claude Agent SDK 封装
    openclaw-gateway.ts  OpenClaw CLI RPC 封装
    task-dispatch.ts  两阶段调度 + 质量审核
    scheduler.ts      后台定时调度器
    event-bus.ts      进程内事件广播
    webhooks.ts       出站 Webhook 投递
    config.ts         集中配置管理
    migrations.ts     数据库迁移脚本
  store/              Zustand 全局状态
  types/              TypeScript 类型定义
  i18n/               国际化 (支持 10 种语言)
.data/                SQLite 数据库 + 运行时状态 (gitignored)
scripts/              安装、部署、诊断脚本
docs/                 文档与指南
```
