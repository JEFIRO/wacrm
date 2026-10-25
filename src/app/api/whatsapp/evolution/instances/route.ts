import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { createInstance, deleteInstance, evolutionServerConfig } from '@/lib/whatsapp/evolution/admin'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

/**
 * GET /api/whatsapp/evolution/instances — whether QR-code numbers are
 * available on this deploy (the Evolution server is configured).
 */
export async function GET() {
  try {
    await requireRole('admin')
    return NextResponse.json({ available: evolutionServerConfig() !== null })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/**
 * POST /api/whatsapp/evolution/instances — body `{ label? }`.
 *
 * Adds a QR-code number (docs/saas/w3-instancia.md): creates an Evolution
 * instance with this app's webhook, stores it as a whatsapp_config row
 * (provider 'evolution', instance name in phone_number_id, its key
 * encrypted in access_token, status 'disconnected' until the phone pairs)
 * and returns the first QR code. Admin only.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const cfg = evolutionServerConfig()
    if (!cfg) return NextResponse.json({ error: t('evolution.notConfigured') }, { status: 503 })

    const body = await request.json().catch(() => ({}))
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 60) || null : null
    const name = `wacrm-${accountId.slice(0, 8)}-${randomBytes(4).toString('hex')}`

    let created
    try {
      created = await createInstance(cfg, name)
    } catch (err) {
      console.error('[evolution] instance create failed:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: t('evolution.createFailed') }, { status: 502 })
    }

    const { data: row, error } = await supabase
      .from('whatsapp_config')
      .insert({
        account_id: accountId,
        user_id: userId,
        provider: 'evolution',
        phone_number_id: name,
        access_token: encrypt(created.apiKey),
        status: 'disconnected',
        label,
      })
      .select('id')
      .single()
    if (error || !row) {
      console.error('[evolution] number save failed:', error?.message)
      // Don't leave an orphan instance on the server.
      await deleteInstance(cfg, name).catch(() => {})
      return NextResponse.json({ error: t('evolution.createFailed') }, { status: 500 })
    }

    return NextResponse.json({ channel_id: row.id, qr: created.qr })
  } catch (error) {
    return toErrorResponse(error)
  }
}
