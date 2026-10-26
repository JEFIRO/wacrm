// ============================================================
// SaaS owner's panel — docs/saas/b6-painel.md. Pure: who counts as
// what, and the summary on top of the customer table.
// ============================================================
import { billingAccess, type Subscription, type SubscriptionStatus } from '@/lib/billing/plan'

export interface PlatformAccountRow {
  account_id: string
  account_name: string
  created_at: string
  owner_email: string | null
  plan_id: string | null
  plan_name: string | null
  status: SubscriptionStatus | null
  trial_ends_at: string | null
  current_period_end: string | null
  extra_users: number | null
  monthly_price_cents: number | null
  extra_user_price_cents: number | null
  external_customer_id: string | null
  seats_used: number
  seats_limit: number | null
  numbers: number
  provider: string | null
  messages_30d: number
  last_message_at: string | null
}

/** Where the customer stands, as the panel groups them. */
export type CustomerSituation = 'trial' | 'active' | 'limited' | 'blocked' | 'none'

export function customerSituation(row: PlatformAccountRow, now: Date): CustomerSituation {
  if (!row.status || !row.plan_id) return 'none'
  const access = billingAccess(
    {
      plan_id: row.plan_id,
      status: row.status,
      trial_ends_at: row.trial_ends_at,
      current_period_end: row.current_period_end,
      extra_users: row.extra_users ?? 0,
    } satisfies Subscription,
    now,
  )
  if (access.level === 'blocked') return 'blocked'
  if (access.level === 'limited') return 'limited'
  return row.status === 'active' ? 'active' : 'trial'
}

/** Monthly revenue of a paying customer: plan + extra attendants. */
export function monthlyRevenueCents(row: PlatformAccountRow): number {
  if (row.status !== 'active' || row.monthly_price_cents === null) return 0
  return row.monthly_price_cents + (row.extra_users ?? 0) * (row.extra_user_price_cents ?? 0)
}

export interface PlatformSummary {
  total: number
  trial: number
  active: number
  limited: number
  blocked: number
  mrrCents: number
}

export function summarize(rows: PlatformAccountRow[], now: Date): PlatformSummary {
  const s: PlatformSummary = { total: rows.length, trial: 0, active: 0, limited: 0, blocked: 0, mrrCents: 0 }
  for (const row of rows) {
    const situation = customerSituation(row, now)
    if (situation !== 'none') s[situation] += 1
    s.mrrCents += monthlyRevenueCents(row)
  }
  return s
}

/** New trial end: N days from today or from the current end, whichever is later. */
export function extendedTrialEnd(current: string | null, days: number, now: Date): Date {
  const base = current && new Date(current) > now ? new Date(current) : now
  return new Date(base.getTime() + days * 86_400_000)
}
