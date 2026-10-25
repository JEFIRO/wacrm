import { describe, expect, it } from 'vitest';
import { phoneFromJid, translateInbound, translateStatus } from './translate';

const key = { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false, id: 'ABC123' };
const base = { key, pushName: 'Maria', messageTimestamp: 1761400000 };

function ok(data: Parameters<typeof translateInbound>[0]) {
  const r = translateInbound(data);
  if ('skip' in r) throw new Error(`skipped: ${r.skip}`);
  return r;
}

describe('Evolution inbound translation', () => {
  it('maps a text message and the sender', () => {
    const { message, contact } = ok({ ...base, message: { conversation: 'oi' } });
    expect(message).toMatchObject({
      id: 'ABC123',
      from: '5511988887777',
      timestamp: '1761400000',
      type: 'text',
      text: { body: 'oi' },
    });
    expect(contact).toEqual({ profile: { name: 'Maria' }, wa_id: '5511988887777' });
  });

  it('reads extended text and the quoted message id', () => {
    const { message } = ok({
      ...base,
      message: { extendedTextMessage: { text: 'respondendo' } },
      contextInfo: { stanzaId: 'QUOTED1' },
    });
    expect(message.text?.body).toBe('respondendo');
    expect(message.context).toEqual({ id: 'QUOTED1' });
  });

  it('maps media with the message id as media id', () => {
    expect(ok({ ...base, message: { imageMessage: { mimetype: 'image/jpeg', caption: 'foto' } } }).message)
      .toMatchObject({ type: 'image', image: { id: 'ABC123', mime_type: 'image/jpeg', caption: 'foto' } });
    expect(ok({ ...base, message: { documentMessage: { mimetype: 'application/pdf', fileName: 'nota.pdf' } } }).message)
      .toMatchObject({ type: 'document', document: { id: 'ABC123', filename: 'nota.pdf' } });
    expect(ok({ ...base, message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus' } } }).message)
      .toMatchObject({ type: 'audio', audio: { id: 'ABC123', mime_type: 'audio/ogg; codecs=opus' } });
  });

  it('maps reactions, locations and button/list replies', () => {
    expect(ok({ ...base, message: { reactionMessage: { key: { id: 'T1' }, text: '👍' } } }).message.reaction)
      .toEqual({ message_id: 'T1', emoji: '👍' });
    expect(ok({ ...base, message: { locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6 } } }).message.location)
      .toMatchObject({ latitude: -23.5, longitude: -46.6 });
    expect(ok({ ...base, message: { buttonsResponseMessage: { selectedButtonId: 'yes', selectedDisplayText: 'Sim' } } }).message.interactive)
      .toEqual({ type: 'button_reply', button_reply: { id: 'yes', title: 'Sim' } });
    expect(ok({ ...base, message: { listResponseMessage: { title: 'Plano', singleSelectReply: { selectedRowId: 'p1' } } } }).message.interactive)
      .toEqual({ type: 'list_reply', list_reply: { id: 'p1', title: 'Plano' } });
  });

  it('uses the phone JID when the chat is addressed by LID', () => {
    const { message } = ok({
      ...base,
      key: { ...key, remoteJid: '1234567890@lid', remoteJidAlt: '5511977776666@s.whatsapp.net' },
      message: { conversation: 'x' },
    });
    expect(message.from).toBe('5511977776666');
  });

  it('skips our own messages, groups, broadcasts and unknown senders', () => {
    const skipped = (k: Record<string, unknown>) =>
      'skip' in translateInbound({ ...base, key: { ...key, ...k }, message: { conversation: 'x' } });
    expect(skipped({ fromMe: true })).toBe(true);
    expect(skipped({ remoteJid: '1203630@g.us' })).toBe(true);
    expect(skipped({ remoteJid: 'status@broadcast' })).toBe(true);
    expect(skipped({ remoteJid: '999@newsletter' })).toBe(true);
    expect(skipped({ remoteJid: '1234567890@lid' })).toBe(true);
    expect(skipped({ id: undefined })).toBe(true);
  });

  it("skips an album's envelope and protocol traffic", () => {
    for (const messageType of ['albumMessage', 'protocolMessage']) {
      expect('skip' in translateInbound({ ...base, messageType, message: {} })).toBe(true);
    }
  });

  it('keeps unknown message types as unsupported', () => {
    expect(ok({ ...base, messageType: 'pollCreationMessage', message: {} }).message.type).toBe('pollCreationMessage');
  });

  it('reads the phone from a device JID', () => {
    expect(phoneFromJid('5511988887777:12@s.whatsapp.net')).toBe('5511988887777');
  });
});

describe('Evolution status translation', () => {
  it('maps the delivery ladder of our own messages', () => {
    expect(translateStatus({ keyId: 'M1', fromMe: true, status: 'SERVER_ACK' })).toEqual({ wamid: 'M1', status: 'sent' });
    expect(translateStatus({ keyId: 'M1', fromMe: true, status: 'DELIVERY_ACK' })?.status).toBe('delivered');
    expect(translateStatus({ keyId: 'M1', fromMe: true, status: 'READ' })?.status).toBe('read');
    expect(translateStatus({ keyId: 'M1', fromMe: true, status: 'PLAYED' })?.status).toBe('read');
  });

  it('ignores customer messages and unknown statuses', () => {
    expect(translateStatus({ keyId: 'M1', fromMe: false, status: 'READ' })).toBeNull();
    expect(translateStatus({ keyId: 'M1', fromMe: true, status: 'DELETED' })).toBeNull();
  });
});
