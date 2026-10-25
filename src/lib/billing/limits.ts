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
