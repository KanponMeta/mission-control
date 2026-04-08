import { query, listSessions, getSessionMessages, getSessionInfo,
         type Options } from '@anthropic-ai/claude-agent-sdk'
import { logger } from './logger'

// ─── 配置 ─────────────────────────────────────────────
function getSdkEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v
  }
  env.ANTHROPIC_BASE_URL = process.env.AGENT_SDK_BASE_URL || 'https://api.anthropic.com'
  env.ANTHROPIC_API_KEY = process.env.AGENT_SDK_API_KEY || ''
  return env
}

const defaultModel = process.env.AGENT_SDK_MODEL || 'claude-sonnet-4-6'
const lightModel = process.env.AGENT_SDK_MODEL_LIGHT || 'claude-haiku-4-5'
const heavyModel = process.env.AGENT_SDK_MODEL_HEAVY || 'claude-opus-4-6'
const defaultMaxTurns = Number(process.env.AGENT_SDK_MAX_TURNS || '30')
const defaultMaxBudget = Number(process.env.AGENT_SDK_MAX_BUDGET_USD || '5.0')
const defaultPermission = (process.env.AGENT_SDK_PERMISSION_MODE || 'acceptEdits') as Options['permissionMode']

// ─── 模型路由 ──────────────────────────────────────────
export type ModelTier = 'light' | 'default' | 'heavy'

export function resolveModel(tier: ModelTier = 'default'): string {
  switch (tier) {
    case 'light': return lightModel
    case 'heavy': return heavyModel
    default: return defaultModel
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

export interface RunAgentOptions {
  model?: string
  modelTier?: ModelTier
  maxTurns?: number
  maxBudgetUsd?: number
  cwd?: string
  sessionId?: string
  resume?: string
  tools?: string[]
  allowedTools?: string[]
  agents?: Options['agents']
  abortController?: AbortController
  permissionMode?: Options['permissionMode']
  persistSession?: boolean
}

export async function runAgent(prompt: string, options?: RunAgentOptions): Promise<QueryResult> {
  const model = options?.model || resolveModel(options?.modelTier)
  const abortController = options?.abortController || new AbortController()

  const sdkOptions: Options = {
    env: getSdkEnv(),
    model,
    maxTurns: options?.maxTurns ?? defaultMaxTurns,
    maxBudgetUsd: options?.maxBudgetUsd ?? defaultMaxBudget,
    permissionMode: options?.permissionMode ?? defaultPermission,
    allowedTools: options?.allowedTools ?? ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
    tools: options?.tools as any,
    cwd: options?.cwd,
    sessionId: options?.sessionId,
    resume: options?.resume,
    agents: options?.agents,
    abortController,
    persistSession: options?.persistSession ?? true,
  }

  let resultText = ''
  let sessionId = ''
  let costUsd = 0
  let inputTokens = 0
  let outputTokens = 0
  let turns = 0
  let durationMs = 0

  logger.info({ model, prompt: prompt.substring(0, 120) }, 'Agent SDK query started')

  for await (const message of query({ prompt, options: sdkOptions })) {
    if (message.type === 'system' && message.subtype === 'init') {
      sessionId = message.session_id
    }
    if (message.type === 'result') {
      if (message.subtype === 'success') {
        resultText = message.result
        costUsd = message.total_cost_usd
        inputTokens = message.usage.input_tokens
        outputTokens = message.usage.output_tokens
        turns = message.num_turns
        durationMs = message.duration_ms
      } else {
        const errMsg = 'errors' in message ? (message as any).errors.join('; ') : 'Agent query failed'
        logger.error({ model, errMsg }, 'Agent SDK query error result')
        throw new Error(errMsg)
      }
    }
  }

  logger.info({ model, sessionId, costUsd, turns, durationMs }, 'Agent SDK query completed')

  return { text: resultText, sessionId, costUsd, inputTokens, outputTokens, turns, durationMs }
}

// ─── 流式查询（SSE 推送用）────────────────────────────
export interface StreamEvent {
  type: 'init' | 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'usage' | 'done' | 'error'
  sessionId?: string
  data?: unknown
}

export async function* runAgentStream(prompt: string, options?: RunAgentOptions): AsyncGenerator<StreamEvent> {
  const model = options?.model || resolveModel(options?.modelTier)
  const abortController = options?.abortController || new AbortController()

  const sdkOptions: Options = {
    env: getSdkEnv(),
    model,
    maxTurns: options?.maxTurns ?? defaultMaxTurns,
    maxBudgetUsd: options?.maxBudgetUsd ?? defaultMaxBudget,
    permissionMode: options?.permissionMode ?? defaultPermission,
    allowedTools: options?.allowedTools ?? ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
    tools: options?.tools as any,
    cwd: options?.cwd,
    sessionId: options?.sessionId,
    resume: options?.resume,
    agents: options?.agents,
    abortController,
    persistSession: options?.persistSession ?? true,
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
            yield { type: 'tool_use', data: { tool: (block as any).name, id: (block as any).id } }
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
          yield { type: 'error', data: 'errors' in message ? (message as any).errors : ['Unknown error'] }
        }
      }
    }
  } catch (err: any) {
    yield { type: 'error', data: err.message || 'Agent stream failed' }
  }
}

// ─── 会话管理 re-exports ──────────────────────────────
export { listSessions, getSessionMessages, getSessionInfo }
