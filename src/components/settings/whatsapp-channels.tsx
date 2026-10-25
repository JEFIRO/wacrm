'use client';

// ============================================================
// WhatsApp numbers ("channels") of the account — migration 060,
// docs/saas/c1-canais.md. A switcher above the existing connection form:
// pick a number to edit, add another one, name its sector, choose the
// default. The form itself (WhatsAppConfig) is unchanged apart from
// receiving the selected channel. QR-code numbers (provider 'evolution',
// docs/saas/w3-instancia.md) get EvolutionConnect instead of that form.
// An account uses ONE kind (migration 067): the Meta/QR choice only
// appears while it has no number.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, QrCode, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WhatsAppConfig } from './whatsapp-config';
import { EvolutionConnect } from './evolution-connect';
import { SettingsPanelHead } from './settings-panel-head';

interface ChannelRow {
  id: string;
  label: string | null;
  phone_number_id: string;
  is_default: boolean;
  status: string;
  default_sector_id: string | null;
  provider: string;
}

/** `'new'` = the blank form that adds a number; null = no number yet. */
type Selection = string | 'new' | null;

export function WhatsAppChannels() {
  const t = useTranslations('Settings.whatsapp.channels');
  const tw = useTranslations('Settings.whatsapp');
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [selected, setSelected] = useState<Selection>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // Sectors (061): new conversations of a number start in its default.
  const [sectors, setSectors] = useState<{ id: string; name: string }[]>([]);
  // How a new number connects: Meta credentials or a QR code (Evolution).
  const [newKind, setNewKind] = useState<'meta' | 'evolution'>('meta');
  const [qrAvailable, setQrAvailable] = useState(false);

  useEffect(() => {
    if (!canEditSettings) return;
    fetch('/api/whatsapp/evolution/instances')
      .then((res) => (res.ok ? res.json() : { available: false }))
      .then((data) => setQrAvailable(data.available === true))
      .catch(() => setQrAvailable(false));
  }, [canEditSettings]);

  const loadChannels = useCallback(
    async (prefer?: string | null) => {
      if (!accountId) return;
      const { data, error } = await supabase
        .from('whatsapp_config')
        .select('id, label, phone_number_id, is_default, status, default_sector_id, provider')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true });
      if (error) {
        console.error('Failed to load WhatsApp numbers:', error.message);
        return;
      }
      const rows = (data ?? []) as ChannelRow[];
      setChannels(rows);
      setSelected((current) => {
        // A reload that finishes after the user opened "add number" must
        // not pull them out of it.
        if (!prefer && current === 'new') return 'new';
        const keep = prefer ?? current;
        if (keep && rows.some((r) => r.id === keep)) return keep;
        return rows.find((r) => r.is_default)?.id ?? rows[0]?.id ?? null;
      });
    },
    [accountId, supabase],
  );

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  const current = channels.find((c) => c.id === selected) ?? null;
  // The account's kind once it has a number; null = still free to choose.
  const accountKind = (channels[0]?.provider as 'meta' | 'evolution' | undefined) ?? null;
  // Adding a number: an explicit "new", or the very first one.
  const adding = selected === 'new' || channels.length === 0;
  const addKind = accountKind ?? (qrAvailable ? newKind : 'meta');

  useEffect(() => {
    if (!accountId) return;
    (async () => {
      const { data } = await supabase
        .from('sectors')
        .select('id, name')
        .eq('account_id', accountId)
        .order('name', { ascending: true });
      setSectors(data ?? []);
    })();
  }, [accountId, supabase]);

  async function setDefaultSector(sectorId: string) {
    if (!current) return;
    const { error } = await supabase
      .from('whatsapp_config')
      .update({ default_sector_id: sectorId || null })
      .eq('id', current.id);
    if (error) {
      console.error('Default sector update failed:', error.message);
      toast.error(t('actionFailed'));
      return;
    }
    toast.success(t('defaultSectorSaved'));
    await loadChannels();
  }

  useEffect(() => {
    setLabelDraft(current?.label ?? '');
  }, [current?.id, current?.label]);

  async function patchChannel(body: Record<string, unknown>, okMessage: string) {
    if (!current) return;
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: current.id, ...body }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(okMessage);
      await loadChannels();
    } catch (err) {
      console.error('Channel update failed:', err);
      toast.error(t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  const sectorName = (id: string | null) => sectors.find((x) => x.id === id)?.name ?? null;
  const channelName = (c: ChannelRow) => c.label || sectorName(c.default_sector_id) || t('unnamed');

  // The company's main number (where every customer writes) and the
  // optional per-sector numbers — the main one is the account default.
  const mainChannel = channels.find((c) => c.is_default) ?? channels[0] ?? null;
  const sectorChannels = channels.filter((c) => c.id !== mainChannel?.id);
  const addingMain = channels.length === 0;
  const addingSector = selected === 'new' && !addingMain;
  // Sector a new sector number will serve (its default sector).
  const [newSectorId, setNewSectorId] = useState('');
  const canAddSector = !addingSector || newSectorId !== '';

  // A new number reports its id back: give it its sector, then reload.
  async function afterSaved(savedId?: string | null) {
    if (savedId && newSectorId && addingSector) {
      const { error } = await supabase
        .from('whatsapp_config')
        .update({ default_sector_id: newSectorId })
        .eq('id', savedId);
      if (error) console.error('Sector of the new number not saved:', error.message);
      setNewSectorId('');
    }
    await loadChannels(savedId ?? null);
  }

  const chip = (c: ChannelRow) => (
    <Button
      key={c.id}
      type="button"
      size="sm"
      variant={selected === c.id ? 'default' : 'outline'}
      onClick={() => setSelected(c.id)}
      aria-pressed={selected === c.id}
    >
      {channelName(c)}
      {c.provider === 'evolution' ? (
        <QrCode className="opacity-70" aria-label={t('qrNumber')} />
      ) : (
        <span className="text-xs opacity-70">…{c.phone_number_id.slice(-4)}</span>
      )}
      <span
        className={`size-1.5 rounded-full ${c.status === 'connected' ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`}
        aria-label={c.status === 'connected' ? t('connected') : t('disconnected')}
      />
    </Button>
  );

  // Single number and no admin rights: nothing to switch or manage.
  const showBar =
    channels.length > 1 || (canEditSettings && (channels.length > 0 || qrAvailable));

  const bar = showBar ? (
    <div className="mb-6 space-y-4 rounded-lg border border-border p-4">
      {/* Main number */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Star className="size-4 fill-current text-primary" />
          <span className="text-sm font-medium">{t('mainTitle')}</span>
        </div>
        {mainChannel ? (
          <div className="flex flex-wrap items-center gap-2">{chip(mainChannel)}</div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('mainEmpty')}</p>
        )}
        <p className="text-xs text-muted-foreground">{t('mainHint')}</p>
      </div>

      {/* Sector numbers (optional) */}
      {mainChannel && (
        <div className="space-y-2 border-t border-border pt-4">
          <span className="text-sm font-medium">{t('sectorNumbersTitle')}</span>
          <div className="flex flex-wrap items-center gap-2">
            {sectorChannels.map(chip)}
            {canEditSettings && (
              <Button
                type="button"
                size="sm"
                variant={selected === 'new' ? 'default' : 'ghost'}
                onClick={() => {
                  setSelected('new');
                  setLabelDraft('');
                  setNewSectorId('');
                }}
              >
                <Plus />
                {t('addSectorNumber')}
              </Button>
            )}
          </div>
          {sectorChannels.length === 0 && selected !== 'new' && (
            <p className="text-xs text-muted-foreground">{t('sectorNumbersEmpty')}</p>
          )}
        </div>
      )}

      {/* Editing / adding */}
      {canEditSettings && (adding || current) && (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm font-medium">
            {addingMain
              ? t('addingMain')
              : addingSector
                ? t('addingSector')
                : current?.id === mainChannel?.id
                  ? t('editingMain')
                  : t('editingSector')}
          </p>

          {adding && accountKind && selected === 'new' && (
            <p className="text-sm text-muted-foreground">
              {accountKind === 'meta' ? t('kindSameMeta') : t('kindSameQr')}
            </p>
          )}

          {adding && !accountKind && qrAvailable && (
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t('connectHow')}>
              <span className="text-sm">{t('connectHow')}</span>
              <Button
                type="button"
                size="sm"
                variant={newKind === 'evolution' ? 'default' : 'outline'}
                aria-pressed={newKind === 'evolution'}
                onClick={() => setNewKind('evolution')}
              >
                <QrCode />
                {t('kindQr')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={newKind === 'meta' ? 'default' : 'outline'}
                aria-pressed={newKind === 'meta'}
                onClick={() => setNewKind('meta')}
              >
                {t('kindMeta')}
              </Button>
              <span className="w-full text-xs text-muted-foreground">{t('kindOnce')}</span>
            </div>
          )}

          {/* Which sector a sector number serves — chosen before connecting. */}
          {(addingSector || (current && current.id !== mainChannel?.id)) && (
            <div className="space-y-1">
              <Label htmlFor="channel-sector">{t('sectorOfNumber')}</Label>
              <select
                id="channel-sector"
                value={addingSector ? newSectorId : (current?.default_sector_id ?? '')}
                onChange={(e) => {
                  if (addingSector) {
                    setNewSectorId(e.target.value);
                    setLabelDraft(sectorName(e.target.value) ?? '');
                  } else {
                    void setDefaultSector(e.target.value);
                  }
                }}
                className="block h-8 rounded-md border border-input bg-transparent px-2 text-sm"
              >
                <option value="">{addingSector ? t('chooseSector') : t('noSector')}</option>
                {sectors.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              {sectors.length === 0 && <p className="text-xs text-amber-500">{t('noSectorsYet')}</p>}
              <p className="text-xs text-muted-foreground">{t('sectorOfNumberHint')}</p>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1 space-y-1">
              <Label htmlFor="channel-label">{t('numberName')}</Label>
              <Input
                id="channel-label"
                value={labelDraft}
                maxLength={60}
                placeholder={addingMain || current?.id === mainChannel?.id ? t('mainNamePlaceholder') : t('labelPlaceholder')}
                onChange={(e) => setLabelDraft(e.target.value)}
              />
            </div>
            {current && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || labelDraft.trim() === (current.label ?? '')}
                  onClick={() => patchChannel({ label: labelDraft }, t('labelSaved'))}
                >
                  {t('saveLabel')}
                </Button>
                {current.id !== mainChannel?.id && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => patchChannel({ is_default: true }, t('defaultChanged'))}
                  >
                    <Star />
                    {t('makeMain')}
                  </Button>
                )}
              </>
            )}
          </div>

          {(addingMain || current?.id === mainChannel?.id) && (
            <p className="text-xs text-muted-foreground">{t('mainRouting')}</p>
          )}
          {addingSector && !newSectorId && (
            <p className="text-xs text-amber-500">{t('chooseSectorFirst')}</p>
          )}
        </div>
      )}
    </div>
  ) : null;

  // A sector number is connected only after its sector is chosen.
  if (!canAddSector) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={tw('title')} description={t('sectorNumbersIntro')} />
        {bar}
      </section>
    );
  }

  const useQr = adding ? addKind === 'evolution' : current?.provider === 'evolution';
  if (useQr) {
    return (
      <EvolutionConnect
        key={adding ? 'new' : selected}
        channelId={adding ? null : selected}
        newLabel={labelDraft}
        onChanged={(savedId) => void afterSaved(savedId)}
        channelBar={bar}
      />
    );
  }

  return (
    <WhatsAppConfig
      key={selected ?? 'default'}
      channelId={selected === 'new' ? null : selected}
      isNew={adding}
      newLabel={labelDraft}
      onChanged={(savedId) => void afterSaved(savedId)}
      channelBar={bar}
    />
  );
}
