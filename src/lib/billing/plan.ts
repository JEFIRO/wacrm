// ============================================================
// Plans and subscription state — docs/saas/b1-planos.md. Pure.
// Plans include a number of users; extra users are bought on top.
// Viewers (read-only) don't take a seat.
// ============================================================

export interface Plan {
  id: string
  name: string
  monthly_price_cents: number
  setup_fee_cents: number
  included_users: number
  max_numbers: number
  extra_user_price_cents: number | null
  api_monthly_quota: number | null
  sort_order: number
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled'

export interface Subscription {
  plan_id: string
  status: SubscriptionStatus
  trial_ends_at: string | null
  current_period_end: string | null
  extra_users: number
}

/** What the account is living in right now, trial expiry included. */
export type SubscriptionPhase = SubscriptionStatus | 'trial_expired'

export function subscriptionPhase(sub: Subscription, now: Date): SubscriptionPhase {
  if (sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at) <= now) {
    return 'trial_expired'
  }
  return sub.status
}

/** Days of trial left, counting today (0 once expired). */
export function trialDaysLeft(sub: Subscription, now: Date): number {
  if (sub.status !== 'trialing' || !sub.trial_ends_at) return 0
  const ms = new Date(sub.trial_ends_at).getTime() - now.getTime()
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000)
}

/** Users the account may have taking a seat: included + bought. */
export function seatLimit(plan: Pick<Plan, 'included_users'>, sub: Pick<Subscription, 'extra_users'>): number {
  return plan.included_users + sub.extra_users
}

/** Members that take a seat — everyone but read-only viewers. */
export function seatsUsed(roles: string[]): number {
  return roles.filter((r) => r !== 'viewer').length
}

/** "R$ 349,00" */
export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}
