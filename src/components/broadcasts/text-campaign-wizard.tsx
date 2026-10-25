'use client';

// ============================================================
// Text campaign for QR-code accounts — docs/saas/w5-fila.md.
// Message (with {{nome}}-style variables) → audience (the same picker
// as template broadcasts) → confirm. The server queue sends one message
// at a time with a random pause, so the tab can be closed.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Clock, Loader2, Send, ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { countAudience, type AudienceConfig } from '@/lib/broadcast-audience';
import {
  CAMPAIGN_VARIABLES,
  estimatedDurationMs,
  renderCampaignText,
  unknownCampaignVariables,
} from '@/lib/broadcasts/text-campaign';
import { useBroadcastSending } from '@/hooks/use-broadcast-sending';
import { Step2SelectAudience } from './step2-select-audience';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const SAMPLE = { name: 'Maria Souza', phone: '5511988887777', email: 'maria@exemplo.com', company: 'Loja da Maria' };

export function TextCampaignWizard() {
  const t = useTranslations('Broadcasts.text');
  const router = useRouter();
  const { queueTextBroadcast, isProcessing, progress } = useBroadcastSending();
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Caret position to restore once an inserted variable is rendered.
  const pendingCaret = useRef<number | null>(null);

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [minInterval, setMinInterval] = useState(20);
  const [maxInterval, setMaxInterval] = useState(45);
  const [audience, setAudience] = useState<AudienceConfig>({ type: 'all' });
  const [count, setCount] = useState<number | null>(null);

  const unknown = useMemo(() => unknownCampaignVariables(text), [text]);
  const intervalOk = minInterval >= 5 && maxInterval >= minInterval && maxInterval <= 3600;
  const messageOk = name.trim() && text.trim() && unknown.length === 0 && intervalOk;

  useEffect(() => {
    const el = textRef.current;
    if (el && pendingCaret.current !== null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [text]);

  useEffect(() => {
    if (step !== 2) return;
    let cancelled = false;
    countAudience(createClient(), audience)
      .then((n) => !cancelled && setCount(n))
      .catch(() => !cancelled && setCount(null));
    return () => {
      cancelled = true;
    };
  }, [step, audience]);

  function insertVariable(variable: string) {
    const el = textRef.current;
    const token = `{{${variable}}}`;
    if (!el) return setText((v) => v + token);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    pendingCaret.current = start + token.length;
    setText(text.slice(0, start) + token + text.slice(end));
  }

  async function start() {
    try {
      const id = await queueTextBroadcast({
        name: name.trim(),
        messageText: text.trim(),
        audience,
        minIntervalSeconds: minInterval,
        maxIntervalSeconds: maxInterval,
      });
      toast.success(t('queued'));
      router.push(`/broadcasts/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('queueFailed'));
    }
  }

  const minutes = count ? Math.ceil(estimatedDurationMs(count, minInterval, maxInterval) / 60000) : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <ol className="flex gap-2 text-xs">
        {[t('stepMessage'), t('stepAudience'), t('stepConfirm')].map((label, i) => (
          <li
            key={label}
            className={`rounded-full px-3 py-1 ${i === step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="campaign-name">{t('name')}</Label>
            <Input id="campaign-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="campaign-text">{t('message')}</Label>
            <Textarea
              id="campaign-text"
              ref={textRef}
              rows={6}
              maxLength={4096}
              value={text}
              placeholder={t('messagePlaceholder')}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{t('variables')}</span>
              {CAMPAIGN_VARIABLES.map((v) => (
                <Button
                  key={v}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  // Keep the caret in the message while clicking.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertVariable(v)}
                >
                  {`{{${v}}}`}
                </Button>
              ))}
            </div>
            {unknown.length > 0 && (
              <p className="text-xs text-destructive">{t('unknownVariables', { list: unknown.join(', ') })}</p>
            )}
          </div>
          {text.trim() && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('preview')}</p>
              <p className="whitespace-pre-wrap rounded-lg bg-emerald-950/40 p-3 text-sm">{renderCampaignText(text, SAMPLE)}</p>
            </div>
          )}
          <div className="space-y-1">
            <Label>{t('interval')}</Label>
            <div className="flex items-center gap-2 text-sm">
              <Input type="number" min={5} max={3600} className="w-20" value={minInterval} onChange={(e) => setMinInterval(Number(e.target.value))} aria-label={t('intervalMin')} />
              {t('to')}
              <Input type="number" min={5} max={3600} className="w-20" value={maxInterval} onChange={(e) => setMaxInterval(Number(e.target.value))} aria-label={t('intervalMax')} />
              {t('seconds')}
            </div>
            <p className="text-xs text-muted-foreground">{intervalOk ? t('intervalHint') : t('intervalInvalid')}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => router.push('/broadcasts')}>
              {t('cancel')}
            </Button>
            <Button type="button" disabled={!messageOk} onClick={() => setStep(1)}>
              {t('next')}
            </Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <Step2SelectAudience audience={audience} onUpdate={setAudience} onNext={() => setStep(2)} onBack={() => setStep(0)} />
      )}

      {step === 2 && (
        <div className="space-y-4">
          <dl className="space-y-2 rounded-lg border border-border p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t('name')}</dt>
              <dd className="font-medium">{name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t('recipients')}</dt>
              <dd className="font-medium">{count ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="flex items-center gap-1 text-muted-foreground">
                <Clock className="size-3.5" />
                {t('duration')}
              </dt>
              <dd className="font-medium">{!count ? '—' : minutes < 1 ? t('underMinute') : t('aboutMinutes', { minutes })}</dd>
            </div>
          </dl>
          <p className="flex gap-2 rounded-lg border border-amber-500/40 p-3 text-xs text-amber-500">
            <ShieldAlert className="size-4 shrink-0" />
            {t('banWarning')}
          </p>
          <div className="flex justify-between gap-2">
            <Button type="button" variant="ghost" onClick={() => setStep(1)} disabled={isProcessing}>
              {t('back')}
            </Button>
            <Button type="button" onClick={start} disabled={isProcessing || count === 0}>
              {isProcessing ? <Loader2 className="animate-spin" /> : <Send />}
              {isProcessing ? t('preparing', { progress }) : t('start')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
