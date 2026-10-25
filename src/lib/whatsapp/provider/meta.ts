// ============================================================
// Meta Cloud API as a WhatsAppProvider — docs/saas/w1-provedor.md.
// Binds one number's credentials and forwards to meta-api.ts, which
// stays the only Graph API client.
// ============================================================
import {
  downloadMedia,
  getMediaUrl,
  getPhoneNumberHealth,
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendReactionMessage,
  sendTemplateMessage,
  sendTextMessage,
  sendTypingIndicator,
} from '../meta-api'
import type { WhatsAppProvider } from './types'

export interface MetaCredentials {
  phoneNumberId: string
  /** Decrypted. */
  accessToken: string
}

export function createMetaProvider(creds: MetaCredentials): WhatsAppProvider {
  const { phoneNumberId, accessToken } = creds
  return {
    kind: 'meta',
    sendText: (args) => sendTextMessage({ ...args, phoneNumberId, accessToken }),
    sendMedia: (args) => sendMediaMessage({ ...args, phoneNumberId, accessToken }),
    sendTemplate: (args) => sendTemplateMessage({ ...args, phoneNumberId, accessToken }),
    sendButtons: (args) => sendInteractiveButtons({ ...args, phoneNumberId, accessToken }),
    sendList: (args) => sendInteractiveList({ ...args, phoneNumberId, accessToken }),
    sendReaction: ({ targetFromMe: _ours, ...args }) =>
      sendReactionMessage({ ...args, phoneNumberId, accessToken }),
    sendTyping: (args) => sendTypingIndicator({ ...args, phoneNumberId, accessToken }),
    getMedia: (mediaId) => getMediaUrl({ mediaId, accessToken }),
    downloadMedia: (url) => downloadMedia({ downloadUrl: url, accessToken }),
    health: () => getPhoneNumberHealth({ phoneNumberId, accessToken }),
  }
}
