import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { currentPlatformAdmin } from '@/lib/platform/admin'
import { extendedTrialEnd } from '@/lib/platform/overview'
import { syncAccountSubscription } from '@/lib/billing/sync'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/platform/accounts/:id — body `{ action, days? }`. Platform
 * admins only (docs/saas/b6-painel.md). Every action is written to
 * platform_audit.
 *
 *   suspend       status 'suspended' → the account is blocked
 *   reactivate    back from 'suspended': re-read from Asaas when it has a
 *                 subscription there, else back to the trial
 *   extend_trial  trial end + `days` (1–90) from its end or today
 */
export async function POST(request: Request, { params }: Ctx) {
  const actor = await currentPlatformAdmin()
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const action = typeof body.action === 'string' ? body.action : ''
  const db = supabaseAdmin()
  const { data: sub } = await db
    .from('account_subscriptions')
    .select('status, trial_ends_at, external_subscription_id')
    .eq('account_id', id)
    .maybeSingle()
  if (!sub) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const now = new Date()
  let details: Record<string, unknown> = { before: sub.status }

  if (action === 'suspend') {
    await db.from('account_subscriptions').update({ status: 'suspended', updated_at: now.toISOString() }).eq('account_id', id)
  } else if (action === 'reactivate') {
    if (sub.status !== 'suspended') {
      return NextResponse.json({ error: 'Account is not suspended' }, { status: 400 })
    }
    // Trial state first; a subscription on Asaas then decides from its payments.
    await db.from('account_subscriptions').update({ status: 'trialing', updated_at: now.toISOString() }).eq('account_id', id)
    if (sub.external_subscription_id) await syncAccountSubscription(db, id)
  } else if (action === 'extend_trial') {
    const days = Number(body.days)
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      return NextResponse.json({ error: 'days must be 1–90' }, { status: 400 })
    }
    const end = extendedTrialEnd(sub.trial_ends_at as string | null, days, now)
    await db
      .from('account_subscriptions')
      .update({
        trial_ends_at: end.toISOString(),
        // A paying customer keeps its status; anyone else is back in trial.
        ...(sub.status === 'active' ? {} : { status: 'trialing' }),
        updated_at: now.toISOString(),
      })
      .eq('account_id', id)
    details = { ...details, days, trial_ends_at: end.toISOString() }
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const { data: after } = await db.from('account_subscriptions').select('status').eq('account_id', id).maybeSingle()
  await db.from('platform_audit').insert({
    actor_email: actor,
    account_id: id,
    action,
    details: { ...details, after: after?.status ?? null },
  })
  return NextResponse.json({ status: after?.status ?? null })
}
