import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInstance,
  deleteInstance,
  evolutionServerConfig,
  instanceOwner,
  instanceState,
  INSTANCE_EVENTS,
} from './admin';

const CFG = {
  baseUrl: 'http://evo.test',
  globalKey: 'global',
  webhookUrl: 'http://app.test/api/whatsapp/evolution/webhook',
  webhookSecret: 's3cret',
};

function mockFetch(...bodies: [unknown, number?][]) {
  const fn = vi.fn();
  for (const [body, status = 200] of bodies) {
    fn.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Evolution server config', () => {
  it('needs the server, the global key, the secret and an app URL', () => {
    vi.stubEnv('EVOLUTION_API_URL', 'http://evo.test/');
    vi.stubEnv('EVOLUTION_GLOBAL_API_KEY', 'global');
    vi.stubEnv('EVOLUTION_WEBHOOK_SECRET', 's3cret');
    vi.stubEnv('EVOLUTION_WEBHOOK_BASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com/');
    expect(evolutionServerConfig()).toEqual({
      baseUrl: 'http://evo.test',
      globalKey: 'global',
      webhookUrl: 'https://crm.example.com/api/whatsapp/evolution/webhook',
      webhookSecret: 's3cret',
    });
    vi.stubEnv('EVOLUTION_WEBHOOK_BASE_URL', 'http://172.21.0.1:3000');
    expect(evolutionServerConfig()?.webhookUrl).toBe('http://172.21.0.1:3000/api/whatsapp/evolution/webhook');
    vi.stubEnv('EVOLUTION_GLOBAL_API_KEY', '');
    expect(evolutionServerConfig()).toBeNull();
  });
});

describe('instance lifecycle', () => {
  it('creates a Baileys instance with the webhook and secret wired', async () => {
    const fn = mockFetch([{ instance: { instanceName: 'wacrm-x' }, hash: 'inst-key', qrcode: { base64: 'data:image/png;base64,AA' } }]);
    const created = await createInstance(CFG, 'wacrm-x');
    expect(created).toEqual({ apiKey: 'inst-key', qr: 'data:image/png;base64,AA' });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('http://evo.test/instance/create');
    expect(init.headers.apikey).toBe('global');
    expect(JSON.parse(init.body)).toEqual({
      instanceName: 'wacrm-x',
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      groupsIgnore: true,
      webhook: {
        url: CFG.webhookUrl,
        byEvents: false,
        base64: false,
        headers: { 'x-wacrm-webhook-secret': 's3cret' },
        events: INSTANCE_EVENTS,
      },
    });
  });

  it('fails when Evolution returns no instance key', async () => {
    mockFetch([{ instance: {} }]);
    await expect(createInstance(CFG, 'wacrm-x')).rejects.toThrow(/without a key/);
  });

  it('reads state with the instance key and the owner with the global one', async () => {
    let fn = mockFetch([{ instance: { state: 'open' } }]);
    expect(await instanceState(CFG, 'wacrm-x', 'inst-key')).toBe('open');
    expect(fn.mock.calls[0][1].headers.apikey).toBe('inst-key');

    fn = mockFetch([[{ ownerJid: '5511988887777@s.whatsapp.net', profileName: 'Loja' }]]);
    expect(await instanceOwner(CFG, 'wacrm-x')).toEqual({ number: '5511988887777', profileName: 'Loja' });
    expect(fn.mock.calls[0][0]).toBe('http://evo.test/instance/fetchInstances?instanceName=wacrm-x');
  });

  it('deletes even when the logout fails (phone never paired)', async () => {
    const fn = mockFetch([{ status: 400, error: 'not connected' }, 400], [{ status: 'SUCCESS' }]);
    await deleteInstance(CFG, 'wacrm-x');
    expect(fn.mock.calls.map((c) => [c[1].method, c[0]])).toEqual([
      ['DELETE', 'http://evo.test/instance/logout/wacrm-x'],
      ['DELETE', 'http://evo.test/instance/delete/wacrm-x'],
    ]);
  });
});
