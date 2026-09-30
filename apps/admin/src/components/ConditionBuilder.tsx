'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, IconButton, InlineAlert, Input, NumberField, SegmentedControl, Select, type SelectOptionGroup } from '@itsm/ui';
import { fromExpression, isUnary, OPERATORS, toExpression, type Condition, type Join, type Operator } from '../rules.js';
import { defaultValue, factFor, factsFrom, operatorsFor, type Fact } from '../rules/facts.js';
import { JsonView } from './JsonView.js';

/**
 * "When all of these are true": a list of conditions a person can read as
 * sentences — `[Priority ▾] [is ▾] [P1 · Critical ▾] ×` — for a rule's *If*,
 * an SLA policy's *Applies to*, a field's *Required when* and a form's *Show
 * when* (B §2.7; F28).
 *
 * What it fixes: a row could not be removed; every value was a text box, so
 * "Open" was typed for a status spelled `in_progress`; raw fact paths were the
 * only labels; and a condition the old editor could not draw was redrawn as
 * the part it could, so saving silently deleted the rest.
 *
 *   - Each row picks a fact by name, a comparison that makes sense for it
 *     (`rules/facts.ts`), and a value editor of the right kind: a list, a
 *     number, yes/no, or text.
 *   - × removes a row; *Add condition* adds one; with two or more, *All of
 *     these* / *Any of these* chooses the join.
 *   - Rows reorder with the ↑/↓ buttons or Alt+↑/↓ from anywhere in the row
 *     (no drag: SPEC D5), and focus stays on the control it was on.
 *   - The output is the engine's expression, through `toExpression` and
 *     `coerce` (`rules.ts`) — numbers and booleans typed as such.
 *   - When `fromExpression` cannot draw the stored condition faithfully, the
 *     builder shows it read-only as JSON with "This condition was written
 *     outside the builder" — and never overwrites it.
 */
export interface ConditionBuilderProps {
  /** The group's name: "Conditions", "Applies to", "Required when". */
  readonly label: string;
  /** The stored expression; `undefined` or `{ always: true }` for none. */
  readonly value: unknown;
  /** Client only. The new expression, after every change. */
  readonly onChange: (expression: unknown) => void;
  /** The engine's fact paths (`configure.rules.facts()`); the whole catalogue without. */
  readonly facts?: readonly string[];
  /**
   * Facts of the caller's own, in place of the rules engine's: a form's
   * questions (`form.accessLevel`, with their options), or what a ticket
   * field's *Required when* is evaluated against. Takes precedence over `facts`.
   */
  readonly factCatalogue?: readonly Fact[];
  /** What no conditions means here. Default "Every time". */
  readonly emptyText?: string;
  readonly readOnly?: boolean;
  readonly className?: string;
}

interface Row extends Condition {
  readonly id: string;
}

let nextRowId = 0;
const rowId = (): string => `condition-${++nextRowId}`;

/**
 * Rows with ids. The first render's ids come from the position, so the
 * server's HTML and the browser's first render agree (a module counter
 * runs on across server requests, and a mismatched `data-row` broke the
 * focus kept by ↑/↓ after hydration); rows made later use the counter.
 */
function toRows(conditions: readonly Condition[], stable = false): Row[] {
  return conditions.map((condition, index) => ({ ...condition, id: stable ? `condition-s${index}` : rowId() }));
}

const OPERATOR_LABELS = new Map<string, string>(OPERATORS.map((entry) => [entry.value, entry.label]));

function groupedFacts(facts: readonly Fact[]): SelectOptionGroup[] {
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const fact of facts) {
    const list = groups.get(fact.group) ?? [];
    list.push({ value: fact.path, label: fact.label });
    groups.set(fact.group, list);
  }
  return [...groups.entries()].map(([label, options]) => ({ label, options }));
}

function ValueEditor({ fact, row, index, onValue, disabled }: { readonly fact: Fact; readonly row: Row; readonly index: number; readonly onValue: (value: string) => void; readonly disabled: boolean }): ReactNode {
  const name = `Value for condition ${index + 1}`;
  if (isUnary(row.operator)) return null;
  switch (fact.kind) {
    case 'enum':
      return (
        <Select
          aria-label={name}
          data-control="value"
          value={row.value}
          disabled={disabled}
          onChange={(event) => onValue(event.target.value)}
          options={fact.options ?? []}
          {...(row.value === '' ? { placeholder: 'Choose…' } : {})}
        />
      );
    case 'boolean':
      return (
        <Select
          aria-label={name}
          data-control="value"
          value={row.value === 'false' ? 'false' : 'true'}
          disabled={disabled}
          onChange={(event) => onValue(event.target.value)}
          options={[
            { value: 'true', label: 'Yes' },
            { value: 'false', label: 'No' },
          ]}
        />
      );
    case 'number':
      return (
        <NumberField
          label={name}
          data-control="value"
          value={row.value.trim() === '' || !Number.isFinite(Number(row.value)) ? null : Number(row.value)}
          onChange={(next) => onValue(next === null ? '' : String(next))}
          disabled={disabled}
          {...(fact.unit ? { unit: fact.unit } : {})}
        />
      );
    default:
      return (
        <Input
          aria-label={name}
          data-control="value"
          value={row.value}
          disabled={disabled}
          onChange={(event) => onValue(event.target.value)}
          placeholder={fact.kind === 'id' ? 'An id' : 'A value'}
        />
      );
  }
}

export function ConditionBuilder({ label, value, onChange, facts: enginePaths, factCatalogue, emptyText = 'Every time', readOnly = false, className }: ConditionBuilderProps): ReactNode {
  const facts = useMemo(() => (factCatalogue ? [...factCatalogue] : factsFrom(enginePaths)), [enginePaths, factCatalogue]);
  const lookup = (path: string): Fact => facts.find((fact) => fact.path === path) ?? factFor(path);
  const factOptions = useMemo(() => groupedFacts(facts), [facts]);
  const parsed = useMemo(() => (value === undefined || value === null ? { conditions: [], join: 'and' as Join } : fromExpression(value)), [value]);

  const [rows, setRows] = useState<Row[]>(() => toRows(parsed?.conditions ?? [], true));
  const [join, setJoin] = useState<Join>(parsed?.join ?? 'and');
  // What this builder last sent up. A new `value` that is not that — a reset,
  // a draft restored — replaces the rows; our own echo does not.
  const emitted = useRef<string>(JSON.stringify(value ?? null));
  const list = useRef<HTMLOListElement | null>(null);
  const [focusAfterMove, setFocusAfterMove] = useState<{ id: string; control: string } | null>(null);

  useEffect(() => {
    const incoming = JSON.stringify(value ?? null);
    if (incoming === emitted.current) return;
    emitted.current = incoming;
    const next = value === undefined || value === null ? { conditions: [], join: 'and' as Join } : fromExpression(value);
    if (next) {
      setRows(toRows(next.conditions));
      setJoin(next.join);
    }
  }, [value]);

  useEffect(() => {
    if (!focusAfterMove) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-row="${focusAfterMove.id}"]`);
    const target = row?.querySelector<HTMLElement>(`[data-control="${focusAfterMove.control}"]`) ?? row?.querySelector<HTMLElement>('select, input, button');
    target?.focus();
    setFocusAfterMove(null);
  }, [focusAfterMove, rows]);

  if (parsed === null) {
    return (
      <div className={className ? `app-Conditions app-Conditions--custom ${className}` : 'app-Conditions app-Conditions--custom'} role="group" aria-label={label}>
        <InlineAlert tone="info">
          This condition was written outside the builder, so it’s shown as it is and can’t be changed here. Saving leaves it exactly as it is.
        </InlineAlert>
        <JsonView value={value} label={label} />
      </div>
    );
  }

  const commit = (nextRows: Row[], nextJoin: Join = join): void => {
    setRows(nextRows);
    setJoin(nextJoin);
    const expression = toExpression(nextRows, nextJoin);
    emitted.current = JSON.stringify(expression);
    onChange(expression);
  };

  const patch = (id: string, change: Partial<Condition>): void => commit(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));

  const chooseFact = (id: string, path: string): void => {
    const fact = lookup(path);
    const row = rows.find((entry) => entry.id === id);
    const operators = operatorsFor(fact);
    const operator = row && operators.includes(row.operator) ? row.operator : operators[0]!;
    patch(id, { fact: path, operator, value: defaultValue(fact) });
  };

  const move = (index: number, by: -1 | 1, control?: string): void => {
    const target = index + by;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    commit(next);
    if (control) setFocusAfterMove({ id: moved!.id, control });
  };

  const remove = (index: number): void => {
    const next = rows.filter((_, position) => position !== index);
    commit(next);
    // Focus the row that took its place, or *Add condition* when none is left.
    const neighbour = next[index] ?? next[index - 1];
    if (neighbour) setFocusAfterMove({ id: neighbour.id, control: 'fact' });
    else list.current?.parentElement?.querySelector<HTMLElement>('[data-control="add"]')?.focus();
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLLIElement>, index: number): void => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const control = (event.target as HTMLElement).closest<HTMLElement>('[data-control]')?.dataset.control ?? 'fact';
    move(index, event.key === 'ArrowUp' ? -1 : 1, control);
  };

  return (
    <fieldset className={className ? `app-Conditions ${className}` : 'app-Conditions'} disabled={readOnly}>
      <legend className="app-Conditions__legend">{label}</legend>

      {rows.length > 1 ? (
        <SegmentedControl
          label="Match"
          mode="value"
          size="sm"
          value={join}
          onValueChange={(next) => commit(rows, next === 'or' ? 'or' : 'and')}
          options={[
            { value: 'and', label: 'All of these' },
            { value: 'or', label: 'Any of these' },
          ]}
        />
      ) : null}

      {rows.length === 0 ? (
        <p className="app-Conditions__empty">{emptyText} — no conditions.</p>
      ) : (
        <ol className="app-Conditions__list" ref={list} aria-label={`${label}, ${rows.length} ${rows.length === 1 ? 'condition' : 'conditions'}`}>
          {rows.map((row, index) => {
            const fact = row.fact ? lookup(row.fact) : null;
            const operators = fact ? operatorsFor(fact) : OPERATORS.map((entry) => entry.value);
            return (
              <li key={row.id} className="app-Conditions__row" data-row={row.id} onKeyDown={(event) => onRowKeyDown(event, index)}>
                {index > 0 ? (
                  <span className="app-Conditions__join" aria-hidden="true">
                    {join === 'and' ? 'and' : 'or'}
                  </span>
                ) : null}
                <Select
                  aria-label={`Field for condition ${index + 1}`}
                  data-control="fact"
                  value={row.fact}
                  onChange={(event) => chooseFact(row.id, event.target.value)}
                  options={factOptions}
                  {...(row.fact === '' ? { placeholder: 'Choose a field…' } : {})}
                />
                <Select
                  aria-label={`Comparison for condition ${index + 1}`}
                  data-control="operator"
                  value={row.operator}
                  onChange={(event) => patch(row.id, { operator: event.target.value as Operator })}
                  options={operators.map((operator) => ({ value: operator, label: OPERATOR_LABELS.get(operator) ?? operator }))}
                />
                {fact ? <ValueEditor fact={fact} row={row} index={index} disabled={readOnly} onValue={(next) => patch(row.id, { value: next })} /> : null}
                {readOnly ? null : (
                  <span className="app-Conditions__rowActions">
                    <IconButton
                      icon="arrow-up"
                      label={`Move condition ${index + 1} up`}
                      variant="ghost"
                      size="sm"
                      data-control="up"
                      aria-keyshortcuts="Alt+ArrowUp"
                      disabled={index === 0}
                      onClick={() => move(index, -1, 'up')}
                    />
                    <IconButton
                      icon="arrow-down"
                      label={`Move condition ${index + 1} down`}
                      variant="ghost"
                      size="sm"
                      data-control="down"
                      aria-keyshortcuts="Alt+ArrowDown"
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1, 'down')}
                    />
                    <IconButton icon="x" label={`Remove condition ${index + 1}`} variant="ghost" size="sm" data-control="remove" onClick={() => remove(index)} />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {readOnly ? null : (
        <Button
          variant="ghost"
          size="sm"
          iconStart="plus"
          data-control="add"
          onClick={() => {
            const first = facts[0];
            const row: Row = first
              ? { id: rowId(), fact: first.path, operator: operatorsFor(first)[0]!, value: defaultValue(first) }
              : { id: rowId(), fact: '', operator: 'eq', value: '' };
            commit([...rows, row]);
            setFocusAfterMove({ id: row.id, control: 'fact' });
          }}
        >
          Add condition
        </Button>
      )}
    </fieldset>
  );
}
