import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import {
  parseMessagingLimit,
  parseQualityRating,
  type PhoneHealth,
} from '@/lib/whatsapp/phone-health'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadChannel } from '@/lib/whatsapp/channels'
import { PROVIDER_COLUMNS, providerForChannel, type ProviderChannel } from '@/lib/whatsapp/provider'

const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=300' }

function reply(body: PhoneHealth) {
  return NextResponse.json(body, { headers: CACHE_HEADERS })
}

const EMPTY: Omit<PhoneHealth, 'state'> = {
  displayPhoneNumber: null,
  quality: 'UNKNOWN',
  limit: null,
}

export async function GET() {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount()

    const limit = checkRateLimit(`whatsapp-health:${userId}`, RATE_LIMITS.whatsappHealth)
    if (!limit.success) return rateLimitResponse(limit)

    const config = await loadChannel<ProviderChannel & { status: string }>(
      supabase,
      accountId,
      null,
      `${PROVIDER_COLUMNS}, status`,
    )

    if (!config || config.status !== 'connected' || !config.phone_number_id) {
      return reply({ state: 'disconnected', ...EMPTY })
    }

    try {
      const info = await providerForChannel(config).health()
      return reply({
        state: 'connected',
        displayPhoneNumber: info.display_phone_number ?? null,
        quality: parseQualityRating(info.quality_rating),
        limit: parseMessagingLimit(info.whatsapp_business_manager_messaging_limit),
      })
    } catch (err) {
      console.error('[whatsapp/health] lookup failed:', err instanceof Error ? err.message : err)
      return reply({ state: 'unavailable', ...EMPTY })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
