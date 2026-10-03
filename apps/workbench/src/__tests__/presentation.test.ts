import { describe, expect, it } from 'vitest';
import { CANONICAL_STATES } from '@itsm/module-ticket';
import { AREAS } from '@itsm/contracts/areas';
import { ApiError, type TimelineEventEntry } from '@itsm/sdk';
import {
  HELP_PORTAL_NAME,
  STATE_LABEL,
  ageOf,
  categoryIntent,
  categoryTone,
  channelLabel,
  describeEvent,
  dueText,
  dueUrgency,
  isTenantSuspended,
  isUrgentPriority,
  isWaitingState,
  personName,
  priorityEmphasis,
  priorityIntent,
  priorityLabel,
  problemOf,
  replyChannelLine,
  rowDescription,
  rowLabel,
  stateLabel,
  ticketEventType,
  typeLabel,
} from '../inbox/presentation.js';
import * as legacy from '../queue/presentation.js';

const JO = '11111111-2222-4333-8444-555555555555';
const ADA = '66666666-7777-4888-9999-000000000000';
const people = { [JO]: { name: 'Jo Bloggs', initials: 'JB' }, [ADA]: { name: 'Ada Lovelace', initials: 'AL' } };

function event(type: string, payload: Record<string, unknown> = {}, actor: Partial<Pick<TimelineEventEntry, 'actorId' | 'actorType'>> = {}): TimelineEventEntry {
  return { kind: 'event', at: '2026-01-10T10:00:00Z', id: 'e1', type, actorType: 'user', actorId: JO, payload, ...actor };
}

describe('how a ticket reads', () => {
  it('has a word for every canonical state MOD-04 defines', () => {
    // A state with no entry falls through to the underscored value, which is
    // legible but is the database's vocabulary. This fails when MOD-04 grows a
    // state, which is the moment to decide what an agent should read.
    for (const state of CANONICAL_STATES) {
      expect(STATE_LABEL[state], state).toBeDefined();
    }
  });

  it('says the status in English', () => {
    expect(stateLabel('pending_third_party')).toBe('Waiting on supplier');
    expect(stateLabel('in_progress')).toBe('In progress');
    // A tenant's own state the table has never seen is still readable.
    expect(stateLabel('awaiting_parts')).toBe('awaiting parts');
    expect(isWaitingState('pending_requester')).toBe(true);
    expect(isWaitingState('in_progress')).toBe(false);
  });

  it('shouts for P1 and nothing else, and draws P2 in high, never amber (D5)', () => {
    expect(priorityIntent('P1')).toBe('danger');
    expect(priorityIntent('P2')).toBe('high');
    expect(priorityIntent('p2')).toBe('high');
    expect(priorityEmphasis('P1')).toBe('solid');
    expect(priorityEmphasis('P2')).toBe('subtle');
    expect(priorityIntent('P3')).toBe('neutral');
    expect(priorityIntent('P4')).toBe('neutral');
    expect(priorityLabel('p2')).toBe('P2 · High');
    expect(priorityLabel('Urgent')).toBe('Urgent');
    expect(isUrgentPriority('P2')).toBe(true);
    expect(isUrgentPriority('P3')).toBe(false);
  });

  it('colours by category, which is the stable thing; waiting is hold, never amber (D5)', () => {
    expect(categoryIntent('paused')).toBe('hold');
    expect(categoryTone('paused')).toBe('hold');
    expect(categoryIntent('open')).toBe('info');
    expect(categoryIntent('resolved')).toBe('success');
    expect(categoryIntent('something-new')).toBe('neutral');
    expect(categoryTone('open')).toBe('info');
    expect(categoryTone('closed')).toBe('neutral');
  });

  it('names a type it knows and echoes one it does not', () => {
    expect(typeLabel('incident')).toBe('Incident');
    expect(typeLabel('question')).toBe('Question');
    expect(typeLabel('service_review')).toBe('service_review');
  });

  it('names channels in words, and says what a reply will do', () => {
    expect(channelLabel('voice')).toBe('Phone');
    expect(channelLabel('carrier_pigeon')).toBe('Carrier pigeon');
    expect(replyChannelLine('email')).toBe('Replying by email');
    expect(replyChannelLine('portal')).toBe('Visible in the Help Portal');
  });

  it('names the Help Portal as the area model does (D1)', () => {
    expect(HELP_PORTAL_NAME).toBe(AREAS.portal.name);
    expect(replyChannelLine('portal')).toBe(`Visible in the ${AREAS.portal.name}`);
  });

  it('keeps amber for SLA risk alone: no category or priority is drawn in warning', () => {
    for (const category of ['open', 'paused', 'resolved', 'closed', 'something-new']) {
      expect(categoryIntent(category), category).not.toBe('warning');
      expect(categoryTone(category), category).not.toBe('warning');
    }
    for (const priority of ['P1', 'P2', 'P3', 'P4', 'Urgent']) expect(priorityIntent(priority), priority).not.toBe('warning');
  });

  it('reads an age at a glance', () => {
    const now = Date.parse('2026-01-10T12:00:00Z');
    expect(ageOf('2026-01-10T11:45:00Z', now)).toBe('15 m');
    expect(ageOf('2026-01-10T09:30:00Z', now)).toBe('2 h 30 m');
    expect(ageOf('2026-01-08T06:00:00Z', now)).toBe('2 d 6 h');
    expect(ageOf('2025-11-10T12:00:00Z', now)).toBe('61 d');
    // A clock skew must not produce "-3 m".
    expect(ageOf('2026-01-10T12:05:00Z', now)).toBe('0 m');
  });

  it('keeps the legacy path working until Stage 5', () => {
    expect(legacy.stateLabel).toBe(stateLabel);
  });
});

describe('deadlines, as text (X-33)', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');

  it('says how long is left, or how late it is', () => {
    expect(dueText('2026-01-10T14:10:00Z', now)).toBe('Due in 2 h 10 min');
    expect(dueText('2026-01-10T11:40:00Z', now)).toBe('Overdue by 20 min');
    expect(dueText(null, now)).toBeNull();
  });

  it('is urgent within the hour and breached after it', () => {
    expect(dueUrgency('2026-01-10T12:30:00Z', now)).toBe('soon');
    expect(dueUrgency('2026-01-10T15:00:00Z', now)).toBe('later');
    expect(dueUrgency('2026-01-10T11:59:00Z', now)).toBe('breached');
    expect(dueUrgency(null, now)).toBeNull();
  });
});

describe('a row, read aloud (X-67)', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');
  const ticket = {
    number: 'INC-000123',
    title: 'VPN keeps dropping',
    status: 'in_progress',
    priority: 'P2',
    dueAt: '2026-01-10T14:10:00Z',
    updatedAt: '2026-01-10T11:55:00Z',
  };

  it('names the row by its title and number, and says when it is unread', () => {
    expect(rowLabel(ticket, true)).toBe('VPN keeps dropping, INC-000123, unread');
    expect(rowLabel(ticket)).toBe('VPN keeps dropping, INC-000123');
  });

  it('describes it in the order an agent triages', () => {
    expect(rowDescription(ticket, now)).toBe('Priority 2, In progress, due in 2 h 10 min, updated 5 min ago');
    expect(rowDescription({ ...ticket, dueAt: null, updatedAt: '2026-01-10T12:00:00Z' }, now)).toBe(
      'Priority 2, In progress, updated just now',
    );
  });
});

describe('people (F8)', () => {
  it('shows a name, "You", or an honest placeholder — never a bare id', () => {
    expect(personName(ADA, people)).toBe('Ada Lovelace');
    expect(personName(JO, people, JO)).toBe('You');
    expect(personName('abcdef12-3456-4789-8abc-def012345678', people)).toBe('Unknown person · abcdef12');
    expect(personName(null, people)).toBe('Nobody');
  });
});

describe('a history, in words (F22)', () => {
  it('drops comment.added, because the comment itself is already in the conversation', () => {
    expect(describeEvent(event('ticket.comment.added', { commentId: 'c1' }), people)).toBeNull();
  });

  it('says who moved it, from what to what, with the reason quoted', () => {
    expect(describeEvent(event('ticket.status.changed', { from: 'new', to: 'in_progress' }), people)).toEqual({
      text: 'Jo Bloggs moved it from New to In progress',
    });
    expect(describeEvent(event('ticket.status.changed', { from: 'in_progress', to: 'pending_third_party', reason: 'Supplier case #8812' }), people)).toEqual({
      text: 'Jo Bloggs moved it from In progress to Waiting on supplier',
      detail: '“Supplier case #8812”',
    });
  });

  it('says who it was assigned to, and how', () => {
    expect(describeEvent(event('ticket.assigned', { assigneeId: ADA, method: 'manual' }), people)?.text).toBe('Jo Bloggs assigned it to Ada Lovelace');
    expect(describeEvent(event('ticket.assigned', { assigneeId: JO }), people)?.text).toBe('Jo Bloggs took it');
    expect(describeEvent(event('ticket.assigned', { assigneeId: null }), people)?.text).toBe('Jo Bloggs unassigned it');
    expect(describeEvent(event('ticket.assigned', { assigneeId: ADA, method: 'rule' }, { actorType: 'workflow', actorId: null }), people)).toEqual({
      text: 'An automation assigned it to Ada Lovelace',
      detail: 'By rule',
    });
  });

  it('says "You" for the reader', () => {
    expect(describeEvent(event('ticket.assigned', { assigneeId: ADA }), people, JO)?.text).toBe('You assigned it to Ada Lovelace');
  });

  it('lists what an edit changed', () => {
    expect(describeEvent(event('ticket.updated', { changed: { priority: {}, urgency: {} } }), people)?.text).toBe(
      'Jo Bloggs changed the priority and the urgency',
    );
    expect(describeEvent(event('ticket.updated', { changed: { title: {}, impact: {}, categoryId: {} } }), people)?.text).toBe(
      'Jo Bloggs changed the title, the impact and the category',
    );
  });

  it('describes raising, tasks, links and attachments', () => {
    expect(describeEvent(event('ticket.created', { channel: 'email' }), people)?.text).toBe('Jo Bloggs raised it · Email');
    expect(describeEvent(event('ticket.task.created', { title: 'Order a token' }), people)?.text).toBe('Jo Bloggs added a task: Order a token');
    expect(describeEvent(event('ticket.attachment.added', { filename: 'log.txt' }), people)?.text).toBe('Jo Bloggs attached log.txt');
    expect(describeEvent(event('ticket.linked', { linkType: 'blocks' }), people)?.text).toBe('Jo Bloggs marked it as blocking another ticket');
  });

  it('names who acted when it was not a person', () => {
    expect(describeEvent(event('ticket.updated', { changed: { priority: {} } }, { actorType: 'ai', actorId: null }), people)?.text).toBe(
      'AI triage changed the priority',
    );
    expect(describeEvent(event('ticket.status.changed', { to: 'closed' }, { actorType: 'system', actorId: null }), people)?.text).toBe(
      'The system moved it to Closed',
    );
    expect(describeEvent(event('ticket.created', {}, { actorId: ADA }), {})?.text).toMatch(/^Unknown person · 66666666 raised it$/);
  });

  it('still shows an event it has never heard of, in plain words', () => {
    expect(describeEvent(event('ticket.sla_paused', {}), people)?.text).toBe('Jo Bloggs · sla paused');
    expect(describeEvent(event('sla_paused', {}), people)?.text).toBe('Jo Bloggs · sla paused');
  });

  // The ticket timeline stores the short type (`insertTicketEvent(…, 'status.changed')`);
  // the live stream and the catalogue use the full one. Both must read the same.
  it('reads the timeline’s short event types exactly as the full ones', () => {
    const cases: readonly [string, Record<string, unknown>][] = [
      ['comment.added', { commentId: 'c1' }],
      ['created', { channel: 'email' }],
      ['imported', {}],
      ['status.changed', { from: 'new', to: 'in_progress', reason: 'Picked up' }],
      ['assigned', { assigneeId: ADA, method: 'rule' }],
      ['updated', { changed: { priority: {} } }],
      ['task.completed', { title: 'Order a token' }],
      ['linked', { linkType: 'relates_to' }],
    ];
    for (const [type, payload] of cases) {
      expect(describeEvent(event(type, payload), people), type).toEqual(describeEvent(event(`ticket.${type}`, payload), people));
    }
    expect(describeEvent(event('status.changed', { from: 'new', to: 'in_progress' }), people)?.text).toBe('Jo Bloggs moved it from New to In progress');
    expect(describeEvent(event('assigned', { assigneeId: JO }), people)?.text).toBe('Jo Bloggs took it');
    expect(ticketEventType('status.changed')).toBe('ticket.status.changed');
    expect(ticketEventType('ticket.assigned')).toBe('ticket.assigned');
  });

  it('matches people whatever case the ids arrive in', () => {
    const shouted = event('assigned', { assigneeId: ADA.toUpperCase() }, { actorId: JO.toUpperCase() });
    expect(describeEvent(shouted, people)?.text).toBe('Jo Bloggs assigned it to Ada Lovelace');
  });
});

describe('problems', () => {
  it('keeps an API error’s status and code', () => {
    const suspended = new ApiError(
      403,
      { type: 'https://docs.itsm.example/problems/tenant_suspended', title: 'tenant suspended', status: 403, correlationId: 'c' },
      'this tenant is suspended',
    );
    expect(problemOf(suspended)).toMatchObject({ status: 403, code: 'tenant_suspended', retryable: false });
    expect(isTenantSuspended(suspended)).toBe(true);
    expect(isTenantSuspended(new ApiError(403, null, 'forbidden'))).toBe(false);
  });

  it('carries field errors for a form', () => {
    const invalid = new ApiError(
      422,
      { type: 'x/problems/validation_failed', title: 'validation failed', status: 422, correlationId: 'c', errors: [{ field: 'title', code: 'too_short', message: 'Too short' }] },
      'invalid',
    );
    expect(problemOf(invalid).fieldErrors).toEqual({ title: 'Too short' });
  });

  it('treats anything else as the network', () => {
    expect(problemOf(new TypeError('Failed to fetch'))).toEqual({ status: 0, retryable: true });
  });

  it('never offers a retry for a demo limit, which waiting does not lift', () => {
    const capped = new ApiError(429, { type: 'x/problems/demo_limit', title: 'Demo limit reached', status: 429, correlationId: 'c' }, 'capped');
    expect(problemOf(capped)).toMatchObject({ status: 429, code: 'demo_limit', retryable: false });
    const limited = new ApiError(429, { type: 'x/problems/rate_limited', title: 'Too many requests', status: 429, correlationId: 'c' }, 'limited');
    expect(problemOf(limited)).toMatchObject({ status: 429, retryable: true });
  });
});
