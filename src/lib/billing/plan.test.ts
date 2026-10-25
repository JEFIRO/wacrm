import { describe, expect, it } from 'vitest';
import { billingAccess, formatBRL, seatLimit, seatsUsed, subscriptionPhase, trialDaysLeft, type Subscription } from './plan';

const NOW = new Date('2026-10-25T12:00:00Z');
const trial = (endsAt: string): Subscription => ({
  plan_id: 'profissional',
  status: 'trialing',
  trial_ends_at: endsAt,
  current_period_end: null,
  extra_users: 0,
});

describe('plan helpers', () => {
  it('counts trial days and spots an expired trial', () => {
    expect(trialDaysLeft(trial('2026-11-24T12:00:00Z'), NOW)).toBe(30);
    expect(trialDaysLeft(trial('2026-11-24T08:00:00Z'), NOW)).toBe(30);
    expect(trialDaysLeft(trial('2026-10-25T20:00:00Z'), NOW)).toBe(1);
    expect(trialDaysLeft(trial('2026-10-25T11:00:00Z'), NOW)).toBe(0);
    expect(subscriptionPhase(trial('2026-11-24T12:00:00Z'), NOW)).toBe('trialing');
    expect(subscriptionPhase(trial('2026-10-25T11:00:00Z'), NOW)).toBe('trial_expired');
    expect(subscriptionPhase({ ...trial('2026-10-01T00:00:00Z'), status: 'active' }, NOW)).toBe('active');
  });

  it('counts seats without viewers', () => {
    expect(seatsUsed(['owner', 'admin', 'agent', 'viewer', 'viewer'])).toBe(3);
    expect(seatLimit({ included_users: 5 }, { extra_users: 2 })).toBe(7);
  });

  it('formats prices in reais', () => {
    expect(formatBRL(34900).replace(/\s/g, ' ')).toBe('R$ 349,00');
  });
});

describe('billing access', () => {
  it('is full during the trial and when paid', () => {
    expect(billingAccess(trial('2026-11-24T12:00:00Z'), NOW).level).toBe('full');
    expect(billingAccess({ ...trial('2026-01-01T00:00:00Z'), status: 'active' }, NOW).level).toBe('full');
    expect(billingAccess(null, NOW).level).toBe('full');
  });

  it('limits an expired trial until the next due date, then blocks', () => {
    const limited = billingAccess(trial('2026-10-20T12:00:00Z'), NOW);
    expect(limited.level).toBe('limited');
    expect(limited.reason).toBe('trial_expired');
    expect(limited.blocksAt?.toISOString()).toBe('2026-11-19T12:00:00.000Z');
    expect(billingAccess(trial('2026-09-01T12:00:00Z'), NOW)).toEqual({ level: 'blocked', reason: 'trial_expired' });
  });

  it('limits an overdue payment for one cycle, then blocks', () => {
    const due = { ...trial(''), trial_ends_at: null, status: 'past_due' as const };
    expect(billingAccess({ ...due, current_period_end: '2026-10-10T00:00:00Z' }, NOW).level).toBe('limited');
    expect(billingAccess({ ...due, current_period_end: '2026-09-10T00:00:00Z' }, NOW).level).toBe('blocked');
  });

  it('blocks suspended and canceled accounts', () => {
    for (const status of ['suspended', 'canceled'] as const) {
      expect(billingAccess({ ...trial('2026-11-24T12:00:00Z'), status }, NOW).level).toBe('blocked');
    }
  });
});

