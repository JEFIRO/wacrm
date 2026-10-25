// ============================================================
// WhatsApp provider — docs/saas/w1-provedor.md.
//
// One interface for every outbound path, whatever the number talks
// through (Meta Cloud API today, Evolution in W2). Arguments are the
// meta-api.ts ones minus the credentials: a provider is bound to one
// number (whatsapp_config row) when it is created.
// ============================================================
import type {
  MetaPhoneHealth,
  MetaSendResult,
  SendInteractiveButtonsArgs,
  SendInteractiveListArgs,
  SendMediaMessageArgs,
  SendReactionMessageArgs,
  SendTemplateMessageArgs,
  SendTextMessageArgs,
  SendTypingIndicatorArgs,
} from '../meta-api'

export type ProviderKind = 'meta' | 'evolution'

type WithoutCredentials<T> = Omit<T, 'phoneNumberId' | 'accessToken'>

export type ProviderSendResult = MetaSendResult
export type SendTextArgs = WithoutCredentials<SendTextMessageArgs>
export type SendMediaArgs = WithoutCredentials<SendMediaMessageArgs>
export type SendTemplateArgs = WithoutCredentials<SendTemplateMessageArgs>
export type SendButtonsArgs = WithoutCredentials<SendInteractiveButtonsArgs>
export type SendListArgs = WithoutCredentials<SendInteractiveListArgs>
export type SendReactionArgs = WithoutCredentials<SendReactionMessageArgs> & {
  /** The reacted message was ours — Evolution needs it to address it. */
  targetFromMe?: boolean
}
export type SendTypingArgs = WithoutCredentials<SendTypingIndicatorArgs>

export interface ProviderMediaInfo {
  url: string
  mimeType: string
  fileSize: number | null
}

export interface WhatsAppProvider {
  readonly kind: ProviderKind
  sendText(args: SendTextArgs): Promise<ProviderSendResult>
  sendMedia(args: SendMediaArgs): Promise<ProviderSendResult>
  sendTemplate(args: SendTemplateArgs): Promise<ProviderSendResult>
  sendButtons(args: SendButtonsArgs): Promise<ProviderSendResult>
  sendList(args: SendListArgs): Promise<ProviderSendResult>
  sendReaction(args: SendReactionArgs): Promise<ProviderSendResult>
  /** Read receipt + "typing…" on an inbound message. Best-effort. */
  sendTyping(args: SendTypingArgs): Promise<void>
  /** Where an inbound media id can be downloaded from. */
  getMedia(mediaId: string): Promise<ProviderMediaInfo>
  downloadMedia(url: string): Promise<{ buffer: Buffer; contentType: string }>
  health(): Promise<MetaPhoneHealth>
}
