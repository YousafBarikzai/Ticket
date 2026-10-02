import { describe, expect, it } from 'vitest';
import { submissionValues, type FormDefinition, type FormValues, type UiElement } from '@itsm/contracts/forms';
import { NO_ANSWERS_DESCRIPTION, UNKNOWN_PERSON, describeAnswers, humaniseKey, userAnswerIds } from '../domain/describe-answers.js';

/**
 * A catalogue request's description is what an agent reads first (A4 §5.3).
 * It must read the way the requester saw the form — labels, option labels,
 * names, dates — in the form's order, and say only what was answered.
 */

const MANAGER = '0199a2b4-7c1d-7e2f-9a3b-4c5d6e7f8091';
const NAMES: ReadonlyMap<string, string> = new Map([[MANAGER, 'Priya Shah']]);

function form(properties: FormDefinition['schema']['properties'], elements: readonly UiElement[]): FormDefinition {
  return { key: 'test-form', version: 1, schema: { type: 'object', properties }, ui: { elements } };
}

const LAPTOP = form(
  {
    model: { type: 'string', title: 'Laptop model', enum: ['standard', 'performance'] },
    reason: { type: 'string', title: 'Reason' },
    neededBy: { type: 'string', format: 'date' },
    deliverTo: { type: 'string', title: 'Deliver to' },
  },
  [
    {
      kind: 'field',
      field: 'model',
      control: 'select',
      label: 'Model',
      options: [
        { value: 'standard', label: 'Standard (Dell Latitude 5450)' },
        { value: 'performance', label: 'Performance (Dell Precision 3591)' },
      ],
    },
    { kind: 'field', field: 'reason', control: 'text' },
    { kind: 'field', field: 'neededBy', control: 'date' },
    { kind: 'field', field: 'deliverTo', control: 'text', label: 'Deliver to' },
  ],
);

describe('describeAnswers', () => {
  it('reads the A4 laptop example the way the requester saw it', () => {
    const answers: FormValues = {
      model: 'performance',
      reason: 'Power BI models for the month-end pack',
      neededBy: '2026-10-12',
      deliverTo: 'London HQ',
    };
    expect(describeAnswers(LAPTOP, answers, NAMES)).toBe(
      [
        'Model: Performance (Dell Precision 3591)',
        'Reason: Power BI models for the month-end pack',
        'Needed by: 12 October 2026',
        'Deliver to: London HQ',
      ].join('\n'),
    );
  });

  it('1 · labels the element first, then the schema title, then the key made readable', () => {
    const definition = form(
      {
        labelled: { type: 'string', title: 'Schema title' },
        titled: { type: 'string', title: 'Title from the schema' },
        costCentre: { type: 'string' },
      },
      [
        { kind: 'field', field: 'labelled', control: 'text', label: 'Element label' },
        { kind: 'field', field: 'titled', control: 'text' },
        { kind: 'field', field: 'costCentre', control: 'text' },
      ],
    );
    expect(describeAnswers(definition, { labelled: 'a', titled: 'b', costCentre: 'FIN-204' }, NAMES)).toBe(
      'Element label: a\nTitle from the schema: b\nCost centre: FIN-204',
    );
  });

  it('2 · prints option labels, one or several, and an unlisted value as it is', () => {
    const definition = form(
      { apps: { type: 'array', items: { type: 'string' } }, level: { type: 'string' } },
      [
        {
          kind: 'field',
          field: 'apps',
          control: 'multiselect',
          label: 'Applications',
          options: [
            { value: 'teams', label: 'Microsoft Teams' },
            { value: 'pbi', label: 'Power BI' },
          ],
        },
        { kind: 'field', field: 'level', control: 'select', label: 'Level', options: [{ value: 'read', label: 'Read only' }] },
      ],
    );
    expect(describeAnswers(definition, { apps: ['pbi', 'teams', 'visio'], level: 'read' }, NAMES)).toBe(
      'Applications: Power BI, Microsoft Teams, visio\nLevel: Read only',
    );
    expect(describeAnswers(definition, { level: 'legacy' }, NAMES)).toBe('Level: legacy');
  });

  it('3 · says Yes or No for a checkbox, including an explicit No', () => {
    const definition = form(
      { remote: { type: 'boolean', title: 'Works remotely' }, laptop: { type: 'boolean', title: 'Has a laptop' } },
      [
        { kind: 'field', field: 'remote', control: 'checkbox' },
        { kind: 'field', field: 'laptop', control: 'checkbox' },
      ],
    );
    expect(describeAnswers(definition, { remote: true, laptop: false }, NAMES)).toBe('Works remotely: Yes\nHas a laptop: No');
  });

  it('4 · writes dates out in British English, never shifted by a time zone', () => {
    const definition = form(
      { start: { type: 'string', format: 'date', title: 'Start date' }, typed: { type: 'string', format: 'date', title: 'Typed' } },
      [
        { kind: 'field', field: 'start', control: 'date' },
        // A date-formatted property behind a plain text control is still a date.
        { kind: 'field', field: 'typed', control: 'text' },
      ],
    );
    // 1 January at midnight is the day most likely to move under a zone shift.
    expect(describeAnswers(definition, { start: '2027-01-01', typed: '2026-03-29' }, NAMES)).toBe(
      'Start date: 1 January 2027\nTyped: 29 March 2026',
    );
    // An instant keeps its calendar date; anything that is not a real date is printed as it is.
    expect(describeAnswers(definition, { start: '2026-10-25T23:30:00-01:00' }, NAMES)).toBe('Start date: 25 October 2026');
    expect(describeAnswers(definition, { start: '2026-02-30' }, NAMES)).toBe('Start date: 2026-02-30');
    expect(describeAnswers(definition, { start: 'next Tuesday' }, NAMES)).toBe('Start date: next Tuesday');
  });

  it('5 · names a person, and says so when they cannot be found', () => {
    const definition = form(
      { manager: { type: 'string' }, approver: { type: 'string' } },
      [
        { kind: 'field', field: 'manager', control: 'user', label: 'Line manager' },
        { kind: 'field', field: 'approver', control: 'user', label: 'Budget holder' },
      ],
    );
    const answers = { manager: MANAGER.toUpperCase(), approver: '0199a2b4-0000-7000-8000-000000000000' };
    expect(describeAnswers(definition, answers, NAMES)).toBe(`Line manager: Priya Shah\nBudget holder: ${UNKNOWN_PERSON}`);
    expect(describeAnswers(definition, answers, NAMES)).not.toContain('0199');
  });

  it('6 · follows the form\'s order, not the order of the answers object', () => {
    const answers: FormValues = { deliverTo: 'Leeds DC', neededBy: '2026-11-02', model: 'standard' };
    expect(describeAnswers(LAPTOP, answers, NAMES)).toBe(
      'Model: Standard (Dell Latitude 5450)\nNeeded by: 2 November 2026\nDeliver to: Leeds DC',
    );
  });

  it('7 · walks nested sections depth-first and skips instructions', () => {
    const definition = form(
      { first: { type: 'string' }, inner: { type: 'string' }, deeper: { type: 'string' }, last: { type: 'string' } },
      [
        { kind: 'instruction', id: 'intro', content: [{ type: 'paragraph', content: [{ text: 'Read me' }] }] },
        { kind: 'field', field: 'first', control: 'text' },
        {
          kind: 'section',
          id: 'outer',
          title: 'Outer',
          elements: [
            { kind: 'field', field: 'inner', control: 'text' },
            { kind: 'section', id: 'nested', title: 'Nested', elements: [{ kind: 'field', field: 'deeper', control: 'text' }] },
          ],
        },
        { kind: 'field', field: 'last', control: 'text' },
      ],
    );
    expect(describeAnswers(definition, { last: '4', deeper: '3', inner: '2', first: '1' }, NAMES)).toBe(
      'First: 1\nInner: 2\nDeeper: 3\nLast: 4',
    );
  });

  it('8 · omits a field the requester could not see, and anything the form never asked', () => {
    const definition = form(
      { level: { type: 'string', title: 'Access level' }, why: { type: 'string', title: 'Why you need it' } },
      [
        { kind: 'field', field: 'level', control: 'text' },
        { kind: 'field', field: 'why', control: 'text', visibleWhen: { ne: [{ var: 'form.level' }, 'read'] } },
      ],
    );
    // The service describes what validation accepted, which has already
    // dropped the hidden answer a stale browser sent.
    const accepted = submissionValues(definition, { level: 'read', why: 'left over from an earlier answer' });
    expect(describeAnswers(definition, accepted, NAMES)).toBe('Access level: read');
    // An answer to a question the form does not ask is not described either.
    expect(describeAnswers(definition, { level: 'read', smuggled: 'x' }, NAMES)).toBe('Access level: read');
  });

  it('9 · says where the request came from when nothing was answered', () => {
    expect(describeAnswers(LAPTOP, {}, NAMES)).toBe(NO_ANSWERS_DESCRIPTION);
    expect(describeAnswers(LAPTOP, { model: null, reason: '   ', neededBy: '' }, NAMES)).toBe('Raised from the service catalogue.');
  });

  it('puts long text under its label, set apart by blank lines', () => {
    const definition = form(
      { system: { type: 'string', title: 'System' }, why: { type: 'string', title: 'Why you need it' }, until: { type: 'string', title: 'Until' } },
      [
        { kind: 'field', field: 'system', control: 'text' },
        { kind: 'field', field: 'why', control: 'longtext' },
        { kind: 'field', field: 'until', control: 'text' },
      ],
    );
    expect(describeAnswers(definition, { system: 'Finance', why: 'Month-end close.\nI post journals.\n', until: 'March' }, NAMES)).toBe(
      'System: Finance\n\nWhy you need it:\nMonth-end close.\nI post journals.\n\nUntil: March',
    );
    expect(describeAnswers(definition, { why: 'Only this.' }, NAMES)).toBe('Why you need it:\nOnly this.');
  });

  it('never prints braces from a template, only what was answered', () => {
    // The demo build refuses a description containing `{` or `}` (V10), so a
    // label or value must never be a template placeholder left unfilled.
    expect(describeAnswers(LAPTOP, { model: 'standard', deliverTo: 'Bristol' }, NAMES)).not.toMatch(/[{}]/);
  });
});

describe('userAnswerIds', () => {
  it('collects the ids a user question was answered with, once each, and nothing else', () => {
    const definition = form(
      { manager: { type: 'string' }, team: { type: 'array' }, name: { type: 'string' } },
      [
        { kind: 'field', field: 'manager', control: 'user' },
        { kind: 'field', field: 'team', control: 'user' },
        { kind: 'field', field: 'name', control: 'text' },
      ],
    );
    expect(userAnswerIds(definition, { manager: MANAGER, team: [MANAGER.toUpperCase(), 'not-an-id'], name: MANAGER })).toEqual([MANAGER]);
    expect(userAnswerIds(definition, {})).toEqual([]);
  });
});

describe('humaniseKey', () => {
  it.each([
    ['costCentre', 'Cost centre'],
    ['needed_by', 'Needed by'],
    ['deliver-to', 'Deliver to'],
    ['VPNAccess', 'VPN access'],
    ['model', 'Model'],
    ['x', 'X'],
  ])('%s → %s', (key, expected) => {
    expect(humaniseKey(key)).toBe(expected);
  });
});
