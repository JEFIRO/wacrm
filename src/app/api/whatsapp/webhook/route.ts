import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { processInboundMessage, type WhatsAppMessage } from '@/lib/whatsapp/inbound'
import { providerForChannel } from '@/lib/whatsapp/provider'
import {
  verifyMetaWebhookSignature,
  verifyTokenMatches,
} from '@/lib/whatsapp/webhook-signature'
import { readCappedBody } from '@/lib/whatsapp/webhook-body'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { applyBroadcastRecipientStatus } from '@/lib/whatsapp/broadcast-recipient-webhook'
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from '@/lib/whatsapp/template-webhook'
import { applyMessageStatus } from '@/lib/whatsapp/message-status-sync'

// The `after()` callback in POST runs within this route's max duration.
// Inbound processing can fan out to per-media Meta verification calls, so
// give it headroom beyond the platform default (Vercel clamps this to the
// plan's ceiling). Tune as needed.
export const maxDuration = 60

// Lazy-initialized to avoid build-time crash when env vars are missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

// The inbound message shape and its processing (contact, conversation,
// message insert, flows, automations, AI, webhooks) live in
// src/lib/whatsapp/inbound.ts, shared with the Evolution webhook (W2).
/** One entry of a failed status's `errors` array, as Meta sends it. */
interface MetaStatusError {
  code: number
  title: string
  message?: string
  error_data?: { details?: string }
  href?: string
}

interface WhatsAppWebhookEntry {
  id: string
  changes: Array<{
    value: {
      messaging_product: string
      metadata: {
        display_phone_number: string
        phone_number_id: string
      }
      contacts?: Array<{
        profile: { name?: string; username?: string }
        /** Absent for a username-only sender — see WhatsAppMessage.from. */
        wa_id?: string
        user_id?: string
        parent_user_id?: string
      }>
      messages?: WhatsAppMessage[]
      statuses?: Array<{
        id: string
        status: string
        timestamp: string
        recipient_id: string
        /**
         * Only present when `status === 'failed'`. Meta's reason for the
         * failure — `code` is a stable numeric error code (e.g. 131049),
         * `title` a short label, `error_data.details` the human-readable
         * explanation. See #535.
         */
        errors?: MetaStatusError[]
      }>
    }
    field: string
  }>
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      )
    }

    // Fetch all whatsapp configs to check verify tokens
    const { data: configs, error: configError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id, verify_token')

    if (configError || !configs) {
      console.error('Error fetching configs for verification:', configError)
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: 403 }
      )
    }

    // Check if any config's verify_token matches. Also collect the
    // matching row so we can opportunistically upgrade its token to
    // GCM if it was still in the legacy CBC format.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let matchedConfig: any = null
    for (const config of configs) {
      if (!config.verify_token) continue
      try {
        if (verifyTokenMatches(decrypt(config.verify_token), verifyToken)) {
          matchedConfig = config
          break
        }
      } catch {
        // Malformed / wrong-key token row — skip it and keep checking.
      }
    }

    if (matchedConfig) {
      // Fire-and-forget GCM upgrade. Safe to run on every subscribe
      // since it's a no-op once the column is already GCM.
      if (isLegacyFormat(matchedConfig.verify_token)) {
        void supabaseAdmin()
          .from('whatsapp_config')
          .update({ verify_token: encrypt(verifyToken) })
          .eq('id', matchedConfig.id)
          .then(({ error }: { error: unknown }) => {
            if (error) {
              console.warn(
                '[webhook] verify_token GCM upgrade failed:',
                (error as { message?: string })?.message ?? error,
              )
            }
          })
      }
      // Return challenge as plain text
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    )
  } catch (error) {
    console.error('Error in webhook GET verification:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Receive messages
export async function POST(request: Request) {
  // Read raw body first so we can HMAC-verify the exact bytes Meta
  // signed. request.json() would re-encode and break the signature.
  const rawBody = await readCappedBody(request)
  if (rawBody === null) {
    console.warn('[webhook] rejected oversized payload')
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    // 401 (not 200) — we want Meta's delivery dashboard to show failures
    // loudly if a misconfiguration causes signatures to stop matching,
    // rather than silently eating events.
    console.warn('[webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { entry?: WhatsAppWebhookEntry[] }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Process AFTER the response so we ack Meta within their ~20s timeout
  // (a slow ack triggers Meta retries + duplicate inserts), while still
  // guaranteeing the work runs to completion.
  //
  // This MUST use `after()` rather than a detached `processWebhook(body)`
  // promise: on serverless platforms (we run on Vercel) the function can
  // be frozen or terminated the moment the response is sent, so a floating
  // promise's DB writes are not guaranteed to finish. That dropped a
  // non-deterministic *subset* of inbound messages — contacts/conversations
  // were created but the message insert never landed, leaving conversations
  // that show in the inbox with an empty thread, and no logs to explain it
  // (see issue #301). `after()` hands the callback to the runtime, which
  // keeps the function alive until it resolves (within the route's
  // maxDuration).
  after(async () => {
    try {
      await processWebhook(body)
    } catch (error) {
      console.error('Error processing webhook:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function resolveAccountForPhoneNumber(
  phoneNumberId: string | undefined
): Promise<string | null> {
  if (!phoneNumberId) return null
  const { data, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', phoneNumberId)

  if (error) {
    console.error('Error resolving account for status update:', phoneNumberId, error)
    return null
  }
  if (!data || data.length !== 1) {
    console.error(
      `Status update for phone_number_id ${phoneNumberId} matched ${data?.length ?? 0} configs; message statuses skipped`
    )
    return null
  }
  return data[0].account_id
}

function metaTimestampToIso(timestamp: string): string | null {
  const seconds = Number.parseInt(timestamp, 10)
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null
}

async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      // Template-lifecycle events (status / quality / components
      // updates from Meta) come in on a different change.field and
      // have a different value shape — route them through the
      // dedicated handler. Skip the messaging branches below so we
      // don't try to read message-shaped fields off a template event.
      // `entry.id` is the WABA id for template events — the handler
      // needs it to resolve the owning account when the template has
      // no local row yet (#534).
      if (isTemplateWebhookField(change.field)) {
        await handleTemplateWebhookChange(
          {
            field: change.field,
            value: change.value as unknown,
            wabaId: entry.id,
          },
          supabaseAdmin(),
        )
        continue
      }

      const value = change.value

      // Handle status updates
      if (value.statuses) {
        const statusAccountId = await resolveAccountForPhoneNumber(
          value.metadata?.phone_number_id
        )
        for (const status of value.statuses) {
          await handleStatusUpdate(status, statusAccountId)
        }
      }

      // Handle incoming messages
      if (!value.messages || !value.contacts) continue

      const phoneNumberId = value.metadata.phone_number_id

      // Find user's config by phone_number_id. `.single()` returns
      // PGRST116 for both 0 rows AND ≥2 rows — distinguish them so
      // operators see the real cause in logs. ≥2 rows shouldn't happen
      // post-migration 013 (UNIQUE constraint), but a row created
      // before the constraint, or a race, would still surface here.
      const { data: configRows, error: configError } = await supabaseAdmin()
        .from('whatsapp_config')
        .select('*')
        .eq('phone_number_id', phoneNumberId)

      if (configError) {
        console.error(
          'Error fetching whatsapp_config for phone_number_id:',
          phoneNumberId,
          configError
        )
        continue
      }

      if (!configRows || configRows.length === 0) {
        console.error('No config found for phone_number_id:', phoneNumberId)
        continue
      }

      if (configRows.length > 1) {
        console.error(
          `Multiple configs (${configRows.length}) found for phone_number_id:`,
          phoneNumberId,
          '— inbound message dropped. Resolve duplicates so each number maps to a single account.',
          'Account owners:',
          configRows.map((r: { account_id: string; user_id: string }) => `${r.account_id} (admin ${r.user_id})`)
        )
        continue
      }

      const config = configRows[0]

      const provider = providerForChannel(config)

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i]
        const contact = value.contacts[i] || value.contacts[0]

        await processInboundMessage(
          message,
          contact,
          // Tenancy — drives every contact / conversation lookup
          // and the engines' active-row dispatch.
          config.account_id,
          // Audit / sender-of-record — used as the user_id on row
          // inserts that need it for NOT NULL FK compliance. Always
          // the admin who saved the WhatsApp config.
          config.user_id,
          provider,
          // Default ON: the column is NOT NULL DEFAULT TRUE, but a row
          // read before migration 039 lands would have it undefined,
          // and losing attachments is the failure mode worth avoiding.
          config.mirror_inbound_media !== false,
          config.id
        )
      }
    }
  }
}

async function handleStatusUpdate(
  status: {
    id: string
    status: string
    timestamp: string
    recipient_id: string
    errors?: MetaStatusError[]
  },
  accountId: string | null
) {
  // Meta's reason for a failed send (#535). Only read on `failed`; a
  // later non-failed status for the same wamid leaves the error
  // columns alone rather than clearing them, so the reason survives.
  const failure =
    status.status === 'failed' && status.errors?.[0]
      ? {
          code: status.errors[0].code,
          title: status.errors[0].title,
          details: status.errors[0].error_data?.details ?? null,
        }
      : null

  if (failure) {
    console.warn(
      `WhatsApp message ${status.id} failed: [${failure.code}] ${failure.title}` +
        (failure.details ? ` — ${failure.details}` : '')
    )
  }

  const advancedMessages = accountId
    ? await applyMessageStatus(supabaseAdmin(), accountId, {
        wamid: status.id,
        status: status.status,
        failure,
        statusAt: metaTimestampToIso(status.timestamp),
      })
    : []

  // Webhook fan-out for this status change happens at the END of this
  // handler (after the broadcast mirror below), so a slow subscriber
  // endpoint can't delay the broadcast_recipients update.

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id
  //    (added in migration 003). The aggregate trigger on
  //    broadcast_recipients re-derives the parent broadcast's
  //    sent/delivered/read/failed counts automatically.
  await applyBroadcastRecipientStatus(supabaseAdmin(), {
    whatsappMessageId: status.id,
    status: status.status,
    occurredAt: new Date(parseInt(status.timestamp) * 1000).toISOString(),
    failure,
  })

  // 3) Webhook fan-out for messages we store (inbox / API sends).
  //    Runs last so a slow subscriber can't delay the mirrors above.
  if (!accountId) return
  for (const advanced of advancedMessages) {
    await dispatchWebhookEvent(
      supabaseAdmin(),
      accountId,
      'message.status_updated',
      {
        whatsapp_message_id: status.id,
        conversation_id: advanced.conversation_id,
        status: status.status,
      }
    )
  }
}
