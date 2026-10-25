// ============================================================
// Lead distribution against the database — docs/saas/setores-e-distribuicao.md.
//
// Loads a sector's snapshot, decides with the pure functions in
// pick.ts / schedule.ts, and writes every assignment through the
// claim_lead() RPC, which re-checks the cap under a row lock. Server
// only: takes the service-role client, and every query is filtered by
// account_id (the service role bypasses RLS).
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { getT } from '@/lib/i18n/translate'
import { nextScheduleStart, type ScheduleRange } from './schedule'
import { pickAgent, planRebalance, type AgentSnapshot, type LeadSnapshot } from './pick'
import { formatNextSlot, nextNoticeRetry, renderQueueMessage } from './queue-message'

const t = getT('Distribution')

const INTL_LOCALE: Record<string, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-ES', ko: 'ko-KR' }

export interface DistributionOptions {
  now?: Date
  random?: () => number
}

async function accountTimezone(db: SupabaseClient, accountId: string): Promise<string> {
  const { data } = await db.from('accounts').select('timezone').eq('id', accountId).maybeSingle()
  return (data?.timezone as string | undefined) ?? 'America/Sao_Paulo'
}

/** The sector's members as distribution snapshots (settings, schedule, load). */
export async function loadSectorAgents(
  db: SupabaseClient,
  accountId: string,
  sectorId: string,
): Promise<AgentSnapshot[]> {
  const { data: members } = await db
    .from('sector_members')
    .select('user_id')
    .eq('account_id', accountId)
    .eq('sector_id', sectorId)
  const ids = (members ?? []).map((m: { user_id: string }) => m.user_id)
  if (ids.length === 0) return []

  const [{ data: settings }, { data: schedules }, { data: load }] = await Promise.all([
    db
      .from('agent_settings')
      .select('user_id, is_online, max_active_leads')
      .eq('account_id', accountId)
      .in('user_id', ids),
    db
      .from('agent_schedules')
      .select('user_id, weekday, start_time, end_time')
      .eq('account_id', accountId)
      .in('user_id', ids),
    db
      .from('conversations')
      .select('assigned_agent_id')
      .eq('account_id', accountId)
      .in('assigned_agent_id', ids)
      .neq('status', 'closed'),
  ])

  return ids.map((userId) => {
    const s = (settings ?? []).find((r: { user_id: string }) => r.user_id === userId) as
      | { is_online: boolean; max_active_leads: number }
      | undefined
    return {
      userId,
      // No settings row yet = never went online.
      isOnline: s?.is_online ?? false,
      maxActiveLeads: s?.max_active_leads ?? 3,
      activeLeads: (load ?? []).filter(
        (c: { assigned_agent_id: string }) => c.assigned_agent_id === userId,
      ).length,
      schedules: (schedules ?? [])
        .filter((r: { user_id: string }) => r.user_id === userId)
        .map((r: { weekday: number; start_time: string; end_time: string }): ScheduleRange => ({
          weekday: r.weekday,
          start: r.start_time,
          end: r.end_time,
        })),
    }
  })
}

/** Atomic assignment; false when the agent filled up or the lead moved on. */
async function claim(
  db: SupabaseClient,
  conversationId: string,
  agentId: string,
  expectedOwner: string | null,
): Promise<boolean> {
  const { data, error } = await db.rpc('claim_lead', {
    p_conversation_id: conversationId,
    p_agent_id: agentId,
    p_expected_owner: expectedOwner,
  })
  if (error) {
    console.error('[distribution] claim_lead failed:', error.message)
    return false
  }
  return data === true
}

/**
 * Pick and claim, retrying with the next candidate if a concurrent
 * distribution took the agent's last slot. Mutates the snapshot loads.
 */
async function assignOne(
  db: SupabaseClient,
  conversationId: string,
  agents: AgentSnapshot[],
  now: Date,
  timeZone: string,
  random: () => number,
): Promise<string | null> {
  for (let attempt = 0; attempt < agents.length; attempt++) {
    const agent = pickAgent(agents, now, timeZone, random)
    if (!agent) return null
    if (await claim(db, conversationId, agent.userId, null)) {
      agent.activeLeads += 1
      return agent.userId
    }
    // Lost the race (or went offline meanwhile): treat as full here.
    agent.activeLeads = agent.maxActiveLeads
  }
  return null
}

/**
 * A slot opened in the sector: hand queued leads out (oldest first),
 * then rebalance unstarted leads. Returns what happened, for logs.
 */
export async function distributeSector(
  db: SupabaseClient,
  accountId: string,
  sectorId: string,
  { now = new Date(), random = Math.random }: DistributionOptions = {},
): Promise<{ assigned: number; moved: number }> {
  const timeZone = await accountTimezone(db, accountId)
  const agents = await loadSectorAgents(db, accountId, sectorId)
  if (agents.length === 0) return { assigned: 0, moved: 0 }

  const { data: queued } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('sector_id', sectorId)
    .is('assigned_agent_id', null)
    .not('queued_at', 'is', null)
    .neq('status', 'closed')
    .order('queued_at', { ascending: true })

  let assigned = 0
  for (const lead of queued ?? []) {
    const to = await assignOne(db, (lead as { id: string }).id, agents, now, timeZone, random)
    if (!to) break
    assigned += 1
  }

  const { data: unstarted } = await db
    .from('conversations')
    .select('id, assigned_agent_id, reassign_count')
    .eq('account_id', accountId)
    .eq('sector_id', sectorId)
    .in('assigned_agent_id', agents.map((a) => a.userId))
    .is('started_at', null)
    .neq('status', 'closed')

  const leads: LeadSnapshot[] = (unstarted ?? []).map(
    (c: { id: string; assigned_agent_id: string; reassign_count: number }) => ({
      conversationId: c.id,
      ownerId: c.assigned_agent_id,
      started: false,
      reassignCount: c.reassign_count,
    }),
  )
  let moved = 0
  for (const move of planRebalance(agents, leads, now, timeZone, random)) {
    if (await claim(db, move.conversationId, move.toId, move.fromId)) moved += 1
  }
  return { assigned, moved }
}

/** Every sector of the account — for events that may open slots anywhere. */
export async function distributeAccount(
  db: SupabaseClient,
  accountId: string,
  options: DistributionOptions = {},
): Promise<{ assigned: number; moved: number }> {
  const { data: sectors } = await db.from('sectors').select('id').eq('account_id', accountId)
  const total = { assigned: 0, moved: 0 }
  for (const s of sectors ?? []) {
    const r = await distributeSector(db, accountId, (s as { id: string }).id, options)
    total.assigned += r.assigned
    total.moved += r.moved
  }
  return total
}

/**
 * Cron safety net (catches a schedule starting): every sector that has a
 * queue or unstarted leads. Moves nothing by idle time — it only acts if
 * eligibility changed.
 */
export async function distributePending(
  db: SupabaseClient,
  options: DistributionOptions = {},
): Promise<{ sectors: number; assigned: number; moved: number }> {
  const { data } = await db
    .from('conversations')
    .select('account_id, sector_id')
    .not('sector_id', 'is', null)
    .neq('status', 'closed')
    .or('queued_at.not.is.null,and(assigned_agent_id.not.is.null,started_at.is.null)')
  const pairs = new Map<string, { accountId: string; sectorId: string }>()
  for (const r of (data ?? []) as { account_id: string; sector_id: string }[]) {
    pairs.set(`${r.account_id}:${r.sector_id}`, { accountId: r.account_id, sectorId: r.sector_id })
  }
  const total = { sectors: pairs.size, assigned: 0, moved: 0 }
  for (const { accountId, sectorId } of pairs.values()) {
    const r = await distributeSector(db, accountId, sectorId, options)
    total.assigned += r.assigned
    total.moved += r.moved
  }
  return total
}

export interface RouteLeadOutcome {
  assignedTo: string | null
  queued: boolean
  /** The queue notice went out now (false if not needed or the send failed). */
  noticeSent: boolean
  /** The send failed: the cron tries again at this time. */
  noticeRetryAt: string | null
  /** The rendered notice, when one was attempted — for the flow log. */
  notice: string | null
}

export interface RouteLeadArgs {
  accountId: string
  conversationId: string
  sectorId: string
  /** Sent once when the lead is queued; `{proximo_horario}` is filled in. */
  queueMessage?: string | null
  /** Author of the notice message row — also used by the retries. */
  noticeUserId: string
  /** Sends text on the conversation's own number (engine send helper). */
  sendText: (text: string) => Promise<unknown>
}

/**
 * Put a lead in a sector and give it to an agent now, or queue it and
 * tell the customer (once) when the next agent starts.
 */
export async function routeLead(
  db: SupabaseClient,
  { accountId, conversationId, sectorId, queueMessage, noticeUserId, sendText }: RouteLeadArgs,
  { now = new Date(), random = Math.random }: DistributionOptions = {},
): Promise<RouteLeadOutcome> {
  await db
    .from('conversations')
    .update({ sector_id: sectorId, status: 'pending', updated_at: now.toISOString() })
    .eq('id', conversationId)
    .eq('account_id', accountId)

  const timeZone = await accountTimezone(db, accountId)
  const agents = await loadSectorAgents(db, accountId, sectorId)

  const { data: conv } = await db
    .from('conversations')
    .select('assigned_agent_id, queued_at, queue_notice_sent_at, queue_notice_retry_at')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  // Already with an agent of this sector (e.g. the flow re-entered).
  if (conv?.assigned_agent_id && agents.some((a) => a.userId === conv.assigned_agent_id)) {
    return { assignedTo: conv.assigned_agent_id as string, queued: false, noticeSent: false, noticeRetryAt: null, notice: null }
  }
  if (conv?.assigned_agent_id) {
    // Owned by someone outside the target sector: release it first.
    await db
      .from('conversations')
      .update({ assigned_agent_id: null })
      .eq('id', conversationId)
      .eq('account_id', accountId)
  }

  const assignedTo = await assignOne(db, conversationId, agents, now, timeZone, random)
  if (assignedTo) return { assignedTo, queued: false, noticeSent: false, noticeRetryAt: null, notice: null }

  await db
    .from('conversations')
    .update({ queued_at: (conv?.queued_at as string | null) ?? now.toISOString() })
    .eq('id', conversationId)
    .eq('account_id', accountId)

  // Once per lead: already sent, or a failed send is waiting for its retry.
  if (!queueMessage?.trim() || conv?.queue_notice_sent_at || conv?.queue_notice_retry_at) {
    return { assignedTo: null, queued: true, noticeSent: false, noticeRetryAt: null, notice: null }
  }

  const slot = nextScheduleStart(
    agents.flatMap((a) => a.schedules),
    now,
    timeZone,
  )
  const locale = INTL_LOCALE[process.env.NEXT_PUBLIC_APP_LOCALE ?? ''] ?? 'pt-BR'
  const text = renderQueueMessage(
    queueMessage,
    slot ? formatNextSlot(slot, timeZone, locale, t('nextSlotPattern')) : null,
  )
  try {
    await sendText(text)
  } catch (err) {
    // Keep the text and let the cron retry it (retryQueueNotices).
    console.error('[distribution] queue notice failed:', err instanceof Error ? err.message : err)
    const retryAt = nextNoticeRetry(1, now)?.toISOString() ?? null
    await db
      .from('conversations')
      .update({
        queue_notice_text: text,
        queue_notice_user_id: noticeUserId,
        queue_notice_attempts: 1,
        queue_notice_retry_at: retryAt,
        queue_notice_failed_at: retryAt ? null : now.toISOString(),
      })
      .eq('id', conversationId)
      .eq('account_id', accountId)
    return { assignedTo: null, queued: true, noticeSent: false, noticeRetryAt: retryAt, notice: text }
  }
  await db
    .from('conversations')
    .update({
      queue_notice_sent_at: now.toISOString(),
      queue_notice_text: null,
      queue_notice_attempts: 1,
      queue_notice_failed_at: null,
    })
    .eq('id', conversationId)
    .eq('account_id', accountId)
  return { assignedTo: null, queued: true, noticeSent: true, noticeRetryAt: null, notice: text }
}

export interface QueueNoticeSend {
  accountId: string
  conversationId: string
  contactId: string
  userId: string
  text: string
}

interface PendingNoticeRow {
  id: string
  account_id: string
  contact_id: string
  assigned_agent_id: string | null
  queued_at: string | null
  status: string
  queue_notice_text: string | null
  queue_notice_user_id: string | null
  queue_notice_attempts: number
  queue_notice_retry_at: string
}

/**
 * Cron: send again the queue notices whose send failed and whose retry
 * is due. A lead that left the queue meanwhile needs no notice. After
 * the last retry the lead is flagged (queue_notice_failed_at) for admins.
 */
export async function retryQueueNotices(
  db: SupabaseClient,
  send: (args: QueueNoticeSend) => Promise<unknown>,
  { now = new Date() }: DistributionOptions = {},
): Promise<{ sent: number; retrying: number; failed: number }> {
  const result = { sent: 0, retrying: 0, failed: 0 }
  const { data } = await db
    .from('conversations')
    .select(
      'id, account_id, contact_id, assigned_agent_id, queued_at, status, queue_notice_text, queue_notice_user_id, queue_notice_attempts, queue_notice_retry_at',
    )
    .not('queue_notice_retry_at', 'is', null)
    .lte('queue_notice_retry_at', now.toISOString())
    .is('queue_notice_sent_at', null)
    .order('queue_notice_retry_at', { ascending: true })
    .limit(50)

  for (const row of (data ?? []) as PendingNoticeRow[]) {
    // Claim: only the run that clears retry_at sends (overlapping crons).
    const { data: claimed } = await db
      .from('conversations')
      .update({ queue_notice_retry_at: null })
      .eq('id', row.id)
      .eq('queue_notice_retry_at', row.queue_notice_retry_at)
      .select('id')
    if (!claimed?.length) continue

    if (!row.queue_notice_text || row.assigned_agent_id || !row.queued_at || row.status === 'closed') {
      await db.from('conversations').update({ queue_notice_text: null }).eq('id', row.id)
      continue
    }

    let userId = row.queue_notice_user_id
    if (!userId) {
      const { data: acc } = await db
        .from('accounts')
        .select('owner_user_id')
        .eq('id', row.account_id)
        .maybeSingle()
      userId = (acc?.owner_user_id as string | undefined) ?? null
    }

    const attempts = row.queue_notice_attempts + 1
    try {
      if (!userId) throw new Error('no author for the notice')
      await send({
        accountId: row.account_id,
        conversationId: row.id,
        contactId: row.contact_id,
        userId,
        text: row.queue_notice_text,
      })
    } catch (err) {
      const retryAt = nextNoticeRetry(attempts, now)?.toISOString() ?? null
      console.error(
        `[distribution] queue notice retry ${attempts} failed:`,
        err instanceof Error ? err.message : err,
      )
      await db
        .from('conversations')
        .update({
          queue_notice_attempts: attempts,
          queue_notice_retry_at: retryAt,
          queue_notice_failed_at: retryAt ? null : now.toISOString(),
        })
        .eq('id', row.id)
      if (retryAt) result.retrying += 1
      else result.failed += 1
      continue
    }
    await db
      .from('conversations')
      .update({
        queue_notice_sent_at: now.toISOString(),
        queue_notice_text: null,
        queue_notice_attempts: attempts,
        queue_notice_failed_at: null,
      })
      .eq('id', row.id)
    result.sent += 1
  }
  return result
}

/**
 * The agent went offline: unstarted leads go back to their sector queue
 * and are redistributed; started ones stay (reported for the admin).
 */
export async function releaseOfflineAgent(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  options: DistributionOptions = {},
): Promise<{ requeued: number; startedKept: number }> {
  const { data: owned } = await db
    .from('conversations')
    .select('id, sector_id, started_at')
    .eq('account_id', accountId)
    .eq('assigned_agent_id', userId)
    .neq('status', 'closed')
  const rows = (owned ?? []) as { id: string; sector_id: string | null; started_at: string | null }[]
  const unstarted = rows.filter((r) => !r.started_at && r.sector_id)
  const now = (options.now ?? new Date()).toISOString()
  if (unstarted.length > 0) {
    await db
      .from('conversations')
      .update({ assigned_agent_id: null, queued_at: now })
      .eq('account_id', accountId)
      .in('id', unstarted.map((r) => r.id))
  }
  for (const sectorId of new Set(unstarted.map((r) => r.sector_id as string))) {
    await distributeSector(db, accountId, sectorId, options)
  }
  return { requeued: unstarted.length, startedKept: rows.length - unstarted.length }
}
