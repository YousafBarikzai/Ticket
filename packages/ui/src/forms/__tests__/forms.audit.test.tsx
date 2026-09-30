// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { afterEach, describe, it } from 'vitest';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, click, render, settle } from '../../web/__tests__/support/render.js';
import { FormRenderer, type FormRendererProps } from '../FormRenderer.js';
import type { FormDefinition, FormValues } from '../schema.js';

/*
 * `FormRenderer`, read by axe (SPEC §8.0 rule 5): the single page with
 * every control, read-only answers, instructions and errors; and steps mode
 * on a step whose check failed and on the review.
 */

afterEach(() => cleanupDocument());

const definition: FormDefinition = {
  key: 'laptop',
  version: 3,
  title: 'Request a laptop',
  schema: {
    type: 'object',
    properties: {
      reason: { type: 'string', title: 'Why do you need a laptop?', description: 'A sentence is enough.' },
      model: { type: 'string', title: 'Model', enum: ['standard', 'engineering'] },
      neededBy: { type: 'string', title: 'Needed by', format: 'date' },
      seats: { type: 'integer', title: 'Seats', minimum: 1 },
      accessories: { type: 'array', title: 'Accessories', items: { type: 'string', enum: ['dock', 'mouse'] } },
      beneficiary: { type: 'string', title: 'Who is it for?' },
      agree: { type: 'boolean', title: 'I will return my old laptop', description: 'Within two weeks.' },
      costCentre: { type: 'string', title: 'Cost centre' },
    },
    required: ['reason', 'model'],
  },
  ui: {
    elements: [
      { kind: 'instruction', id: 'intro', intent: 'info', content: [{ type: 'paragraph', content: [{ text: 'Laptops arrive within five working days. ' }, { text: 'Read the policy', href: 'https://example.com/policy' }] }] },
      { kind: 'field', field: 'reason', control: 'longtext' },
      { kind: 'field', field: 'model', control: 'select' },
      { kind: 'field', field: 'agree', control: 'checkbox' },
      { kind: 'field', field: 'costCentre', control: 'text', readOnlyWhen: { always: true } },
      {
        kind: 'section',
        id: 'delivery',
        title: 'Delivery',
        description: 'Where and when.',
        elements: [
          { kind: 'field', field: 'neededBy', control: 'date' },
          { kind: 'field', field: 'seats', control: 'number' },
          { kind: 'field', field: 'accessories', control: 'multiselect' },
          { kind: 'field', field: 'beneficiary', control: 'user' },
          { kind: 'instruction', id: 'warn', intent: 'warning', content: [{ type: 'paragraph', content: [{ text: 'Engineering models need approval.' }] }] },
        ],
      },
    ],
  },
};

function Harness(props: Partial<FormRendererProps> & { readonly initial?: FormValues }): ReactNode {
  const [values, setValues] = useState<FormValues>(props.initial ?? {});
  return <FormRenderer definition={definition} {...props} values={values} onChange={setValues} loadUsers={async () => []} />;
}

describe('FormRenderer audit', () => {
  it('single page: every control, read-only answers, instructions and errors', async () => {
    render(
      <Harness
        initial={{ costCentre: 'CC-104', model: 'standard', accessories: ['dock'] }}
        errors={{ reason: 'Why do you need a laptop? is required', agree: 'Tick this to continue', accessories: 'Choose one of the available options' }}
      />,
    );
    await settle();
    await expectNoViolations(document.body);
  });

  it('single page: read-only choices, dates, groups and boxes', async () => {
    const readOnly: FormDefinition = {
      ...definition,
      ui: {
        elements: (['model', 'neededBy', 'accessories', 'agree', 'beneficiary'] as const).map((field) => ({
          kind: 'field' as const,
          field,
          control: field === 'model' ? ('select' as const) : field === 'neededBy' ? ('date' as const) : field === 'accessories' ? ('multiselect' as const) : field === 'agree' ? ('checkbox' as const) : ('user' as const),
          readOnlyWhen: { always: true },
        })),
      },
    };
    render(
      <FormRenderer
        definition={readOnly}
        values={{ model: 'engineering', neededBy: '2026-10-01', accessories: ['mouse'], agree: true, beneficiary: 'u-1' }}
        userLabels={{ 'u-1': 'Ada Lovelace' }}
        onChange={() => undefined}
      />,
    );
    await expectNoViolations(document.body);
  });

  it('steps: a step whose check failed', async () => {
    render(<Harness mode="steps" title="Laptop" />);
    const next = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Continue')!;
    click(next);
    await settle();
    await expectNoViolations(document.body);
  });

  it('steps: the review', async () => {
    render(<Harness mode="steps" title="Laptop" submitLabel="Request a laptop" initial={{ reason: 'Mine broke', model: 'standard', agree: true, neededBy: '2026-10-01', accessories: ['dock', 'mouse'] }} />);
    for (let step = 0; step < 2; step += 1) {
      const next = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Continue')!;
      click(next);
    }
    await settle();
    await expectNoViolations(document.body);
  });
});
