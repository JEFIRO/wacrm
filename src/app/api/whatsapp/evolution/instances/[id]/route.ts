import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  deleteInstance,
  evolutionServerConfig,
  instanceOwner,
  instanceQr,
  instanceState,
} from '@/lib/whatsapp/evolution/admin'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

type Ctx = { params: Promise<{ id: string }> }

/** The account's Evolution number `id`, read with the caller's RLS. */
async function loadEvolutionChannel(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  id: string,
) {
  const { data } = await supabase
    .from('whatsapp_config')
    .select('id, phone_number_id, access_token, status')
    .eq('id', id)
    .eq('account_id', accountId)
    .eq('provider', 'evolution')
    .maybeSingle()
  return data as { id: string; phone_number_id: string; access_token: string; status: string } | null
}

/**
 * GET /api/whatsapp/evolution/instances/:id — connection state of a
 * QR-code number; while not paired, also a fresh QR code. Keeps
 * whatsapp_config.status in step (the webhook does too). Admin only;
 * the settings screen polls it while the QR is shown.
 */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const cfg = evolutionServerConfig()
    if (!cfg) return NextResponse.json({ error: t('evolution.notConfigured') }, { status: 503 })
    const { id } = await params
    const channel = await loadEvolutionChannel(supabase, accountId, id)
    if (!channel) return NextResponse.json({ error: t('whatsappConfig.channelNotFound') }, { status: 404 })

    const apiKey = decrypt(channel.access_token)
    let state: string
    try {
      state = await instanceState(cfg, channel.phone_number_id, apiKey)
    } catch (err) {
      console.error('[evolution] state check failed:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: t('evolution.unreachable') }, { status: 502 })
    }

    const connected = state === 'open'
    if (connected !== (channel.status === 'connected')) {
      await supabase
        .from('whatsapp_config')
        .update({
          status: connected ? 'connected' : 'disconnected',
          ...(connected ? { connected_at: new Date().toISOString() } : {}),
        })
        .eq('id', channel.id)
        .eq('account_id', accountId)
    }

    if (connected) {
      const owner = await instanceOwner(cfg, channel.phone_number_id).catch(() => null)
      return NextResponse.json({ state, number: owner?.number ?? null, profile_name: owner?.profileName ?? null })
    }
    const qr = await instanceQr(cfg, channel.phone_number_id, apiKey).catch(() => null)
    return NextResponse.json({ state, qr })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/**
 * DELETE /api/whatsapp/evolution/instances/:id — logs the phone out,
 * deletes the instance on the server and removes the number (its
 * conversations keep their history, as for Meta numbers). Admin only.
 */
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const cfg = evolutionServerConfig()
    if (!cfg) return NextResponse.json({ error: t('evolution.notConfigured') }, { status: 503 })
    const { id } = await params
    const channel = await loadEvolutionChannel(supabase, accountId, id)
    if (!channel) return NextResponse.json({ error: t('whatsappConfig.channelNotFound') }, { status: 404 })

    try {
      await deleteInstance(cfg, channel.phone_number_id)
    } catch (err) {
      // Already gone on the server is fine; anything else keeps the row
      // so the admin can retry instead of leaving a live orphan.
      const message = err instanceof Error ? err.message : String(err)
      if (!/404/.test(message)) {
        console.error('[evolution] instance delete failed:', message)
        return NextResponse.json({ error: t('evolution.deleteFailed') }, { status: 502 })
      }
    }

    const { error } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('id', channel.id)
      .eq('account_id', accountId)
    if (error) {
      console.error('[evolution] number delete failed:', error.message)
      return NextResponse.json({ error: t('whatsappConfig.deleteFailed') }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
