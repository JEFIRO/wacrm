import { NextResponse } from 'next/server'
import { currentPlatformAdmin } from '@/lib/platform/admin'

/** GET /api/platform/me — whether the signed-in user may open the SaaS panel. */
export async function GET() {
  return NextResponse.json({ admin: (await currentPlatformAdmin()) !== null })
}
