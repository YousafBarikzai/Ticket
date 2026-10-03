import { describe, expect, it } from 'vitest';
import { CANONICAL_STATES } from '@itsm/module-ticket';
import type { CatalogueItem } from '@itsm/sdk';
import { TICKET_STATE_LOOK } from '@itsm/ui';
import { groupByService, UNGROUPED } from '../catalogue/group.js';
import { DEFAULT_SERVICE_ICON, SERVICE_TOPICS, serviceIcon, topicFor, topicHref } from '../catalogue/icons.js';
import {
  PROGRESS_STEPS,
  needsYou,
  nextAction,
  progressOf,
  raisedAgo,
  requesterState,
  typeLabel,
  URGENCY_CHOICES,
  yoursFirst,
} from '../tickets/presentation.js';

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

describe('how a state is drawn', () => {
  it('gives every canonical state a pill tone and its own icon, so it reads without colour', () => {
    for (const state of CANONICAL_STATES) {
      const shown = requesterState(state);
      expect(shown.icon, state).not.toBe('dot');
      expect(['neutral', 'info', 'success', 'hold', 'danger']).toContain(shown.tone);
    }
  });

  it('takes every tone from the design system’s state map, keeping the requester’s own words (D5)', () => {
    for (const state of CANONICAL_STATES) {
      const look = TICKET_STATE_LOOK[state as keyof typeof TICKET_STATE_LOOK];
      expect(look, state).toBeDefined();
      expect(requesterState(state).tone, state).toBe(look.tone);
      expect(requesterState(state).intent, state).toBe(look.tone);
    }
    // The words stay the requester's: never the agent's "Waiting on requester".
    expect(requesterState('pending_requester').label).not.toBe(TICKET_STATE_LOOK.pending_requester.label);
  });

  it('never draws a state in amber, which means an SLA at risk and nothing else', () => {
    for (const state of [...CANONICAL_STATES, 'awaiting_parts_l3']) expect(requesterState(state).tone, state).not.toBe('warning');
    for (const state of [...CANONICAL_STATES, 'awaiting_parts_l3']) expect(nextAction(state).tone, state).not.toBe('warning');
  });

  it('keeps the accent blue for things that can be pressed: no state is drawn in it', () => {
    for (const state of [...CANONICAL_STATES, 'awaiting_parts_l3']) expect(requesterState(state).tone).not.toBe('accent');
  });

  it('draws the one state that is the requester’s to answer in hold, like every wait', () => {
    expect(requesterState('pending_requester').tone).toBe('hold');
  });
});

describe('what happens next (nextAction)', () => {
  it('asks for a reply when the desk asked something', () => {
    expect(nextAction('pending_requester')).toEqual({ kind: 'reply', label: 'Reply needed', tone: 'hold', yours: true });
  });

  it('asks for a word on a fix, because "Yes, it’s fixed" closes it', () => {
    expect(nextAction('resolved')).toMatchObject({ kind: 'confirm', label: 'Confirm it’s fixed', yours: true });
  });

  it('says plainly when nothing is needed — never "Nothing to do. We’ll update you"', () => {
    for (const state of ['new', 'in_progress', 'reopened', 'pending_third_party', 'pending_approval', 'awaiting_parts_l3']) {
      expect(nextAction(state), state).toMatchObject({ kind: 'none', label: 'No action needed', yours: false });
    }
  });

  it('says nothing at all about a request that is over', () => {
    expect(nextAction('closed').label).toBeNull();
    expect(nextAction('cancelled').label).toBeNull();
  });

  it('marks exactly two canonical states as the requester’s to move', () => {
    expect(CANONICAL_STATES.filter((state) => nextAction(state).yours).sort()).toEqual(['pending_requester', 'resolved']);
  });

  it('pins the requester’s rows first and keeps each half in its order', () => {
    const rows = [
      { id: 'a', status: 'in_progress' },
      { id: 'b', status: 'resolved' },
      { id: 'c', status: 'new' },
      { id: 'd', status: 'pending_requester' },
    ];
    expect(yoursFirst(rows).map((row) => row.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(yoursFirst([])).toEqual([]);
  });
});

describe('where a request has got to (the four-step progress)', () => {
  it('has four steps, the same for every request', () => {
    expect(PROGRESS_STEPS).toEqual(['Received', 'Being worked on', 'Resolved', 'Closed']);
  });

  it('places every canonical state on one of them', () => {
    for (const state of CANONICAL_STATES) {
      const progress = progressOf(state);
      expect(progress.current, state).toBeGreaterThanOrEqual(0);
      expect(progress.current, state).toBeLessThan(PROGRESS_STEPS.length);
    }
  });

  it('names who a paused request is waiting for on the step itself', () => {
    expect(progressOf('pending_requester')).toEqual({ current: 1, currentLabel: 'Waiting for you' });
    expect(progressOf('pending_approval')).toEqual({ current: 1, currentLabel: 'Waiting for approval' });
    expect(progressOf('pending_third_party')).toEqual({ current: 1, currentLabel: 'Waiting on a supplier' });
  });

  it('ends a withdrawn request on the last step, named for what happened', () => {
    expect(progressOf('cancelled')).toEqual({ current: 3, currentLabel: 'Cancelled' });
    expect(progressOf('new').current).toBe(0);
    expect(progressOf('resolved').current).toBe(2);
    expect(progressOf('awaiting_parts_l3').current).toBe(1);
  });
});

describe('a glyph for a service (catalogue/icons.ts)', () => {
  it('recognises the guided tiles’ two topics from the words tenants use', () => {
    expect(topicFor('Access & accounts')?.id).toBe('access');
    expect(topicFor('Passwords and MFA')?.id).toBe('access');
    expect(topicFor('Devices & equipment')?.id).toBe('devices');
    expect(topicFor('Laptops')?.id).toBe('devices');
    expect(SERVICE_TOPICS.slice(0, 2).map((topic) => topic.label)).toEqual(['Access & accounts', 'Devices & equipment']);
  });

  it('matches whole words only, whatever the case or accents', () => {
    expect(topicFor('Apps')?.id).toBe('software');
    expect(topicFor('Happiness survey')).toBeNull();
    expect(topicFor('ÉQUIPEMENT')?.id).toBe('devices');
  });

  it('falls back to the summary, then to a neutral grid rather than a guess', () => {
    expect(serviceIcon('Workplace', 'A new laptop for a starter')).toBe('assets');
    expect(serviceIcon('Facilities', null, undefined)).toBe(DEFAULT_SERVICE_ICON);
  });

  it('sends a guided tile to the matching service, or to the catalogue filtered by the topic', () => {
    const services = [
      { key: 'workplace', name: 'Workplace' },
      { key: 'identity', name: 'Identity & access' },
    ];
    expect(topicHref('access', services)).toBe('/catalogue#identity');
    expect(topicHref('devices', services)).toBe('/catalogue?q=device');
    expect(topicHref('nothing-like-it', services)).toBe('/catalogue');
  });
});
