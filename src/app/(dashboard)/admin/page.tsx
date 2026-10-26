'use client';

// ============================================================
// SaaS owner's panel — docs/saas/b6-painel.md. Customers, plan,
// situation, usage and revenue; suspend / reactivate / extend trial.
// The API refuses anyone who isn't a platform admin.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Loader2, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatBRL } from '@/lib/billing/plan';
import type { CustomerSituation, PlatformAccountRow, PlatformSummary } from '@/lib/platform/overview';

type Row = PlatformAccountRow & { situation: CustomerSituation; revenue_cents: number };

const SITUATION_STYLE: Record<CustomerSituation, string> = {
  trial: 'border-sky-500/40 text-sky-400',
  active: 'border-emerald-500/40 text-emerald-400',
  limited: 'border-amber-500/40 text-amber-400',
  blocked: 'border-red-500/40 text-red-400',
  none: 'text-muted-foreground',
};

export default function PlatformAdminPage() {
  const t = useTranslations('PlatformAdmin');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [filter, setFilter] = useState<CustomerSituation | 'all'>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/platform/accounts');
    if (res.status === 403) return setForbidden(true);
    const data = await res.json();
    setRows(data.accounts ?? []);
    setSummary(data.summary ?? null);
  }, []);

  useEffect(() => {
    // Fetch on mount; state set after the request resolves.
    void load();
  }, [load]);

  async function act(row: Row, action: 'suspend' | 'reactivate' | 'extend_trial', days?: number) {
    if (action === 'suspend' && !confirm(t('suspendConfirm', { name: row.account_name }))) return;
    setBusy(row.account_id);
    try {
      const res = await fetch(`/api/platform/accounts/${row.account_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, days }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('actionFailed'));
      toast.success(t('actionDone'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (filter === 'all' || r.situation === filter) &&
        (!q || r.account_name.toLowerCase().includes(q) || (r.owner_email ?? '').toLowerCase().includes(q)),
    );
  }, [rows, filter, search]);

  if (forbidden) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Lock className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('forbidden')}</p>
      </div>
    );
  }
  if (!rows || !summary) {
    return <Loader2 className="mx-auto mt-16 size-6 animate-spin text-primary" />;
  }

  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');
  const kpis: { key: CustomerSituation | 'all'; label: string; value: string }[] = [
    { key: 'all', label: t('kpi.total'), value: String(summary.total) },
    { key: 'trial', label: t('kpi.trial'), value: String(summary.trial) },
    { key: 'active', label: t('kpi.active'), value: String(summary.active) },
    { key: 'limited', label: t('kpi.limited'), value: String(summary.limited) },
    { key: 'blocked', label: t('kpi.blocked'), value: String(summary.blocked) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Building2 className="size-5 text-primary" />
        <h1 className="text-2xl font-bold">{t('title')}</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {kpis.map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => setFilter(k.key)}
            className={`rounded-lg border p-3 text-left transition-colors ${filter === k.key ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}
          >
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="text-xl font-semibold">{k.value}</p>
          </button>
        ))}
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">{t('kpi.mrr')}</p>
          <p className="text-xl font-semibold">{formatBRL(summary.mrrCents)}</p>
        </div>
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('search')}
        className="max-w-sm"
      />

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">{t('col.account')}</th>
                <th className="p-3">{t('col.plan')}</th>
                <th className="p-3">{t('col.situation')}</th>
                <th className="p-3">{t('col.until')}</th>
                <th className="p-3">{t('col.seats')}</th>
                <th className="p-3">{t('col.numbers')}</th>
                <th className="p-3">{t('col.messages')}</th>
                <th className="p-3">{t('col.revenue')}</th>
                <th className="p-3">{t('col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.account_id} className="border-b border-border last:border-0 align-top">
                  <td className="p-3">
                    <p className="font-medium">{r.account_name}</p>
                    <p className="text-xs text-muted-foreground">{r.owner_email ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">{t('since', { date: date(r.created_at) })}</p>
                  </td>
                  <td className="p-3">
                    {r.plan_name ?? '—'}
                    {r.external_customer_id && (
                      <p className="font-mono text-[10px] text-muted-foreground">{r.external_customer_id}</p>
                    )}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline" className={SITUATION_STYLE[r.situation]}>
                      {t(`situation.${r.situation}`)}
                    </Badge>
                    {r.status === 'suspended' && (
                      <p className="mt-1 text-xs text-muted-foreground">{t('suspendedByPanel')}</p>
                    )}
                  </td>
                  <td className="p-3 text-xs">
                    {r.status === 'active' ? t('paidUntil', { date: date(r.current_period_end) }) : t('trialUntil', { date: date(r.trial_ends_at) })}
                  </td>
                  <td className="p-3">
                    {r.seats_used} / {r.seats_limit ?? '—'}
                  </td>
                  <td className="p-3">
                    {r.numbers}
                    {r.provider && (
                      <span className="ml-1 text-xs text-muted-foreground">({r.provider === 'evolution' ? 'QR' : 'Meta'})</span>
                    )}
                  </td>
                  <td className="p-3">
                    {r.messages_30d}
                    <p className="text-xs text-muted-foreground">{t('lastMessage', { date: date(r.last_message_at) })}</p>
                  </td>
                  <td className="p-3">{r.revenue_cents ? formatBRL(r.revenue_cents) : '—'}</td>
                  <td className="space-y-1 p-3">
                    {r.status === 'suspended' ? (
                      <Button type="button" size="sm" variant="outline" disabled={busy === r.account_id} onClick={() => act(r, 'reactivate')}>
                        {t('reactivate')}
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="outline" disabled={busy === r.account_id} onClick={() => act(r, 'suspend')}>
                        {t('suspend')}
                      </Button>
                    )}
                    {r.status !== 'active' && r.status !== 'suspended' && (
                      <div className="flex gap-1">
                        {[7, 30].map((d) => (
                          <Button
                            key={d}
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy === r.account_id}
                            onClick={() => act(r, 'extend_trial', d)}
                          >
                            {t('extend', { days: d })}
                          </Button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">{t('auditHint')}</p>
    </div>
  );
}
