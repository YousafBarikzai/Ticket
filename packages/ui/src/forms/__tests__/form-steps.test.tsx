// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeElement, cleanupDocument, click, focus, press, render, selectOption, settle, typeInto } from '../../web/__tests__/support/render.js';
import { FormRenderer, type FormRendererProps, type FormStepChange } from '../FormRenderer.js';
import type { FormErrors } from '../logic.js';
import type { FormDefinition, FormValues } from '../schema.js';

/*
 * `FormRenderer mode="steps"` (SPEC §4.4, §6.3): steps from sections, each
 * checked with the contract's validation before the next, a review with a
 * way back to each step, heading levels, and the API's errors taking the
 * person to the step they belong to. Single mode's changes are here too:
 * heading level, read-only fields, the checkbox's description.
 */

afterEach(() => cleanupDocument());

const definition: FormDefinition = {
  key: 'access.request',
  version: 2,
  title: 'System access',
  schema: {
    type: 'object',
    properties: {
      system: { type: 'string', title: 'System', enum: ['crm', 'finance'] },
      level: { type: 'string', title: 'Access level', description: 'Read, edit or admin.' },
      until: { type: 'string', title: 'Until', format: 'date' },
      justification: { type: 'string', title: 'Why do you need it?' },
      notes: { type: 'string', title: 'Anything else?' },
      urgent: { type: 'boolean', title: 'This is urgent', description: 'We will call you.' },
    },
    required: ['system'],
  },
  ui: {
    elements: [
      { kind: 'field', field: 'system', control: 'select', options: [{ value: 'crm', label: 'CRM' }, { value: 'finance', label: 'Finance ledger' }] },
      { kind: 'field', field: 'urgent', control: 'checkbox' },
      {
        kind: 'section',
        id: 'access',
        title: 'Access details',
        description: 'What you need and for how long.',
        elements: [
          { kind: 'field', field: 'level', control: 'text', requiredWhen: { always: true } },
          { kind: 'field', field: 'until', control: 'date' },
          {
            kind: 'section',
            id: 'nested',
            title: 'Extra detail',
            elements: [{ kind: 'field', field: 'notes', control: 'longtext' }],
          },
        ],
      },
      {
        kind: 'section',
        id: 'finance',
        title: 'Finance approval',
        visibleWhen: { eq: [{ var: 'form.system' }, 'finance'] },
        elements: [{ kind: 'field', field: 'justification', control: 'longtext', requiredWhen: { always: true } }],
      },
    ],
  },
};

type HarnessProps = Partial<FormRendererProps> & { readonly initialValues?: FormValues; readonly onValues?: (values: FormValues) => void };

/** The renderer inside the page's own form, as the portal uses it: the final button submits that form. */
function Harness({ initialValues = {}, onValues, onSubmit, ...props }: HarnessProps): ReactNode {
  const [values, setValues] = useState<FormValues>(initialValues);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <FormRenderer
        definition={definition}
        mode="steps"
        title="System access"
        submitLabel="Request System access"
        {...props}
        values={values}
        onChange={(next) => {
          setValues(next);
          onValues?.(next);
        }}
      />
    </form>
  );
}

const heading = (): HTMLElement | null => document.querySelector('.itsm-FormRenderer__stepHeading');
const button = (text: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found;
};
const control = (label: string): HTMLElement => {
  const element = [...document.querySelectorAll('label')].find((candidate) => candidate.textContent?.replace('*', '').trim() === label);
  const target = element ? document.getElementById(element.htmlFor) : null;
  if (!target) throw new Error(`no control "${label}"`);
  return target;
};

describe('FormRenderer steps', () => {
  it('turns loose questions and sections into steps, with the step in the heading', () => {
    render(<Harness />);
    expect(heading()?.tagName).toBe('H2');
    expect(heading()?.textContent).toBe('Step 1 of 3: System access');
    // The finance section is hidden until chosen, so it is not a step yet.
    const steps = [...document.querySelectorAll('.itsm-Stepper__label')].map((label) => label.firstChild?.textContent);
    expect(steps).toEqual(['System access', 'Access details', 'Review']);
    expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('33');
    // Only this step's questions are on screen.
    expect(document.querySelector('select')).not.toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('checks the step before moving on, and focuses a summary linked to the fields', () => {
    render(<Harness />);
    click(button('Continue'));

    const summary = document.querySelector('.itsm-FormErrorSummary');
    expect(activeElement()).toBe(summary);
    const link = summary?.querySelector('a');
    expect(link?.textContent).toBe('System is required');
    expect(link?.getAttribute('href')).toBe(`#${control('System').id}`);
    expect(control('System').getAttribute('aria-invalid')).toBe('true');
    expect(heading()?.textContent).toContain('Step 1 of 3');

    // Fixing the field takes its message away.
    selectOption(control('System') as HTMLSelectElement, 'crm');
    expect(control('System').getAttribute('aria-invalid')).toBeNull();
    expect(document.querySelector('.itsm-FormErrorSummary')).toBeNull();

    click(button('Continue'));
    expect(heading()?.textContent).toBe('Step 2 of 3: Access details');
    expect(activeElement()).toBe(heading());
  });

  it('adds a step when an answer reveals its section', () => {
    render(<Harness />);
    selectOption(control('System') as HTMLSelectElement, 'finance');
    expect(heading()?.textContent).toBe('Step 1 of 4: System access');
  });

  it('continues on Enter in a field instead of submitting the page’s form', async () => {
    const onSubmit = vi.fn();
    render(<Harness initialValues={{ system: 'crm' }} onSubmit={onSubmit} />);
    click(button('Continue'));
    const level = control('Access level') as HTMLInputElement;
    typeInto(level, 'Edit');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => {
      level.dispatchEvent(enter);
    });
    expect(enter.defaultPrevented).toBe(true);
    await settle();
    expect(heading()?.textContent).toBe('Step 3 of 3: Review your answers');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('heads nested sections one level down, and follows headingLevel', () => {
    render(<Harness initialValues={{ system: 'crm' }} headingLevel={3} />);
    expect(heading()?.tagName).toBe('H3');
    click(button('Continue'));
    expect(heading()?.tagName).toBe('H3');
    expect(document.querySelector('.itsm-FormRenderer__sectionTitle')?.tagName).toBe('H4');
    expect(document.querySelector('.itsm-FormRenderer__stepDescription')?.textContent).toBe('What you need and for how long.');
  });

  it('reviews the answers by step, and Edit goes back and returns to the review', () => {
    const changes: FormStepChange[] = [];
    render(<Harness initialValues={{ system: 'finance', urgent: true, level: 'Edit', until: '2026-12-31', justification: 'Month end' }} onStepChange={(step) => changes.push(step)} />);
    click(button('Continue'));
    click(button('Continue'));
    click(button('Continue'));
    expect(heading()?.textContent).toBe('Step 4 of 4: Review your answers');
    expect(changes.map((change) => change.id)).toEqual(['access', 'finance', ':review']);
    expect(changes.at(-1)).toMatchObject({ index: 3, total: 4, review: true, title: 'Review' });

    const groups = [...document.querySelectorAll('.itsm-FormRenderer__reviewGroup')];
    expect(groups.map((group) => group.querySelector('h3')?.textContent)).toEqual(['System access', 'Access details', 'Finance approval']);
    const answers = (group: Element | undefined): string[] =>
      [...(group?.querySelectorAll('.itsm-DescriptionList__item') ?? [])].map(
        (item) => `${item.querySelector('dt')?.textContent}: ${item.querySelector('dd')?.textContent}`,
      );
    expect(answers(groups[0])).toEqual(['System: Finance ledger', 'This is urgent: Yes']);
    expect(answers(groups[1])).toEqual(['Access level: Edit', 'Until: 31 Dec 2026']);

    const edit = [...(groups[1]?.querySelectorAll('button') ?? [])][0]!;
    expect(edit.textContent).toBe('Edit Access details');
    click(edit);
    expect(heading()?.textContent).toBe('Step 2 of 4: Access details');
    click(button('Review answers'));
    expect(heading()?.textContent).toBe('Step 4 of 4: Review your answers');
  });

  it('sends from the review once every step checks out', () => {
    const onSubmit = vi.fn();
    render(<Harness initialValues={{ system: 'crm', level: 'Read' }} onSubmit={onSubmit} />);
    click(button('Continue'));
    click(button('Continue'));
    const send = button('Request System access');
    expect(send.type).toBe('submit');
    click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('calls onSubmit itself when given one', () => {
    const onSubmit = vi.fn();
    render(
      <FormRenderer definition={definition} mode="steps" values={{ system: 'crm', level: 'Read' }} onChange={() => undefined} onSubmit={onSubmit} />,
    );
    click(button('Continue'));
    click(button('Continue'));
    const send = button('Send request');
    expect(send.type).toBe('button');
    click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('explains why sending is unavailable instead of sending', () => {
    const onSubmit = vi.fn();
    render(<Harness initialValues={{ system: 'crm', level: 'Read' }} onSubmit={onSubmit} submitDisabledReason="Requests can't be sent offline." />);
    click(button('Continue'));
    click(button('Continue'));
    const send = button('Request System access');
    expect(send.getAttribute('aria-disabled')).toBe('true');
    click(send);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('takes the API’s field errors to the step they belong to, and focuses the summary', () => {
    function WithServer(): ReactNode {
      const [errors, setErrors] = useState<FormErrors>({});
      return (
        <>
          <Harness initialValues={{ system: 'crm', level: 'Read' }} errors={errors} />
          <button type="button" onClick={() => setErrors({ level: 'Choose read, edit or admin' })}>
            Reject
          </button>
        </>
      );
    }
    render(<WithServer />);
    click(button('Continue'));
    click(button('Continue'));
    expect(heading()?.textContent).toContain('Review');

    click(button('Reject'));
    expect(heading()?.textContent).toBe('Step 2 of 3: Access details');
    const summary = document.querySelector('.itsm-FormErrorSummary');
    expect(activeElement()).toBe(summary);
    expect(summary?.textContent).toContain('Choose read, edit or admin');
    // Straight back to the review once fixed.
    expect(button('Review answers')).toBeTruthy();

    typeInto(control('Access level') as HTMLInputElement, 'Edit');
    expect(document.querySelector('.itsm-FormErrorSummary')).toBeNull();
  });

  it('returns to the first step with a problem when sending finds one', () => {
    function Clearing(): ReactNode {
      const [values, setValues] = useState<FormValues>({ system: 'crm', level: 'Read' });
      return (
        <>
          <FormRenderer definition={definition} mode="steps" values={values} onChange={setValues} onSubmit={() => undefined} />
          <button type="button" onClick={() => setValues({ system: 'crm' })}>
            Lose an answer
          </button>
        </>
      );
    }
    render(<Clearing />);
    click(button('Continue'));
    click(button('Continue'));
    click(button('Lose an answer'));
    click(button('Send request'));
    expect(heading()?.textContent).toBe('Step 2 of 3: Access details');
    expect(document.querySelector('.itsm-FormErrorSummary')?.textContent).toContain('Access level is required');
  });

  it('goes back a step with Back', () => {
    render(<Harness initialValues={{ system: 'crm' }} />);
    expect(document.querySelector('button')?.textContent).not.toBe('Back');
    click(button('Continue'));
    click(button('Back'));
    expect(heading()?.textContent).toBe('Step 1 of 3: System access');
    expect(activeElement()).toBe(heading());
  });
});

describe('FormRenderer single page', () => {
  it('heads top-level sections at level 2 by default, nested ones below', () => {
    render(<FormRenderer definition={definition} values={{ system: 'finance' }} onChange={() => undefined} />);
    const titles = [...document.querySelectorAll('.itsm-FormRenderer__sectionTitle')].map((title) => `${title.tagName} ${title.textContent}`);
    expect(titles).toEqual(['H2 Access details', 'H3 Extra detail', 'H2 Finance approval']);
  });

  it('renders read-only questions read-only, not disabled', () => {
    const readOnly: FormDefinition = {
      ...definition,
      ui: {
        elements: [
          { kind: 'field', field: 'level', control: 'text', readOnlyWhen: { always: true } },
          { kind: 'field', field: 'system', control: 'select', readOnlyWhen: { always: true }, options: [{ value: 'crm', label: 'CRM' }] },
          { kind: 'field', field: 'urgent', control: 'checkbox', readOnlyWhen: { always: true } },
        ],
      },
    };
    const seen: FormValues[] = [];
    render(<FormRenderer definition={readOnly} values={{ level: 'Edit', system: 'crm', urgent: true }} onChange={(values) => seen.push(values)} />);
    const level = control('Access level') as HTMLInputElement;
    expect(level.readOnly).toBe(true);
    expect(level.disabled).toBe(false);
    // A choice reads as its label, in a read-only box.
    const system = control('System') as HTMLInputElement;
    expect(system.tagName).toBe('INPUT');
    expect(system.readOnly).toBe(true);
    expect(system.value).toBe('CRM');
    // The checkbox keeps its box but will not change.
    const urgent = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(urgent.getAttribute('aria-readonly')).toBe('true');
    expect(urgent.disabled).toBe(false);
    click(urgent);
    expect(urgent.checked).toBe(true);
    expect(seen).toEqual([]);
  });

  it('describes a lone checkbox by its hint and its error', () => {
    render(<FormRenderer definition={definition} values={{}} errors={{ urgent: 'Tick this to continue' }} onChange={() => undefined} />);
    const urgent = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const described = (urgent.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(['We will call you.', 'Tick this to continue']);
    expect(urgent.getAttribute('aria-invalid')).toBe('true');
  });

  it('styles instructions by class and intent, with no inline style', () => {
    const withInstruction: FormDefinition = {
      ...definition,
      ui: { elements: [{ kind: 'instruction', id: 'warn', intent: 'warning', content: [{ type: 'paragraph', content: [{ text: 'Needs approval.' }] }] }] },
    };
    render(<FormRenderer definition={withInstruction} values={{}} onChange={() => undefined} />);
    const instruction = document.querySelector('.itsm-FormRenderer__instruction');
    expect(instruction?.getAttribute('data-intent')).toBe('warning');
    expect(document.querySelector('.itsm-FormRenderer [style]')).toBeNull();
  });

  it('gives every question an id its label and a summary link can use, whatever its key', () => {
    const oddKeys: FormDefinition = {
      ...definition,
      schema: { type: 'object', properties: { 'cost centre': { type: 'string', title: 'Cost centre' }, 'cost.centre': { type: 'string', title: 'Other' } } },
      ui: {
        elements: [
          { kind: 'field', field: 'cost centre', control: 'text' },
          { kind: 'field', field: 'cost.centre', control: 'text' },
        ],
      },
    };
    render(<FormRenderer definition={oddKeys} values={{}} onChange={() => undefined} />);
    const first = control('Cost centre');
    const second = control('Other');
    expect(first.id).not.toMatch(/\s/);
    expect(first.id).not.toBe(second.id);
  });

  it('keeps the keyboard in the field it is typing in', () => {
    render(<FormRenderer definition={definition} values={{}} onChange={() => undefined} />);
    const select = control('System');
    focus(select);
    press(select, 'Enter');
    expect(activeElement()).toBe(select);
  });
});
