import { runAgent, runAgentStream, getSessionMessages,
         type QueryResult, type RunAgentOptions, type StreamEvent } from './agent-sdk'
import { callOpenClawGateway, parseGatewayJsonOutput } from './openclaw-gateway'
import { runOpenClaw } from './command'
import { logger } from './logger'

// ─── Re-exports for convenience ───────────────────────
export type { QueryResult, StreamEvent }

// ─── Extended options (backend-specific extras) ───────
export interface AgentBackendOptions extends RunAgentOptions {
  /** OpenClaw gateway RPC method override */
  openclawMethod?: string
  /** OpenClaw gateway RPC params override */
  openclawParams?: unknown
  /** OpenClaw timeout in ms */
  openclawTimeoutMs?: number
  /** OpenClaw agent ID (from config.openclawId) */
  openclawAgentId?: string
}

// ─── Interface ────────────────────────────────────────
export interface AgentBackend {
  readonly name: 'agent-sdk' | 'openclaw'

  /** Execute a prompt (new session or with options like resume/sessionId) */
  dispatch(prompt: string, options?: AgentBackendOptions): Promise<QueryResult>

  /** Send a message to an existing session */
  sendMessage(sessionKey: string, message: string, options?: AgentBackendOptions): Promise<QueryResult>

  /** Terminate a session */
  killSession(sessionKey: string): Promise<void>

  /** Get session transcript */
  getHistory(sessionKey: string): Promise<Array<{ role: string; content: string }>>

  /** Optional streaming support */
  stream?(prompt: string, options?: AgentBackendOptions): AsyncGenerator<StreamEvent>
}

// ─── AgentSdkBackend ─────────────────────────────────
class AgentSdkBackend implements AgentBackend {
  readonly name = 'agent-sdk' as const

  async dispatch(prompt: string, options?: AgentBackendOptions): Promise<QueryResult> {
    return runAgent(prompt, options)
  }

  async sendMessage(sessionKey: string, message: string, options?: AgentBackendOptions): Promise<QueryResult> {
    return runAgent(message, { ...options, resume: sessionKey })
  }

  async killSession(sessionKey: string): Promise<void> {
    try {
      await runAgent('Terminate session.', { resume: sessionKey, maxTurns: 1, maxBudgetUsd: 0.05 })
    } catch {
      // Session may already be gone — kill is idempotent
    }
  }

  async getHistory(sessionKey: string): Promise<Array<{ role: string; content: string }>> {
    const messages = await getSessionMessages(sessionKey)
    return (messages as any[]).map((m) => ({
      role: m.role ?? (m.type === 'user' ? 'user' : 'assistant'),
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }))
  }

  async *stream(prompt: string, options?: AgentBackendOptions): AsyncGenerator<StreamEvent> {
    yield* runAgentStream(prompt, options)
  }
}

// ─── OpenClawBackend ─────────────────────────────────
class OpenClawBackend implements AgentBackend {
  readonly name = 'openclaw' as const

  async dispatch(prompt: string, options?: AgentBackendOptions): Promise<QueryResult> {
    const start = Date.now()

    // If a specific RPC method is provided, use it directly
    if (options?.openclawMethod) {
      const result = await callOpenClawGateway(
        options.openclawMethod,
        options.openclawParams ?? { message: prompt },
        options.openclawTimeoutMs ?? 120_000,
      )
      return this.normalizeResult(result, start)
    }

    // Default: invoke agent via --expect-final for full response
    const invokeParams: Record<string, unknown> = {
      message: prompt,
      idempotencyKey: `mc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      deliver: false,
    }
    if (options?.openclawAgentId) invokeParams.agentId = options.openclawAgentId
    if (options?.model) invokeParams.model = options.model

    const timeoutMs = options?.openclawTimeoutMs ?? 120_000
    const finalResult = await runOpenClaw(
      ['gateway', 'call', 'agent', '--expect-final', '--timeout', String(timeoutMs), '--params', JSON.stringify(invokeParams), '--json'],
      { timeoutMs: timeoutMs + 5_000 },
    )

    const payload = (parseGatewayJsonOutput(finalResult.stdout)
      ?? parseGatewayJsonOutput(finalResult.stderr || '')) as any
    const parsed = this.parseAgentResponse(
      payload?.result ? JSON.stringify(payload.result) : finalResult.stdout,
    )

    return {
      text: parsed.text || '',
      sessionId: parsed.sessionId || (payload as any)?.result?.meta?.agentMeta?.sessionId || '',
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      turns: 0,
      durationMs: Date.now() - start,
    }
  }

  async sendMessage(sessionKey: string, message: string, options?: AgentBackendOptions): Promise<QueryResult> {
    const start = Date.now()
    const result = await callOpenClawGateway<any>(
      'chat.send',
      {
        sessionKey,
        message,
        idempotencyKey: `mc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        deliver: false,
      },
      options?.openclawTimeoutMs ?? 125_000,
    )

    return {
      text: result?.text || `Message sent to session ${sessionKey}`,
      sessionId: result?.runId || sessionKey,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      turns: 0,
      durationMs: Date.now() - start,
    }
  }

  async killSession(sessionKey: string): Promise<void> {
    try {
      await callOpenClawGateway('sessions_kill', { sessionKey }, 10_000)
    } catch (err: any) {
      logger.warn({ sessionKey, err: err.message }, 'OpenClaw killSession failed (may already be gone)')
    }
  }

  async getHistory(sessionKey: string): Promise<Array<{ role: string; content: string }>> {
    try {
      const result = await callOpenClawGateway<any[]>('chat.history', { sessionKey, limit: 200 }, 15_000)
      if (Array.isArray(result)) {
        return result.map((m: any) => ({
          role: m.role || 'assistant',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        }))
      }
    } catch (err: any) {
      logger.warn({ sessionKey, err: err.message }, 'OpenClaw getHistory failed')
    }
    return []
  }

  // No streaming support for OpenClaw gateway

  // ─── Helpers ──────────────────────────────────────
  private normalizeResult(raw: unknown, startTime: number): QueryResult {
    const parsed = raw as any
    return {
      text: typeof parsed === 'string' ? parsed : (parsed?.text ?? parsed?.result ?? JSON.stringify(parsed)),
      sessionId: parsed?.session_id ?? parsed?.sessionId ?? '',
      costUsd: parsed?.cost_usd ?? 0,
      inputTokens: parsed?.input_tokens ?? 0,
      outputTokens: parsed?.output_tokens ?? 0,
      turns: parsed?.turns ?? 0,
      durationMs: Date.now() - startTime,
    }
  }

  private parseAgentResponse(stdout: string): { text: string | null; sessionId: string | null } {
    try {
      const parsed = JSON.parse(stdout)
      const sessionId = parsed?.sessionId ?? parsed?.session_id ?? null
      if (parsed?.payloads?.[0]?.text) return { text: parsed.payloads[0].text, sessionId }
      if (parsed?.result) return { text: String(parsed.result), sessionId }
      if (parsed?.output) return { text: String(parsed.output), sessionId }
      return { text: JSON.stringify(parsed, null, 2), sessionId }
    } catch {
      return { text: stdout.trim() || null, sessionId: null }
    }
  }
}

// ─── Singletons ──────────────────────────────────────
const agentSdkBackend = new AgentSdkBackend()
const openClawBackend = new OpenClawBackend()

// ─── Factory ─────────────────────────────────────────

/** Returns the default backend (Agent SDK). */
export function getDefaultBackend(): AgentBackend {
  return agentSdkBackend
}

/** Select a backend by name. Defaults to Agent SDK. */
export function resolveBackend(backendName?: 'agent-sdk' | 'openclaw' | string): AgentBackend {
  if (backendName === 'openclaw') return openClawBackend
  return agentSdkBackend
}

/** Extract `backend` from an agent's config JSON and return the appropriate backend. */
export function resolveBackendFromConfig(configJson: string | null | undefined): AgentBackend {
  if (!configJson) return agentSdkBackend
  try {
    const cfg = JSON.parse(configJson)
    return resolveBackend(cfg.backend)
  } catch {
    return agentSdkBackend
  }
}
