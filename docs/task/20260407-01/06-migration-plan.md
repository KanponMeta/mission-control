# Mission Control 改造方案：OpenClaw Gateway → Claude Agent SDK + 百炼

**日期**: 2026-04-07
**目标**: 使用 `@anthropic-ai/claude-agent-sdk` 替代 OpenClaw Gateway CLI 调用，后端接入阿里百炼大模型平台

---

## 一、架构对比

### 改造前

```
Mission Control (Next.js)
    │
    ├─ callOpenClawGateway(method, params)     ← 7 个 API route
    │    → runOpenClaw(['gateway', 'call', method, '--params', JSON, '--json'])
    │         → child_process.spawn('openclaw', ...)
    │              → 全量缓冲 stdout → JSON.parse
    │
    ├─ runOpenClaw(['gateway', 'call', 'agent', '--expect-final', ...])  ← task-dispatch
    │    → 同步阻塞 125s，无流式
    │
    └─ runCommand('claude', ['--print', '--resume', ...])  ← sessions/continue
         → 同步阻塞 180s
```

### 改造后

```
Mission Control (Next.js)
    │
    ├─ agentClient.query({ prompt, options })    ← 库级调用，无子进程
    │    → async iterator 流式接收
    │    → ANTHROPIC_BASE_URL → 百炼端点
    │    → ANTHROPIC_API_KEY  → 百炼 API Key
    │
    ├─ agentClient.listSessions()                ← 会话管理
    ├─ agentClient.getSessionMessages(id)        ← 历史记录
    └─ agentClient.getSessionInfo(id)            ← 会话信息
```

---

## 二、环境变量配置

### 新增 `.env` 变量

```bash
# === Agent SDK (百炼) ===
# 百炼 Anthropic 兼容端点
AGENT_SDK_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode
# 百炼 API Key
AGENT_SDK_API_KEY=sk-xxx
# 默认模型（百炼模型名）
AGENT_SDK_MODEL=qwen-coder-plus-latest
# 备选模型（轻量任务）
AGENT_SDK_MODEL_LIGHT=qwen-coder-turbo-latest
# 备选模型（复杂任务）
AGENT_SDK_MODEL_HEAVY=qwen-coder-max-latest
# 预算限制（美元，每次 query 上限）
AGENT_SDK_MAX_BUDGET_USD=5.0
# 最大轮次
AGENT_SDK_MAX_TURNS=30
# 权限模式: default | acceptEdits | bypassPermissions
AGENT_SDK_PERMISSION_MODE=acceptEdits
```

### 保留的变量

```bash
# 这些与 Agent SDK 无关，继续保留
MC_CLAUDE_HOME=~/.claude                    # Claude Code 本地数据
MISSION_CONTROL_DATA_DIR=.data              # MC 数据库
MC_RETAIN_*                                 # 数据保留策略
```

### 废弃的变量

```bash
# 以下全部移除
OPENCLAW_GATEWAY_HOST / PORT / TOKEN
OPENCLAW_TOOLS_PROFILE
OPENCLAW_BIN / CLAWDBOT_BIN
NEXT_PUBLIC_GATEWAY_HOST / PORT / PROTOCOL / URL / CLIENT_ID / OPTIONAL
```

---

## 三、核心模块改造

### 3.1 新建 `src/lib/agent-sdk.ts`（核心封装）

替代 `openclaw-gateway.ts`，提供统一的 Agent SDK 调用接口。

```typescript
import { query, listSessions, getSessionMessages, getSessionInfo,
         type Options, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from './logger'

// ─── 配置 ─────────────────────────────────────────────
const sdkEnv: Record<string, string> = {
  ...process.env as Record<string, string>,
  ANTHROPIC_BASE_URL: process.env.AGENT_SDK_BASE_URL || 'https://api.anthropic.com',
  ANTHROPIC_API_KEY:  process.env.AGENT_SDK_API_KEY  || '',
}

const defaultModel      = process.env.AGENT_SDK_MODEL       || 'claude-sonnet-4-6'
const lightModel        = process.env.AGENT_SDK_MODEL_LIGHT  || 'claude-haiku-4-5'
const heavyModel        = process.env.AGENT_SDK_MODEL_HEAVY  || 'claude-opus-4-6'
const defaultMaxTurns   = Number(process.env.AGENT_SDK_MAX_TURNS || '30')
const defaultMaxBudget  = Number(process.env.AGENT_SDK_MAX_BUDGET_USD || '5.0')
const defaultPermission = (process.env.AGENT_SDK_PERMISSION_MODE || 'acceptEdits') as Options['permissionMode']

// ─── 模型路由 ──────────────────────────────────────────
export type ModelTier = 'light' | 'default' | 'heavy'

export function resolveModel(tier: ModelTier = 'default'): string {
  switch (tier) {
    case 'light':  return lightModel
    case 'heavy':  return heavyModel
    default:       return defaultModel
  }
}

// ─── 单次查询（fire-and-wait）─────────────────────────
export interface QueryResult {
  text: string
  sessionId: string
  costUsd: number
  inputTokens: number
  outputTokens: number
  turns: number
  durationMs: number
}

export async function runAgent(prompt: string, options?: {
  model?: string
  modelTier?: ModelTier
  maxTurns?: number
  maxBudgetUsd?: number
  cwd?: string
  sessionId?: string
  resume?: string
  tools?: string[]
  allowedTools?: string[]
  systemPrompt?: string
  agents?: Options['agents']
  abortController?: AbortController
}): Promise<QueryResult> {
  const model = options?.model || resolveModel(options?.modelTier)
  const abortController = options?.abortController || new AbortController()

  const sdkOptions: Options = {
    env: sdkEnv,
    model,
    maxTurns: options?.maxTurns ?? defaultMaxTurns,
    maxBudgetUsd: options?.maxBudgetUsd ?? defaultMaxBudget,
    permissionMode: defaultPermission,
    allowedTools: options?.allowedTools ?? ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
    cwd: options?.cwd,
    sessionId: options?.sessionId,
    resume: options?.resume,
    tools: options?.tools as any,
    agents: options?.agents,
    abortController,
    persistSession: true,
  }

  let resultText = ''
  let sessionId = ''
  let costUsd = 0
  let inputTokens = 0
  let outputTokens = 0
  let turns = 0
  let durationMs = 0

  for await (const message of query({ prompt, options: sdkOptions })) {
    if (message.type === 'system' && message.subtype === 'init') {
      sessionId = message.session_id
    }
    if (message.type === 'result' && message.subtype === 'success') {
      resultText = message.result
      costUsd = message.total_cost_usd
      inputTokens = message.usage.input_tokens
      outputTokens = message.usage.output_tokens
      turns = message.num_turns
      durationMs = message.duration_ms
    }
    if (message.type === 'result' && message.subtype !== 'success') {
      const errMsg = 'errors' in message ? message.errors.join('; ') : 'Agent query failed'
      throw new Error(errMsg)
    }
  }

  return { text: resultText, sessionId, costUsd, inputTokens, outputTokens, turns, durationMs }
}

// ─── 流式查询（SSE 推送用）────────────────────────────
export interface StreamEvent {
  type: 'init' | 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'usage' | 'done' | 'error'
  sessionId?: string
  data?: any
}

export async function* runAgentStream(prompt: string, options?: Parameters<typeof runAgent>[1]): AsyncGenerator<StreamEvent> {
  const model = options?.model || resolveModel(options?.modelTier)
  const abortController = options?.abortController || new AbortController()

  const sdkOptions: Options = {
    env: sdkEnv,
    model,
    maxTurns: options?.maxTurns ?? defaultMaxTurns,
    maxBudgetUsd: options?.maxBudgetUsd ?? defaultMaxBudget,
    permissionMode: defaultPermission,
    allowedTools: options?.allowedTools ?? ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
    cwd: options?.cwd,
    sessionId: options?.sessionId,
    resume: options?.resume,
    agents: options?.agents,
    abortController,
    persistSession: true,
    includePartialMessages: true,
  }

  try {
    for await (const message of query({ prompt, options: sdkOptions })) {
      if (message.type === 'system' && message.subtype === 'init') {
        yield { type: 'init', sessionId: message.session_id }
      }
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if ('text' in block && block.text) {
            yield { type: 'text', data: block.text }
          }
          if ('name' in block) {
            yield { type: 'tool_use', data: { tool: block.name, id: block.id } }
          }
        }
      }
      if (message.type === 'result') {
        if (message.subtype === 'success') {
          yield {
            type: 'done',
            sessionId: message.session_id,
            data: {
              text: message.result,
              costUsd: message.total_cost_usd,
              usage: message.usage,
              turns: message.num_turns,
              durationMs: message.duration_ms,
            },
          }
        } else {
          yield { type: 'error', data: 'errors' in message ? message.errors : ['Unknown error'] }
        }
      }
    }
  } catch (err: any) {
    yield { type: 'error', data: err.message || 'Agent stream failed' }
  }
}

// ─── 会话管理 ─────────────────────────────────────────
export { listSessions, getSessionMessages, getSessionInfo }
```

### 3.2 改造 `src/lib/config.ts`

```diff
  export const config = {
+   // Agent SDK
+   agentSdk: {
+     baseUrl:    process.env.AGENT_SDK_BASE_URL || 'https://api.anthropic.com',
+     apiKey:     process.env.AGENT_SDK_API_KEY || '',
+     model:      process.env.AGENT_SDK_MODEL || 'claude-sonnet-4-6',
+     modelLight: process.env.AGENT_SDK_MODEL_LIGHT || 'claude-haiku-4-5',
+     modelHeavy: process.env.AGENT_SDK_MODEL_HEAVY || 'claude-opus-4-6',
+     maxTurns:   clampInt(Number(process.env.AGENT_SDK_MAX_TURNS || '30'), 1, 200, 30),
+     maxBudget:  Number(process.env.AGENT_SDK_MAX_BUDGET_USD || '5.0'),
+     permission: process.env.AGENT_SDK_PERMISSION_MODE || 'acceptEdits',
+   },
    claudeHome: process.env.MC_CLAUDE_HOME || path.join(os.homedir(), '.claude'),
    dataDir: resolvedDataDir,
    dbPath: resolvedDbPath,
    // ... 保留其他配置
-   openclawBin: process.env.OPENCLAW_BIN || 'openclaw',
-   clawdbotBin: process.env.CLAWDBOT_BIN || 'clawdbot',
-   gatewayHost: process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1',
-   gatewayPort: clampInt(...),
  }
```

### 3.3 改造 `src/lib/task-dispatch.ts`（核心）

**改造前** (line 278, 481):
```typescript
const finalResult = await runOpenClaw(
  ['gateway', 'call', 'agent', '--expect-final', '--timeout', '120000',
   '--params', JSON.stringify(invokeParams), '--json'],
  { timeoutMs: 125_000 }
)
const finalPayload = parseGatewayJson(finalResult.stdout)
const agentResponse = parseAgentResponse(
  finalPayload?.result ? JSON.stringify(finalPayload.result) : finalResult.stdout
)
```

**改造后**:
```typescript
import { runAgent, resolveModel } from './agent-sdk'

// 任务分派
const result = await runAgent(prompt, {
  model: dispatchModel || undefined,
  modelTier: dispatchModel ? undefined : 'default',
  maxTurns: 30,
  maxBudgetUsd: 3.0,
  allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
})
const agentResponse = { text: result.text, sessionId: result.sessionId }

// Aegis 审查
const reviewResult = await runAgent(reviewPrompt, {
  modelTier: 'light',  // 审查用轻量模型
  maxTurns: 5,
  maxBudgetUsd: 0.5,
  allowedTools: ['Read', 'Glob', 'Grep'],  // 只读工具
})
const verdict = parseReviewVerdict(reviewResult.text)
```

**关键改进**:
- 移除 `runOpenClaw` / `parseGatewayJson` / `parseAgentResponse` 调用链
- `classifyTaskModel()` 返回百炼模型名或 `ModelTier`
- Aegis 审查使用轻量模型降低成本
- 自动获取 `sessionId`，无需手动解析

### 3.4 改造 `src/app/api/spawn/route.ts`

**改造前**:
```typescript
result = await callOpenClawGateway('sessions_spawn', spawnPayload, 15_000)
```

**改造后**:
```typescript
import { runAgent } from '@/lib/agent-sdk'

const result = await runAgent(task, {
  model: model || undefined,
  maxTurns: 1,  // spawn 只启动，不执行完整任务
  maxBudgetUsd: 1.0,
  sessionId: crypto.randomUUID(),  // 显式指定 session ID
})

return NextResponse.json({
  success: true,
  spawnId,
  sessionInfo: result.sessionId,
  task,
  model,
  result: { text: result.text, costUsd: result.costUsd },
})
```

### 3.5 改造 `src/app/api/sessions/continue/route.ts`

**改造前**:
```typescript
const result = await runCommand('claude', ['--print', '--resume', sessionId, prompt], {
  timeoutMs: 180000,
})
reply = (result.stdout || '').trim()
```

**改造后**:
```typescript
import { runAgent } from '@/lib/agent-sdk'

const result = await runAgent(prompt, {
  resume: sessionId,
  maxTurns: 20,
  maxBudgetUsd: 2.0,
})
reply = result.text
```

### 3.6 改造 `src/app/api/chat/messages/route.ts`

**改造前**:
```typescript
// 消息转发到 gateway
await callOpenClawGateway('chat.send', { sessionKey, message }, 125_000)
// 或 agent 调用
const result = await runOpenClaw(['gateway', 'call', 'agent', '--timeout', ...])
```

**改造后**:
```typescript
import { runAgent, runAgentStream } from '@/lib/agent-sdk'

// 方式 1: 等待完整结果
const result = await runAgent(message, { resume: sessionId })

// 方式 2: 流式（后续 SSE 端点）
for await (const event of runAgentStream(message, { resume: sessionId })) {
  // 推送到前端
}
```

### 3.7 改造 `src/app/api/sessions/transcript/gateway/route.ts`

**改造前**:
```typescript
const history = await callOpenClawGateway<any[]>('chat.history', { sessionKey, limit }, 15_000)
// fallback: 读 JSONL 文件
```

**改造后**:
```typescript
import { getSessionMessages } from '@/lib/agent-sdk'

const messages = await getSessionMessages(sessionId)
// 已经是结构化数据，无需 JSONL 解析
```

---

## 四、模型路由改造

### 改造 `classifyTaskModel()`

**改造前** (task-dispatch.ts:39-77):
```typescript
// 返回 gateway 模型路由字符串
return '9router/cc/claude-opus-4-6'
return '9router/cc/claude-haiku-4-5-20251001'
```

**改造后**:
```typescript
import { resolveModel, type ModelTier } from './agent-sdk'

function classifyTaskModel(task: DispatchableTask): ModelTier {
  // 允许 agent config 覆盖
  if (task.agent_config) {
    try {
      const cfg = JSON.parse(task.agent_config)
      if (cfg.dispatchModel) return cfg.dispatchModel  // 直接返回百炼模型名
    } catch {}
  }

  const text = `${task.title} ${task.description ?? ''}`.toLowerCase()
  const priority = task.priority?.toLowerCase() ?? ''

  // 复杂任务 → heavy
  const complexSignals = ['debug', 'diagnos', 'architect', 'refactor', 'migration', ...]
  if (priority === 'critical' || complexSignals.some(s => text.includes(s))) return 'heavy'

  // 简单任务 → light
  const routineSignals = ['status check', 'rename', 'format', 'summarize', ...]
  if (routineSignals.some(s => text.includes(s))) return 'light'

  return 'default'
}
```

---

## 五、新增 SSE 流式端点

### `src/app/api/agent/stream/route.ts`（新建）

```typescript
import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { runAgentStream } from '@/lib/agent-sdk'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status })

  const { prompt, sessionId, model } = await request.json()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runAgentStream(prompt, { resume: sessionId, model })) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
        controller.close()
      } catch (err: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', data: err.message })}\n\n`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
```

---

## 六、需改造文件清单

### P0 — 核心功能（必须改）

| 文件 | 改造内容 | 复杂度 |
|------|---------|--------|
| `package.json` | 添加 `@anthropic-ai/claude-agent-sdk` 依赖 | 低 |
| `.env.example` | 新增 Agent SDK 变量，标记废弃的 Gateway 变量 | 低 |
| `src/lib/config.ts` | 添加 `agentSdk` 配置块，移除 gateway 配置 | 低 |
| **`src/lib/agent-sdk.ts`** | **新建**：runAgent, runAgentStream, 会话管理 | **高** |
| `src/lib/task-dispatch.ts` | 替换 runOpenClaw → runAgent (2 处) | 高 |
| `src/app/api/spawn/route.ts` | 替换 callOpenClawGateway → runAgent | 中 |
| `src/app/api/sessions/continue/route.ts` | 替换 runCommand('claude') → runAgent | 低 |
| `src/app/api/chat/messages/route.ts` | 替换 gateway 消息转发 → runAgent | 高 |
| `src/app/api/sessions/transcript/gateway/route.ts` | 替换 chat.history → getSessionMessages | 低 |

### P1 — 会话控制

| 文件 | 改造内容 | 复杂度 |
|------|---------|--------|
| `src/app/api/sessions/route.ts` | 替换 5 个 session_set* 方法 | 中 |
| `src/app/api/sessions/[id]/control/route.ts` | 替换 sessions_kill, sessions_send | 中 |
| `src/lib/sessions.ts` | 替换 gateway 磁盘读取 → SDK listSessions | 中 |
| **`src/app/api/agent/stream/route.ts`** | **新建**：SSE 流式端点 | 中 |

### P2 — Agent 管理

| 文件 | 改造内容 | 复杂度 |
|------|---------|--------|
| `src/app/api/agents/message/route.ts` | 替换 runOpenClaw → runAgent | 低 |
| `src/app/api/agents/[id]/wake/route.ts` | 替换唤醒命令 | 低 |
| `src/app/api/notifications/deliver/route.ts` | 替换通知投递 | 低 |
| `src/app/api/tasks/[id]/broadcast/route.ts` | 替换任务广播 | 低 |
| `src/app/api/pipelines/run/route.ts` | 替换 pipeline agent 调用 | 中 |

### P3 — 清理与兼容

| 文件 | 改造内容 | 复杂度 |
|------|---------|--------|
| `src/lib/openclaw-gateway.ts` | **删除整个文件** | — |
| `src/lib/command.ts` | 移除 `runOpenClaw`，保留 `runCommand` | 低 |
| `src/lib/websocket.ts` | 移除 gateway WebSocket，改用 SSE | 中 |
| `src/app/api/status/route.ts` | 移除 openclaw --version 检查 | 低 |
| `src/app/api/diagnostics/route.ts` | 移除 openclaw --version | 低 |
| `src/app/api/openclaw/*/route.ts` | 移除或重构 doctor/update/version | 低 |
| `src/app/api/nodes/route.ts` | 评估：设备管理是否保留 | 中 |
| `src/app/api/channels/route.ts` | 评估：频道管理是否保留 | 中 |

---

## 七、数据库迁移

### 新增 migration

```sql
-- migration 0XX: Agent SDK session tracking
ALTER TABLE agents ADD COLUMN sdk_session_id TEXT;
ALTER TABLE agents ADD COLUMN sdk_model TEXT;
ALTER TABLE tasks ADD COLUMN sdk_session_id TEXT;
ALTER TABLE tasks ADD COLUMN sdk_cost_usd REAL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN sdk_tokens_in INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN sdk_tokens_out INTEGER DEFAULT 0;
```

---

## 八、实施阶段

### Phase 1: 基础接入（1-2 天）

1. `pnpm add @anthropic-ai/claude-agent-sdk`
2. 新建 `src/lib/agent-sdk.ts`
3. 更新 `.env.example` + `config.ts`
4. 改造 `sessions/continue/route.ts`（最简单的入口）
5. 验证百炼连通性

### Phase 2: 核心替换（2-3 天）

1. 改造 `task-dispatch.ts`（dispatchAssignedTasks + runAegisReviews）
2. 改造 `spawn/route.ts`
3. 改造 `chat/messages/route.ts`
4. 改造 `sessions/transcript/gateway/route.ts`
5. 更新 `classifyTaskModel()` 模型路由

### Phase 3: 流式与会话管理（1-2 天）

1. 新建 SSE 流式端点 `api/agent/stream`
2. 改造 `sessions/route.ts` 会话控制
3. 改造 `sessions.ts` 会话读取
4. 前端适配 SSE 替代 WebSocket（可选）

### Phase 4: 清理（1 天）

1. 删除 `openclaw-gateway.ts`
2. 清理 `command.ts` 的 `runOpenClaw`
3. 移除废弃环境变量
4. 评估 nodes/channels 路由去留
5. 更新测试

---

## 九、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 百炼 API 兼容性差异 | 工具调用格式不匹配 | Phase 1 先验证基础 query 和工具调用 |
| Agent SDK 内部 spawn Claude Code CLI | 百炼模型无法处理 Claude 特有 prompt | 通过 env 注入自定义 system prompt |
| 流式输出事件格式差异 | 前端解析错误 | `runAgentStream` 做事件归一化 |
| 并发 agent 进程过多 | 内存/CPU 压力 | 调度器限流 + maxTurns 限制 |
| 会话持久化路径差异 | 历史记录读取失败 | 使用 SDK 的 listSessions/getSessionMessages |
| 无 OpenClaw 后设备/频道管理失效 | nodes/channels 页面不可用 | 标记为可选功能，UI 隐藏或显示提示 |

---

## 十、验证检查表

- [ ] `AGENT_SDK_BASE_URL` 指向百炼，`query()` 能正常返回
- [ ] 工具调用（Read/Edit/Bash）在百炼模型下正常工作
- [ ] `dispatchAssignedTasks()` 能完成任务并写入 resolution
- [ ] `runAegisReviews()` 能解析 VERDICT 并更新任务状态
- [ ] `POST /api/spawn` 能创建会话并返回 sessionId
- [ ] `POST /api/sessions/continue` 能恢复会话
- [ ] `GET /api/sessions/transcript/gateway` 能读取历史记录
- [ ] SSE 流式端点能实时推送进度
- [ ] `classifyTaskModel()` 正确路由到百炼模型
- [ ] 调度器 60s tick 正常运行无异常
- [ ] 无任何 `openclaw` / `runOpenClaw` 残留引用
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 通过
