// ============================================================
// Plans and subscription state — docs/saas/b1-planos.md. Pure.
// Plans include a number of users; extra users are bought on top.
// Viewers (read-only) don't take a seat.
// ============================================================

export interface Plan {
  id: string
  name: string
  /** Null while the price is still being decided (annual plan). */
  monthly_price_cents: number | null
  /** 'yearly' = 12-month commitment paid in monthly instalments. */
  billing_cycle: 'monthly' | 'yearly'
  /** 'per_seat': price per attendant (extra_user_price_cents), minimum
   *  included_users; 'flat': monthly_price_cents for the account. */
  pricing: 'flat' | 'per_seat'
  tagline: string | null
  highlight: boolean
  features: string[]
  active: boolean
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

/** Days an account keeps working (limited) after the trial or a due
 *  date passes unpaid — "until the next due date". Then it is blocked. */
export const GRACE_DAYS = 30

export type AccessLevel = 'full' | 'limited' | 'blocked'

export interface BillingAccess {
  level: AccessLevel
  /** Why it isn't full. */
  reason?: 'trial_expired' | 'past_due' | 'suspended' | 'canceled'
  /** When a limited account becomes blocked. */
  blocksAt?: Date
  /** Days left of a running trial (counting today). */
  trialDaysLeft?: number
}

const plusDays = (iso: string | null, days: number, fallback: Date) =>
  new Date((iso ? new Date(iso) : fallback).getTime() + days * 86_400_000)

/**
 * What the account may do now (decision of the user, 2026-10-25): an
 * expired trial or an overdue payment keeps the account working in a
 * LIMITED mode until the next due date; still unpaid then, BLOCKED.
 * Suspended / canceled accounts are blocked.
 */
export function billingAccess(sub: Subscription | null, now: Date): BillingAccess {
  if (!sub) return { level: 'full' }
  switch (sub.status) {
    case 'active':
      return { level: 'full' }
    case 'trialing': {
      if (!sub.trial_ends_at) return { level: 'full' }
      if (new Date(sub.trial_ends_at) > now) return { level: 'full', trialDaysLeft: trialDaysLeft(sub, now) }
      const blocksAt = plusDays(sub.trial_ends_at, GRACE_DAYS, now)
      return blocksAt > now
        ? { level: 'limited', reason: 'trial_expired', blocksAt }
        : { level: 'blocked', reason: 'trial_expired' }
    }
    case 'past_due': {
      const blocksAt = plusDays(sub.current_period_end, GRACE_DAYS, now)
      return blocksAt > now
        ? { level: 'limited', reason: 'past_due', blocksAt }
        : { level: 'blocked', reason: 'past_due' }
    }
    default:
      return { level: 'blocked', reason: sub.status }
  }
}

/** Pause before each manual send while limited ("slower"). */
export const LIMITED_SEND_DELAY_MS = 5000

/** "R$ 349,00" */
export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}
