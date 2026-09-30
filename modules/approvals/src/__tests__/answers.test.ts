import { describe, expect, it } from 'vitest';
import { labelAnswers, userIdsIn } from '../domain/answers.js';

/**
 * How a catalogue submission reads to the person approving it.
 *
 * The approver cannot fetch the form to translate keys and option values
 * themselves, so whatever this leaves untranslated is what they decide on. The
 * cases that matter are the ones where it could quietly show less than the
 * requester said: an answer the document does not mention, a malformed
 * document, and a person named only by id.
 */

const MANAGER = '6f1c9a4e-7b3d-4f2a-9c1e-2d5b8a7f0e13';

const document = {
  key: 'system-access',
  version: 3,
  schema: {
    type: 'object',
    properties: {
      system: { type: 'string', title: 'System' },
      accessLevel: { type: 'string', enum: ['read', 'admin'] },
      modules: { type: 'array', items: { type: 'string' } },
      urgent: { type: 'boolean', title: 'Is this urgent?' },
      seats: { type: 'number' },
      manager: { type: 'string', title: 'Who approves?' },
      reason: { type: 'string', title: 'Why do you need it?' },
    },
  },
  ui: {
    elements: [
      { kind: 'instruction', id: 'intro', content: [] },
      {
        kind: 'section',
        id: 'what',
        title: 'What you need',
        elements: [
          { kind: 'field', field: 'system', control: 'select', options: [{ value: 'crm', label: 'Customer CRM' }] },
          {
            kind: 'field',
            field: 'accessLevel',
            control: 'select',
            label: 'Access level',
            options: [
              { value: 'read', label: 'Read only' },
              { value: 'admin', label: 'Administrator' },
            ],
          },
          {
            kind: 'field',
            field: 'modules',
            control: 'multiselect',
            label: 'Modules',
            options: [
              { value: 'sales', label: 'Sales' },
              { value: 'billing', label: 'Billing' },
            ],
          },
        ],
      },
      { kind: 'field', field: 'urgent', control: 'checkbox' },
      { kind: 'field', field: 'seats', control: 'number', label: 'Seats' },
      { kind: 'field', field: 'manager', control: 'user' },
      { kind: 'field', field: 'reason', control: 'longtext', label: '  ' },
    ],
  },
};

describe('labelAnswers', () => {
  it('puts the answers in the order the form asked them, with the questions as asked', () => {
    const answers = {
      reason: 'New starter',
      seats: 2,
      urgent: false,
      modules: ['billing', 'sales'],
      accessLevel: 'admin',
      system: 'crm',
      manager: MANAGER,
    };
    const labelled = labelAnswers(document, answers, new Map([[MANAGER, 'Priya Lead']]));

    expect(labelled.map((answer) => answer.field)).toEqual([
      'system',
      'accessLevel',
      'modules',
      'urgent',
      'seats',
      'manager',
      'reason',
    ]);
    expect(labelled).toEqual([
      { field: 'system', label: 'System', value: 'crm', display: 'Customer CRM' },
      { field: 'accessLevel', label: 'Access level', value: 'admin', display: 'Administrator' },
      { field: 'modules', label: 'Modules', value: ['billing', 'sales'], display: 'Billing, Sales' },
      { field: 'urgent', label: 'Is this urgent?', value: false, display: 'No' },
      { field: 'seats', label: 'Seats', value: 2, display: '2' },
      { field: 'manager', label: 'Who approves?', value: MANAGER, display: 'Priya Lead' },
      // A blank label falls back to the schema title rather than showing nothing.
      { field: 'reason', label: 'Why do you need it?', value: 'New starter', display: 'New starter' },
    ]);
  });

  it('keeps an answer the document does not mention, under its property name', () => {
    // Dropping it would have the approver decide on less than the requester said.
    const labelled = labelAnswers(document, { system: 'crm', costCentre: 'CC-104' });
    expect(labelled.at(-1)).toEqual({ field: 'costCentre', label: 'costCentre', value: 'CC-104', display: 'CC-104' });
  });

  it('shows a value that is not one of the options as it was stored', () => {
    expect(labelAnswers(document, { accessLevel: 'owner' })[0]!.display).toBe('owner');
  });

  it('shows a person it cannot name by their id, not as blank', () => {
    expect(labelAnswers(document, { manager: MANAGER })[0]!.display).toBe(MANAGER);
  });

  it('leaves an unanswered question empty', () => {
    expect(labelAnswers(document, { reason: null })[0]).toEqual({
      field: 'reason',
      label: 'Why do you need it?',
      value: null,
      display: '',
    });
  });

  it('falls back to property names when the document is missing or malformed', () => {
    const answers = { system: 'crm', urgent: true };
    for (const broken of [null, undefined, 'not a form', { ui: { elements: 'nope' } }, { ui: { elements: [null, 7] } }]) {
      expect(labelAnswers(broken, answers)).toEqual([
        { field: 'system', label: 'system', value: 'crm', display: 'crm' },
        { field: 'urgent', label: 'urgent', value: true, display: 'Yes' },
      ]);
    }
  });

  it('returns nothing for answers that are not an object', () => {
    expect(labelAnswers(document, null)).toEqual([]);
    expect(labelAnswers(document, ['crm'])).toEqual([]);
  });
});

describe('userIdsIn', () => {
  it('finds the people named in user answers, and only there', () => {
    const other = '0b8f2c1d-3e4a-4b5c-8d6e-7f9012345678';
    expect(userIdsIn(document, { manager: MANAGER, system: other })).toEqual([MANAGER]);
    expect(userIdsIn(document, { manager: [MANAGER, other, ''] })).toEqual([MANAGER, other]);
    expect(userIdsIn(null, { manager: MANAGER })).toEqual([]);
  });
});
