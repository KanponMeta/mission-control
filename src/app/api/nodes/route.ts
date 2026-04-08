import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

const VALID_DEVICE_ACTIONS = ['approve', 'reject', 'rotate-token', 'revoke-token'] as const
type DeviceAction = (typeof VALID_DEVICE_ACTIONS)[number]

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const action = request.nextUrl.searchParams.get('action') || 'list'

  if (action === 'list') {
    return NextResponse.json({
      nodes: [],
      connected: false,
      message: 'Node management requires OpenClaw Gateway',
    })
  }

  if (action === 'devices') {
    return NextResponse.json({ devices: [] })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}

/**
 * POST /api/nodes - Device management actions
 * Body: { action: DeviceAction, requestId?: string, deviceId?: string, role?: string, scopes?: string[] }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const action = body.action as string
  if (!action || !VALID_DEVICE_ACTIONS.includes(action as DeviceAction)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${VALID_DEVICE_ACTIONS.join(', ')}` },
      { status: 400 },
    )
  }

  return NextResponse.json({ ok: false, error: 'Device management requires OpenClaw Gateway' })
}
