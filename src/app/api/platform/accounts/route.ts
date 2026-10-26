import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { currentPlatformAdmin } from '@/lib/platform/admin'
import { customerSituation, monthlyRevenueCents, summarize, type PlatformAccountRow } from '@/lib/platform/overview'

/**
 * GET /api/platform/accounts — every customer account with plan,
 * situation, usage and monthly revenue, plus the summary
 * (docs/saas/b6-painel.md). Platform admins only.
 */
export async function GET() {
  if (!(await currentPlatformAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { data, error } = await supabaseAdmin().rpc('platform_accounts_overview')
  if (error) {
    console.error('[platform] overview failed:', error.message)
    return NextResponse.json({ error: 'overview failed' }, { status: 500 })
  }
  const rows = (data ?? []) as PlatformAccountRow[]
  const now = new Date()
  return NextResponse.json({
    summary: summarize(rows, now),
    accounts: rows.map((r) => ({
      ...r,
      situation: customerSituation(r, now),
      revenue_cents: monthlyRevenueCents(r),
    })),
  })
}
