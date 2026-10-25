// ============================================================
// Evolution API v2 as a WhatsAppProvider — docs/saas/w2-evolution.md.
//
// One Evolution instance = one number. Calls use the instance's own
// API key (stored encrypted in whatsapp_config.access_token; the
// instance name lives in phone_number_id). Templates and interactive
// buttons/lists are Meta features — W4 decides what Evolution does.
// ============================================================
import type { MetaPhoneHealth } from '../meta-api'
import type { ProviderMediaInfo, ProviderSendResult, WhatsAppProvider } from './types'

export interface EvolutionCredentials {
  /** Server base URL, e.g. https://evolution.example.com */
  baseUrl: string
  instance: string
  apiKey: string
}

/** A send Evolution can't do (yet) — callers surface the message. */
export class EvolutionUnsupportedError extends Error {}

export function createEvolutionProvider(creds: EvolutionCredentials): WhatsAppProvider {
  const base = creds.baseUrl.replace(/\/+$/, '')
  const instance = encodeURIComponent(creds.instance)

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${base}${path}/${instance}`, {
      method,
      headers: { 'Content-Type': 'application/json', apikey: creds.apiKey },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    const data = text ? JSON.parse(text) : null
    if (!response.ok) {
      const detail = data?.response?.message ?? data?.message ?? data?.error ?? text
      throw new Error(
        `Evolution API error: ${response.status} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`,
      )
    }
    return data as T
  }

  async function send(path: string, body: Record<string, unknown>): Promise<ProviderSendResult> {
    const data = await call<{ key?: { id?: string } }>('POST', path, body)
    const id = data?.key?.id
    if (!id) throw new Error('Evolution API error: response without a message id')
    return { messageId: id }
  }

  const quoted = (contextMessageId?: string) =>
    contextMessageId ? { quoted: { key: { id: contextMessageId } } } : {}

  const unsupported = (what: string) => async (): Promise<never> => {
    throw new EvolutionUnsupportedError(`${what} is not available on Evolution numbers yet`)
  }

  return {
    kind: 'evolution',
    sendText: ({ to, text, contextMessageId }) =>
      send('/message/sendText', { number: to, text, ...quoted(contextMessageId) }),
    sendMedia: ({ to, kind, link, caption, filename, contextMessageId }) =>
      kind === 'audio'
        ? send('/message/sendWhatsAppAudio', { number: to, audio: link, ...quoted(contextMessageId) })
        : send('/message/sendMedia', {
            number: to,
            mediatype: kind,
            media: link,
            ...(caption ? { caption } : {}),
            ...(kind === 'document' && filename ? { fileName: filename } : {}),
            ...quoted(contextMessageId),
          }),
    sendReaction: ({ to, targetMessageId, emoji, targetFromMe }) =>
      send('/message/sendReaction', {
        key: { remoteJid: `${to}@s.whatsapp.net`, fromMe: targetFromMe ?? false, id: targetMessageId },
        reaction: emoji,
      }),
    sendTemplate: unsupported('Templates'),
    sendButtons: unsupported('Interactive buttons'),
    sendList: unsupported('Interactive lists'),
    // Evolution's "composing" presence needs the chat, not the message
    // id the interface carries — skipped (cosmetic, best-effort).
    sendTyping: async () => {},
    async getMedia(mediaId): Promise<ProviderMediaInfo> {
      const data = await call<{ base64?: string; mimetype?: string }>(
        'POST',
        '/chat/getBase64FromMediaMessage',
        { message: { key: { id: mediaId } }, convertToMp4: false },
      )
      if (!data?.base64) throw new Error('Evolution API error: media not found')
      const mimeType = data.mimetype || 'application/octet-stream'
      return {
        // Bytes come inline; downloadMedia decodes this data URL.
        url: `data:${mimeType};base64,${data.base64}`,
        mimeType,
        fileSize: Math.floor((data.base64.length * 3) / 4),
      }
    },
    async downloadMedia(url) {
      const match = /^data:([^;,]+)?;base64,([\s\S]*)$/.exec(url)
      if (match) return { buffer: Buffer.from(match[2], 'base64'), contentType: match[1] || 'application/octet-stream' }
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Media download failed: ${response.status}`)
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') || 'application/octet-stream',
      }
    },
    async health(): Promise<MetaPhoneHealth> {
      const data = await call<{ instance?: { state?: string } }>('GET', '/instance/connectionState')
      const state = data?.instance?.state
      if (state !== 'open') throw new Error(`Evolution instance is ${state ?? 'unknown'}`)
      return { id: creds.instance }
    },
  }
}
