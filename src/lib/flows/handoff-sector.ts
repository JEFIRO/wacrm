// ============================================================
// Handoff node → sector routing — docs/saas/setores-e-distribuicao.md.
//
// When a handoff node names a sector (fixed, or taken from a flow
// variable holding the customer's choice), the lead goes to that sector
// and is distributed among its agents, or queued with a one-time notice.
// Kept out of engine.ts so the upstream runner changes by one branch.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { getT } from '@/lib/i18n/translate'
import { routeLead } from '@/lib/distribution/distribute'
import { engineSendText } from './meta-send'
import type { FlowRunRow, HandoffNodeConfig } from './types'

const t = getT('Distribution')

/**
 * The sector this handoff targets: `sector_id`, or the sector whose name
 * matches the run variable `sector_var` (case-insensitive) — e.g. the
 * button the customer tapped. Null when the node routes to no sector.
 */
export async function resolveHandoffSector(
  db: SupabaseClient,
  run: FlowRunRow,
  cfg: HandoffNodeConfig,
): Promise<string | null> {
  if (cfg.sector_id) {
    const { data } = await db
      .from('sectors')
      .select('id')
      .eq('id', cfg.sector_id)
      .eq('account_id', run.account_id)
      .maybeSingle()
    return (data?.id as string | undefined) ?? null
  }
  const wanted = cfg.sector_var ? String(run.vars?.[cfg.sector_var] ?? '').trim().toLowerCase() : ''
  if (!wanted) return null
  const { data } = await db.from('sectors').select('id, name').eq('account_id', run.account_id)
  const match = (data ?? []).find(
    (s: { name: string }) => s.name.trim().toLowerCase() === wanted,
  ) as { id: string } | undefined
  return match?.id ?? null
}

/** Route the run's conversation to `sectorId`; returns the outcome to log. */
export async function handoffToSector(
  db: SupabaseClient,
  run: FlowRunRow,
  cfg: HandoffNodeConfig,
  sectorId: string,
) {
  const conversationId = run.conversation_id as string
  return routeLead(db, {
    accountId: run.account_id,
    conversationId,
    sectorId,
    queueMessage: cfg.queue_message?.trim() || t('defaultQueueMessage'),
    noticeUserId: run.user_id,
    sendText: (text) =>
      engineSendText({
        accountId: run.account_id,
        userId: run.user_id,
        conversationId,
        contactId: run.contact_id as string,
        text,
      }),
  })
}
