import { describe, expect, it } from 'vitest';
import { CANONICAL_STATES, STATES } from '@itsm/module-ticket';
import { ageOf, categoryIntent, priorityEmphasis, priorityIntent, STATE_LABEL, stateLabel, typeLabel } from '../queue/presentation.js';
import { ALLOWED_TRANSITIONS, transitionsFrom } from '../queue/transitions.js';
import { queueHref, queueViewFrom } from '../queue/view.js';

describe('the queue view, read from the URL', () => {
  it('shows open work by default, not everything ever raised', () => {
    const view = queueViewFrom({});
    expect(view.filter.statusCategory).toBe('new,open,pending');
    expect(view.filter.sort).toBe('-createdAt');
    expect(view.title).toBe('Open tickets');
  });

  it('leaves `me` and `none` for the API to resolve, so a link is shareable', () => {
    expect(queueViewFrom({ assignee: 'me' }).filter.assignee).toBe('me');
    expect(queueViewFrom({ assignee: 'none' }).filter.assignee).toBe('none');
    expect(queueViewFrom({ assignee: 'me' }).title).toBe('Assigned to me');
  });

  it('accepts a user id and refuses anything else', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(queueViewFrom({ assignee: id }).filter.assignee).toBe(id);
    expect(queueViewFrom({ assignee: "'; drop table" }).filter.assignee).toBeUndefined();
  });

  it('takes the first value when a parameter is repeated', () => {
    expect(queueViewFrom({ assignee: ['me', 'none'] }).filter.assignee).toBe('me');
  });

  it('falls back to a known sort rather than passing one through', () => {
    // The API's `sort` is an enum; an unrecognised value is a 422 on a page
    // load, which reads as the queue being broken.
    expect(queueViewFrom({ sort: 'dueAt' }).sort).toBe('dueAt');
    expect(queueViewFrom({ sort: 'DROP' }).sort).toBe('-createdAt');
  });

  it('caps and cleans a status list', () => {
    expect(queueViewFrom({ status: 'new,in_progress' }).filter.status).toBe('new,in_progress');
    expect(queueViewFrom({ status: 'new, in_progress ,' }).filter.status).toBe('new,in_progress');
    expect(queueViewFrom({ status: '<script>' }).filter.statusCategory).toBe('new,open,pending');
    expect(queueViewFrom({ status: Array.from({ length: 40 }, (_, i) => `s${i}`).join(',') }).filter.status)
      .toBe(Array.from({ length: 10 }, (_, i) => `s${i}`).join(','));
  });

  it('truncates a search rather than sending an essay', () => {
    expect(queueViewFrom({ q: 'x'.repeat(500) }).filter.q).toHaveLength(200);
  });

  it('builds a link for the same view with one thing changed', () => {
    const view = queueViewFrom({ assignee: 'me', q: 'vpn' });
    expect(queueHref(view, { assignee: 'none' })).toBe('/queue?assignee=none&q=vpn');
    // The default sort is left out, so the plain queue URL stays plain.
    expect(queueHref(queueViewFrom({}), {})).toBe('/queue');
  });
});

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
  });

  it('shouts for P1 and nothing else', () => {
    expect(priorityIntent('P1')).toBe('danger');
    expect(priorityEmphasis('P1')).toBe('solid');
    expect(priorityEmphasis('P2')).toBe('subtle');
    expect(priorityIntent('P4')).toBe('neutral');
  });

  it('colours by category, which is the stable thing', () => {
    expect(categoryIntent('paused')).toBe('warning');
    expect(categoryIntent('resolved')).toBe('success');
    expect(categoryIntent('something-new')).toBe('neutral');
  });

  it('names a type it knows and echoes one it does not', () => {
    expect(typeLabel('incident')).toBe('Incident');
    expect(typeLabel('service_review')).toBe('service_review');
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
});

describe('the transitions the workbench offers', () => {
  /**
   * The workbench cannot import `@itsm/module-ticket` at runtime — a module
   * package carries Prisma, and this app has no database. The table is
   * therefore a copy, and this is the check that keeps it one.
   */
  it('matches MOD-04’s state machine exactly', () => {
    const canonical = Object.fromEntries(
      Object.entries(STATES).map(([state, definition]) => [state, [...definition.allowed].sort()]),
    );
    const copied = Object.fromEntries(
      Object.entries(ALLOWED_TRANSITIONS).map(([state, allowed]) => [state, [...allowed].sort()]),
    );
    expect(copied).toEqual(canonical);
  });

  it('offers nothing from a state it does not recognise', () => {
    expect(transitionsFrom('awaiting_parts')).toEqual([]);
    expect(transitionsFrom('closed')).toEqual([]);
    expect(transitionsFrom('new')).toContain('in_progress');
  });
});
