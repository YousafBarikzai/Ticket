import { describe, expect, it } from 'vitest';
import { canAutoLink, permits } from '../domain/identity-policy.js';
import { guardChat, type ChatEvent } from '../domain/chat-guard.js';
import { findTicketRef, parseAction, parseMessage, parseSlash, stripMention, titleFrom } from '../domain/chat-commands.js';

const linked = (method: string | null) => ({ userId: 'user-1', verified: true, method });

describe('what a verification method permits', () => {
  it('lets the provider’s word raise a ticket in your own name', () => {
    // The worst case is a ticket you did not raise, addressed to you, which you
    // can see and close.
    expect(permits(linked('provider_verified'), { kind: 'createTicket', subject: 'a', body: 'b' }).allowed).toBe(true);
  });

  it('does not let it comment, disclose or approve', () => {
    // Each of these is different in kind: words in your mouth on a record other
    // people read, a disclosure, and a commitment of money.
    for (const command of [
      { kind: 'addComment', ticketRef: 'REQ-000123', body: 'x' },
      { kind: 'getStatus', ticketRef: 'REQ-000123' },
      { kind: 'decideApproval', approvalId: '00000000-0000-4000-8000-000000000001', decision: 'approved' },
    ] as const) {
      const verdict = permits(linked('provider_verified'), command);
      expect(verdict.allowed).toBe(false);
      expect(verdict.offerLinking).toBe(true);
      // The reply is the only thing the person sees, so it has to say what to do.
      expect(verdict.message).toMatch(/[Ll]ink this/);
    }
  });

  it('lets a code-verified identity do everything in the set', () => {
    for (const command of [
      { kind: 'createTicket', subject: 'a', body: 'b' },
      { kind: 'addComment', ticketRef: 'REQ-000123', body: 'x' },
      { kind: 'getStatus', ticketRef: 'REQ-000123' },
      { kind: 'decideApproval', approvalId: '00000000-0000-4000-8000-000000000001', decision: 'approved' },
    ] as const) {
      expect(permits(linked('one_time_code'), command).allowed).toBe(true);
    }
  });

  it('always lets anybody ask to be linked', () => {
    expect(permits(null, { kind: 'linkIdentity' }).allowed).toBe(true);
  });

  it('treats an unrecognised method as no method rather than as trusted', () => {
    // A row written by a later version, or by hand, must not be trusted more
    // than the strongest thing this version understands.
    expect(permits(linked('sso_probably_fine'), { kind: 'createTicket', subject: 'a', body: 'b' }).allowed).toBe(false);
  });

  it('refuses an identity that exists but is not verified', () => {
    expect(permits({ userId: 'user-1', verified: false, method: 'one_time_code' }, { kind: 'getStatus', ticketRef: 'REQ-1' }).allowed).toBe(false);
    expect(permits({ userId: null, verified: true, method: 'one_time_code' }, { kind: 'getStatus', ticketRef: 'REQ-1' }).allowed).toBe(false);
  });
});

describe('canAutoLink', () => {
  const trustedDomains = ['acme.example'];

  it('needs both a verified email and a domain the tenant claimed', () => {
    expect(canAutoLink({ email: 'alice@acme.example', providerVerified: true, trustedDomains })).toBe(true);
  });

  it('refuses an unverified email, which is a profile field anybody can type', () => {
    expect(canAutoLink({ email: 'alice@acme.example', providerVerified: false, trustedDomains })).toBe(false);
  });

  it('refuses a verified email on a domain the tenant did not claim', () => {
    // A verified address in somebody else's workspace says nothing about who
    // this person is here — and a workspace admin can usually edit a profile.
    expect(canAutoLink({ email: 'mallory@evil.example', providerVerified: true, trustedDomains })).toBe(false);
  });

  it('matches the domain exactly, not as a suffix', () => {
    // `notacme.example` must not pass because it ends with the trusted string.
    expect(canAutoLink({ email: 'x@notacme.example', providerVerified: true, trustedDomains })).toBe(false);
    expect(canAutoLink({ email: 'x@acme.example.evil.test', providerVerified: true, trustedDomains })).toBe(false);
  });

  it('is case-insensitive about the domain and refuses a malformed address', () => {
    expect(canAutoLink({ email: 'Alice@ACME.example', providerVerified: true, trustedDomains })).toBe(true);
    expect(canAutoLink({ email: '@acme.example', providerVerified: true, trustedDomains })).toBe(false);
    expect(canAutoLink({ email: null, providerVerified: true, trustedDomains })).toBe(false);
  });
});

describe('guardChat', () => {
  const base: ChatEvent = {
    senderId: 'U-person',
    text: 'my laptop will not start',
    direct: true,
    mentioned: false,
    sizeBytes: 100,
  };
  const options = { ownBotUserId: 'U-desk', maxBytes: 10_000, recentFromSender: 0, maxPerSenderPerHour: 30 };

  it('accepts a direct message from a person', () => {
    expect(guardChat(base, options).accept).toBe(true);
  });

  it('drops the desk hearing its own voice, before anything can reply', () => {
    // The loop: the desk acknowledges, its own message arrives as an event, it
    // acknowledges that. One turn faster than a holiday responder and it does
    // not stop on its own.
    expect(guardChat({ ...base, senderId: 'U-desk' }, options).reason).toBe('loop_detected');
  });

  it('drops another application’s messages, and counts them as ordinary', () => {
    const verdict = guardChat({ ...base, botId: 'B-deploybot' }, options);
    expect(verdict.reason).toBe('bot_message');
  });

  it('reads an allowlisted application', () => {
    expect(guardChat({ ...base, botId: 'B-monitoring' }, { ...options, allowedBotIds: ['B-monitoring'] }).accept).toBe(true);
  });

  it('ignores events about a message rather than messages', () => {
    // Acting on an edit would re-raise a ticket somebody just corrected.
    expect(guardChat({ ...base, subtype: 'message_changed' }, options).reason).toBe('unsupported_event');
    expect(guardChat({ ...base, subtype: 'channel_join' }, options).reason).toBe('unsupported_event');
  });

  it('ignores a channel message that did not address the desk', () => {
    // The commonest rejection by far: the desk is invited to a busy channel and
    // sees everything said in it.
    expect(guardChat({ ...base, direct: false, mentioned: false }, options).reason).toBe('not_addressed');
    expect(guardChat({ ...base, direct: false, mentioned: true }, options).accept).toBe(true);
  });

  it('applies the size cap and the rate limit', () => {
    expect(guardChat({ ...base, sizeBytes: 20_000 }, options).reason).toBe('too_large');
    expect(guardChat(base, { ...options, recentFromSender: 30 }).reason).toBe('rate_limited');
  });

  it('drops an empty message', () => {
    expect(guardChat({ ...base, text: '   ' }, options).reason).toBe('empty');
  });

  it('checks the loop before the rate limit, so a loop is never reported as chattiness', () => {
    const verdict = guardChat({ ...base, senderId: 'U-desk' }, { ...options, recentFromSender: 500 });
    expect(verdict.reason).toBe('loop_detected');
  });
});

describe('parsing what somebody typed', () => {
  it('reads a bare slash command as raising a ticket', () => {
    const command = parseSlash({ text: 'my laptop will not start' });
    expect(command).toEqual({ kind: 'createTicket', subject: 'my laptop will not start', body: 'my laptop will not start' });
  });

  it('reads an explicit status query', () => {
    expect(parseSlash({ text: 'status REQ-000123' })).toEqual({ kind: 'getStatus', ticketRef: 'REQ-000123' });
  });

  it('does not mistake a request that begins with a subcommand word', () => {
    // `/ticket status of my laptop` is about a laptop. Refusing it would be
    // pedantry aimed at the wrong person.
    expect(parseSlash({ text: 'status of my laptop is bad' }).kind).toBe('createTicket');
  });

  it('reads a link request with and without a code', () => {
    expect(parseSlash({ text: 'link 4821' })).toEqual({ kind: 'linkIdentity', code: '4821' });
    expect(parseSlash({ text: 'link' })).toEqual({ kind: 'linkIdentity' });
  });

  it('asks for a person when somebody asks for one', () => {
    expect(parseSlash({ text: 'agent please' })).toEqual({ kind: 'handoff', reason: 'please' });
    expect(parseSlash({ text: '' })).toEqual({ kind: 'handoff' });
  });

  it('strips the mention so a ticket is not titled with the bot’s name', () => {
    expect(stripMention('<@U0DESK> my laptop will not start')).toBe('my laptop will not start');
    expect(stripMention('<at>Service Desk</at> printer jammed')).toBe('printer jammed');
  });

  it('treats a reply in the desk’s own thread as a comment on that ticket', () => {
    // That is what a thread is. Asking people to repeat the reference is asking
    // them to do the computer's filing.
    expect(parseMessage({ text: 'still broken', threadTicketRef: 'REQ-000123' })).toEqual({
      kind: 'addComment',
      ticketRef: 'REQ-000123',
      body: 'still broken',
    });
  });

  it('reads a question about a named ticket as a status query', () => {
    expect(parseMessage({ text: '<@U0DESK> any news on REQ-000123?' })).toEqual({
      kind: 'getStatus',
      ticketRef: 'REQ-000123',
    });
  });

  it('titles a long message with something recognisable in a list', () => {
    const long = `${'a'.repeat(200)}`;
    expect(titleFrom(long).length).toBeLessThanOrEqual(120);
    expect(titleFrom('It broke. Then it broke again.')).toBe('It broke.');
  });

  it('finds a ticket reference whatever case it was typed in', () => {
    expect(findTicketRef('see req-000123 please')).toBe('REQ-000123');
    expect(findTicketRef('nothing here')).toBeNull();
  });
});

describe('a button payload is parsed, not trusted', () => {
  const approvalId = '00000000-0000-4000-8000-000000000001';

  it('reads an approve and a reject', () => {
    expect(parseAction({ action: 'approve', subjectId: approvalId })).toEqual({
      kind: 'decideApproval',
      approvalId,
      decision: 'approved',
    });
    expect(parseAction({ action: 'reject', subjectId: approvalId })).toEqual({
      kind: 'decideApproval',
      approvalId,
      decision: 'rejected',
    });
  });

  it('refuses an action it does not recognise', () => {
    // The platform wrote the button; what came back arrived over the internet.
    expect(parseAction({ action: 'delete_everything', subjectId: approvalId })).toBeNull();
    expect(parseAction({ action: 'approve', subjectId: 'not-a-uuid' })).toBeNull();
    expect(parseAction({ action: 'approve' })).toBeNull();
    expect(parseAction('approve')).toBeNull();
    expect(parseAction(null)).toBeNull();
  });
});
