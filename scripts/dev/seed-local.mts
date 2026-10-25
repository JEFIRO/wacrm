// Seeds the LOCAL Supabase with a test account for sectors and lead
// distribution. Dev only — refuses to run against a non-local URL.
//
//   node --env-file=.env.local scripts/dev/seed-local.mts
//
// Creates (idempotent where it can be):
//   owner   teste@wacrm.test      password TEST_USER_PASSWORD
//   agents  jefferson@wacrm.test  jennifer@wacrm.test  password TEST_AGENT_PASSWORD
//   numbers "Vendas" 1000000000001 and "Suporte" 1000000000002 (fake tokens:
//           routing works, any real Meta call fails)
//   qr@wacrm.test (TEST_USER_PASSWORD) — a SECOND account, because an
//           account uses one kind of connection (migration 067): its number
//           "Evolution" = instance wacrm-dev-evolution, which only exists on
//           scripts/dev/fake-evolution.mts
//   sectors Vendas (Jefferson) and Suporte (Jennifer), each number's default
//   schedules every day 00:00–23:59 for both agents (a sector member needs one)
// Loaded by URL: Node needs the .ts extension, which the app's tsc rejects.
const { encrypt } = (await import(
  new URL('../../src/lib/whatsapp/encryption.ts', import.meta.url).href
)) as { encrypt: (text: string) => string }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  console.error(`refusing to seed a non-local Supabase: ${url}`)
  process.exit(1)
}
const ownerPassword = process.env.TEST_USER_PASSWORD
const agentPassword = process.env.TEST_AGENT_PASSWORD
if (!ownerPassword || !agentPassword) {
  console.error('set TEST_USER_PASSWORD and TEST_AGENT_PASSWORD in .env.local')
  process.exit(1)
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' }

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, Prefer: 'return=representation', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

async function ensureUser(email: string, password: string, fullName: string): Promise<string> {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: fullName } }),
  })
  if (res.ok) return ((await res.json()) as { id: string }).id
  const list = (await (await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers })).json()) as {
    users: { id: string; email: string }[]
  }
  const found = list.users.find((u) => u.email === email)
  if (!found) throw new Error(`could not create or find ${email}: ${await res.text()}`)
  return found.id
}

const ownerId = await ensureUser('teste@wacrm.test', ownerPassword, 'Usuário Teste')
const agents = {
  jefferson: await ensureUser('jefferson@wacrm.test', agentPassword, 'Jefferson'),
  jennifer: await ensureUser('jennifer@wacrm.test', agentPassword, 'Jennifer'),
}

const [owner] = (await rest(`profiles?user_id=eq.${ownerId}&select=account_id`)) as { account_id: string }[]
const accountId = owner.account_id

// Agents join the owner's account; the accounts their sign-up created go.
for (const [name, id] of Object.entries(agents)) {
  const [p] = (await rest(`profiles?user_id=eq.${id}&select=account_id`)) as { account_id: string }[]
  if (p.account_id !== accountId) {
    await rest(`profiles?user_id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        account_id: accountId,
        account_role: 'agent',
        full_name: name[0].toUpperCase() + name.slice(1),
      }),
    })
    await rest(`accounts?id=eq.${p.account_id}`, { method: 'DELETE' })
  }
}

// A sector member must have a schedule (migration 064): set it first.
for (const id of Object.values(agents)) {
  const ranges = (await rest(`agent_schedules?user_id=eq.${id}&select=id`)) as unknown[]
  if (ranges.length) continue
  await rest('agent_schedules', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        user_id: id,
        account_id: accountId,
        weekday,
        start_time: '00:00',
        end_time: '23:59',
      })),
    ),
  })
}

// A sector is created with its member in one call (migration 064).
async function ensureSector(name: string, memberId: string): Promise<string> {
  const rows = (await rest(`sectors?account_id=eq.${accountId}&name=eq.${encodeURIComponent(name)}&select=id`)) as {
    id: string
  }[]
  if (rows.length) return rows[0].id
  return (await rest('rpc/create_sector', {
    method: 'POST',
    body: JSON.stringify({ p_account_id: accountId, p_name: name, p_member_ids: [memberId] }),
  })) as string
}

const sectors = {
  vendas: await ensureSector('Vendas', agents.jefferson),
  suporte: await ensureSector('Suporte', agents.jennifer),
}

const token = encrypt('fake-token-local-test')
for (const [label, phone, sector, provider] of [
  ['Vendas', '1000000000001', sectors.vendas, 'meta'],
  ['Suporte', '1000000000002', sectors.suporte, 'meta'],
] as const) {
  const existing = (await rest(`whatsapp_config?phone_number_id=eq.${phone}&select=id`)) as { id: string }[]
  if (existing.length) continue
  await rest('whatsapp_config', {
    method: 'POST',
    body: JSON.stringify({
      account_id: accountId,
      user_id: ownerId,
      phone_number_id: phone,
      access_token: token,
      status: 'connected',
      label,
      default_sector_id: sector,
      provider,
    }),
  })
}

await rest('agent_settings?on_conflict=user_id', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(
    Object.values(agents).map((id) => ({ user_id: id, account_id: accountId, is_online: true, max_active_leads: 3 })),
  ),
})

// QR-code (Evolution) account — its own owner, its own number.
const qrOwnerId = await ensureUser('qr@wacrm.test', ownerPassword, 'Loja QR')
const [qrProfile] = (await rest(`profiles?user_id=eq.${qrOwnerId}&select=account_id`)) as { account_id: string }[]
const qrAccountId = qrProfile.account_id
const qrExisting = (await rest('whatsapp_config?phone_number_id=eq.wacrm-dev-evolution&select=id,account_id')) as {
  id: string
  account_id: string
}[]
if (qrExisting.length && qrExisting[0].account_id !== qrAccountId) {
  // Older seeds put it in the Meta account; move it.
  await rest(`whatsapp_config?id=eq.${qrExisting[0].id}`, { method: 'DELETE' })
}
if (!qrExisting.length || qrExisting[0].account_id !== qrAccountId) {
  await rest('whatsapp_config', {
    method: 'POST',
    body: JSON.stringify({
      account_id: qrAccountId,
      user_id: qrOwnerId,
      phone_number_id: 'wacrm-dev-evolution',
      access_token: token,
      status: 'connected',
      label: 'Evolution',
      provider: 'evolution',
    }),
  })
}

console.log(JSON.stringify({ accountId, ownerId, agents, sectors, qrAccountId }, null, 2))
