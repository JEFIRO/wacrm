'use client';

// ============================================================
// Plan and usage — docs/saas/b1-planos.md. Read-only until payment
// (B2): current plan, trial / status, seats and numbers used, and the
// plan catalogue to compare.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { Check, CreditCard, ExternalLink, Loader2, Minus, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
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
  // B5: "subscribe now" at signup lands here with ?assinar=<plan>.
  const searchParams = useSearchParams();
  const wantedPlan = searchParams.get('assinar');

  useEffect(() => {
    if (!wantedPlan || !isOwner || choosing) return;
    const p = plans.find((x) => x.id === wantedPlan && x.active && x.monthly_price_cents !== null);
    // Open the subscribe form once the plans are loaded.
    if (p) setChoosing(p);
  }, [wantedPlan, isOwner, plans, choosing]);

  async function tryPlan(p: Plan) {
    setBusy(true);
    try {
      const res = await fetch('/api/billing/trial-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: p.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('trialPlanFailed'));
      toast.success(t('trialPlanChanged', { plan: p.name }));
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('trialPlanFailed'));
    } finally {
      setBusy(false);
    }
  }
  // Extra users to buy (B3); null = unchanged from the subscription.
  const [extraDraft, setExtraDraft] = useState<number | null>(null);

  async function saveSeats(extra: number) {
    setBusy(true);
    try {
      const res = await fetch('/api/billing/seats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extra_users: extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('seatsFailed'));
      toast.success(t('seatsSaved'));
      setExtraDraft(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('seatsFailed'));
    } finally {
      setBusy(false);
    }
  }

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
        // All plans: the account may be on one no longer offered.
        db.from('plans').select('*').order('sort_order'),
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
  const offered = plans.filter((p) => p.active);
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
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{t('extraUsers')}</span>
              {plan.extra_user_price_cents !== null && sub.external_subscription_id && isOwner ? (
                <>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label={t('fewerUsers')}
                    disabled={busy || (extraDraft ?? sub.extra_users) <= 0}
                    onClick={() => setExtraDraft(Math.max(0, (extraDraft ?? sub.extra_users) - 1))}
                  >
                    <Minus />
                  </Button>
                  <span className="w-6 text-center font-medium">{extraDraft ?? sub.extra_users}</span>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label={t('moreUsers')}
                    disabled={busy}
                    onClick={() => setExtraDraft((extraDraft ?? sub.extra_users) + 1)}
                  >
                    <Plus />
                  </Button>
                  <span className="text-muted-foreground">
                    {t('extraUserEach', { price: formatBRL(plan.extra_user_price_cents) })}
                  </span>
                  {extraDraft !== null && extraDraft !== sub.extra_users && (
                    <Button type="button" size="sm" onClick={() => saveSeats(extraDraft)} disabled={busy}>
                      {t('saveSeats', {
                        total: formatBRL((plan.monthly_price_cents ?? 0) + extraDraft * plan.extra_user_price_cents),
                      })}
                    </Button>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">
                  {sub.extra_users > 0 ? sub.extra_users : ''}{' '}
                  {plan.extra_user_price_cents === null ? t('extraUserTbdShort') : t('extraUserAfterSubscribe')}
                </span>
              )}
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

      <div className="grid gap-4 md:grid-cols-3">
        {offered.map((p) => {
          const isCurrent = p.id === sub?.plan_id;
          const perSeat = p.pricing === 'per_seat' && p.extra_user_price_cents !== null;
          return (
            <Card key={p.id} className={isCurrent || p.highlight ? 'relative border-primary' : 'relative'}>
              {p.highlight && (
                <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] uppercase">
                  {t('recommended')}
                </Badge>
              )}
              <CardHeader>
                <CardTitle className="text-base">{p.name}</CardTitle>
                {p.tagline && <CardDescription>{p.tagline}</CardDescription>}
                <p className="pt-2 text-2xl font-semibold text-foreground">
                  {perSeat ? formatBRL(p.extra_user_price_cents!) : priceLabel(p)}
                  {perSeat && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">{t('perAttendant')}</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {perSeat
                    ? t('minimumSeats', { count: p.included_users, total: formatBRL(p.monthly_price_cents ?? 0) })
                    : p.billing_cycle === 'yearly'
                      ? t('yearlyIncluded', { count: p.included_users })
                      : t('includedUsers', { count: p.included_users })}
                </p>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
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
                {/* B5: switch the trial's plan without paying. */}
                {!isCurrent && isOwner && sub?.status === 'trialing' && !sub.external_subscription_id && (
                  <Button type="button" className="w-full" variant="ghost" size="sm" disabled={busy} onClick={() => tryPlan(p)}>
                    {t('tryPlan')}
                  </Button>
                )}
                <ul className="space-y-1.5">
                  {(p.features.length ? p.features : [t('maxNumbers', { count: p.max_numbers })]).map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="size-4 shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                  {!perSeat && (
                    <li className="flex gap-2 text-muted-foreground">
                      <Check className="size-4 shrink-0" />
                      {p.extra_user_price_cents === null
                        ? t('extraUserTbd')
                        : t('extraUser', { price: formatBRL(p.extra_user_price_cents) })}
                    </li>
                  )}
                </ul>
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
