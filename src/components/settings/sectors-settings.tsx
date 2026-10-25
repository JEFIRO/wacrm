'use client';

// ============================================================
// Sectors and lead distribution — docs/saas/setores-e-distribuicao.md.
// Account timezone, sectors and their members, and per agent: online
// switch, simultaneous-lead cap and weekly schedule. Writes that can open
// a slot go through /api/agents/* or nudge /api/distribution/run.
// Rules (migration 064): a sector always has a member, and a sector
// member always has a schedule — the UI mirrors them, the DB enforces.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Clock, Plus, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { requestDistribution } from '@/lib/distribution/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

interface Member {
  user_id: string;
  full_name: string | null;
  email: string | null;
  account_role: string;
}
interface Sector {
  id: string;
  name: string;
}
interface AgentSetting {
  user_id: string;
  is_online: boolean;
  max_active_leads: number;
}
interface Range {
  weekday: number;
  start: string;
  end: string;
}

const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Cuiaba',
  'America/Porto_Velho',
  'America/Rio_Branco',
  'America/Noronha',
  'Europe/Lisbon',
  'America/New_York',
  'UTC',
];

export function SectorsSettings() {
  const t = useTranslations('Settings.sectors');
  const supabase = createClient();
  const { accountId, user, canEditSettings } = useAuth();

  const [members, setMembers] = useState<Member[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [sectorMembers, setSectorMembers] = useState<{ sector_id: string; user_id: string }[]>([]);
  const [settings, setSettings] = useState<AgentSetting[]>([]);
  const [schedules, setSchedules] = useState<(Range & { user_id: string })[]>([]);
  const [startedOffline, setStartedOffline] = useState<Record<string, number>>({});
  const [failedNotices, setFailedNotices] = useState(0);
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [newSector, setNewSector] = useState('');
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Range[]>([]);

  const load = useCallback(async () => {
    if (!accountId) return;
    const [m, s, sm, st, sc, acc, started, failed] = await Promise.all([
      supabase
        .from('profiles')
        .select('user_id, full_name, email, account_role')
        .eq('account_id', accountId)
        .order('full_name', { ascending: true }),
      supabase.from('sectors').select('id, name').eq('account_id', accountId).order('name'),
      supabase.from('sector_members').select('sector_id, user_id').eq('account_id', accountId),
      supabase
        .from('agent_settings')
        .select('user_id, is_online, max_active_leads')
        .eq('account_id', accountId),
      supabase
        .from('agent_schedules')
        .select('user_id, weekday, start_time, end_time')
        .eq('account_id', accountId)
        .order('start_time'),
      supabase.from('accounts').select('timezone').eq('id', accountId).maybeSingle(),
      // Leads already started by someone — offline owners are flagged below.
      supabase
        .from('conversations')
        .select('assigned_agent_id')
        .eq('account_id', accountId)
        .not('assigned_agent_id', 'is', null)
        .not('started_at', 'is', null)
        .neq('status', 'closed'),
      // Queued leads whose "no agent available" notice never went out.
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .not('queue_notice_failed_at', 'is', null)
        .not('queued_at', 'is', null)
        .is('assigned_agent_id', null)
        .neq('status', 'closed'),
    ]);
    setMembers((m.data ?? []) as Member[]);
    setSectors((s.data ?? []) as Sector[]);
    setSectorMembers(sm.data ?? []);
    setSettings((st.data ?? []) as AgentSetting[]);
    setSchedules(
      (sc.data ?? []).map(
        (r: { user_id: string; weekday: number; start_time: string; end_time: string }) => ({
          user_id: r.user_id,
          weekday: r.weekday,
          start: r.start_time.slice(0, 5),
          end: r.end_time.slice(0, 5),
        }),
      ),
    );
    if (acc.data?.timezone) setTimezone(acc.data.timezone as string);
    const counts: Record<string, number> = {};
    for (const c of (started.data ?? []) as { assigned_agent_id: string }[]) {
      counts[c.assigned_agent_id] = (counts[c.assigned_agent_id] ?? 0) + 1;
    }
    setStartedOffline(counts);
    setFailedNotices(failed.count ?? 0);
  }, [accountId, supabase]);

  useEffect(() => {
    // Fetch on mount / account change; state is set after the queries
    // resolve. Same accepted pattern as contact-sidebar.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const hasSchedule = (userId: string) => schedules.some((r) => r.user_id === userId);
  const inAnySector = (userId: string) => sectorMembers.some((x) => x.user_id === userId);
  const memberCount = (sectorId: string) => sectorMembers.filter((x) => x.sector_id === sectorId).length;

  // The DB rules of migration 064 surface as stable messages.
  function saveError(error: { code?: string; message?: string }) {
    if (error.message === 'sector_needs_member') toast.error(t('needsMember'));
    else if (error.message === 'sector_member_needs_schedule') toast.error(t('needsSchedule'));
    else if (error.code === '23505') toast.error(t('sectorExists'));
    else toast.error(t('saveFailed'));
  }

  const settingFor = (userId: string): AgentSetting =>
    settings.find((s) => s.user_id === userId) ?? { user_id: userId, is_online: false, max_active_leads: 3 };

  async function patchAgent(body: Record<string, unknown>, okMessage: string) {
    const res = await fetch('/api/agents/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || t('saveFailed'));
      return;
    }
    toast.success(
      data.requeued ? t('wentOfflineRequeued', { count: data.requeued }) : okMessage,
    );
    await load();
  }

  async function saveTimezone(next: string) {
    setTimezone(next);
    const { error } = await supabase.from('accounts').update({ timezone: next }).eq('id', accountId);
    if (error) toast.error(t('saveFailed'));
    else {
      toast.success(t('timezoneSaved'));
      requestDistribution();
    }
  }

  async function addSector() {
    const name = newSector.trim();
    if (!name || newMembers.length === 0) return;
    const { error } = await supabase.rpc('create_sector', {
      p_account_id: accountId,
      p_name: name,
      p_member_ids: newMembers,
    });
    if (error) {
      saveError(error);
      return;
    }
    setNewSector('');
    setNewMembers([]);
    await load();
    requestDistribution();
  }

  async function renameSector(sector: Sector, name: string) {
    if (!name.trim() || name.trim() === sector.name) return;
    const { error } = await supabase.from('sectors').update({ name: name.trim() }).eq('id', sector.id);
    if (error) toast.error(error.code === '23505' ? t('sectorExists') : t('saveFailed'));
    await load();
  }

  async function deleteSector(sector: Sector) {
    if (!confirm(t('deleteConfirm', { name: sector.name }))) return;
    const { error } = await supabase.from('sectors').delete().eq('id', sector.id);
    if (error) toast.error(t('saveFailed'));
    await load();
  }

  async function toggleMember(sectorId: string, userId: string, on: boolean) {
    const { error } = on
      ? await supabase.from('sector_members').insert({ sector_id: sectorId, user_id: userId })
      : await supabase.from('sector_members').delete().eq('sector_id', sectorId).eq('user_id', userId);
    if (error) saveError(error);
    await load();
    requestDistribution();
  }

  async function saveSchedule(userId: string) {
    const res = await fetch('/api/agents/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, ranges: draft }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || t('saveFailed'));
      return;
    }
    toast.success(t('scheduleSaved'));
    setEditing(null);
    await load();
  }

  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, label: t(`weekdays.${d}`) }));
  const name = (m: Member) => m.full_name || m.email || m.user_id.slice(0, 8);

  // Agents see only their own switch; the rest is admin configuration.
  if (!canEditSettings) {
    const me = user ? settingFor(user.id) : null;
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('agentDescription')} />
        {me && (
          <Card>
            <CardContent className="flex items-center justify-between gap-4 pt-6">
              <div>
                <p className="text-sm font-medium">{t('myStatus')}</p>
                <p className="text-xs text-muted-foreground">{t('onlineHint')}</p>
              </div>
              <Switch
                checked={me.is_online}
                onCheckedChange={(v) =>
                  patchAgent({ is_online: v }, v ? t('nowOnline') : t('nowOffline'))
                }
              />
            </CardContent>
          </Card>
        )}
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200 space-y-6">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {failedNotices > 0 && (
        <p className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 p-3 text-sm text-amber-500">
          <AlertTriangle className="size-4 shrink-0" />
          {t('failedNotices', { count: failedNotices })}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('timezone')}</CardTitle>
          <CardDescription>{t('timezoneHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <select
            value={timezone}
            onChange={(e) => saveTimezone(e.target.value)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            aria-label={t('timezone')}
          >
            {(TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES]).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('sectors')}</CardTitle>
          <CardDescription>{t('sectorsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sectors.length === 0 && <p className="text-sm text-muted-foreground">{t('noSectors')}</p>}
          {sectors.map((s) => (
            <div key={s.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Input
                  defaultValue={s.name}
                  maxLength={60}
                  aria-label={t('sectorName')}
                  onBlur={(e) => renameSector(s, e.target.value)}
                  className="max-w-64"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('deleteSector')}
                  onClick={() => deleteSector(s)}
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {members.map((m) => {
                  const checked = sectorMembers.some((x) => x.sector_id === s.id && x.user_id === m.user_id);
                  // Can't add someone without a schedule, nor remove the last member.
                  const locked = checked ? memberCount(s.id) === 1 : !hasSchedule(m.user_id);
                  return (
                    <label
                      key={m.user_id}
                      className={`flex items-center gap-2 text-sm ${locked ? 'text-muted-foreground' : 'cursor-pointer'}`}
                      title={locked ? (checked ? t('needsMember') : t('needsSchedule')) : undefined}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={locked}
                        onCheckedChange={(v) => toggleMember(s.id, m.user_id, v === true)}
                      />
                      {name(m)}
                      {!hasSchedule(m.user_id) && <span className="text-xs">({t('withoutSchedule')})</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
            <div className="flex gap-2">
            <Input
              value={newSector}
              maxLength={60}
              placeholder={t('newSectorPlaceholder')}
              onChange={(e) => setNewSector(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addSector()}
              className="max-w-64"
            />
            <Button
              type="button"
              variant="outline"
              onClick={addSector}
              disabled={!newSector.trim() || newMembers.length === 0}
            >
              <Plus />
              {t('addSector')}
            </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('newSectorMembers')}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {members.map((m) => (
                <label
                  key={m.user_id}
                  className={`flex items-center gap-2 text-sm ${hasSchedule(m.user_id) ? 'cursor-pointer' : 'text-muted-foreground'}`}
                  title={hasSchedule(m.user_id) ? undefined : t('needsSchedule')}
                >
                  <Checkbox
                    checked={newMembers.includes(m.user_id)}
                    disabled={!hasSchedule(m.user_id)}
                    onCheckedChange={(v) =>
                      setNewMembers(
                        v === true
                          ? [...newMembers, m.user_id]
                          : newMembers.filter((id) => id !== m.user_id),
                      )
                    }
                  />
                  {name(m)}
                  {!hasSchedule(m.user_id) && <span className="text-xs">({t('withoutSchedule')})</span>}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('agents')}</CardTitle>
          <CardDescription>{t('agentsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {members.map((m) => {
            const st = settingFor(m.user_id);
            const ranges = schedules.filter((r) => r.user_id === m.user_id);
            const started = startedOffline[m.user_id] ?? 0;
            return (
              <div key={m.user_id} className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="min-w-40 flex-1">
                    <p className="text-sm font-medium">{name(m)}</p>
                    <p className="text-xs text-muted-foreground">
                      {ranges.length === 0
                        ? t('noSchedule')
                        : t('scheduleSummary', { count: ranges.length })}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={st.is_online}
                      onCheckedChange={(v) =>
                        patchAgent(
                          { user_id: m.user_id, is_online: v },
                          v ? t('nowOnline') : t('nowOffline'),
                        )
                      }
                    />
                    {st.is_online ? t('online') : t('offline')}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    {t('cap')}
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      defaultValue={st.max_active_leads}
                      key={`${m.user_id}-${st.max_active_leads}`}
                      className="w-16"
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== st.max_active_leads)
                          patchAgent({ user_id: m.user_id, max_active_leads: v }, t('capSaved'));
                      }}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(editing === m.user_id ? null : m.user_id);
                      setDraft(ranges.map(({ weekday, start, end }) => ({ weekday, start, end })));
                    }}
                  >
                    <Clock />
                    {t('schedule')}
                  </Button>
                </div>

                {!st.is_online && started > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-500">
                    <AlertTriangle className="size-3.5" />
                    {t('startedWhileOffline', { count: started })}
                  </p>
                )}

                {editing === m.user_id && (
                  <div className="space-y-2 border-t border-border pt-3">
                    <p className="text-xs text-muted-foreground">{t('scheduleHint', { tz: timezone })}</p>
                    {weekdays.map(({ d, label }) => (
                      <div key={d} className="flex flex-wrap items-center gap-2">
                        <span className="w-20 text-sm">{label}</span>
                        {draft
                          .map((r, i) => ({ r, i }))
                          .filter(({ r }) => r.weekday === d)
                          .map(({ r, i }) => (
                            <span key={i} className="flex items-center gap-1">
                              <Input
                                type="time"
                                value={r.start}
                                className="w-28"
                                aria-label={t('start')}
                                onChange={(e) =>
                                  setDraft(draft.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))
                                }
                              />
                              –
                              <Input
                                type="time"
                                value={r.end}
                                className="w-28"
                                aria-label={t('end')}
                                onChange={(e) =>
                                  setDraft(draft.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))
                                }
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t('removeRange')}
                                onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                              >
                                <X />
                              </Button>
                            </span>
                          ))}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setDraft([...draft, { weekday: d, start: '09:00', end: '18:00' }])}
                        >
                          <Plus />
                          {t('addRange')}
                        </Button>
                      </div>
                    ))}
                    {draft.length === 0 && inAnySector(m.user_id) && (
                      <p className="text-xs text-amber-500">{t('scheduleRequired')}</p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        disabled={draft.length === 0 && inAnySector(m.user_id)}
                        onClick={() => saveSchedule(m.user_id)}
                      >
                        {t('saveSchedule')}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        {t('cancel')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <Label className="text-xs font-normal text-muted-foreground">{t('distributionRule')}</Label>
        </CardContent>
      </Card>
    </section>
  );
}
