import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json(
    { version: null, message: 'OpenClaw CLI not available in Agent SDK mode' },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
