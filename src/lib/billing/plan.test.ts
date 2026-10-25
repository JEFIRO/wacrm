import { describe, expect, it } from 'vitest';
import { formatBRL, seatLimit, seatsUsed, subscriptionPhase, trialDaysLeft, type Subscription } from './plan';

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
