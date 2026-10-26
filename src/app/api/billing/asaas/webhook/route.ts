import { timingSafeEqual } from 'node:crypto'
import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { readCappedBody } from '@/lib/whatsapp/webhook-body'
import { syncAccountSubscription } from '@/lib/billing/sync'

/**
 * POST /api/billing/asaas/webhook — Asaas payment events
 * (docs/saas/b2-asaas.md). Authenticated by the `asaas-access-token`
 * header (= ASAAS_WEBHOOK_TOKEN, set in the Asaas webhook config). The
 * body only says WHICH subscription changed: its account is re-synced
 * from the Asaas API, so a forged event can't activate anything. Always
 * acks 200 once authenticated — Asaas pauses the queue after failures.
 */
export async function POST(request: Request) {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN
  if (!expected) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  const supplied = Buffer.from(request.headers.get('asaas-access-token') ?? '')
  const wanted = Buffer.from(expected)
  if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = await readCappedBody(request)
  let body: { event?: string; payment?: { subscription?: string | null } } = {}
  try {
    body = raw ? JSON.parse(raw) : {}
  } catch {
    return NextResponse.json({ received: true })
  }
  const subscriptionId = body.payment?.subscription
  if (!subscriptionId) return NextResponse.json({ received: true })

  after(async () => {
    try {
      const db = supabaseAdmin()
      const { data } = await db
        .from('account_subscriptions')
        .select('account_id')
        .eq('external_subscription_id', subscriptionId)
        .maybeSingle()
      if (!data) {
        console.warn(`[billing] Asaas event ${body.event} for unknown subscription ${subscriptionId}`)
        return
      }
      await syncAccountSubscription(db, data.account_id as string)
    } catch (err) {
      console.error('[billing] Asaas webhook sync failed:', err instanceof Error ? err.message : err)
    }
  })
  return NextResponse.json({ received: true })
}
