import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

export async function GET(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  return NextResponse.json({ ok: false, message: 'OpenClaw doctor is not available in Agent SDK mode' })
}

export async function POST(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  return NextResponse.json({ ok: false, message: 'OpenClaw doctor is not available in Agent SDK mode' })
}
