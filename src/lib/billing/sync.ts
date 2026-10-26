// ============================================================
// Keep account_subscriptions in step with Asaas — docs/saas/b2-asaas.md.
// Called by the Asaas webhook (any payment event of the subscription),
// after subscribing, and by the plan screen's "update status". Always
// re-reads the payments from Asaas; the webhook body is only a hint.
// Service-role client: filtered by account_id.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { AsaasError, asaasConfig, getSubscription, listSubscriptionPayments } from './asaas'
import { statusFromPayments } from './asaas-status'

export interface SyncResult {
  status: string
  invoiceUrl: string | null
}

export async function syncAccountSubscription(db: SupabaseClient, accountId: string): Promise<SyncResult | null> {
  const cfg = asaasConfig()
  if (!cfg) return null
  const { data: sub } = await db
    .from('account_subscriptions')
    .select('status, external_subscription_id')
    .eq('account_id', accountId)
    .maybeSingle()
  const externalId = (sub as { external_subscription_id?: string | null } | null)?.external_subscription_id
  if (!sub || !externalId) return null

  let active = true
  try {
    const remote = await getSubscription(cfg, externalId)
    active = !remote.deleted && remote.status !== 'INACTIVE'
  } catch (err) {
    if (!(err instanceof AsaasError && err.status === 404)) throw err
    active = false
  }
  const payments = active ? await listSubscriptionPayments(cfg, externalId) : []
  const synced = statusFromPayments(payments, active)

  const status = synced.status ?? (sub as { status: string }).status
  await db
    .from('account_subscriptions')
    .update({
      status,
      ...(synced.currentPeriodEnd ? { current_period_end: synced.currentPeriodEnd } : {}),
      pending_invoice_url: synced.invoiceUrl,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
  return { status, invoiceUrl: synced.invoiceUrl }
}
