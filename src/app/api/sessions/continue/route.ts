import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getDefaultBackend } from '@/lib/agent-backend'

type ContinueKind = 'claude-code' | 'codex-cli'

function sanitizePrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * POST /api/sessions/continue
 * Body: { kind: 'claude-code'|'codex-cli', id: string, prompt: string }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json().catch(() => ({}))
    const kind = body?.kind as ContinueKind
    const sessionId = typeof body?.id === 'string' ? body.id.trim() : ''
    const prompt = sanitizePrompt(body?.prompt)

    if (!sessionId || !/^[a-zA-Z0-9._:-]+$/.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
    }
    if (kind !== 'claude-code' && kind !== 'codex-cli') {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
    }
    if (!prompt || prompt.length > 6000) {
      return NextResponse.json({ error: 'prompt is required (max 6000 chars)' }, { status: 400 })
    }

    let reply = ''

    if (kind === 'claude-code') {
      const backend = getDefaultBackend()
      const result = await backend.sendMessage(sessionId, prompt, { maxTurns: 20, maxBudgetUsd: 2.0 })
      reply = result.text
    } else {
      const backend = getDefaultBackend()
      const result = await backend.sendMessage(sessionId, prompt, { maxTurns: 20, maxBudgetUsd: 2.0 })
      reply = result.text
    }

    if (!reply) {
      reply = 'Session continued, but no text response was returned.'
    }

    return NextResponse.json({ ok: true, reply })
  } catch (error: any) {
    logger.error({ err: error }, 'POST /api/sessions/continue error')
    return NextResponse.json({ error: error?.message || 'Failed to continue session' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
