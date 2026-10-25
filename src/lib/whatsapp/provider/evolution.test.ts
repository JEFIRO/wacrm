import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvolutionProvider, EvolutionUnsupportedError } from './evolution';

const CREDS = { baseUrl: 'https://evo.test/', instance: 'wacrm-1', apiKey: 'inst-key' };

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const sent = (fn: ReturnType<typeof vi.fn>) => ({
  url: fn.mock.calls[0][0] as string,
  init: fn.mock.calls[0][1] as RequestInit,
  body: JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string),
});

afterEach(() => vi.unstubAllGlobals());

describe('Evolution provider', () => {
  it('sends text with the instance key and returns the message id', async () => {
    const fn = mockFetch({ key: { id: 'EVO1' } });
    const r = await createEvolutionProvider(CREDS).sendText({ to: '5511988887777', text: 'oi', contextMessageId: 'Q1' });
    const { url, init, body } = sent(fn);
    expect(r).toEqual({ messageId: 'EVO1' });
    expect(url).toBe('https://evo.test/message/sendText/wacrm-1');
    expect((init.headers as Record<string, string>).apikey).toBe('inst-key');
    expect(body).toEqual({ number: '5511988887777', text: 'oi', quoted: { key: { id: 'Q1' } } });
  });

  it('sends documents as media and audio as a voice note', async () => {
    let fn = mockFetch({ key: { id: 'E2' } });
    await createEvolutionProvider(CREDS).sendMedia({
      to: '55119', kind: 'document', link: 'https://x/n.pdf', caption: 'nota', filename: 'n.pdf',
    });
    expect(sent(fn).url).toContain('/message/sendMedia/');
    expect(sent(fn).body).toEqual({ number: '55119', mediatype: 'document', media: 'https://x/n.pdf', caption: 'nota', fileName: 'n.pdf' });

    fn = mockFetch({ key: { id: 'E3' } });
    await createEvolutionProvider(CREDS).sendMedia({ to: '55119', kind: 'audio', link: 'https://x/a.ogg' });
    expect(sent(fn).url).toContain('/message/sendWhatsAppAudio/');
    expect(sent(fn).body).toEqual({ number: '55119', audio: 'https://x/a.ogg' });
  });

  it('addresses a reaction by chat, author and id', async () => {
    const fn = mockFetch({ key: { id: 'E4' } });
    await createEvolutionProvider(CREDS).sendReaction({ to: '55119', targetMessageId: 'T1', emoji: '👍', targetFromMe: true });
    expect(sent(fn).body).toEqual({ key: { remoteJid: '55119@s.whatsapp.net', fromMe: true, id: 'T1' }, reaction: '👍' });
  });

  it("surfaces Evolution's error message", async () => {
    mockFetch({ status: 400, error: 'Bad Request', response: { message: ['number not on WhatsApp'] } }, 400);
    await expect(createEvolutionProvider(CREDS).sendText({ to: '1', text: 'x' })).rejects.toThrow(
      /Evolution API error: 400 .*number not on WhatsApp/,
    );
  });

  it('refuses templates (Meta-only)', async () => {
    await expect(createEvolutionProvider(CREDS).sendTemplate({ to: '1', templateName: 't' })).rejects.toBeInstanceOf(
      EvolutionUnsupportedError,
    );
  });

  it('sends buttons and lists as a numbered text menu', async () => {
    let fn = mockFetch({ key: { id: 'E5' } });
    await createEvolutionProvider(CREDS).sendButtons({
      to: '55119',
      bodyText: 'Quer?',
      buttons: [{ id: 'sim', title: 'Sim' }, { id: 'nao', title: 'Não' }],
    });
    expect(sent(fn).url).toContain('/message/sendText/');
    expect(sent(fn).body.text).toMatch(/^Quer\?\n\n1\. Sim\n2\. Não\n\n/);

    fn = mockFetch({ key: { id: 'E6' } });
    await createEvolutionProvider(CREDS).sendList({
      to: '55119',
      bodyText: 'Plano?',
      buttonLabel: 'Ver',
      sections: [{ title: 'A', rows: [{ id: 'p1', title: 'Essencial' }] }, { rows: [{ id: 'p2', title: 'Pro' }] }],
    });
    expect(sent(fn).body.text).toContain('1. Essencial\n2. Pro');
  });

  it('fetches inbound media as base64 and decodes it', async () => {
    const fn = mockFetch({ base64: Buffer.from('hello').toString('base64'), mimetype: 'image/png' });
    const p = createEvolutionProvider(CREDS);
    const info = await p.getMedia('MSG1');
    expect(sent(fn).body).toEqual({ message: { key: { id: 'MSG1' } }, convertToMp4: false });
    expect(info.mimeType).toBe('image/png');
    const file = await p.downloadMedia(info.url);
    expect(file.buffer.toString()).toBe('hello');
    expect(file.contentType).toBe('image/png');
  });

  it('reports health from the connection state', async () => {
    mockFetch({ instance: { instanceName: 'wacrm-1', state: 'open' } });
    await expect(createEvolutionProvider(CREDS).health()).resolves.toEqual({ id: 'wacrm-1' });
    mockFetch({ instance: { instanceName: 'wacrm-1', state: 'close' } });
    await expect(createEvolutionProvider(CREDS).health()).rejects.toThrow(/close/);
  });
});
