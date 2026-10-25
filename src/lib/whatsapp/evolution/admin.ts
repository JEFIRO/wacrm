// ============================================================
// Evolution instance lifecycle — docs/saas/w3-instancia.md.
//
// Creating and removing instances needs the server's GLOBAL key
// (EVOLUTION_GLOBAL_API_KEY), so this is server-only and used by the
// admin routes under /api/whatsapp/evolution/instances. Day-to-day
// calls (send, QR, state) use the instance's own key.
//
// Shapes checked against Evolution API v2.3.7 on 2026-10-25.
// ============================================================
import { EVOLUTION_SECRET_HEADER } from './webhook-secret'

export interface EvolutionServerConfig {
  baseUrl: string
  globalKey: string
  /** Where Evolution posts events — this app's webhook route. */
  webhookUrl: string
  webhookSecret: string
}

/** Null when the server isn't configured (the UI hides the QR option). */
export function evolutionServerConfig(): EvolutionServerConfig | null {
  const baseUrl = process.env.EVOLUTION_API_URL
  const globalKey = process.env.EVOLUTION_GLOBAL_API_KEY
  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET
  // Locally Evolution runs in Docker and reaches the app by the host IP,
  // not by the public app URL.
  const appUrl = process.env.EVOLUTION_WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (!baseUrl || !globalKey || !webhookSecret || !appUrl) return null
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    globalKey,
    webhookUrl: `${appUrl.replace(/\/+$/, '')}/api/whatsapp/evolution/webhook`,
    webhookSecret,
  }
}

/** Events the app handles (W2 messages, W3 connection). */
export const INSTANCE_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE']

async function evolution<T>(
  cfg: EvolutionServerConfig,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  key: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: key },
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

export interface CreatedInstance {
  /** The instance's own API key — store it encrypted. */
  apiKey: string
  /** QR code as a data:image/png URL, when Evolution returned one. */
  qr: string | null
}

/** Create a Baileys instance with this app's webhook already wired. */
export async function createInstance(cfg: EvolutionServerConfig, name: string): Promise<CreatedInstance> {
  const data = await evolution<{ hash?: string; qrcode?: { base64?: string } }>(
    cfg,
    'POST',
    '/instance/create',
    cfg.globalKey,
    {
      instanceName: name,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      groupsIgnore: true,
      webhook: {
        url: cfg.webhookUrl,
        byEvents: false,
        base64: false,
        headers: { [EVOLUTION_SECRET_HEADER]: cfg.webhookSecret },
        events: INSTANCE_EVENTS,
      },
    },
  )
  if (!data?.hash) throw new Error('Evolution API error: instance created without a key')
  return { apiKey: data.hash, qr: data.qrcode?.base64 ?? null }
}

export type InstanceState = 'open' | 'connecting' | 'close' | string

export async function instanceState(cfg: EvolutionServerConfig, name: string, apiKey: string): Promise<InstanceState> {
  const data = await evolution<{ instance?: { state?: string } }>(
    cfg,
    'GET',
    `/instance/connectionState/${encodeURIComponent(name)}`,
    apiKey,
  )
  return data?.instance?.state ?? 'close'
}

/** A fresh QR code (data URL) to pair the phone; null if already paired. */
export async function instanceQr(cfg: EvolutionServerConfig, name: string, apiKey: string): Promise<string | null> {
  const data = await evolution<{ base64?: string }>(
    cfg,
    'GET',
    `/instance/connect/${encodeURIComponent(name)}`,
    apiKey,
  )
  return data?.base64 ?? null
}

/** The paired phone number (digits) and WhatsApp profile name. */
export async function instanceOwner(
  cfg: EvolutionServerConfig,
  name: string,
): Promise<{ number: string | null; profileName: string | null }> {
  const data = await evolution<{ ownerJid?: string | null; profileName?: string | null }[]>(
    cfg,
    'GET',
    `/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`,
    cfg.globalKey,
  )
  const row = data?.[0]
  return {
    number: row?.ownerJid ? row.ownerJid.split('@')[0] : null,
    profileName: row?.profileName ?? null,
  }
}

/** Log the phone out (best-effort) and delete the instance. */
export async function deleteInstance(cfg: EvolutionServerConfig, name: string): Promise<void> {
  const path = encodeURIComponent(name)
  await evolution(cfg, 'DELETE', `/instance/logout/${path}`, cfg.globalKey).catch(() => {})
  await evolution(cfg, 'DELETE', `/instance/delete/${path}`, cfg.globalKey)
}
