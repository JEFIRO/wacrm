'use client';

// ============================================================
// WhatsApp numbers ("channels") of the account — migration 060,
// docs/saas/c1-canais.md. A switcher above the existing connection form:
// pick a number to edit, add another one, name its sector, choose the
// default. The form itself (WhatsAppConfig) is unchanged apart from
// receiving the selected channel.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WhatsAppConfig } from './whatsapp-config';

interface ChannelRow {
  id: string;
  label: string | null;
  phone_number_id: string;
  is_default: boolean;
  status: string;
}

/** `'new'` = the blank form that adds a number; null = no number yet. */
type Selection = string | 'new' | null;

export function WhatsAppChannels() {
  const t = useTranslations('Settings.whatsapp.channels');
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [selected, setSelected] = useState<Selection>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const loadChannels = useCallback(
    async (prefer?: string | null) => {
      if (!accountId) return;
      const { data, error } = await supabase
        .from('whatsapp_config')
        .select('id, label, phone_number_id, is_default, status')
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

  const channelName = (c: ChannelRow) => c.label || t('unnamed');

  // Single number and no admin rights: nothing to switch or manage.
  const showBar = channels.length > 1 || (canEditSettings && channels.length > 0);

  const bar = showBar ? (
    <div className="mb-6 space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-medium">{t('title')}</span>
        {channels.map((c) => (
          <Button
            key={c.id}
            type="button"
            size="sm"
            variant={selected === c.id ? 'default' : 'outline'}
            onClick={() => setSelected(c.id)}
            aria-pressed={selected === c.id}
          >
            {c.is_default && <Star className="fill-current" aria-label={t('isDefault')} />}
            {channelName(c)}
            <span className="text-xs opacity-70">…{c.phone_number_id.slice(-4)}</span>
          </Button>
        ))}
        {canEditSettings && (
          <Button
            type="button"
            size="sm"
            variant={selected === 'new' ? 'default' : 'ghost'}
            onClick={() => {
              setSelected('new');
              setLabelDraft('');
            }}
          >
            <Plus />
            {t('addNumber')}
          </Button>
        )}
      </div>

      {canEditSettings && (selected === 'new' || current) && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="channel-label">{t('labelLabel')}</Label>
            <Input
              id="channel-label"
              value={labelDraft}
              maxLength={60}
              placeholder={t('labelPlaceholder')}
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
              {!current.is_default && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => patchChannel({ is_default: true }, t('defaultChanged'))}
                >
                  <Star />
                  {t('makeDefault')}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {selected === 'new' ? t('newHint') : t('defaultHint')}
      </p>
    </div>
  ) : null;

  return (
    <WhatsAppConfig
      key={selected ?? 'default'}
      channelId={selected === 'new' ? null : selected}
      isNew={selected === 'new'}
      newLabel={labelDraft}
      onChanged={(savedId) => loadChannels(savedId ?? null)}
      channelBar={bar}
    />
  );
}
