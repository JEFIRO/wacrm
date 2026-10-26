// Plan limits checked on the server — docs/saas/b1-planos.md.
// The database enforces them too (migration 070); these give a clear
// error before work that is costly to undo (e.g. an Evolution instance).
import type { SupabaseClient } from '@supabase/supabase-js'

/** Whether the account already has as many numbers as its plan allows. */
export async function numberLimitReached(
  db: SupabaseClient,
  accountId: string,
): Promise<{ reached: boolean; max: number | null }> {
  const { data: sub } = await db
    .from('account_subscriptions')
    .select('plans(max_numbers)')
    .eq('account_id', accountId)
    .maybeSingle()
  const plan = (sub as { plans?: { max_numbers?: number } | null } | null)?.plans
  const max = plan?.max_numbers ?? null
  if (max === null) return { reached: false, max }
  const { count } = await db
    .from('whatsapp_config')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
  return { reached: (count ?? 0) >= max, max }
}

/**
 * Seats of the account (B3): the plan's included users plus the extra
 * users bought, against the members holding one (everyone but viewers)
 * and the pending non-viewer invitations. `limit` null = not limited.
 */
export async function seatUsage(
  db: SupabaseClient,
  accountId: string,
): Promise<{ limit: number | null; used: number; pending: number }> {
  const { data: sub } = await db
    .from('account_subscriptions')
    .select('extra_users, plans(included_users)')
    .eq('account_id', accountId)
    .maybeSingle()
  const row = sub as { extra_users?: number; plans?: { included_users?: number } | null } | null
  const limit = row?.plans?.included_users != null ? row.plans.included_users + (row.extra_users ?? 0) : null
  const [{ count: used }, { count: pending }] = await Promise.all([
    db
      .from('profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .neq('account_role', 'viewer'),
    db
      .from('account_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .neq('role', 'viewer')
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString()),
  ])
  return { limit, used: used ?? 0, pending: pending ?? 0 }
}
