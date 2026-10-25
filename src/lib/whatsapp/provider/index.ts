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
import type { WhatsAppProvider } from './types'

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
  // W2 adds the Evolution implementation.
  throw new Error(`WhatsApp provider "${kind}" is not supported yet`)
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
