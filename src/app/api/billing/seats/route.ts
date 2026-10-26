import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { asaasConfig, updateSubscription } from '@/lib/billing/asaas'
import { seatUsage } from '@/lib/billing/limits'
import { syncAccountSubscription } from '@/lib/billing/sync'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * POST /api/billing/seats — body `{ extra_users }`. Owner only (B3,
 * docs/saas/b3-assentos.md). Sets how many users the account buys on top
 * of its plan and updates the Asaas subscription value (plan price +
 * extra users × extra-user price). Needs an Asaas subscription and a
 * plan with an extra-user price; can't go below the seats in use.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('owner')
    const cfg = asaasConfig()
    if (!cfg) return NextResponse.json({ error: t('billing.notConfigured') }, { status: 503 })

    const body = await request.json().catch(() => ({}))
    const extra = Number(body.extra_users)
    if (!Number.isInteger(extra) || extra < 0 || extra > 500) {
      return NextResponse.json({ error: t('billing.invalidSeats') }, { status: 400 })
    }

    const db = supabaseAdmin()
    const { data: sub } = await db
      .from('account_subscriptions')
      .select('external_subscription_id, plans(name, monthly_price_cents, included_users, extra_user_price_cents)')
      .eq('account_id', accountId)
      .maybeSingle()
    const plan = (sub as { plans?: { name: string; monthly_price_cents: number | null; included_users: number; extra_user_price_cents: number | null } | null } | null)?.plans
    const subscriptionId = (sub as { external_subscription_id?: string | null } | null)?.external_subscription_id
    if (!plan || plan.monthly_price_cents === null || plan.extra_user_price_cents === null || !subscriptionId) {
      return NextResponse.json({ error: t('billing.seatsUnavailable') }, { status: 400 })
    }

    const usage = await seatUsage(db, accountId)
    if (plan.included_users + extra < usage.used) {
      return NextResponse.json({ error: t('billing.seatsBelowUsage', { used: usage.used }) }, { status: 400 })
    }

    const cents = plan.monthly_price_cents + extra * plan.extra_user_price_cents
    try {
      await updateSubscription(cfg, subscriptionId, {
        value: cents / 100,
        description: `wacrm — plano ${plan.name}${extra ? ` + ${extra} usuário(s) adicional(is)` : ''}`,
      })
    } catch (err) {
      console.error('[billing] seats update failed:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: t('billing.providerFailed') }, { status: 502 })
    }

    await db
      .from('account_subscriptions')
      .update({ extra_users: extra, updated_at: new Date().toISOString() })
      .eq('account_id', accountId)
    const synced = await syncAccountSubscription(db, accountId)
    return NextResponse.json({ extra_users: extra, monthly_cents: cents, invoice_url: synced?.invoiceUrl ?? null })
  } catch (error) {
    return toErrorResponse(error)
  }
}
