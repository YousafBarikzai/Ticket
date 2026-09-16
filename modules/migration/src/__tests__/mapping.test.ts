import { describe, expect, it } from 'vitest';
import { mapRecord, parseDate, parseMapping, slugify } from '../domain/mapping.js';

/**
 * Every tool calls things something different, so the mapping is
 * configuration. What these prove is the refusals: nothing is guessed, a
 * mapping that names a field the entity does not have is refused before it
 * runs, and a bad row is reported by itself rather than taking the file
 * with it.
 */

describe('checking a mapping before it runs', () => {
  it('refuses a field the entity does not have, naming the ones it does', () => {
    expect(() => parseMapping('users', { externalKeyFrom: 'id', fields: { email: 'email', displayName: 'name', nickname: 'nick' } })).toThrow(/nickname/);
    expect(() => parseMapping('users', { externalKeyFrom: 'id', fields: { email: 'email', displayName: 'name', nickname: 'nick' } })).toThrow(/displayName/);
  });

  it('refuses a mapping missing a required field', () => {
    expect(() => parseMapping('tickets', { externalKeyFrom: 'id', fields: { title: 'subject' } })).toThrow(/status/);
  });

  it('accepts a required field as a constant', () => {
    expect(() => parseMapping('tickets', { externalKeyFrom: 'id', fields: { title: 'subject', createdAt: 'opened' }, constants: { status: 'closed' } })).not.toThrow();
  });

  it('lets only tickets carry comments, and comments need a body', () => {
    expect(() => parseMapping('users', { externalKeyFrom: 'id', fields: { email: 'e', displayName: 'n' }, comments: { from: 'c', fields: { body: 'b' } } })).toThrow(/only a tickets mapping/);
    expect(() => parseMapping('tickets', { externalKeyFrom: 'id', fields: { title: 't', status: 's', createdAt: 'c' }, comments: { from: 'c', fields: { author: 'a' } } })).toThrow(/body/);
  });
});

const ticketMapping = parseMapping('tickets', {
  externalKeyFrom: 'sys_id',
  fields: {
    reference: 'number',
    title: 'short_description',
    status: 'state',
    priority: 'priority',
    requester: ['caller_id.value', 'caller_email'],
    createdAt: 'opened_at',
    resolvedAt: 'resolved_at',
  },
  constants: { type: 'incident' },
  valueMaps: { status: { '6': 'resolved', '7': 'closed' }, priority: { '1': 'P1', '2': 'P2' } },
  comments: {
    from: 'journal',
    externalKeyFrom: 'id',
    fields: { body: 'value', author: 'by', visibility: 'element' },
    valueMaps: { visibility: { comments: 'public', work_notes: 'internal' } },
  },
});

describe('reading a row', () => {
  it('maps a row through the value tables, reads the dates strictly, and keeps the reference candidates in order', () => {
    const row = mapRecord('tickets', ticketMapping, {
      sys_id: 'abc',
      number: 'INC0001',
      short_description: 'Printer',
      state: '6',
      priority: '2',
      caller_id: { value: 'user-sys-id' },
      caller_email: 'a@example.test',
      opened_at: '2024-01-05 10:22:33',
      resolved_at: '2024-01-06T09:00:00Z',
      journal: [{ id: 'j1', value: 'Looking', by: 'agent', element: 'work_notes' }],
    });
    expect(row.problems).toEqual([]);
    expect(row.externalKey).toBe('abc');
    expect(row.values.status).toBe('resolved');
    expect(row.values.priority).toBe('P2');
    expect(row.values.type).toBe('incident');
    expect(row.values.requester).toEqual({ candidates: ['user-sys-id', 'a@example.test'] });
    expect((row.values.createdAt as Date).toISOString()).toBe('2024-01-05T10:22:33.000Z');
    expect(row.comments).toHaveLength(1);
    expect(row.comments[0]!.values.visibility).toBe('internal');
    expect(row.comments[0]!.externalKey).toBe('j1');
  });

  it('refuses a status the table does not name rather than guessing', () => {
    const row = mapRecord('tickets', ticketMapping, { sys_id: 'abc', short_description: 'x', state: '3', opened_at: '2024-01-05T00:00:00Z' });
    expect(row.problems.join(' ')).toMatch(/status "3" is not in valueMaps.status/);
  });

  it('refuses a date it cannot read, and a row with no external key', () => {
    const row = mapRecord('tickets', ticketMapping, { short_description: 'x', state: '6', opened_at: '05/01/2024' });
    expect(row.problems.join(' ')).toMatch(/nothing to remember this row by/);
    expect(row.problems.join(' ')).toMatch(/not a date/);
  });

  it('keeps a bad comment as the comment\'s problem, not the ticket\'s', () => {
    const row = mapRecord('tickets', ticketMapping, {
      sys_id: 'abc',
      short_description: 'x',
      state: '6',
      opened_at: '2024-01-05T00:00:00Z',
      journal: [{ id: 'j1', by: 'agent', element: 'comments' }],
    });
    expect(row.problems).toEqual([]);
    expect(row.comments[0]!.problems.join(' ')).toMatch(/no value for body/);
  });

  it('joins several paths for a text field and reads a list from a string or an array', () => {
    const mapping = parseMapping('users', { externalKeyFrom: 'id', fields: { email: 'email', displayName: ['first', 'last'], teams: 'groups' } });
    expect(mapRecord('users', mapping, { id: '1', email: 'a@b.c', first: 'Ada', last: 'Lovelace', groups: 'desk, network' }).values).toMatchObject({ displayName: 'Ada Lovelace', teams: ['desk', 'network'] });
    expect(mapRecord('users', mapping, { id: '1', email: 'a@b.c', first: 'Ada', groups: ['desk'] }).values).toMatchObject({ displayName: 'Ada', teams: ['desk'] });
  });

  it('matches a value-map key without minding the case, because people type them', () => {
    const mapping = parseMapping('tickets', { externalKeyFrom: 'id', fields: { title: 't', status: 's', createdAt: 'c' }, valueMaps: { status: { Resolved: 'resolved' } } });
    expect(mapRecord('tickets', mapping, { id: '1', t: 'x', s: 'RESOLVED', c: '2024-01-01' }).values.status).toBe('resolved');
  });
});

describe('dates', () => {
  it('reads ISO 8601 and the ServiceNow form, and nothing else', () => {
    expect(parseDate('2024-01-05')?.toISOString()).toBe('2024-01-05T00:00:00.000Z');
    expect(parseDate('2024-01-05T10:22:33+01:00')?.toISOString()).toBe('2024-01-05T09:22:33.000Z');
    expect(parseDate('2024-01-05 10:22:33')?.toISOString()).toBe('2024-01-05T10:22:33.000Z');
    expect(parseDate('5 Jan 2024')).toBeUndefined();
    expect(parseDate('1704450153')).toBeUndefined();
  });
});

describe('a key from a name', () => {
  it('makes something the team and service schemas accept', () => {
    expect(slugify('Service Desk (EMEA)')).toBe('service-desk-emea');
    expect(slugify('Réseau & Télécoms')).toBe('reseau-telecoms');
    expect(slugify('3rd line')).toBe('x-3rd-line');
  });
});
