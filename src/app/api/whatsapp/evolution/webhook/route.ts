import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { readCappedBody } from '@/lib/whatsapp/webhook-body'
import { processInboundMessage, processOutboundEcho } from '@/lib/whatsapp/inbound'
import { providerForChannel } from '@/lib/whatsapp/provider'
import { applyMessageStatus } from '@/lib/whatsapp/message-status-sync'
import { applyBroadcastRecipientStatus } from '@/lib/whatsapp/broadcast-recipient-webhook'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import {
  translateInbound,
  translateStatus,
  type EvolutionMessageData,
  type EvolutionStatusData,
} from '@/lib/whatsapp/evolution/translate'
import { EVOLUTION_SECRET_HEADER, evolutionSecretMatches } from '@/lib/whatsapp/evolution/webhook-secret'

// Same headroom as the Meta webhook: inbound processing fans out to
// media downloads, flows, automations and the AI reply.
export const maxDuration = 60

const HANDLED_EVENTS = new Set(['messages.upsert', 'messages.update', 'connection.update'])

/**
 * POST /api/whatsapp/evolution/webhook — Evolution API v2 events for
 * every instance (docs/saas/w2-evolution.md). Authenticated by a shared
 * secret header; the instance name picks the number (whatsapp_config
 * row with provider 'evolution'). Handles messages.upsert (inbound,
 * through the same pipeline as Meta), messages.update (delivery
 * status of what we sent) and connection.update (paired / logged out,
 * W3). Acks right away and works in `after()`.
 */
export async function POST(request: Request) {
  const expected = process.env.EVOLUTION_WEBHOOK_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'Evolution webhook not configured' }, { status: 503 })
  }
  if (!evolutionSecretMatches(request.headers.get(EVOLUTION_SECRET_HEADER) ?? '', expected)) {
    console.warn('[evolution webhook] rejected request with an invalid secret')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawBody = await readCappedBody(request)
  if (rawBody === null) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }
  let body: { event?: string; instance?: string; data?: unknown }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // "messages.upsert" or "MESSAGES_UPSERT", depending on the server config.
  const event = (body.event ?? '').toLowerCase().replace(/_/g, '.')
  if (!body.instance || !HANDLED_EVENTS.has(event)) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }
  const instance = body.instance
  const items = (Array.isArray(body.data) ? body.data : [body.data]).filter(Boolean)

  after(async () => {
    try {
      await processEvent(event, instance, items)
    } catch (error) {
      console.error('[evolution webhook] processing failed:', error)
    }
  })
  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processEvent(event: string, instance: string, items: unknown[]) {
  const db = supabaseAdmin()
  const { data: rows, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('provider', 'evolution')
    .eq('phone_number_id', instance)
  if (error) {
    console.error('[evolution webhook] number lookup failed:', instance, error.message)
    return
  }
  if (!rows || rows.length !== 1) {
    console.error(`[evolution webhook] instance ${instance} matched ${rows?.length ?? 0} numbers; event dropped`)
    return
  }
  const config = rows[0]

  if (event === 'connection.update') {
    // 'open' = phone paired, 'close' = logged out; 'connecting' changes nothing.
    const state = (items[0] as { state?: string } | undefined)?.state
    if (state !== 'open' && state !== 'close') return
    await db
      .from('whatsapp_config')
      .update({
        status: state === 'open' ? 'connected' : 'disconnected',
        ...(state === 'open' ? { connected_at: new Date().toISOString() } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', config.id)
      .eq('account_id', config.account_id)
    return
  }

  if (event === 'messages.update') {
    for (const item of items) {
      const status = translateStatus(item as EvolutionStatusData)
      if (!status) continue
      const statusAt = new Date().toISOString()
      const advanced = await applyMessageStatus(db, config.account_id, {
        ...status,
        failure: null,
        statusAt,
      })
      // Text campaigns (W5) count delivered/read like template broadcasts.
      await applyBroadcastRecipientStatus(db, {
        whatsappMessageId: status.wamid,
        status: status.status,
        occurredAt: statusAt,
        failure: null,
      })
      for (const message of advanced) {
        await dispatchWebhookEvent(db, config.account_id, 'message.status_updated', {
          whatsapp_message_id: status.wamid,
          conversation_id: message.conversation_id,
          status: status.status,
        })
      }
    }
    return
  }

  const provider = providerForChannel(config)
  for (const item of items) {
    const translated = translateInbound(item as EvolutionMessageData)
    if ('skip' in translated) {
      console.info(`[evolution webhook] skipped message on ${instance}: ${translated.skip}`)
      continue
    }
    if (translated.fromMe) {
      // Sent from the phone / WhatsApp Web — or by this app (skipped by id).
      await processOutboundEcho(
        translated.message,
        translated.contact,
        config.account_id,
        config.user_id,
        provider,
        config.mirror_inbound_media !== false,
        config.id,
      )
      continue
    }
    await processInboundMessage(
      translated.message,
      translated.contact,
      config.account_id,
      config.user_id,
      provider,
      config.mirror_inbound_media !== false,
      config.id,
      { menuReplies: true },
    )
  }
}
