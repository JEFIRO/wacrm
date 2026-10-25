// Sends an Evolution API v2 webhook event to the LOCAL app, with the
// shared secret header. Dev only.
//
//   node --env-file=.env.local scripts/dev/simulate-evolution.mts <instance> text "<texto>" [from]
//   node --env-file=.env.local scripts/dev/simulate-evolution.mts <instance> image "<legenda>" [from]
//   node --env-file=.env.local scripts/dev/simulate-evolution.mts <instance> status <message_id> <READ|DELIVERY_ACK|...>
import crypto from 'node:crypto'

const [instance, kind, arg, extra] = process.argv.slice(2)
const secret = process.env.EVOLUTION_WEBHOOK_SECRET
if (!instance || !kind || !arg || !secret) {
  console.error('usage: simulate-evolution.mts <instance> text|image|status <arg> [from|status]  (needs EVOLUTION_WEBHOOK_SECRET)')
  process.exit(1)
}

const from = kind === 'status' ? '' : extra ?? '5511966665555'
const body =
  kind === 'status'
    ? { event: 'messages.update', instance, data: { keyId: arg, remoteJid: 'x@s.whatsapp.net', fromMe: true, status: extra ?? 'READ' } }
    : {
        event: 'messages.upsert',
        instance,
        data: {
          key: { remoteJid: `${from}@s.whatsapp.net`, fromMe: false, id: `EVO-IN-${crypto.randomUUID()}` },
          pushName: 'Cliente Evolution',
          messageType: kind === 'image' ? 'imageMessage' : 'conversation',
          messageTimestamp: Math.floor(Date.now() / 1000),
          message: kind === 'image' ? { imageMessage: { mimetype: 'image/png', caption: arg } } : { conversation: arg },
        },
        date_time: new Date().toISOString(),
      }

const res = await fetch('http://localhost:3000/api/whatsapp/evolution/webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-wacrm-webhook-secret': secret },
  body: JSON.stringify(body),
})
console.log(res.status, await res.text())
