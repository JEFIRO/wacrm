import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadChannel } from './channels';

interface Row {
  id: string;
  account_id: string;
  is_default: boolean;
  created_at: string;
}

const rows: Row[] = [
  { id: 'old', account_id: 'acct-1', is_default: false, created_at: '2026-01-01' },
  { id: 'def', account_id: 'acct-1', is_default: true, created_at: '2026-02-01' },
  { id: 'other', account_id: 'acct-2', is_default: true, created_at: '2026-01-01' },
];

// Minimal in-memory stand-in for the PostgREST chain loadChannel uses:
// eq filters, is_default desc / created_at asc ordering, limit,
// maybeSingle.
function fakeDb(data: Row[]): SupabaseClient {
  return {
    from() {
      let result = [...data];
      const chain = {
        select: () => chain,
        eq(col: keyof Row, value: unknown) {
          result = result.filter((r) => r[col] === value);
          return chain;
        },
        order: () => chain,
        limit(n: number) {
          result.sort(
            (a, b) =>
              Number(b.is_default) - Number(a.is_default) ||
              a.created_at.localeCompare(b.created_at)
          );
          return Promise.resolve({ data: result.slice(0, n), error: null });
        },
        maybeSingle: () =>
          Promise.resolve({ data: result[0] ?? null, error: null }),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe('loadChannel', () => {
  it('returns the default channel when no channel is asked for', async () => {
    const row = await loadChannel<Row>(fakeDb(rows), 'acct-1');
    expect(row?.id).toBe('def');
  });

  it('returns the requested channel of the account', async () => {
    const row = await loadChannel<Row>(fakeDb(rows), 'acct-1', 'old');
    expect(row?.id).toBe('old');
  });

  it("never resolves another account's channel", async () => {
    const row = await loadChannel<Row>(fakeDb(rows), 'acct-1', 'other');
    expect(row).toBeNull();
  });

  it('falls back to the oldest row when no default is flagged', async () => {
    const noDefault = rows.map((r) => ({ ...r, is_default: false }));
    const row = await loadChannel<Row>(fakeDb(noDefault), 'acct-1');
    expect(row?.id).toBe('old');
  });

  it('returns null for an account without channels', async () => {
    expect(await loadChannel(fakeDb(rows), 'acct-9')).toBeNull();
  });
});
