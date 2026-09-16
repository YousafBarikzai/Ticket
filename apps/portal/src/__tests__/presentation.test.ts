import { describe, expect, it } from 'vitest';
import { CANONICAL_STATES } from '@itsm/module-ticket';
import type { CatalogueItem } from '@itsm/sdk';
import { groupByService, UNGROUPED } from '../catalogue/group.js';
import { needsYou, raisedAgo, requesterState, typeLabel, URGENCY_CHOICES } from '../tickets/presentation.js';

describe('what a state means to the person who raised it', () => {
  it('names a party in every label, because that is the whole question', () => {
    // "In progress" tells somebody nothing. Who is holding it does.
    expect(requesterState('in_progress').label).toBe('Being worked on');
    expect(requesterState('pending_requester').label).toBe('Waiting for you');
    expect(requesterState('pending_third_party').label).toBe('Waiting on a supplier');
  });

  it('marks exactly the state that is the requester’s to act on', () => {
    const waiting = CANONICAL_STATES.filter((state) => needsYou(state));
    expect(waiting).toEqual(['pending_requester']);
  });

  it('covers every canonical state MOD-04 defines', () => {
    // A state with no entry would fall through to "Open", which is safe but
    // uninformative. This fails when MOD-04 grows one, which is the moment to
    // decide what it means to a requester.
    for (const state of CANONICAL_STATES) {
      expect(requesterState(state).label, state).not.toBe('Open');
    }
  });

  it('says less rather than leaking a tenant’s own status name', () => {
    expect(requesterState('awaiting_parts_l3').label).toBe('Open');
    expect(requesterState('awaiting_parts_l3').needsYou).toBe(false);
  });

  it('never uses the service desk’s own word for a ticket', () => {
    expect(typeLabel('incident')).toBe('Issue');
    expect(typeLabel('request')).toBe('Request');
    // Anything the portal has no word for is just a ticket, never `change`.
    expect(typeLabel('change')).toBe('Ticket');
  });

  it('asks about urgency in the requester’s terms, and only urgency', () => {
    // Impact is the desk's to set: a requester cannot know how many other
    // people are affected, and a form that asks produces a number nobody
    // should act on.
    expect(URGENCY_CHOICES.map((choice) => choice.value)).toEqual(['low', 'medium', 'high']);
    expect(URGENCY_CHOICES.every((choice) => !/impact/i.test(choice.label))).toBe(true);
  });
});

describe('how long ago', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');

  it('reads as a sentence, not as a duration', () => {
    expect(raisedAgo('2026-01-10T11:59:40Z', now)).toBe('just now');
    expect(raisedAgo('2026-01-10T11:59:00Z', now)).toBe('1 minute ago');
    expect(raisedAgo('2026-01-10T11:30:00Z', now)).toBe('30 minutes ago');
    expect(raisedAgo('2026-01-10T09:00:00Z', now)).toBe('3 hours ago');
    expect(raisedAgo('2026-01-08T12:00:00Z', now)).toBe('2 days ago');
    expect(raisedAgo('2025-10-10T12:00:00Z', now)).toBe('3 months ago');
  });

  it('never reads as the future when a clock is out by a minute', () => {
    expect(raisedAgo('2026-01-10T12:05:00Z', now)).toBe('just now');
  });
});

describe('grouping the catalogue', () => {
  const item = (key: string, service: string | null): CatalogueItem => ({
    key,
    name: key,
    description: null,
    shortSummary: null,
    formKey: null,
    service,
    serviceKey: service,
  });

  it('groups by service, alphabetically', () => {
    const groups = groupByService([item('a', 'Workplace'), item('b', 'Accounts'), item('c', 'Workplace')]);
    expect(groups.map((group) => group.service)).toEqual(['Accounts', 'Workplace']);
    expect(groups[1]!.items).toHaveLength(2);
  });

  it('keeps an item whose service was removed, rather than hiding it', () => {
    const groups = groupByService([item('a', 'Accounts'), item('orphan', null)]);
    expect(groups.map((group) => group.service)).toEqual(['Accounts', UNGROUPED]);
  });

  it('puts the catch-all last however the locale collates', () => {
    // "Everything else" would land between "Accounts" and "Workplace"
    // alphabetically, and read as a service called Everything.
    const groups = groupByService([item('a', 'Workplace'), item('orphan', null), item('b', 'Accounts')]);
    expect(groups.at(-1)!.service).toBe(UNGROUPED);
  });

  it('returns nothing for nothing', () => {
    expect(groupByService([])).toEqual([]);
  });
});
