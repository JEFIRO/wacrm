import { describe, expect, it } from 'vitest';

import {
  isWithinSchedule,
  nextScheduleStart,
  type ScheduleRange,
} from './schedule';
import { isEligible, pickAgent, planRebalance, type AgentSnapshot } from './pick';
import { formatNextSlot, nextNoticeRetry, renderQueueMessage } from './queue-message';

const SP = 'America/Sao_Paulo'; // UTC-3, no DST
// Wednesday 2026-10-21 15:00 in São Paulo = 18:00 UTC.
const WED_15H = new Date('2026-10-21T18:00:00Z');
const MON_FRI_12_18: ScheduleRange[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  start: '12:00',
  end: '18:00',
}));

function agent(userId: string, over: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    userId,
    isOnline: true,
    maxActiveLeads: 3,
    activeLeads: 0,
    schedules: MON_FRI_12_18,
    ...over,
  };
}

describe('schedule', () => {
  it('is inside the range on a weekday afternoon in the account timezone', () => {
    expect(isWithinSchedule(MON_FRI_12_18, WED_15H, SP)).toBe(true);
  });

  it('is outside before the start, at the end minute, and on weekends', () => {
    expect(isWithinSchedule(MON_FRI_12_18, new Date('2026-10-21T14:59:00Z'), SP)).toBe(false); // 11:59
    expect(isWithinSchedule(MON_FRI_12_18, new Date('2026-10-21T21:00:00Z'), SP)).toBe(false); // 18:00
    expect(isWithinSchedule(MON_FRI_12_18, new Date('2026-10-24T18:00:00Z'), SP)).toBe(false); // Sat
  });

  it('uses the account timezone, not UTC', () => {
    // 13:00 UTC = 10:00 in São Paulo: outside; the same instant is
    // 14:00 in Lisbon (UTC+1 in October): inside.
    const instant = new Date('2026-10-21T13:00:00Z');
    expect(isWithinSchedule(MON_FRI_12_18, instant, SP)).toBe(false);
    expect(isWithinSchedule(MON_FRI_12_18, instant, 'Europe/Lisbon')).toBe(true);
  });

  it('treats an agent with no ranges as never available', () => {
    expect(isWithinSchedule([], new Date('2026-10-25T06:00:00Z'), SP)).toBe(false);
  });

  it('allows several ranges in one day', () => {
    const split: ScheduleRange[] = [
      { weekday: 3, start: '08:00', end: '12:00' },
      { weekday: 3, start: '14:00', end: '18:00' },
    ];
    expect(isWithinSchedule(split, new Date('2026-10-21T16:00:00Z'), SP)).toBe(false); // 13:00
    expect(isWithinSchedule(split, new Date('2026-10-21T17:00:00Z'), SP)).toBe(true); // 14:00
  });
});

describe('next schedule start', () => {
  it('is later the same day when today still has a start ahead', () => {
    const morning = new Date('2026-10-21T12:00:00Z'); // Wed 09:00
    expect(nextScheduleStart(MON_FRI_12_18, morning, SP)?.toISOString()).toBe(
      '2026-10-21T15:00:00.000Z', // Wed 12:00 São Paulo
    );
  });

  it('wraps over the weekend to Monday', () => {
    const fridayNight = new Date('2026-10-23T23:00:00Z'); // Fri 20:00
    expect(nextScheduleStart(MON_FRI_12_18, fridayNight, SP)?.toISOString()).toBe(
      '2026-10-26T15:00:00.000Z', // Mon 12:00
    );
  });

  it('wraps a full week to the same weekday', () => {
    const onlyWed: ScheduleRange[] = [{ weekday: 3, start: '12:00', end: '18:00' }];
    const afterStart = new Date('2026-10-21T15:30:00Z'); // Wed 12:30
    expect(nextScheduleStart(onlyWed, afterStart, SP)?.toISOString()).toBe(
      '2026-10-28T15:00:00.000Z', // next Wed 12:00
    );
  });

  it('is computed in the account timezone', () => {
    const now = new Date('2026-10-21T12:00:00Z');
    expect(nextScheduleStart(MON_FRI_12_18, now, 'Europe/Lisbon')?.toISOString()).toBe(
      '2026-10-22T11:00:00.000Z', // Thu 12:00 Lisbon (UTC+1); Wed 12:00 already passed there
    );
  });

  it('is null without any range', () => {
    expect(nextScheduleStart([], WED_15H, SP)).toBeNull();
  });
});

describe('who gets the lead', () => {
  it('picks the eligible agent with the fewest active leads', () => {
    const picked = pickAgent([agent('A', { activeLeads: 2 }), agent('B', { activeLeads: 1 })], WED_15H, SP);
    expect(picked?.userId).toBe('B');
  });

  it('breaks a tie at random with the injected generator', () => {
    const tied = [agent('A', { activeLeads: 1 }), agent('B', { activeLeads: 1 })];
    expect(pickAgent(tied, WED_15H, SP, () => 0)?.userId).toBe('A');
    expect(pickAgent(tied, WED_15H, SP, () => 0.99)?.userId).toBe('B');
  });

  it('skips agents outside their schedule', () => {
    const saturday = new Date('2026-10-24T18:00:00Z');
    expect(pickAgent([agent('A')], saturday, SP)).toBeNull();
    expect(isEligible(agent('A', { schedules: [] }), saturday, SP)).toBe(false); // no schedule, never eligible
  });

  it('skips offline agents', () => {
    const picked = pickAgent(
      [agent('A', { isOnline: false }), agent('B', { activeLeads: 2 })],
      WED_15H,
      SP,
    );
    expect(picked?.userId).toBe('B');
  });

  it('skips agents at their cap and queues when everyone is full', () => {
    const full = [agent('A', { activeLeads: 3 }), agent('B', { activeLeads: 2, maxActiveLeads: 2 })];
    expect(pickAgent(full, WED_15H, SP)).toBeNull();
  });
});

describe('rebalancing when a slot opens', () => {
  it('moves the unstarted 3rd lead of A=3 to B after B drops from 2 to 1', () => {
    const a = agent('A', { activeLeads: 3 });
    const leads = [
      { conversationId: 'l1', ownerId: 'A', started: true, reassignCount: 0 },
      { conversationId: 'l2', ownerId: 'A', started: true, reassignCount: 0 },
      { conversationId: 'l3', ownerId: 'A', started: false, reassignCount: 0 },
    ];
    // B at 2: gap of 1 — nothing moves.
    expect(planRebalance([a, agent('B', { activeLeads: 2 })], leads, WED_15H, SP)).toEqual([]);
    // B at 1: gap of 2 — the unstarted lead moves, once.
    expect(planRebalance([a, agent('B', { activeLeads: 1 })], leads, WED_15H, SP)).toEqual([
      { conversationId: 'l3', fromId: 'A', toId: 'B' },
    ]);
  });

  it('never moves a started lead', () => {
    const leads = [{ conversationId: 'l1', ownerId: 'A', started: true, reassignCount: 0 }];
    expect(
      planRebalance([agent('A', { activeLeads: 3 }), agent('B')], leads, WED_15H, SP),
    ).toEqual([]);
  });

  it('stops after the move cap so a lead cannot bounce forever', () => {
    const leads = [{ conversationId: 'l1', ownerId: 'A', started: false, reassignCount: 2 }];
    expect(
      planRebalance([agent('A', { activeLeads: 3 }), agent('B')], leads, WED_15H, SP),
    ).toEqual([]);
  });

  it('does not over-correct: loads are updated as moves are planned', () => {
    const leads = ['l1', 'l2', 'l3'].map((id) => ({
      conversationId: id,
      ownerId: 'A',
      started: false,
      reassignCount: 0,
    }));
    // A=3, B=0: one move gives A=2/B=1 (gap 1) — stop there.
    expect(
      planRebalance([agent('A', { activeLeads: 3 }), agent('B')], leads, WED_15H, SP),
    ).toHaveLength(1);
  });

  it('only moves to an eligible agent', () => {
    const leads = [{ conversationId: 'l1', ownerId: 'A', started: false, reassignCount: 0 }];
    expect(
      planRebalance(
        [agent('A', { activeLeads: 3 }), agent('B', { isOnline: false })],
        leads,
        WED_15H,
        SP,
      ),
    ).toEqual([]);
  });
});

describe('queue message', () => {
  it('fills {proximo_horario} with weekday and time in the account timezone', () => {
    const slot = new Date('2026-10-26T15:00:00Z'); // Mon 12:00 São Paulo
    const text = formatNextSlot(slot, SP, 'pt-BR', '{weekday} às {time}');
    expect(text).toBe('segunda-feira às 12:00');
    expect(
      renderQueueMessage(
        'Não há atendentes disponíveis no momento. Nosso próximo atendimento é {proximo_horario}.',
        text,
      ),
    ).toBe(
      'Não há atendentes disponíveis no momento. Nosso próximo atendimento é segunda-feira às 12:00.',
    );
  });

  it('sends the sentence without a date when no one has a future schedule', () => {
    expect(
      renderQueueMessage('Sem atendentes agora. Voltamos {proximo_horario} .', null),
    ).toBe('Sem atendentes agora. Voltamos.');
  });
});

describe('queue notice retries', () => {
  it('waits 1, 5, 15 and 60 minutes, then gives up after the 5th send', () => {
    const minutes = [1, 2, 3, 4].map(
      (attempts) => (nextNoticeRetry(attempts, WED_15H)!.getTime() - WED_15H.getTime()) / 60_000,
    );
    expect(minutes).toEqual([1, 5, 15, 60]);
    expect(nextNoticeRetry(5, WED_15H)).toBeNull();
  });
});
