import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { syncAccountSubscription } from '@/lib/billing/sync'

/**
 * POST /api/billing/sync — re-reads the account's Asaas payments and
 * updates its status ("I already paid" / page load). Admin+.
 */
export async function POST() {
  try {
    const { accountId } = await requireRole('admin')
    const synced = await syncAccountSubscription(supabaseAdmin(), accountId)
    return NextResponse.json({ status: synced?.status ?? null, invoice_url: synced?.invoiceUrl ?? null })
  } catch (error) {
    return toErrorResponse(error)
  }
}
