import { describe, expect, it } from 'vitest';
import { buildEvalContext } from '../logic.js';
import type { FormDefinition } from '../schema.js';
import { DETAILS_STEP_ID, formSteps, formatAnswer, stepAnswers, stepFields, visibleSteps } from '../steps.js';

/*
 * How a definition divides into steps (SPEC §4.4): loose questions first,
 * named after the item, then one step per top-level section; hidden sections
 * skipped; answers read back as a sentence would say them.
 */

const definition: FormDefinition = {
  key: 'access.request',
  version: 2,
  title: 'System access',
  schema: {
    type: 'object',
    properties: {
      system: { type: 'string', title: 'System', enum: ['crm', 'finance'] },
      level: { type: 'string', title: 'Access level' },
      until: { type: 'string', title: 'Until', format: 'date' },
      justification: { type: 'string', title: 'Why do you need it?' },
      manager: { type: 'string', title: 'Approving manager' },
      urgent: { type: 'boolean', title: 'This is urgent' },
      seats: { type: 'integer', title: 'Seats' },
      tools: { type: 'array', title: 'Tools', items: { type: 'string', enum: ['vpn', 'mfa'] } },
    },
    required: ['system'],
  },
  ui: {
    elements: [
      { kind: 'field', field: 'system', control: 'select', options: [{ value: 'crm', label: 'CRM' }, { value: 'finance', label: 'Finance ledger' }] },
      {
        kind: 'section',
        id: 'access',
        title: 'Access details',
        elements: [
          { kind: 'field', field: 'level', control: 'text' },
          { kind: 'field', field: 'until', control: 'date' },
        ],
      },
      {
        kind: 'section',
        id: 'finance',
        title: 'Finance approval',
        visibleWhen: { eq: [{ var: 'form.system' }, 'finance'] },
        elements: [
          { kind: 'field', field: 'justification', control: 'longtext' },
          { kind: 'field', field: 'manager', control: 'user' },
        ],
      },
      // A loose question after the sections still belongs to the first step.
      { kind: 'field', field: 'urgent', control: 'checkbox' },
      { kind: 'field', field: 'seats', control: 'number' },
      { kind: 'field', field: 'tools', control: 'multiselect', options: [{ value: 'vpn', label: 'VPN' }, { value: 'mfa', label: 'Authenticator' }] },
    ],
  },
};

const context = (values: Record<string, unknown> = {}) => buildEvalContext(values as never);

describe('formSteps', () => {
  it('makes the loose questions a first step named after the item, then one step per section', () => {
    const { steps, lead } = formSteps(definition, 'System access');
    expect(lead).toEqual([]);
    expect(steps.map((step) => [step.id, step.title])).toEqual([
      [DETAILS_STEP_ID, 'System access'],
      ['access', 'Access details'],
      ['finance', 'Finance approval'],
    ]);
    expect(steps[0]?.elements.map((element) => (element.kind === 'field' ? element.field : element.kind))).toEqual(['system', 'urgent', 'seats', 'tools']);
  });

  it('lets loose instructions introduce the first shown step rather than be a step of their own', () => {
    const onlyInstructions: FormDefinition = {
      ...definition,
      ui: {
        elements: [
          { kind: 'instruction', id: 'intro', content: [{ type: 'paragraph', content: [{ text: 'Approval takes two days.' }] }] },
          ...definition.ui.elements.filter((element) => element.kind === 'section'),
        ],
      },
    };
    const steps = visibleSteps(onlyInstructions, context(), 'System access');
    expect(steps.map((step) => step.id)).toEqual(['access']);
    expect(steps[0]?.elements[0]?.kind).toBe('instruction');
  });

  it('makes a form without sections one step', () => {
    const flat: FormDefinition = { ...definition, ui: { elements: definition.ui.elements.filter((element) => element.kind !== 'section') } };
    expect(visibleSteps(flat, context(), 'System access').map((step) => step.id)).toEqual([DETAILS_STEP_ID]);
  });
});

describe('visibleSteps', () => {
  it('skips a step whose section the answers hide, and shows it when they reveal it', () => {
    expect(visibleSteps(definition, context({ system: 'crm' }), 'x').map((step) => step.id)).toEqual([DETAILS_STEP_ID, 'access']);
    expect(visibleSteps(definition, context({ system: 'finance' }), 'x').map((step) => step.id)).toEqual([DETAILS_STEP_ID, 'access', 'finance']);
  });

  it('lists a step’s visible questions in order', () => {
    const [details] = visibleSteps(definition, context(), 'x');
    expect(stepFields(details!, context()).map((field) => field.field)).toEqual(['system', 'urgent', 'seats', 'tools']);
  });
});

describe('answers for the review', () => {
  const format = { locale: 'en-GB', userName: (id: string) => (id === 'u-1' ? 'Ada Lovelace' : id) };

  it('reads each answer as a sentence would say it', () => {
    const values = { system: 'finance', until: '2026-12-31', urgent: false, seats: 1200, tools: ['vpn', 'mfa'], manager: 'u-1' };
    const ctx = context(values);
    const [details, access, finance] = visibleSteps(definition, ctx, 'System access');
    expect(stepAnswers(details!, definition, values, ctx, format)).toEqual([
      { field: 'system', label: 'System', text: 'Finance ledger' },
      { field: 'urgent', label: 'This is urgent', text: 'No' },
      { field: 'seats', label: 'Seats', text: '1,200' },
      { field: 'tools', label: 'Tools', text: 'VPN and Authenticator' },
    ]);
    expect(stepAnswers(access!, definition, values, ctx, format)).toEqual([{ field: 'until', label: 'Until', text: '31 Dec 2026' }]);
    expect(stepAnswers(finance!, definition, values, ctx, format)).toEqual([{ field: 'manager', label: 'Approving manager', text: 'Ada Lovelace' }]);
  });

  it('leaves out questions nobody answered', () => {
    const ctx = context({});
    const [details] = visibleSteps(definition, ctx, 'x');
    expect(stepAnswers(details!, definition, {}, ctx, format)).toEqual([]);
  });

  it('says "Yes" for a ticked box and keeps an unknown option as its value', () => {
    const urgent = definition.ui.elements.find((element) => element.kind === 'field' && element.field === 'urgent');
    const system = definition.ui.elements[0];
    if (urgent?.kind !== 'field' || system?.kind !== 'field') throw new Error('fixture');
    expect(formatAnswer(urgent, definition, true, format)).toBe('Yes');
    expect(formatAnswer(system, definition, 'hr', format)).toBe('hr');
  });
});
