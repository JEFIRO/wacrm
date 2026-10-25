import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { processTextBroadcasts } from '@/lib/broadcasts/text-queue'

// The worker paces sends (random pause between messages), so it stays
// up for most of the minute between cron hits.
export const maxDuration = 60
const RUN_MS = 50_000

/**
 * GET /api/broadcasts/cron — text campaign queue (docs/saas/w5-fila.md).
 * Hit every minute by the same external cron as the automations, with
 * the `x-cron-secret` header = AUTOMATION_CRON_SECRET.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '')
  const wanted = Buffer.from(expected)
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await processTextBroadcasts(supabaseAdmin(), {
    deadline: new Date(Date.now() + RUN_MS),
  })
  return NextResponse.json(result)
}
