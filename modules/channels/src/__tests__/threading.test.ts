import { describe, expect, it } from 'vitest';
import {
  outboundMessageId,
  outboundSubject,
  parseReferences,
  resolveThread,
  stripQuotedReply,
  subjectToken,
  TICKET_HEADER,
} from '../domain/threading.js';
import { guardInbound } from '../domain/loop-guard.js';

/**
 * Which ticket an email belongs to, and whether it should be accepted at all.
 *
 * These two decisions are where an email-fed service desk goes wrong: a reply
 * that starts a second ticket, a holiday responder in a loop with the
 * acknowledgement, or a thread that becomes unreadable because every reply
 * carries the whole history.
 */

describe('threading', () => {
  it('prefers the header we stamped ourselves', () => {
    // Set by us, invisible to the user, and impossible to type by accident.
    const match = resolveThread(
      { [TICKET_HEADER]: 'INC-000123', 'in-reply-to': '<other@example.test>' },
      '[REQ-000999] a different token in the subject',
    );
    expect(match).toEqual({ kind: 'header-token', ticketRef: 'INC-000123' });
  });

  it('falls back to the reference chain', () => {
    const match = resolveThread(
      { References: '<a@x.test> <b@x.test>', 'In-Reply-To': '<b@x.test>' },
      'Re: something',
    );
    expect(match).toEqual({ kind: 'references', messageIds: ['<b@x.test>', '<a@x.test>'] });
  });

  it('falls back to a bracketed subject token when a reply was forwarded', () => {
    const match = resolveThread({}, 'Fwd: [INC-000045] printer jam');
    expect(match).toEqual({ kind: 'subject-token', ticketRef: 'INC-000045' });
  });

  it('starts a new ticket when nothing matches', () => {
    expect(resolveThread({}, 'my laptop is broken')).toEqual({ kind: 'new' });
  });

  it('ignores a ticket number mentioned in passing', () => {
    // "as I said in INC-000045" is someone talking about a ticket, not replying
    // to one. Only the bracketed form counts.
    expect(subjectToken('following up on INC-000045 from yesterday')).toBeNull();
    expect(subjectToken('[INC-000045] following up')).toBe('INC-000045');
  });

  it('de-duplicates references while keeping the parent last', () => {
    expect(parseReferences({ references: '<a@x> <b@x> <a@x>', 'in-reply-to': '<b@x>' }))
      .toEqual(['<b@x>', '<a@x>']);
  });

  it('refuses a malformed header token rather than trusting it', () => {
    expect(resolveThread({ [TICKET_HEADER]: 'not-a-ticket' }, 'hello')).toEqual({ kind: 'new' });
  });
});

describe('quoted replies', () => {
  it('keeps only what the person wrote this time', () => {
    const body = [
      'That worked, thank you.',
      '',
      'On Monday 14 September 2026 at 09:15, Service Desk wrote:',
      '> Have you tried turning it off and on again?',
      '> Let us know.',
    ].join('\n');
    expect(stripQuotedReply(body)).toBe('That worked, thank you.');
  });

  it('handles the Outlook style', () => {
    const body = 'Still broken.\n\n-----Original Message-----\nFrom: Service Desk\nAnything?';
    expect(stripQuotedReply(body)).toBe('Still broken.');
  });

  it('leaves a message alone when it finds no marker', () => {
    // Losing what somebody wrote is far worse than keeping too much.
    const body = 'Just a plain message with no quoting at all.';
    expect(stripQuotedReply(body)).toBe(body);
  });

  it('keeps the original when the reply is nothing but quoted text', () => {
    const body = 'On Monday, Service Desk wrote:\n> anything?';
    expect(stripQuotedReply(body)).toBe(body);
  });
});

describe('outbound', () => {
  it('adds the token once and does not double it', () => {
    expect(outboundSubject('INC-000123', 'printer jam')).toBe('[INC-000123] printer jam');
    expect(outboundSubject('INC-000123', 'Re: [INC-000123] printer jam')).toBe('Re: [INC-000123] printer jam');
  });

  it('stamps a message id that threads with itself', () => {
    expect(outboundMessageId('INC-000123', 2, 'help.example')).toBe('<inc-000123.2@help.example>');
  });
});

describe('the loop guard', () => {
  const base = {
    headers: {} as Record<string, string | undefined>,
    subject: 'help',
    body: 'my laptop is broken',
    fromAddress: 'ada@example.test',
    sizeBytes: 1024,
  };
  const options = {
    maxBytes: 10_000_000,
    ownAddresses: ['support@help.example'],
    recentFromSender: 0,
    maxPerSenderPerHour: 20,
  };

  it('accepts an ordinary message', () => {
    expect(guardInbound(base, options)).toEqual({ accept: true });
  });

  it('drops an out-of-office responder', () => {
    // The loop this prevents: responder replies to the acknowledgement, the desk
    // acknowledges the reply, until the mailbox fills.
    const verdict = guardInbound({ ...base, headers: { 'Auto-Submitted': 'auto-replied' } }, options);
    expect(verdict).toMatchObject({ accept: false, reason: 'auto_reply' });
  });

  it('accepts a message that explicitly says it is not automatic', () => {
    expect(guardInbound({ ...base, headers: { 'auto-submitted': 'no' } }, options).accept).toBe(true);
  });

  it('drops bulk and list mail', () => {
    expect(guardInbound({ ...base, headers: { Precedence: 'bulk' } }, options).reason).toBe('auto_reply');
    expect(guardInbound({ ...base, headers: { precedence: 'list' } }, options).reason).toBe('auto_reply');
  });

  it('drops a bounce, which has no envelope sender', () => {
    expect(guardInbound({ ...base, fromAddress: '<>' }, options).reason).toBe('loop_detected');
  });

  it('drops our own address writing to us', () => {
    expect(guardInbound({ ...base, fromAddress: 'Support@Help.Example' }, options).reason).toBe('loop_detected');
  });

  it('rate-limits one sender without affecting others', () => {
    expect(guardInbound(base, { ...options, recentFromSender: 20 }).reason).toBe('rate_limited');
    expect(guardInbound(base, { ...options, recentFromSender: 19 }).accept).toBe(true);
  });

  it('drops an empty message and an oversized one', () => {
    expect(guardInbound({ ...base, subject: '  ', body: '' }, options).reason).toBe('empty');
    expect(guardInbound({ ...base, sizeBytes: 20_000_000 }, options).reason).toBe('too_large');
  });
});
