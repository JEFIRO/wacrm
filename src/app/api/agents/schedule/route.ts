import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { distributeAccount } from '@/lib/distribution/distribute'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * PUT /api/agents/schedule
 *
 * Body: `{ user_id, ranges: [{ weekday, start, end }] }` replaces the
 * agent's weekly schedule (times in the account timezone). Members of a
 * sector must keep at least one range (migration 064). Owners/admins
 * only. A wider schedule can open a slot, so distribution runs after saving.
 */
export async function PUT(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json()
    const targetId = typeof body.user_id === 'string' ? body.user_id : ''
    const ranges: unknown[] = Array.isArray(body.ranges) ? body.ranges : []

    const rows = []
    for (const raw of ranges) {
      const r = raw as { weekday?: unknown; start?: unknown; end?: unknown }
      const weekday = Number(r.weekday)
      const start = String(r.start ?? '')
      const end = String(r.end ?? '')
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !TIME.test(start) || !TIME.test(end) || end <= start) {
        return NextResponse.json({ error: t('agents.invalidSchedule') }, { status: 400 })
      }
      rows.push({ weekday, start, end })
    }

    const db = supabaseAdmin()
    const { data: member } = await db
      .from('profiles')
      .select('user_id')
      .eq('user_id', targetId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!member) return NextResponse.json({ error: t('agents.notMember') }, { status: 404 })

    if (rows.length === 0) {
      const { count } = await db
        .from('sector_members')
        .select('sector_id', { count: 'exact', head: true })
        .eq('user_id', targetId)
        .eq('account_id', accountId)
      if (count) return NextResponse.json({ error: t('agents.scheduleRequired') }, { status: 400 })
    }

    const { error } = await db.rpc('replace_agent_schedule', {
      p_account_id: accountId,
      p_user_id: targetId,
      p_ranges: rows,
    })
    if (error) {
      if (error.message === 'sector_member_needs_schedule') {
        return NextResponse.json({ error: t('agents.scheduleRequired') }, { status: 400 })
      }
      console.error('agent_schedules save failed:', error.message)
      return NextResponse.json({ error: t('agents.saveFailed') }, { status: 500 })
    }

    await distributeAccount(db, accountId)
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
