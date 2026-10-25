// ============================================================
// Provider for a WhatsApp number — docs/saas/w1-provedor.md.
//
// Outbound paths load the number's provider here instead of loading
// whatsapp_config and decrypting the token themselves.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '../encryption'
import { loadChannel } from '../channels'
import { createMetaProvider } from './meta'
import { createEvolutionProvider } from './evolution'
import type { ProviderKind, WhatsAppProvider } from './types'

export type * from './types'

/** Columns a provider needs from whatsapp_config. */
export const PROVIDER_COLUMNS = 'id, provider, phone_number_id, access_token'

export interface ProviderChannel {
  id: string
  /** Absent on rows read before migration 066 — treated as Meta. */
  provider?: string | null
  phone_number_id: string
  /** Encrypted, as stored. */
  access_token: string
}

/** The provider of an already-loaded channel row. */
export function providerForChannel(channel: ProviderChannel): WhatsAppProvider {
  const kind = channel.provider ?? 'meta'
  if (kind === 'meta') {
    return createMetaProvider({
      phoneNumberId: channel.phone_number_id,
      accessToken: decrypt(channel.access_token),
    })
  }
  if (kind === 'evolution') {
    // Instance name in phone_number_id, instance API key in access_token
    // (docs/saas/w2-evolution.md); the server is the SaaS's own.
    const baseUrl = process.env.EVOLUTION_API_URL
    if (!baseUrl) throw new Error('EVOLUTION_API_URL is not configured')
    return createEvolutionProvider({
      baseUrl,
      instance: channel.phone_number_id,
      apiKey: decrypt(channel.access_token),
    })
  }
  throw new Error(`WhatsApp provider "${kind}" is not supported`)
}

/**
 * The kind of connection the account uses — one per account (migration
 * 067): 'meta', 'evolution', or null while it has no number yet.
 */
export async function accountProviderKind(
  db: SupabaseClient,
  accountId: string,
): Promise<ProviderKind | null> {
  const { data } = await db
    .from('whatsapp_config')
    .select('provider')
    .eq('account_id', accountId)
    .limit(1)
  const kind = (data?.[0] as { provider?: string } | undefined)?.provider
  return kind === 'meta' || kind === 'evolution' ? kind : null
}

/**
 * The channel (the given one, or the account's default) and its
 * provider. Null when the account has no such number.
 */
export async function loadChannelProvider(
  db: SupabaseClient,
  accountId: string,
  channelId?: string | null,
): Promise<{ channel: ProviderChannel; provider: WhatsAppProvider } | null> {
  const channel = await loadChannel<ProviderChannel>(db, accountId, channelId, PROVIDER_COLUMNS)
  if (!channel) return null
  return { channel, provider: providerForChannel(channel) }
}
