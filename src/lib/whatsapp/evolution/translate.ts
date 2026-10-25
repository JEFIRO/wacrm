// ============================================================
// Evolution API v2 webhook → the inbound shape the app already
// processes (Meta Cloud API's) — docs/saas/w2-evolution.md.
//
// Pure: no DB, no network. Groups, broadcasts/status and newsletters are
// skipped. Messages sent FROM the number (fromMe — the phone, WhatsApp
// Web, or this app) come back flagged `fromMe`; the webhook stores the
// ones the app didn't send (W4, docs/saas/w4-regras.md).
// ============================================================
import type { WhatsAppMessage } from '../inbound'
import type { WaContactPayload } from '../wa-identity'

export interface EvolutionMessageKey {
  remoteJid?: string
  /** Phone JID when remoteJid is a LID (newer WhatsApp addressing). */
  remoteJidAlt?: string
  fromMe?: boolean
  id?: string
}

interface MediaBody {
  mimetype?: string
  caption?: string
  fileName?: string
}

export interface EvolutionMessageData {
  key?: EvolutionMessageKey
  pushName?: string
  messageType?: string
  messageTimestamp?: number | string
  message?: {
    conversation?: string
    extendedTextMessage?: { text?: string }
    imageMessage?: MediaBody
    videoMessage?: MediaBody
    documentMessage?: MediaBody
    audioMessage?: MediaBody
    stickerMessage?: MediaBody
    locationMessage?: {
      degreesLatitude?: number
      degreesLongitude?: number
      name?: string
      address?: string
    }
    reactionMessage?: { key?: EvolutionMessageKey; text?: string }
    buttonsResponseMessage?: { selectedButtonId?: string; selectedDisplayText?: string }
    listResponseMessage?: { title?: string; singleSelectReply?: { selectedRowId?: string } }
  }
  /** Quote of a swipe-reply: stanzaId is the quoted message id. */
  contextInfo?: { stanzaId?: string } | null
}

export interface EvolutionStatusData {
  keyId?: string
  remoteJid?: string
  fromMe?: boolean
  status?: string
}

/**
 * Wrappers and protocol traffic, not something a person wrote: an
 * album's envelope (each photo/video of it arrives as its own message),
 * edits/deletes, key distribution.
 */
const NON_MESSAGE_TYPES = new Set([
  'albumMessage',
  'protocolMessage',
  'senderKeyDistributionMessage',
  'messageContextInfo',
])

export type InboundTranslation =
  | { message: WhatsAppMessage; contact: WaContactPayload; fromMe: boolean }
  | { skip: string }

/** Digits of a person's JID, or null for groups, broadcasts, LIDs, etc. */
export function phoneFromJid(jid?: string): string | null {
  if (!jid) return null
  const [user, server] = jid.split('@')
  if (server !== 's.whatsapp.net') return null
  const digits = user.split(':')[0].replace(/\D/g, '')
  return digits || null
}

/** One messages.upsert `data` → a Meta-shaped message + contact. */
export function translateInbound(data: EvolutionMessageData): InboundTranslation {
  const key = data.key ?? {}
  if (!key.id) return { skip: 'no message id' }
  const fromMe = key.fromMe === true
  const jid = key.remoteJid ?? ''
  if (/@(g\.us|broadcast|newsletter)$/.test(jid)) return { skip: `not a 1:1 chat (${jid})` }
  if (data.messageType && NON_MESSAGE_TYPES.has(data.messageType)) {
    return { skip: `not a message (${data.messageType})` }
  }
  const phone = phoneFromJid(jid) ?? phoneFromJid(key.remoteJidAlt)
  if (!phone) return { skip: `no phone number for ${jid}` }

  const ts = Number(data.messageTimestamp)
  const base: WhatsAppMessage = {
    id: key.id,
    from: phone,
    timestamp: String(Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : Math.floor(Date.now() / 1000)),
    type: 'unsupported',
  }
  if (data.contextInfo?.stanzaId) base.context = { id: data.contextInfo.stanzaId }
  // On our own messages pushName is OUR name — never the customer's.
  const contact: WaContactPayload = { profile: { name: fromMe ? undefined : data.pushName || undefined }, wa_id: phone }
  const m = data.message ?? {}
  // Media is fetched later by the provider with the message id.
  const media = (body: MediaBody) => ({ id: key.id!, mime_type: body.mimetype || 'application/octet-stream' })

  let message: WhatsAppMessage
  const text = m.conversation ?? m.extendedTextMessage?.text
  if (text !== undefined) {
    message = { ...base, type: 'text', text: { body: text } }
  } else if (m.imageMessage) {
    message = { ...base, type: 'image', image: { ...media(m.imageMessage), caption: m.imageMessage.caption } }
  } else if (m.videoMessage) {
    message = { ...base, type: 'video', video: { ...media(m.videoMessage), caption: m.videoMessage.caption } }
  } else if (m.documentMessage) {
    message = {
      ...base,
      type: 'document',
      document: {
        ...media(m.documentMessage),
        filename: m.documentMessage.fileName,
        caption: m.documentMessage.caption,
      },
    }
  } else if (m.audioMessage) {
    message = { ...base, type: 'audio', audio: media(m.audioMessage) }
  } else if (m.stickerMessage) {
    message = { ...base, type: 'sticker', sticker: media(m.stickerMessage) }
  } else if (m.locationMessage) {
    message = {
      ...base,
      type: 'location',
      location: {
        latitude: m.locationMessage.degreesLatitude ?? 0,
        longitude: m.locationMessage.degreesLongitude ?? 0,
        name: m.locationMessage.name,
        address: m.locationMessage.address,
      },
    }
  } else if (m.reactionMessage?.key?.id) {
    message = {
      ...base,
      type: 'reaction',
      reaction: { message_id: m.reactionMessage.key.id, emoji: m.reactionMessage.text ?? '' },
    }
  } else if (m.buttonsResponseMessage?.selectedButtonId) {
    const r = m.buttonsResponseMessage
    message = {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: r.selectedButtonId!, title: r.selectedDisplayText ?? '' },
      },
    }
  } else if (m.listResponseMessage?.singleSelectReply?.selectedRowId) {
    const r = m.listResponseMessage
    message = {
      ...base,
      type: 'interactive',
      interactive: {
        type: 'list_reply',
        list_reply: { id: r.singleSelectReply!.selectedRowId!, title: r.title ?? '' },
      },
    }
  } else {
    message = { ...base, type: data.messageType || 'unsupported' }
  }
  return { message, contact, fromMe }
}

/** Evolution's message status → the app's (sent/delivered/read/failed). */
const STATUS: Record<string, string> = {
  SERVER_ACK: 'sent',
  DELIVERY_ACK: 'delivered',
  READ: 'read',
  PLAYED: 'read',
  ERROR: 'failed',
}

/** One messages.update `data` for a message we sent → wamid + status. */
export function translateStatus(data: EvolutionStatusData): { wamid: string; status: string } | null {
  if (!data.keyId || !data.fromMe) return null
  const status = STATUS[data.status ?? '']
  return status ? { wamid: data.keyId, status } : null
}
