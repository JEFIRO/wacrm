// Simulates a Meta inbound text message against the LOCAL webhook,
// signed with META_APP_SECRET like Meta would. Dev only.
//
//   node --env-file=.env.local scripts/dev/simulate-inbound.mts <phone_number_id> "<text>" [from_wa_id]
//
// The phone_number_id must belong to a whatsapp_config row (channel).
import crypto from 'node:crypto'

const [phoneNumberId, text, from = '5511988887777'] = process.argv.slice(2)
if (!phoneNumberId || !text) {
  console.error('usage: simulate-inbound.mts <phone_number_id> "<text>" [from_wa_id]')
  process.exit(1)
}

const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA-DEV', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '0000', phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: 'Cliente Teste' }, wa_id: from }],
    messages: [{
      from,
      id: `wamid.dev.${crypto.randomUUID()}`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'text',
      text: { body: text },
    }],
  } }] }],
})

const secret = (process.env.META_APP_SECRET ?? '').split(',')[0].trim()
const signature = crypto.createHmac('sha256', secret).update(body).digest('hex')
const res = await fetch('http://localhost:3000/api/whatsapp/webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
  body,
})
console.log(res.status, await res.text())
