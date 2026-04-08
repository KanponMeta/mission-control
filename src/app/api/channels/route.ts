import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

/**
 * GET /api/channels - Fetch channel status
 * Gateway is not available; returns empty channel data.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({
    channels: {},
    channelAccounts: {},
    channelOrder: [],
    channelLabels: {},
    connected: false,
    message: 'Channel management requires OpenClaw Gateway',
  })
}

/**
 * POST /api/channels - Platform-specific actions
 * Body: { action: string, ...params }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => null)
  if (!body || !body.action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 })
  }

  const { action } = body

  switch (action) {
    case 'whatsapp-link':
      return NextResponse.json({ ok: false, error: 'WhatsApp login requires OpenClaw Gateway' })

    case 'whatsapp-wait':
      return NextResponse.json({ ok: false, error: 'WhatsApp login requires OpenClaw Gateway' })

    case 'whatsapp-logout':
      return NextResponse.json({ ok: false, error: 'Channel logout requires OpenClaw Gateway' })

    case 'nostr-profile-save':
      return NextResponse.json({ ok: false, error: 'Nostr profile management requires OpenClaw Gateway' })

    case 'nostr-profile-import':
      return NextResponse.json({ ok: false, error: 'Nostr profile management requires OpenClaw Gateway' })

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }
}
