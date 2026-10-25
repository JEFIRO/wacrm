import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { distributeAccount } from '@/lib/distribution/distribute'

/**
 * POST /api/distribution/run
 *
 * A slot may have opened in the caller's account (a lead was closed,
 * reopened or transferred, a sector's members changed): hand queued leads
 * out and rebalance unstarted ones. Any member can trigger it; the
 * account comes from the session, never from the body.
 */
export async function POST() {
  try {
    const { accountId } = await getCurrentAccount()
    const result = await distributeAccount(supabaseAdmin(), accountId)
    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error)
  }
}
