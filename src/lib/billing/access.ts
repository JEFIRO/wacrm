// Billing access on the server — docs/saas/b1-planos.md ("Fim do teste").
// Reads the account's subscription and applies billingAccess(): full,
// limited (expired trial / overdue: slower, fewer features, warning) or
// blocked (nothing goes out; inbound is still stored).
import type { SupabaseClient } from '@supabase/supabase-js'
import { billingAccess, type BillingAccess, type Subscription } from './plan'

export async function loadBillingAccess(
  db: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
): Promise<BillingAccess> {
  const { data } = await db
    .from('account_subscriptions')
    .select('plan_id, status, trial_ends_at, current_period_end, extra_users')
    .eq('account_id', accountId)
    .maybeSingle()
  return billingAccess((data as Subscription | null) ?? null, now)
}
