'use client';

// ============================================================
// QR-code (Evolution) number — docs/saas/w3-instancia.md. Shown by
// WhatsAppChannels instead of the Meta form when the admin adds a
// QR-code number or picks one. New: creates the instance and hands the
// id back. Existing: polls state + QR until the phone pairs, then shows
// the paired number and lets the admin disconnect and remove it.
// ============================================================
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, QrCode, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

const POLL_MS = 3000;
/** Stop polling after this long without pairing; the admin can resume. */
const POLL_LIMIT_MS = 3 * 60 * 1000;

interface StateResponse {
  state?: string;
  qr?: string | null;
  number?: string | null;
  profile_name?: string | null;
  error?: string;
}

export function EvolutionConnect({
  channelId,
  newLabel,
  onChanged,
  channelBar,
}: {
  /** Null = adding a new QR-code number. */
  channelId: string | null;
  newLabel: string;
  onChanged: (channelId: string | null) => void;
  channelBar: ReactNode;
}) {
  const t = useTranslations('Settings.whatsapp.evolution');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<StateResponse | null>(null);
  const [polling, setPolling] = useState(channelId !== null);
  const startedAt = useRef(Date.now());

  const refresh = useCallback(async () => {
    if (!channelId) return;
    const res = await fetch(`/api/whatsapp/evolution/instances/${channelId}`);
    const data: StateResponse = await res.json().catch(() => ({}));
    setInfo(res.ok ? data : { error: data.error || t('checkFailed') });
    if (data.state === 'open' || Date.now() - startedAt.current > POLL_LIMIT_MS) setPolling(false);
  }, [channelId, t]);

  useEffect(() => {
    if (!channelId || !polling) return;
    // First check now, then on an interval until paired or timed out.
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [channelId, polling, refresh]);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/evolution/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('createFailed'));
      toast.success(t('created'));
      onChanged(data.channel_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('createFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!channelId || !confirm(t('removeConfirm'))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/whatsapp/evolution/instances/${channelId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('removeFailed'));
      toast.success(t('removed'));
      onChanged(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('removeFailed'));
    } finally {
      setBusy(false);
    }
  }

  const connected = info?.state === 'open';

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      {channelBar}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <QrCode className="size-4" />
            {channelId ? (connected ? t('connectedTitle') : t('pairTitle')) : t('newTitle')}
          </CardTitle>
          <CardDescription>
            {channelId ? (connected ? t('connectedHint') : t('pairHint')) : t('newHint')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!channelId && (
            <Button type="button" onClick={create} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <QrCode />}
              {t('generate')}
            </Button>
          )}

          {channelId && !info && (
            <Loader2 className="size-6 animate-spin text-primary" aria-label={t('loading')} />
          )}

          {info?.error && <p className="text-sm text-destructive">{info.error}</p>}

          {channelId && info && !connected && !info.error && (
            <div className="space-y-3">
              {info.qr ? (
                // eslint-disable-next-line @next/next/no-img-element -- data: URL from Evolution
                <img src={info.qr} alt={t('qrAlt')} className="size-64 rounded-lg bg-white p-2" />
              ) : (
                <p className="text-sm text-muted-foreground">{t('waitingQr')}</p>
              )}
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>{t('step1')}</li>
                <li>{t('step2')}</li>
                <li>{t('step3')}</li>
              </ol>
              {!polling && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    startedAt.current = Date.now();
                    setPolling(true);
                  }}
                >
                  <RefreshCw />
                  {t('newQr')}
                </Button>
              )}
            </div>
          )}

          {connected && (
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-emerald-500" />
              {info?.profile_name
                ? t('connectedAs', { number: info?.number ? `+${info.number}` : '—', name: info.profile_name })
                : t('connectedAsNumber', { number: info?.number ? `+${info.number}` : '—' })}
            </p>
          )}

          {channelId && (
            <div className="border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={remove} disabled={busy}>
                <Trash2 />
                {t('remove')}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">{t('removeHint')}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
