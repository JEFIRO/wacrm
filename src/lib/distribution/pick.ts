// ============================================================
// Who gets a lead — docs/saas/setores-e-distribuicao.md.
//
// Pure decisions over a snapshot of a sector's agents. The database
// re-checks capacity atomically (claim_lead) before anything is written,
// so a stale snapshot can only make a claim fail, never overfill.
// ============================================================
import { isWithinSchedule, type ScheduleRange } from './schedule';

export interface AgentSnapshot {
  userId: string;
  isOnline: boolean;
  maxActiveLeads: number;
  /** Open (not closed) conversations currently assigned to the agent. */
  activeLeads: number;
  schedules: ScheduleRange[];
}

export interface LeadSnapshot {
  conversationId: string;
  ownerId: string;
  /** The owner already replied — never moved. */
  started: boolean;
  reassignCount: number;
}

/** Defaults for rebalancing: move only with a real gap, and not forever. */
export const REBALANCE_MIN_GAP = 2;
export const REBALANCE_MAX_MOVES = 2;

/** Online, inside their schedule now, and below their cap. */
export function isEligible(agent: AgentSnapshot, now: Date, timeZone: string): boolean {
  return (
    agent.isOnline &&
    agent.activeLeads < agent.maxActiveLeads &&
    isWithinSchedule(agent.schedules, now, timeZone)
  );
}

/**
 * The eligible agent with the fewest active leads; ties broken at random
 * with the injected `random` (Math.random in production, fixed in tests).
 * Null when nobody is eligible — the lead goes to the sector queue.
 */
export function pickAgent(
  agents: AgentSnapshot[],
  now: Date,
  timeZone: string,
  random: () => number = Math.random,
): AgentSnapshot | null {
  const eligible = agents.filter((a) => isEligible(a, now, timeZone));
  if (eligible.length === 0) return null;
  const least = Math.min(...eligible.map((a) => a.activeLeads));
  const tied = eligible.filter((a) => a.activeLeads === least);
  return tied[Math.min(tied.length - 1, Math.floor(random() * tied.length))];
}

export interface RebalanceMove {
  conversationId: string;
  fromId: string;
  toId: string;
}

/**
 * Moves of not-yet-started leads to a less loaded eligible agent of the
 * same sector, run only when a slot opens. A lead moves when the target
 * has at least `minGap` fewer active leads than its owner (so A=3,B=1
 * moves one, A=3,B=2 does not) and it has moved fewer than `maxMoves`
 * times. Loads are updated as moves are planned, so one call never
 * over-corrects.
 */
export function planRebalance(
  agents: AgentSnapshot[],
  leads: LeadSnapshot[],
  now: Date,
  timeZone: string,
  random: () => number = Math.random,
  { minGap = REBALANCE_MIN_GAP, maxMoves = REBALANCE_MAX_MOVES } = {},
): RebalanceMove[] {
  const state = agents.map((a) => ({ ...a }));
  const byId = new Map(state.map((a) => [a.userId, a]));
  const moves: RebalanceMove[] = [];

  // Most loaded owners first, so the biggest imbalance is fixed first.
  const candidates = leads
    .filter((l) => !l.started && l.reassignCount < maxMoves && byId.has(l.ownerId))
    .sort((a, b) => byId.get(b.ownerId)!.activeLeads - byId.get(a.ownerId)!.activeLeads);

  for (const lead of candidates) {
    const owner = byId.get(lead.ownerId)!;
    const targets = state.filter(
      (a) =>
        a.userId !== owner.userId &&
        isEligible(a, now, timeZone) &&
        owner.activeLeads - a.activeLeads >= minGap,
    );
    const target = pickAgent(targets, now, timeZone, random);
    if (!target) continue;
    moves.push({ conversationId: lead.conversationId, fromId: owner.userId, toId: target.userId });
    owner.activeLeads -= 1;
    target.activeLeads += 1;
  }
  return moves;
}
