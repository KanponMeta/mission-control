import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { heavyLimiter } from '@/lib/rate-limit'
import { getDefaultBackend } from '@/lib/agent-backend'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json().catch(() => ({}))
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : undefined
    const model = typeof body?.model === 'string' ? body.model.trim() : undefined

    if (!prompt || prompt.length > 10000) {
      return new Response(JSON.stringify({ error: 'prompt is required (max 10000 chars)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const backend = getDefaultBackend()
    if (!backend.stream) {
      return new Response(JSON.stringify({ error: 'Streaming not supported by current backend' }), {
        status: 501,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of backend.stream!(prompt, {
            resume: sessionId,
            model,
            maxTurns: 30,
            maxBudgetUsd: 5.0,
          })) {
            const data = `data: ${JSON.stringify(event)}\n\n`
            controller.enqueue(encoder.encode(data))
          }
        } catch (err: any) {
          const errorEvent = `data: ${JSON.stringify({ type: 'error', data: err.message })}\n\n`
          controller.enqueue(encoder.encode(errorEvent))
          logger.error({ err }, 'Agent stream error')
        } finally {
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
  } catch (error: any) {
    logger.error({ err: error }, 'Agent stream API error')
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export const dynamic = 'force-dynamic'
