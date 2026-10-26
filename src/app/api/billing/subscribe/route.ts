import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { asaasConfig, createCustomer, createSubscription, updateSubscription } from '@/lib/billing/asaas'
import { isValidCpfCnpj } from '@/lib/billing/asaas-status'
import { syncAccountSubscription } from '@/lib/billing/sync'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * POST /api/billing/subscribe — body `{ plan_id, cpf_cnpj }`. Owner only.
 *
 * Subscribes the account to a plan on Asaas (docs/saas/b2-asaas.md):
 * creates (or reuses) the Asaas customer and the monthly subscription —
 * the payer picks Pix, boleto or card on the invoice; the annual plan is
 * 12 monthly instalments — or, if one exists, changes its value. During
 * the trial the first charge is due when the trial ends; otherwise today.
 * Returns the invoice of the next charge to pay.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId, account } = await requireRole('owner')
    const cfg = asaasConfig()
    if (!cfg) return NextResponse.json({ error: t('billing.notConfigured') }, { status: 503 })

    const body = await request.json().catch(() => ({}))
    const planId = typeof body.plan_id === 'string' ? body.plan_id : ''
    const cpfCnpj = typeof body.cpf_cnpj === 'string' ? body.cpf_cnpj.replace(/\D/g, '') : ''
    if (!isValidCpfCnpj(cpfCnpj)) {
      return NextResponse.json({ error: t('billing.invalidDocument'), field: 'cpf_cnpj' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const { data: plan } = await db
      .from('plans')
      .select('id, name, monthly_price_cents, billing_cycle, active')
      .eq('id', planId)
      .maybeSingle()
    if (!plan || !plan.active || plan.monthly_price_cents === null) {
      return NextResponse.json({ error: t('billing.planUnavailable') }, { status: 400 })
    }

    const { data: sub } = await db
      .from('account_subscriptions')
      .select('status, trial_ends_at, external_customer_id, external_subscription_id')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!sub) return NextResponse.json({ error: t('billing.planUnavailable') }, { status: 400 })

    const value = plan.monthly_price_cents / 100
    const description = `wacrm — plano ${plan.name}`
    let customerId = sub.external_customer_id as string | null
    let subscriptionId = sub.external_subscription_id as string | null

    try {
      if (!customerId) {
        const { data: owner } = await db.from('profiles').select('email').eq('user_id', userId).maybeSingle()
        const customer = await createCustomer(cfg, {
          name: account.name,
          cpfCnpj,
          email: (owner?.email as string | undefined) ?? null,
          externalReference: accountId,
        })
        customerId = customer.id
      }

      if (subscriptionId) {
        await updateSubscription(cfg, subscriptionId, { value, description })
      } else {
        const now = new Date()
        const trialEnd = sub.trial_ends_at ? new Date(sub.trial_ends_at as string) : null
        const due = sub.status === 'trialing' && trialEnd && trialEnd > now ? trialEnd : now
        const created = await createSubscription(cfg, customerId, {
          value,
          nextDueDate: due.toISOString().slice(0, 10),
          description,
          externalReference: accountId,
          ...(plan.billing_cycle === 'yearly' ? { maxPayments: 12 } : {}),
        })
        subscriptionId = created.id
      }
    } catch (err) {
      console.error('[billing] subscribe failed:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: t('billing.providerFailed') }, { status: 502 })
    }

    await db
      .from('account_subscriptions')
      .update({
        plan_id: plan.id,
        billing_provider: 'asaas',
        external_customer_id: customerId,
        external_subscription_id: subscriptionId,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)

    const synced = await syncAccountSubscription(db, accountId)
    return NextResponse.json({ status: synced?.status ?? null, invoice_url: synced?.invoiceUrl ?? null })
  } catch (error) {
    return toErrorResponse(error)
  }
}
