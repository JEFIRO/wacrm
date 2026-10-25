// A stand-in for the Evolution API v2 server, for LOCAL tests of the
// Evolution provider (docs/saas/w2-evolution.md). Dev only.
//
//   node scripts/dev/fake-evolution.mts [port=18080]
//
// Answers sendText / sendMedia / sendWhatsAppAudio / sendReaction with a
// fresh message id, getBase64FromMediaMessage with a 1×1 PNG and
// connectionState with "open". Every request is printed as one JSON line.
import http from 'node:http'

const port = Number(process.argv[2] ?? 18080)
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
let n = 0

http
  .createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const path = (req.url ?? '').split('/').slice(0, -1).join('/')
      console.log(JSON.stringify({ method: req.method, url: req.url, apikey: req.headers.apikey, body: raw ? JSON.parse(raw) : null }))
      res.setHeader('content-type', 'application/json')
      if (path.startsWith('/message/')) {
        n += 1
        res.end(JSON.stringify({ key: { id: `EVO-FAKE-${n}`, fromMe: true }, status: 'PENDING' }))
      } else if (path === '/chat/getBase64FromMediaMessage') {
        res.end(JSON.stringify({ base64: PNG_1x1, mimetype: 'image/png', mediaType: 'imageMessage' }))
      } else if (path === '/instance/connectionState') {
        res.end(JSON.stringify({ instance: { instanceName: req.url?.split('/').pop(), state: 'open' } }))
      } else {
        res.statusCode = 404
        res.end(JSON.stringify({ status: 404, error: 'Not Found', response: { message: ['unknown route'] } }))
      }
    })
  })
  .listen(port, '127.0.0.1', () => console.error(`fake Evolution on http://127.0.0.1:${port}`))
