import { describe, expect, it } from 'vitest';
import { SESSION_WINDOW_MS, whatsappTransport, withinSessionWindow } from '../service/whatsapp.js';
import { transcriptBody, voiceTransport } from '../service/voice.js';

const whatsapp = whatsappTransport({
  accessTokenRef: 'wa-token',
  appSecretRef: 'wa-secret',
  phoneNumberId: '1234567890',
});
const voice = voiceTransport({ authTokenRef: 'twilio-token', webhookUrl: 'https://desk.example.com/hook' });

describe('the WhatsApp session window', () => {
  const now = new Date('2026-09-15T12:00:00Z');

  it('is open for 24 hours after the person last wrote', () => {
    expect(withinSessionWindow(new Date(now.getTime() - 1000), now)).toBe(true);
    expect(withinSessionWindow(new Date(now.getTime() - SESSION_WINDOW_MS + 1000), now)).toBe(true);
  });

  it('is closed once the window has passed', () => {
    // Not a quota to retry past: repeatedly attempting free-form sends outside
    // the window is how a business number's quality rating gets cut and the
    // channel is lost for every requester.
    expect(withinSessionWindow(new Date(now.getTime() - SESSION_WINDOW_MS - 1000), now)).toBe(false);
  });

  it('is closed when the person has never written', () => {
    expect(withinSessionWindow(null, now)).toBe(false);
  });
});

describe('the WhatsApp adapter', () => {
  const inbound = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    entry: [{ changes: [{ value: { messages: [message], contacts: [{ profile: { name: 'Alice' } }], ...extra } }] }],
  });

  it('reads a text message', () => {
    const parsed = whatsapp.parseInbound(
      inbound({ id: 'wamid.1', from: '447700900000', type: 'text', text: { body: 'my laptop died' } }),
      {},
    );
    expect(parsed?.fromAddress).toBe('447700900000');
    expect(parsed?.body).toBe('my laptop died');
    expect(parsed?.identity.displayName).toBe('Alice');
  });

  it('treats every message as addressed, because WhatsApp is one-to-one', () => {
    const parsed = whatsapp.parseInbound(inbound({ id: 'wamid.1', from: '447700900000', type: 'text', text: { body: 'hi' } }), {});
    expect(parsed?.chat.direct).toBe(true);
  });

  it('never claims a verified email for a phone number', () => {
    // Meta vouches for neither, so a WhatsApp identity is always linked by code.
    const parsed = whatsapp.parseInbound(inbound({ id: 'wamid.1', from: '447700900000', type: 'text', text: { body: 'hi' } }), {});
    expect(parsed?.identity.email).toBeNull();
    expect(parsed?.identity.emailVerified).toBe(false);
  });

  it('ignores delivery and read receipts, which arrive on the same webhook', () => {
    // They are not messages and must not become tickets.
    expect(whatsapp.parseInbound({ entry: [{ changes: [{ value: { statuses: [{ status: 'delivered' }] } }] }] }, {})).toBeNull();
  });

  it('drops a message type it cannot represent rather than raising an empty ticket', () => {
    expect(whatsapp.parseInbound(inbound({ id: 'wamid.2', from: '447700900000', type: 'image', image: { id: 'x' } }), {})).toBeNull();
  });

  it('returns nothing for a malformed payload', () => {
    expect(whatsapp.parseInbound({}, {})).toBeNull();
    expect(whatsapp.parseInbound({ entry: [] }, {})).toBeNull();
  });

  it('refuses to verify without a configured app secret', () => {
    expect(whatsapp.verify({ rawBody: '{}', headers: { 'x-hub-signature-256': 'sha256=x' }, url: 'https://x.test' }).ok).toBe(false);
  });
});

describe('transcriptBody', () => {
  it('names the transcript as a transcript rather than quoting it as speech', () => {
    // It is somebody else's speech recognition and it will sometimes be wrong.
    // An agent acting on a misheard account number has been misled by us.
    const body = transcriptBody({ transcript: 'my laptop will not start', recordingUrl: null, durationSeconds: null });
    expect(body).toMatch(/as the telephony provider heard it/);
    expect(body).toContain('my laptop will not start');
  });

  it('says so when there was no transcript', () => {
    expect(transcriptBody({ transcript: null, recordingUrl: null, durationSeconds: null })).toMatch(/not transcribed/);
  });

  it('carries the recording so somebody can listen to the real thing', () => {
    const body = transcriptBody({
      transcript: 'unclear',
      recordingUrl: 'https://api.twilio.test/r/1',
      durationSeconds: 92,
    });
    expect(body).toContain('https://api.twilio.test/r/1');
    expect(body).toContain('92s');
  });
});

describe('the voice adapter', () => {
  const completed = {
    CallSid: 'CA123',
    From: '+441234567890',
    CallStatus: 'completed',
    CallDuration: '92',
    TranscriptionText: 'my laptop will not start',
  };

  it('turns a completed call into a ticket body', () => {
    const parsed = voice.parseInbound(completed, {});
    expect(parsed?.externalMessageId).toBe('CA123');
    expect(parsed?.subject).toBe('Call from +441234567890');
    expect(parsed?.body).toContain('my laptop will not start');
  });

  it('ignores a call that is still in progress', () => {
    // One call is one ticket, not one per status change.
    expect(voice.parseInbound({ ...completed, CallStatus: 'ringing' }, {})).toBeNull();
    expect(voice.parseInbound({ ...completed, CallStatus: 'in-progress' }, {})).toBeNull();
  });

  it('never claims caller ID is verified, because it is spoofable', () => {
    const parsed = voice.parseInbound(completed, {});
    expect(parsed?.identity.emailVerified).toBe(false);
    expect(parsed?.identity.email).toBeNull();
  });

  it('returns nothing without a call id or a caller', () => {
    expect(voice.parseInbound({ CallStatus: 'completed' }, {})).toBeNull();
    expect(voice.parseInbound({}, {})).toBeNull();
  });

  it('signs against the configured URL, not the one the request claims', () => {
    // A host header is attacker-controlled; signing against it would let
    // somebody choose the string being verified.
    expect(
      voice.verify({ rawBody: 'CallSid=CA123', headers: { 'x-twilio-signature': 'nope' }, url: 'https://evil.test/hook' })
        .ok,
    ).toBe(false);
  });

  it('does not call anybody back', async () => {
    // An automated outbound call is a different product with different
    // regulations attached; a callback is a person's decision.
    expect(await voice.send({ roomId: '+441234567890', threadId: null, text: 'your ticket was updated' })).toEqual({
      messageId: null,
    });
  });
});
