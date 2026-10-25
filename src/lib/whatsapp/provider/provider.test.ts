import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({
  meta: {
    sendTextMessage: vi.fn(),
    sendMediaMessage: vi.fn(),
    sendTemplateMessage: vi.fn(),
    sendInteractiveButtons: vi.fn(),
    sendInteractiveList: vi.fn(),
    sendReactionMessage: vi.fn(),
    sendTypingIndicator: vi.fn(),
    getMediaUrl: vi.fn(),
    downloadMedia: vi.fn(),
    getPhoneNumberHealth: vi.fn(),
  },
  loadChannel: vi.fn(),
}));

vi.mock('../meta-api', () => h.meta);
vi.mock('../encryption', () => ({ decrypt: (v: string) => `plain:${v}` }));
vi.mock('../channels', () => ({ loadChannel: h.loadChannel }));

import { createMetaProvider } from './meta';
import { loadChannelProvider, providerForChannel, PROVIDER_COLUMNS } from './index';

const CREDS = { phoneNumberId: 'pn-1', accessToken: 'tok' };
const db = {} as SupabaseClient;

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(h.meta)) fn.mockResolvedValue({ messageId: 'wamid.1' });
});

describe('Meta provider', () => {
  it('adds the bound credentials to every send', async () => {
    const p = createMetaProvider(CREDS);
    await p.sendText({ to: '5511999990000', text: 'oi', contextMessageId: 'wamid.0' });
    await p.sendMedia({ to: '5511999990000', kind: 'image', link: 'https://x/a.png' });
    await p.sendTemplate({ to: '5511999990000', templateName: 'hello' });
    await p.sendButtons({ to: '5511999990000', bodyText: 'b', buttons: [{ id: '1', title: 'Sim' }] });
    await p.sendList({ to: '5511999990000', bodyText: 'b', buttonLabel: 'Ver', sections: [] });
    await p.sendReaction({ to: '5511999990000', targetMessageId: 'wamid.0', emoji: '👍' });
    await p.sendTyping({ messageId: 'wamid.in' });
    await p.health();

    expect(h.meta.sendTextMessage).toHaveBeenCalledWith({
      ...CREDS,
      to: '5511999990000',
      text: 'oi',
      contextMessageId: 'wamid.0',
    });
    for (const fn of [
      h.meta.sendMediaMessage,
      h.meta.sendTemplateMessage,
      h.meta.sendInteractiveButtons,
      h.meta.sendInteractiveList,
      h.meta.sendReactionMessage,
      h.meta.sendTypingIndicator,
      h.meta.getPhoneNumberHealth,
    ]) {
      expect(fn).toHaveBeenCalledWith(expect.objectContaining(CREDS));
    }
  });

  it('downloads media with the token only', async () => {
    const p = createMetaProvider(CREDS);
    await p.getMedia('media-1');
    await p.downloadMedia('https://cdn/x');
    expect(h.meta.getMediaUrl).toHaveBeenCalledWith({ mediaId: 'media-1', accessToken: 'tok' });
    expect(h.meta.downloadMedia).toHaveBeenCalledWith({ downloadUrl: 'https://cdn/x', accessToken: 'tok' });
  });
});

describe('provider of a channel', () => {
  const row = { id: 'ch-1', phone_number_id: 'pn-1', access_token: 'enc' };

  it('decrypts the token and uses Meta for meta rows and rows without provider', async () => {
    for (const channel of [{ ...row, provider: 'meta' }, row, { ...row, provider: null }]) {
      const p = providerForChannel(channel);
      expect(p.kind).toBe('meta');
      await p.sendText({ to: '1', text: 't' });
      expect(h.meta.sendTextMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ phoneNumberId: 'pn-1', accessToken: 'plain:enc' }),
      );
    }
  });

  it('builds an Evolution provider from the instance name and its key', () => {
    vi.stubEnv('EVOLUTION_API_URL', 'https://evo.test');
    expect(providerForChannel({ ...row, provider: 'evolution' }).kind).toBe('evolution');
    vi.stubEnv('EVOLUTION_API_URL', '');
    expect(() => providerForChannel({ ...row, provider: 'evolution' })).toThrow(/EVOLUTION_API_URL/);
    vi.unstubAllEnvs();
  });

  it('refuses an unknown provider', () => {
    expect(() => providerForChannel({ ...row, provider: 'other' })).toThrow(/other/);
  });

  it('loads the channel asked for with the provider columns', async () => {
    h.loadChannel.mockResolvedValue({ ...row, provider: 'meta' });
    const loaded = await loadChannelProvider(db, 'acc-1', 'ch-1');
    expect(h.loadChannel).toHaveBeenCalledWith(db, 'acc-1', 'ch-1', PROVIDER_COLUMNS);
    expect(loaded?.channel.id).toBe('ch-1');
    expect(loaded?.provider.kind).toBe('meta');
  });

  it('returns null when the account has no such number', async () => {
    h.loadChannel.mockResolvedValue(null);
    expect(await loadChannelProvider(db, 'acc-1')).toBeNull();
  });
});
