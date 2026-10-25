// ============================================================
// Channel selection — which whatsapp_config row an action uses.
//
// An account can hold several WhatsApp numbers ("channels", migration
// 060, docs/saas/c1-canais.md). Every outbound path resolves its row
// here instead of `.eq('account_id').single()`, which errors as soon as
// a second number exists.
//
// Rule: the channel asked for (usually the conversation's
// `whatsapp_config_id`) when given, otherwise the account's default.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { isUniqueViolation } from '@/lib/contacts/dedupe'

/**
 * Load one channel row of the account. With `channelId`, that channel
 * (scoped to the account, so a foreign id resolves to nothing); without
 * it — e.g. an orphaned conversation or an action with no conversation —
 * the default channel. Returns `null` when nothing matches.
 */
export async function loadChannel<T = Record<string, unknown>>(
  db: SupabaseClient,
  accountId: string,
  channelId?: string | null,
  columns = '*'
): Promise<T | null> {
  if (channelId) {
    const { data, error } = await db
      .from('whatsapp_config')
      .select(columns)
      .eq('account_id', accountId)
      .eq('id', channelId)
      .maybeSingle()
    if (error) {
      console.error('[channels] channel lookup failed:', error.message)
      return null
    }
    return (data as T | null) ?? null
  }

  // Default first; oldest as a tiebreak for rows written before the
  // default triggers existed.
  const { data, error } = await db
    .from('whatsapp_config')
    .select(columns)
    .eq('account_id', accountId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) {
    console.error('[channels] default channel lookup failed:', error.message)
    return null
  }
  return ((data?.[0] as T | undefined) ?? null)
}

export interface ChannelConversationArgs {
  accountId: string
  contactId: string
  /** The number the thread belongs to; null only when the account has none. */
  channelId: string | null
  /** NOT NULL audit FK on insert (config owner / acting user). */
  userId: string
}

/**
 * Find or create the conversation of `contact` on `channel` — one
 * thread per (account, contact, channel), unique index from migration
 * 060. Order of resolution:
 *   1. the contact's conversation on this channel;
 *   2. an orphaned conversation of the contact (its number was
 *      disconnected), adopted onto this channel so reconnecting a
 *      number keeps the history in one thread;
 *   3. a new conversation.
 * A concurrent create (unique violation) re-resolves the winner, as the
 * single-number code did (issue #363). Returns null on a DB error.
 */
export async function findOrCreateChannelConversation<T = Record<string, unknown>>(
  db: SupabaseClient,
  { accountId, contactId, channelId, userId }: ChannelConversationArgs,
  columns = '*'
): Promise<{ conversation: T; created: boolean } | null> {
  const findOnChannel = () => {
    const q = db
      .from('conversations')
      .select(columns)
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
    return (channelId ? q.eq('whatsapp_config_id', channelId) : q.is('whatsapp_config_id', null))
      .order('created_at', { ascending: true })
      .limit(1)
  }

  const { data: existing, error: findError } = await findOnChannel()
  if (findError) {
    console.error('[channels] conversation lookup failed:', findError.message)
    return null
  }
  if (existing && existing.length > 0) {
    return { conversation: existing[0] as T, created: false }
  }

  if (channelId) {
    const { data: orphans } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .is('whatsapp_config_id', null)
      .order('created_at', { ascending: true })
      .limit(1)
    if (orphans && orphans.length > 0) {
      const { data: adopted, error: adoptError } = await db
        .from('conversations')
        .update({ whatsapp_config_id: channelId })
        .eq('id', (orphans[0] as { id: string }).id)
        .select(columns)
        .single()
      if (!adoptError && adopted) {
        return { conversation: adopted as T, created: false }
      }
      // Lost the adoption to a concurrent delivery — fall through and
      // resolve whatever now exists on this channel.
    }
  }

  const { data: created, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      whatsapp_config_id: channelId,
    })
    .select(columns)
    .single()

  if (createError || !created) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await findOnChannel()
      if (raced && raced.length > 0) {
        return { conversation: raced[0] as T, created: false }
      }
    }
    console.error('[channels] conversation create failed:', createError?.message)
    return null
  }
  return { conversation: created as T, created: true }
}
