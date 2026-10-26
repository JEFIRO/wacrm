import { describe, expect, it } from 'vitest';
import { customerSituation, extendedTrialEnd, monthlyRevenueCents, summarize, type PlatformAccountRow } from './overview';

const NOW = new Date('2026-10-25T12:00:00Z');
const row = (over: Partial<PlatformAccountRow>): PlatformAccountRow => ({
  account_id: 'a',
  account_name: 'Loja',
  created_at: '2026-10-01T00:00:00Z',
  owner_email: 'dono@loja.com',
  plan_id: 'impulso',
  plan_name: 'Impulso',
  status: 'trialing',
  trial_ends_at: '2026-11-20T00:00:00Z',
  current_period_end: null,
  extra_users: 0,
  monthly_price_cents: 44970,
  extra_user_price_cents: 14990,
  external_customer_id: null,
  seats_used: 1,
  seats_limit: 3,
  numbers: 1,
  provider: 'evolution',
  messages_30d: 10,
  last_message_at: null,
  ...over,
});

describe('platform overview', () => {
  it('groups customers by situation', () => {
    expect(customerSituation(row({}), NOW)).toBe('trial');
    expect(customerSituation(row({ trial_ends_at: '2026-10-20T00:00:00Z' }), NOW)).toBe('limited');
    expect(customerSituation(row({ trial_ends_at: '2026-09-01T00:00:00Z' }), NOW)).toBe('blocked');
    expect(customerSituation(row({ status: 'active' }), NOW)).toBe('active');
    expect(customerSituation(row({ status: 'suspended' }), NOW)).toBe('blocked');
    expect(customerSituation(row({ status: null, plan_id: null }), NOW)).toBe('none');
  });

  it('counts monthly revenue only for paying customers, extra attendants included', () => {
    expect(monthlyRevenueCents(row({}))).toBe(0);
    expect(monthlyRevenueCents(row({ status: 'active', extra_users: 2 }))).toBe(44970 + 2 * 14990);
  });

  it('summarizes the table', () => {
    const s = summarize(
      [row({}), row({ status: 'active' }), row({ status: 'suspended' }), row({ trial_ends_at: '2026-10-20T00:00:00Z' })],
      NOW,
    );
    expect(s).toEqual({ total: 4, trial: 1, active: 1, limited: 1, blocked: 1, mrrCents: 44970 });
  });

  it('extends a trial from its end, or from today once over', () => {
    expect(extendedTrialEnd('2026-11-20T00:00:00Z', 7, NOW).toISOString()).toBe('2026-11-27T00:00:00.000Z');
    expect(extendedTrialEnd('2026-10-01T00:00:00Z', 7, NOW).toISOString()).toBe('2026-11-01T12:00:00.000Z');
  });
});
