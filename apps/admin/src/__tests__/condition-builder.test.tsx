// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalStateSchema, channelSchema, impactUrgencySchema, prioritySchema, statusCategorySchema, ticketTypeSchema } from '@itsm/contracts';
import { exprSchema } from '@itsm/expr';
import { ConditionBuilder } from '../components/ConditionBuilder.js';
import { CHANNELS, FACTS, LEVELS, PRIORITIES, STATUS_CATEGORIES, TICKET_STATUSES, TICKET_TYPES, factFor, factsFrom, operatorsFor } from '../rules/facts.js';
import { cleanupDocument, click, render } from './support/render.js';

/**
 * The condition builder (F28): rows that can be removed and reordered, typed
 * value editors from the fact catalogue, and a condition it cannot draw left
 * exactly as it was.
 */

afterEach(cleanupDocument);

function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function keydown(target: Element, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}

const twoRows = {
  and: [{ eq: [{ var: 'ticket.priority' }, 'P1'] }, { eq: [{ var: 'ticket.status' }, 'new'] }],
};

describe('the fact catalogue', () => {
  it('uses the API contract’s own vocabularies', () => {
    const values = (options: readonly { value: string }[]): string[] => options.map((option) => option.value);
    expect(values(TICKET_STATUSES)).toEqual(canonicalStateSchema.options);
    expect(values(STATUS_CATEGORIES)).toEqual(statusCategorySchema.options);
    expect(values(TICKET_TYPES)).toEqual(ticketTypeSchema.options);
    expect(values(PRIORITIES)).toEqual(prioritySchema.options);
    expect(values(LEVELS)).toEqual(impactUrgencySchema.options);
    expect(values(CHANNELS)).toEqual(channelSchema.options);
  });

  it('names every fact and offers only sensible comparisons', () => {
    expect(new Set(FACTS.map((fact) => fact.path)).size).toBe(FACTS.length);
    expect(operatorsFor(factFor('ticket.priority'))).not.toContain('gt');
    expect(operatorsFor(factFor('ticket.ageMinutes'))).toContain('gt');
    expect(operatorsFor(factFor('ticket.hasAssignee'))).toEqual(['eq']);
  });

  it('keeps a fact it does not know usable, as text under its path', () => {
    expect(factFor('fields.costCentre')).toMatchObject({ label: 'Field: costCentre', kind: 'text' });
    expect(factFor('ticket.somethingNew')).toMatchObject({ label: 'ticket.somethingNew', kind: 'text' });
    // The engine's list decides what is offered.
    expect(factsFrom(['ticket.priority', 'fields.costCentre']).map((fact) => fact.path)).toEqual(['ticket.priority', 'fields.costCentre']);
  });
});

describe('the builder', () => {
  it('draws each condition as a row with typed controls', () => {
    const { container } = render(<ConditionBuilder label="Conditions" value={twoRows} onChange={() => undefined} />);
    const rows = container.querySelectorAll('li.app-Conditions__row');
    expect(rows).toHaveLength(2);
    const fact = rows[0]!.querySelector<HTMLSelectElement>('select[aria-label="Field for condition 1"]')!;
    expect(fact.value).toBe('ticket.priority');
    // The priority is chosen from its list, not typed.
    const value = rows[0]!.querySelector<HTMLSelectElement>('select[aria-label="Value for condition 1"]')!;
    expect(value.value).toBe('P1');
    expect([...value.options].map((option) => option.value)).toContain('P4');
    // Priority cannot be "greater than".
    const comparison = rows[0]!.querySelector<HTMLSelectElement>('select[aria-label="Comparison for condition 1"]')!;
    expect([...comparison.options].map((option) => option.value)).not.toContain('gt');
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Match');
  });

  it('removes a row, and emits what the engine accepts', () => {
    const onChange = vi.fn();
    const { container } = render(<ConditionBuilder label="Conditions" value={twoRows} onChange={onChange} />);
    click(container.querySelector('button[aria-label="Remove condition 1"]')!);
    const expression = onChange.mock.calls.at(-1)?.[0];
    expect(expression).toEqual({ eq: [{ var: 'ticket.status' }, 'new'] });
    expect(exprSchema.safeParse(expression).success).toBe(true);
    expect(container.querySelectorAll('li.app-Conditions__row')).toHaveLength(1);
  });

  it('means every time when the last row goes', () => {
    const onChange = vi.fn();
    const { container } = render(<ConditionBuilder label="Conditions" value={{ eq: [{ var: 'ticket.priority' }, 'P2'] }} onChange={onChange} />);
    click(container.querySelector('button[aria-label="Remove condition 1"]')!);
    expect(onChange).toHaveBeenLastCalledWith({ always: true });
    expect(container.textContent).toContain('Every time — no conditions.');
  });

  it('adds a row and joins by any of these', () => {
    const onChange = vi.fn();
    const { container } = render(<ConditionBuilder label="Conditions" value={{ always: true }} onChange={onChange} />);
    click([...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Add condition'))!);
    click([...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Add condition'))!);
    expect(container.querySelectorAll('li.app-Conditions__row')).toHaveLength(2);
    const any = [...container.querySelectorAll('[role="radio"]')].find((radio) => radio.textContent === 'Any of these')!;
    click(any);
    const expression = onChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(Object.keys(expression)).toEqual(['or']);
    expect(exprSchema.safeParse(expression).success).toBe(true);
  });

  it('types a value by its fact: a number stays a number', () => {
    const onChange = vi.fn();
    const { container } = render(<ConditionBuilder label="Conditions" value={{ always: true }} onChange={onChange} />);
    click([...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Add condition'))!);
    choose(container.querySelector<HTMLSelectElement>('select[aria-label="Field for condition 1"]')!, 'ticket.reopenCount');
    choose(container.querySelector<HTMLSelectElement>('select[aria-label="Comparison for condition 1"]')!, 'gt');
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '2');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith({ gt: [{ var: 'ticket.reopenCount' }, 2] });
  });

  it('moves a row with Alt+↓ and keeps focus where it was', () => {
    const onChange = vi.fn();
    const { container } = render(<ConditionBuilder label="Conditions" value={twoRows} onChange={onChange} />);
    const first = container.querySelector<HTMLSelectElement>('select[aria-label="Field for condition 1"]')!;
    first.focus();
    keydown(first, 'ArrowDown', { altKey: true });
    expect(onChange).toHaveBeenLastCalledWith({
      and: [{ eq: [{ var: 'ticket.status' }, 'new'] }, { eq: [{ var: 'ticket.priority' }, 'P1'] }],
    });
    // The priority row is second now, and still has focus.
    const moved = container.querySelector<HTMLSelectElement>('select[aria-label="Field for condition 2"]')!;
    expect(moved.value).toBe('ticket.priority');
    expect(document.activeElement).toBe(moved);
  });

  it('shows a condition it cannot draw read-only, and never rewrites it', () => {
    const onChange = vi.fn();
    const custom = { not: { eq: [{ var: 'ticket.priority' }, 'P1'] } };
    const { container } = render(<ConditionBuilder label="Conditions" value={custom} onChange={onChange} />);
    expect(container.textContent).toContain('written outside the builder');
    expect(container.querySelectorAll('select')).toHaveLength(0);
    expect(container.textContent).toContain('"P1"');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('takes a new value from outside (a reset) but not its own echo', () => {
    const onChange = vi.fn();
    const { container, root } = render(<ConditionBuilder label="Conditions" value={twoRows} onChange={onChange} />);
    act(() => {
      root.render(<ConditionBuilder label="Conditions" value={{ eq: [{ var: 'ticket.type' }, 'incident'] }} onChange={onChange} />);
    });
    expect(container.querySelectorAll('li.app-Conditions__row')).toHaveLength(1);
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Field for condition 1"]')!.value).toBe('ticket.type');
  });
});
