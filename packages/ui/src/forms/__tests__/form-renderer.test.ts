// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupDocument, click, render, selectOption, settle, typeInto } from '../../web/__tests__/support/render.js';
import { FormHarness } from './support/fixtures.js';
import type { FormDefinition } from '../schema.js';

afterEach(() => cleanupDocument());

const definition: FormDefinition = {
  key: 'access.request',
  version: 1,
  schema: {
    type: 'object',
    properties: {
      system: { type: 'string', title: 'System', enum: ['crm', 'finance'] },
      justification: { type: 'string', title: 'Justification', description: 'Why do you need access?' },
      manager: { type: 'string', title: 'Approving manager' },
      urgent: { type: 'boolean', title: 'This is urgent' },
    },
    required: ['system'],
  },
  ui: {
    elements: [
      { kind: 'field', field: 'system', control: 'select' },
      {
        kind: 'section',
        id: 'finance',
        title: 'Finance system details',
        visibleWhen: { eq: [{ var: 'form.system' }, 'finance'] },
        elements: [
          { kind: 'field', field: 'justification', control: 'longtext', requiredWhen: { always: true } },
          { kind: 'field', field: 'manager', control: 'user' },
        ],
      },
      { kind: 'field', field: 'urgent', control: 'checkbox' },
    ],
  },
};

const labelFor = (control: Element | null): string | null => {
  if (!control) return null;
  const label = document.querySelector(`label[for="${control.id}"]`);
  return label?.textContent?.replace('*', '').trim() ?? null;
};

describe('FormRenderer', () => {
  it('renders a labelled control for each visible field and hides the rest', () => {
    render(createElement(FormHarness, { definition }));
    const select = document.querySelector<HTMLSelectElement>('select');
    expect(labelFor(select)).toBe('System');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelector('[role="combobox"]')).toBeNull();
    // A checkbox labels itself, so it is not wrapped in a second label.
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')).not.toBeNull();
  });

  it('reveals a conditional section when the answer it depends on changes', () => {
    render(createElement(FormHarness, { definition }));
    const select = document.querySelector<HTMLSelectElement>('select');
    if (!select) throw new Error('no select');

    selectOption(select, 'finance');

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea');
    expect(labelFor(textarea)).toBe('Justification');
    expect(document.querySelector('section')?.textContent).toContain('Finance system details');
    // requiredWhen has fired, so the control says so to assistive technology.
    expect(textarea?.getAttribute('aria-required')).toBe('true');
  });

  it('wires hints to their control with aria-describedby', () => {
    render(createElement(FormHarness, { definition, initialValues: { system: 'finance' } }));
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea');
    const describedBy = textarea?.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('Why do you need access?');
  });

  it('renders a user field as a combobox over the injected loader', async () => {
    const loadUsers = async (query: string): Promise<readonly { id: string; name: string; detail: string }[]> => [
      { id: 'u-1', name: `Ada Lovelace (${query})`, detail: 'ada@example.test' },
    ];
    render(createElement(FormHarness, { definition, initialValues: { system: 'finance' }, loadUsers }));

    const combobox = document.querySelector<HTMLInputElement>('[role="combobox"]');
    if (!combobox) throw new Error('no combobox');
    expect(combobox.getAttribute('aria-expanded')).toBe('false');
    expect(combobox.getAttribute('aria-autocomplete')).toBe('list');

    typeInto(combobox, 'ada');
    expect(combobox.getAttribute('aria-expanded')).toBe('true');

    // The loader is debounced; wait for it to settle and the listbox to fill.
    await settle(300);
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]?.textContent).toContain('Ada Lovelace (ada)');
  });

  it('keeps the answers in one object, so conditions see every change', () => {
    const seen: Record<string, unknown>[] = [];
    render(createElement(FormHarness, { definition, onValues: (values) => seen.push({ ...values }) }));

    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) throw new Error('no checkbox');
    click(checkbox);

    expect(seen.at(-1)).toEqual({ urgent: true });
  });
});
