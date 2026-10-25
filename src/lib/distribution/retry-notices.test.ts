import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { retryQueueNotices } from './distribute';

const NOW = new Date('2026-10-21T18:00:00Z');

// Minimal stand-in for the query builder: every chained call returns the
// builder; awaiting it answers by what was asked. Updates are recorded.
function fakeDb(rows: Record<string, unknown>[]) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      let update: Record<string, unknown> | null = null;
      let selectAfterUpdate = false;
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'not', 'lte', 'is', 'order', 'limit', 'eq']) {
        builder[m] = () => {
          if (m === 'select' && update) selectAfterUpdate = true;
          return builder;
        };
      }
      builder.update = (payload: Record<string, unknown>) => {
        update = payload;
        updates.push(payload);
        return builder;
      };
      builder.maybeSingle = () => Promise.resolve({ data: { owner_user_id: 'owner-1' } });
      builder.then = (resolve: (v: unknown) => void) => {
        if (table !== 'conversations') return resolve({ data: null });
        if (update) return resolve({ data: selectAfterUpdate ? [{ id: 'c1' }] : null });
        return resolve({ data: rows });
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, updates };
}

const queued = {
  id: 'c1',
  account_id: 'acc-1',
  contact_id: 'k1',
  assigned_agent_id: null,
  queued_at: '2026-10-21T17:00:00Z',
  status: 'pending',
  queue_notice_text: 'Sem atendentes agora.',
  queue_notice_user_id: 'u1',
  queue_notice_attempts: 1,
  queue_notice_retry_at: '2026-10-21T17:59:00Z',
};

describe('queue notice retry (cron)', () => {
  it('sends the stored notice and marks it sent', async () => {
    const { db, updates } = fakeDb([queued]);
    const send = vi.fn().mockResolvedValue({});
    const result = await retryQueueNotices(db, send, { now: NOW });

    expect(send).toHaveBeenCalledWith({
      accountId: 'acc-1',
      conversationId: 'c1',
      contactId: 'k1',
      userId: 'u1',
      text: 'Sem atendentes agora.',
    });
    expect(result).toEqual({ sent: 1, retrying: 0, failed: 0 });
    expect(updates.at(-1)).toMatchObject({
      queue_notice_sent_at: NOW.toISOString(),
      queue_notice_text: null,
      queue_notice_attempts: 2,
    });
  });

  it('schedules the next try when the send fails again', async () => {
    const { db, updates } = fakeDb([queued]);
    const result = await retryQueueNotices(db, vi.fn().mockRejectedValue(new Error('meta down')), {
      now: NOW,
    });

    expect(result).toEqual({ sent: 0, retrying: 1, failed: 0 });
    expect(updates.at(-1)).toMatchObject({
      queue_notice_attempts: 2,
      queue_notice_retry_at: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
      queue_notice_failed_at: null,
    });
  });

  it('drops the notice when the lead already left the queue', async () => {
    const { db, updates } = fakeDb([{ ...queued, assigned_agent_id: 'agent-1', queued_at: null }]);
    const send = vi.fn();
    const result = await retryQueueNotices(db, send, { now: NOW });

    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, retrying: 0, failed: 0 });
    expect(updates.at(-1)).toEqual({ queue_notice_text: null });
  });

  it("falls back to the account owner as author when the flow's user is gone", async () => {
    const { db } = fakeDb([{ ...queued, queue_notice_user_id: null }]);
    const send = vi.fn().mockResolvedValue({});
    await retryQueueNotices(db, send, { now: NOW });
    expect(send.mock.calls[0][0].userId).toBe('owner-1');
  });
});
