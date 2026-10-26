import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * POST /api/billing/trial-plan — body `{ plan_id }`. Owner only (B5,
 * docs/saas/b5-cadastro.md). Switches the plan the free trial runs on,
 * without paying. Only while trialing and before any Asaas subscription
 * exists (after that, changing plan goes through /api/billing/subscribe).
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('owner')
    const body = await request.json().catch(() => ({}))
    const planId = typeof body.plan_id === 'string' ? body.plan_id : ''
    const db = supabaseAdmin()

    const [{ data: plan }, { data: sub }] = await Promise.all([
      db.from('plans').select('id, active').eq('id', planId).maybeSingle(),
      db
        .from('account_subscriptions')
        .select('status, external_subscription_id')
        .eq('account_id', accountId)
        .maybeSingle(),
    ])
    if (!plan?.active) return NextResponse.json({ error: t('billing.planUnavailable') }, { status: 400 })
    if (!sub || sub.status !== 'trialing' || sub.external_subscription_id) {
      return NextResponse.json({ error: t('billing.trialPlanLocked') }, { status: 409 })
    }

    await db
      .from('account_subscriptions')
      .update({ plan_id: plan.id, updated_at: new Date().toISOString() })
      .eq('account_id', accountId)
    return NextResponse.json({ plan_id: plan.id })
  } catch (error) {
    return toErrorResponse(error)
  }
}
