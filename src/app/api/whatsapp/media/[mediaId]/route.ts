import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadChannel } from '@/lib/whatsapp/channels'
import { PROVIDER_COLUMNS, providerForChannel, type ProviderChannel } from '@/lib/whatsapp/provider'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getT } from '@/lib/i18n/translate'
import { mediaProxyHeaders } from '@/lib/media/proxy-response-headers'

const t = getT('Api')

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: t('media.idRequired') },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: t('common.unauthorized') },
        { status: 401 }
      )
    }

    const limit = checkRateLimit(`whatsapp-media:${user.id}`, RATE_LIMITS.whatsappMedia)
    if (!limit.success) return rateLimitResponse(limit)

    // Resolve the caller's account_id — whatsapp_config is one-per-
    // account post-multi-user, so a teammate fetching media for a
    // conversation in the shared inbox needs the account's config,
    // not their personal (non-existent) row.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: t('common.profileNotLinked') },
        { status: 403 },
      )
    }

    // Media belongs to the number it arrived on: the webhook stamps that
    // channel on the proxy URL (`?channel=`). Older URLs without it — or
    // a channel since disconnected — fall back to the default number.
    const channelId = new URL(request.url).searchParams.get('channel')
    const config =
      (await loadChannel<ProviderChannel>(supabase, accountId, channelId, PROVIDER_COLUMNS)) ??
      (channelId ? await loadChannel<ProviderChannel>(supabase, accountId, null, PROVIDER_COLUMNS) : null)

    if (!config) {
      return NextResponse.json(
        { error: t('common.whatsappNotConfigured') },
        { status: 400 }
      )
    }

    const provider = providerForChannel(config)

    // Get the download URL from the provider
    const mediaInfo = await provider.getMedia(mediaId)

    // Download the binary data
    const { buffer, contentType } = await provider.downloadMedia(mediaInfo.url)

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: mediaProxyHeaders(mediaId, contentType || mediaInfo.mimeType),
    })
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: t('media.fetchFailed') },
      { status: 500 }
    )
  }
}
