'use client';

// ============================================================
// Plan and usage — docs/saas/b1-planos.md. Read-only until payment
// (B2): current plan, trial / status, seats and numbers used, and the
// plan catalogue to compare.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { Check, CreditCard, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  formatBRL,
  seatLimit,
  seatsUsed,
  subscriptionPhase,
  trialDaysLeft,
  type Plan,
  type Subscription,
} from '@/lib/billing/plan';
import { SettingsPanelHead } from './settings-panel-head';

export function PlanSettings() {
  const t = useTranslations('Settings.plan');
  const { accountId, isOwner } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sub, setSub] = useState<(Subscription & { pending_invoice_url?: string | null; external_subscription_id?: string | null }) | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [numbers, setNumbers] = useState(0);
  // Subscribe form (B2, docs/saas/b2-asaas.md).
  const [choosing, setChoosing] = useState<Plan | null>(null);
  const [docNumber, setDocNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  async function subscribe() {
    if (!choosing) return;
    setBusy(true);
    try {
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: choosing.id, cpf_cnpj: docNumber }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('subscribeFailed'));
      toast.success(t('subscribed'));
      setChoosing(null);
      if (data.invoice_url) window.open(data.invoice_url, '_blank', 'noopener');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('subscribeFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    try {
      await fetch('/api/billing/sync', { method: 'POST' });
      refresh();
      toast.success(t('statusUpdated'));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!accountId) return;
    const db = createClient();
    let cancelled = false;
    (async () => {
      const [p, s, m, w] = await Promise.all([
        db.from('plans').select('*').eq('active', true).order('sort_order'),
        db.from('account_subscriptions').select('*').eq('account_id', accountId).maybeSingle(),
        db.from('profiles').select('account_role').eq('account_id', accountId),
        db.from('whatsapp_config').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      ]);
      if (cancelled) return;
      setPlans((p.data ?? []) as Plan[]);
      setSub((s.data as Subscription | null) ?? null);
      setRoles(((m.data ?? []) as { account_role: string }[]).map((r) => r.account_role));
      setNumbers(w.count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, reload]);

  const plan = plans.find((p) => p.id === sub?.plan_id) ?? null;
  const priceLabel = (p: Plan) =>
    p.monthly_price_cents === null
      ? t('priceTbd')
      : p.billing_cycle === 'yearly'
        ? t('pricePerInstalment', { price: formatBRL(p.monthly_price_cents) })
        : t('pricePerMonth', { price: formatBRL(p.monthly_price_cents) });
  const now = new Date();
  const phase = sub ? subscriptionPhase(sub, now) : null;

  return (
    <section className="animate-in fade-in-50 duration-200 space-y-6">
      <SettingsPanelHead title={t('title')} description={t('descriptionPay')} />

      {sub && plan && phase && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <CreditCard className="size-4" />
              {t('current', { plan: plan.name })}
              <Badge variant={phase === 'active' ? 'default' : 'outline'}>
                {phase === 'trialing'
                  ? t('trialDays', { days: trialDaysLeft(sub, now) })
                  : t(`status.${phase}`)}
              </Badge>
            </CardTitle>
            <CardDescription>
              {phase === 'trialing' || phase === 'trial_expired'
                ? t('trialHint', { date: new Date(sub.trial_ends_at ?? '').toLocaleDateString() })
                : priceLabel(plan)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Usage label={t('users')} used={seatsUsed(roles)} limit={seatLimit(plan, sub)} hint={t('usersHint')} />
              <Usage label={t('numbers')} used={numbers} limit={plan.max_numbers} />
            </div>
            {sub.external_subscription_id && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                {sub.pending_invoice_url && (
                  <a
                    href={sub.pending_invoice_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    <ExternalLink className="size-4" />
                    {t('openInvoice')}
                  </a>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={syncNow} disabled={busy}>
                  <RefreshCw className={busy ? 'animate-spin' : ''} />
                  {t('refreshStatus')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => {
          const isCurrent = p.id === sub?.plan_id;
          return (
            <Card key={p.id} className={isCurrent ? 'border-primary' : undefined}>
              <CardHeader>
                <CardTitle className="text-base">{p.name}</CardTitle>
                <CardDescription className="text-lg font-semibold text-foreground">
                  {priceLabel(p)}
                </CardDescription>
                {p.billing_cycle === 'yearly' && (
                  <p className="text-xs text-muted-foreground">{t('yearlyHint')}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ul className="space-y-1.5">
                  <li className="flex gap-2">
                    <Check className="size-4 text-primary" />
                    {t('includedUsers', { count: p.included_users })}
                  </li>
                  <li className="flex gap-2">
                    <Check className="size-4 text-primary" />
                    {t('maxNumbers', { count: p.max_numbers })}
                  </li>
                  <li className="flex gap-2 text-muted-foreground">
                    <Check className="size-4" />
                    {p.extra_user_price_cents === null
                      ? t('extraUserTbd')
                      : t('extraUser', { price: formatBRL(p.extra_user_price_cents) })}
                  </li>
                </ul>
                <Button
                  type="button"
                  className="w-full"
                  variant={isCurrent ? 'outline' : 'default'}
                  disabled={!isOwner || p.monthly_price_cents === null || (isCurrent && !!sub?.external_subscription_id)}
                  title={!isOwner ? t('ownerOnly') : undefined}
                  onClick={() => setChoosing(p)}
                >
                  {isCurrent ? (sub?.external_subscription_id ? t('currentPlan') : t('subscribeCurrent')) : t('choose')}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {choosing && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="text-base">{t('subscribeTitle', { plan: choosing.name })}</CardTitle>
            <CardDescription>{t('subscribeHint')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor="billing-document">{t('document')}</Label>
              <Input
                id="billing-document"
                inputMode="numeric"
                value={docNumber}
                placeholder="000.000.000-00"
                onChange={(e) => setDocNumber(e.target.value)}
              />
            </div>
            <Button type="button" onClick={subscribe} disabled={busy || docNumber.replace(/\D/g, '').length < 11}>
              {busy ? <Loader2 className="animate-spin" /> : <CreditCard />}
              {t('subscribeAndPay')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setChoosing(null)} disabled={busy}>
              {t('cancel')}
            </Button>
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">{t('paymentHint')}</p>
    </section>
  );
}

function Usage({ label, used, limit, hint }: { label: string; used: number; limit: number; hint?: string }) {
  const full = used >= limit;
  return (
    <div className="space-y-1 rounded-lg border border-border p-3">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className={full ? 'font-medium text-amber-500' : 'font-medium'}>
          {used} / {limit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${full ? 'bg-amber-500' : 'bg-primary'}`}
          style={{ width: `${Math.min(100, (used / Math.max(1, limit)) * 100)}%` }}
        />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
