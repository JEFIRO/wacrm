// ============================================================
// Text campaign queue worker — docs/saas/w5-fila.md.
//
// Run by /api/broadcasts/cron (every minute, for up to ~50 s). Each
// 'text' broadcast in 'sending' sends ONE recipient per turn, then
// waits a random min..max interval — the anti-ban pace for QR-code
// numbers. Taking a turn is a conditional update of next_send_at, so
// overlapping workers never send the same turn twice.
//
// Sends go through the inbox send core, so the message lands in the
// customer's conversation (and pauses an active flow) like an agent
// reply. Service-role client: every query is filtered by account_id.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { findOrCreateChannelConversation, loadChannel } from '@/lib/whatsapp/channels'
import { sendMessageToConversation } from '@/lib/whatsapp/send-message'
import { nextIntervalMs, renderCampaignText } from './text-campaign'
import { loadBillingAccess } from '@/lib/billing/access'

interface QueuedBroadcast {
  id: string
  account_id: string
  user_id: string
  channel_id: string | null
  message_text: string
  min_interval_seconds: number
  max_interval_seconds: number
  next_send_at: string
}

export interface QueueRunOptions {
  /** Stop starting new sends after this instant. */
  deadline: Date
  now?: () => Date
  random?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface QueueRunResult {
  sent: number
  failed: number
  finished: number
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function processTextBroadcasts(
  db: SupabaseClient,
  { deadline, now = () => new Date(), random = Math.random, sleep = realSleep }: QueueRunOptions,
): Promise<QueueRunResult> {
  const result: QueueRunResult = { sent: 0, failed: 0, finished: 0 }

  while (now() < deadline) {
    const { data: due } = await db
      .from('broadcasts')
      .select('id, account_id, user_id, channel_id, message_text, min_interval_seconds, max_interval_seconds, next_send_at')
      .eq('kind', 'text')
      .eq('status', 'sending')
      .lte('next_send_at', now().toISOString())
      .order('next_send_at', { ascending: true })
      .limit(10)

    if (!due || due.length === 0) {
      // Nothing due: wait for the next turn if it falls inside this run.
      const { data: next } = await db
        .from('broadcasts')
        .select('next_send_at')
        .eq('kind', 'text')
        .eq('status', 'sending')
        .order('next_send_at', { ascending: true })
        .limit(1)
      const at = next?.[0]?.next_send_at ? new Date(next[0].next_send_at as string) : null
      if (!at || at >= deadline) break
      await sleep(Math.max(0, at.getTime() - now().getTime()))
      continue
    }

    for (const broadcast of due as QueuedBroadcast[]) {
      if (now() >= deadline) break
      // Billing: campaigns of limited / blocked accounts wait (re-checked hourly).
      if ((await loadBillingAccess(db, broadcast.account_id, now())).level !== 'full') {
        await db
          .from('broadcasts')
          .update({ next_send_at: new Date(now().getTime() + 3_600_000).toISOString() })
          .eq('id', broadcast.id)
          .eq('account_id', broadcast.account_id)
          .eq('next_send_at', broadcast.next_send_at)
        continue
      }
      const outcome = await takeTurn(db, broadcast, now(), random)
      if (outcome === 'sent') result.sent += 1
      if (outcome === 'failed') result.failed += 1
      if (outcome === 'finished') result.finished += 1
    }
  }
  return result
}

type TurnOutcome = 'sent' | 'failed' | 'finished' | 'skipped'

async function takeTurn(
  db: SupabaseClient,
  b: QueuedBroadcast,
  at: Date,
  random: () => number,
): Promise<TurnOutcome> {
  const next = new Date(at.getTime() + nextIntervalMs(b.min_interval_seconds, b.max_interval_seconds, random))
  const { data: claimed } = await db
    .from('broadcasts')
    .update({ next_send_at: next.toISOString(), updated_at: at.toISOString() })
    .eq('id', b.id)
    .eq('account_id', b.account_id)
    .eq('status', 'sending')
    .eq('next_send_at', b.next_send_at)
    .select('id')
  if (!claimed?.length) return 'skipped'

  const { data: pending } = await db
    .from('broadcast_recipients')
    .select('id, contact_id')
    .eq('broadcast_id', b.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
  const recipient = pending?.[0] as { id: string; contact_id: string } | undefined
  if (!recipient) {
    await finalize(db, b)
    return 'finished'
  }

  let outcome: TurnOutcome
  try {
    const { data: contact } = await db
      .from('contacts')
      .select('id, name, phone, email, company')
      .eq('id', recipient.contact_id)
      .eq('account_id', b.account_id)
      .maybeSingle()
    if (!contact) throw new Error('contact not found')

    const channelId =
      b.channel_id ?? (await loadChannel<{ id: string }>(db, b.account_id, null, 'id'))?.id ?? null
    if (!channelId) throw new Error('WhatsApp number not found')
    const conversation = await findOrCreateChannelConversation<{ id: string }>(db, {
      accountId: b.account_id,
      contactId: contact.id,
      channelId,
      userId: b.user_id,
    })
    if (!conversation) throw new Error('could not open the conversation')

    const sent = await sendMessageToConversation(db, b.account_id, {
      conversationId: conversation.conversation.id,
      messageType: 'text',
      contentText: renderCampaignText(b.message_text, contact),
      senderId: b.user_id,
    })
    await db
      .from('broadcast_recipients')
      .update({ status: 'sent', sent_at: new Date().toISOString(), whatsapp_message_id: sent.whatsappMessageId })
      .eq('id', recipient.id)
    outcome = 'sent'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[broadcasts] text send failed (${b.id}):`, message)
    await db
      .from('broadcast_recipients')
      .update({ status: 'failed', error_message: message.slice(0, 500) })
      .eq('id', recipient.id)
    outcome = 'failed'
  }

  // Close the campaign right after its last recipient.
  const { count } = await db
    .from('broadcast_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('broadcast_id', b.id)
    .eq('status', 'pending')
  if (!count) await finalize(db, b)
  return outcome
}

/** 'failed' when nobody received it, otherwise 'sent'. */
async function finalize(db: SupabaseClient, b: QueuedBroadcast) {
  const { count: delivered } = await db
    .from('broadcast_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('broadcast_id', b.id)
    .neq('status', 'failed')
  await db
    .from('broadcasts')
    .update({ status: delivered ? 'sent' : 'failed', next_send_at: null, updated_at: new Date().toISOString() })
    .eq('id', b.id)
    .eq('account_id', b.account_id)
}
