'use client';

// ============================================================
// Plan and usage — docs/saas/b1-planos.md. Read-only until payment
// (B2): current plan, trial / status, seats and numbers used, and the
// plan catalogue to compare.
// ============================================================
import { useEffect, useState } from 'react';
import { Check, CreditCard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  const { accountId } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [numbers, setNumbers] = useState(0);

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
  }, [accountId]);

  const plan = plans.find((p) => p.id === sub?.plan_id) ?? null;
  const now = new Date();
  const phase = sub ? subscriptionPhase(sub, now) : null;

  return (
    <section className="animate-in fade-in-50 duration-200 space-y-6">
      <SettingsPanelHead title={t('title')} description={t('description')} />

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
                : t('pricePerMonth', { price: formatBRL(plan.monthly_price_cents) })}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Usage label={t('users')} used={seatsUsed(roles)} limit={seatLimit(plan, sub)} hint={t('usersHint')} />
            <Usage label={t('numbers')} used={numbers} limit={plan.max_numbers} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.id === sub?.plan_id;
          return (
            <Card key={p.id} className={isCurrent ? 'border-primary' : undefined}>
              <CardHeader>
                <CardTitle className="text-base">{p.name}</CardTitle>
                <CardDescription className="text-lg font-semibold text-foreground">
                  {t('pricePerMonth', { price: formatBRL(p.monthly_price_cents) })}
                </CardDescription>
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
                  {p.setup_fee_cents > 0 && (
                    <li className="flex gap-2 text-muted-foreground">
                      <Check className="size-4" />
                      {t('setupFee', { price: formatBRL(p.setup_fee_cents) })}
                    </li>
                  )}
                </ul>
                <Button type="button" className="w-full" variant={isCurrent ? 'outline' : 'default'} disabled title={t('paymentSoon')}>
                  {isCurrent ? t('currentPlan') : t('choose')}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t('paymentSoon')}</p>
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
