import { NextResponse } from 'next/server'
import { ForbiddenError, getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { canEditSettings } from '@/lib/auth/roles'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { distributeAccount, releaseOfflineAgent } from '@/lib/distribution/distribute'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * PATCH /api/agents/settings
 *
 * Body: `{ user_id?, is_online?, max_active_leads? }`. Agents switch
 * their own online status; owners/admins change anyone's status and cap.
 * Then distribution reacts: going offline sends the agent's unstarted
 * leads back to the queue, going online or a higher cap hands queued
 * leads out (docs/saas/setores-e-distribuicao.md).
 */
export async function PATCH(request: Request) {
  try {
    const { accountId, userId, role } = await getCurrentAccount()
    const body = await request.json()
    const targetId: string = typeof body.user_id === 'string' ? body.user_id : userId
    const isAdmin = canEditSettings(role)
    if (targetId !== userId && !isAdmin) throw new ForbiddenError()
    if (body.max_active_leads !== undefined && !isAdmin) throw new ForbiddenError()

    const db = supabaseAdmin()
    const { data: member } = await db
      .from('profiles')
      .select('user_id')
      .eq('user_id', targetId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!member) return NextResponse.json({ error: t('agents.notMember') }, { status: 404 })

    const { data: before } = await db
      .from('agent_settings')
      .select('is_online, max_active_leads')
      .eq('user_id', targetId)
      .eq('account_id', accountId)
      .maybeSingle()

    const patch: Record<string, unknown> = { user_id: targetId, account_id: accountId, updated_at: new Date().toISOString() }
    if (typeof body.is_online === 'boolean') patch.is_online = body.is_online
    if (body.max_active_leads !== undefined) {
      const cap = Number(body.max_active_leads)
      if (!Number.isInteger(cap) || cap < 1 || cap > 100) {
        return NextResponse.json({ error: t('agents.invalidCap') }, { status: 400 })
      }
      patch.max_active_leads = cap
    }

    const { error } = await db.from('agent_settings').upsert(patch, { onConflict: 'user_id' })
    if (error) {
      console.error('agent_settings upsert failed:', error.message)
      return NextResponse.json({ error: t('agents.saveFailed') }, { status: 500 })
    }

    const wasOnline = before?.is_online ?? false
    const result: Record<string, number> = {}
    if (patch.is_online === false && wasOnline) {
      Object.assign(result, await releaseOfflineAgent(db, accountId, targetId))
    } else if (
      (patch.is_online === true && !wasOnline) ||
      (typeof patch.max_active_leads === 'number' &&
        patch.max_active_leads > (before?.max_active_leads ?? 3))
    ) {
      Object.assign(result, await distributeAccount(db, accountId))
    }
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return toErrorResponse(error)
  }
}
