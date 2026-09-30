'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, FormField, Icon, IconButton, InlineAlert, Input, SegmentedControl, Select, type IconName, type SegmentedOption } from '@itsm/ui';
import { Combobox, Menu, type ComboboxOption } from '@itsm/ui/overlays';
import { emptyAction, LEVEL_FIELDS, type ActionDraft, type ActionType } from '../../rules.js';
import { LEVELS, PRIORITIES, TICKET_STATUSES } from '../../rules/facts.js';
import { JsonView } from '../JsonView.js';
import { MAX_ACTIONS, actionId, isCustom, offeredTypes, type ActionItem } from './draft.js';
import { RECIPIENTS, STRATEGIES, TEMPLATES, actionChip, isKnownTemplate, templateLabel } from './presentation.js';
import type { Choice } from './types.js';

/**
 * *Then*: the rule's actions as cards, in the order the engine applies them
 * (SPEC §6.1). Each card has a typed editor — never a box to paste an id
 * into — and × to remove it; cards move with ↑/↓ or Alt+↑/↓ from anywhere
 * in the card, keeping focus where it was (no dragging, SPEC D5).
 *
 * An action the builder cannot draw (a category, a watcher, a duplicate
 * link, a field other than impact or urgency) is a *Custom action*: shown
 * as it is stored, movable and removable, and saved back untouched.
 */
export interface ActionsEditorProps {
  readonly items: readonly ActionItem[];
  /** Client only. */
  readonly onChange: (items: ActionItem[]) => void;
  /** Published and draft workflows to start, by name; null shows a key field instead. */
  readonly workflows: readonly Choice[] | null;
  /** Teams (A6); null hides *Assign to a team*. */
  readonly teams: readonly Choice[] | null;
  /** Messages by item id, from the builder's checks or the API. */
  readonly errors: Readonly<Record<string, string>>;
  readonly readOnly?: boolean;
}

const TYPE_ICONS: Readonly<Record<ActionType, IconName>> = {
  setPriority: 'flag',
  setStatus: 'circle-dashed',
  sendNotification: 'bell',
  assignStrategy: 'people',
  assignGroup: 'people',
  addTag: 'tag',
  startWorkflow: 'workflow',
  setField: 'sliders-horizontal',
};

export function ActionsEditor({ items, onChange, workflows, teams, errors, readOnly = false }: ActionsEditorProps): ReactNode {
  const list = useRef<HTMLOListElement | null>(null);
  const [focusAfter, setFocusAfter] = useState<{ id: string; control: string } | null>(null);
  const types = useMemo(() => offeredTypes({ teams: teams !== null }), [teams]);

  useEffect(() => {
    if (!focusAfter) return;
    const card = list.current?.querySelector<HTMLElement>(`[data-row="${focusAfter.id}"]`);
    const target = card?.querySelector<HTMLElement>(`[data-control="${focusAfter.control}"]`) ?? card?.querySelector<HTMLElement>('select, input, button');
    target?.focus();
    setFocusAfter(null);
  }, [focusAfter, items]);

  const replace = (id: string, draft: ActionDraft): void => onChange(items.map((item) => (item.id === id ? { id, draft } : item)));

  const move = (index: number, by: -1 | 1, control?: string): void => {
    const target = index + by;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    onChange(next);
    if (control) setFocusAfter({ id: moved!.id, control });
  };

  const remove = (index: number): void => {
    const next = items.filter((_, position) => position !== index);
    onChange(next);
    const neighbour = next[index] ?? next[index - 1];
    if (neighbour) setFocusAfter({ id: neighbour.id, control: 'type' });
    else list.current?.parentElement?.querySelector<HTMLElement>('[data-control="add-action"]')?.focus();
  };

  const add = (type: ActionType): void => {
    const item: ActionItem = { id: actionId(), draft: emptyAction(type) };
    onChange([...items, item]);
    setFocusAfter({ id: item.id, control: 'value' });
  };

  const onCardKeyDown = (event: KeyboardEvent<HTMLLIElement>, index: number): void => {
    if (readOnly || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const control = (event.target as HTMLElement).closest<HTMLElement>('[data-control]')?.dataset.control ?? 'type';
    move(index, event.key === 'ArrowUp' ? -1 : 1, control);
  };

  return (
    <div className="app-Actions">
      {items.length === 0 ? (
        <p className="app-Actions__empty">No actions yet. Add what the rule should do when it matches.</p>
      ) : (
        <ol className="app-Actions__list" ref={list} aria-label={`Actions, ${items.length} ${items.length === 1 ? 'action' : 'actions'}, applied in this order`}>
          {items.map((item, index) => {
            const error = errors[item.id];
            const number = index + 1;
            return (
              <li key={item.id} className="app-ActionCard" data-row={item.id} data-invalid={error ? '' : undefined} onKeyDown={(event) => onCardKeyDown(event, index)}>
                <div className="app-ActionCard__head">
                  <span className="app-ActionCard__number" aria-hidden="true">
                    {number}
                  </span>
                  {isCustom(item) ? (
                    <span className="app-ActionCard__custom">
                      <Icon name="settings-2" size="sm" />
                      <span>Custom action · {actionChip(item.custom).label}</span>
                    </span>
                  ) : (
                    <span className="app-ActionCard__type">
                      <Icon name={TYPE_ICONS[item.draft.type]} size="sm" />
                      <Select
                        aria-label={`Action ${number}`}
                        data-control="type"
                        value={item.draft.type}
                        disabled={readOnly}
                        options={types.some((type) => type.value === item.draft.type) ? types : [...types, { value: item.draft.type, label: item.draft.type }]}
                        onChange={(event) => replace(item.id, emptyAction(event.target.value as ActionType))}
                      />
                    </span>
                  )}
                  {readOnly ? null : (
                    <span className="app-ActionCard__tools">
                      <IconButton
                        icon="arrow-up"
                        label={`Move action ${number} up`}
                        variant="ghost"
                        size="sm"
                        data-control="up"
                        aria-keyshortcuts="Alt+ArrowUp"
                        disabled={index === 0}
                        onClick={() => move(index, -1, 'up')}
                      />
                      <IconButton
                        icon="arrow-down"
                        label={`Move action ${number} down`}
                        variant="ghost"
                        size="sm"
                        data-control="down"
                        aria-keyshortcuts="Alt+ArrowDown"
                        disabled={index === items.length - 1}
                        onClick={() => move(index, 1, 'down')}
                      />
                      <IconButton icon="x" label={`Remove action ${number}`} variant="ghost" size="sm" data-control="remove" onClick={() => remove(index)} />
                    </span>
                  )}
                </div>
                <div className="app-ActionCard__body">
                  {isCustom(item) ? (
                    <>
                      <p className="app-ActionCard__note">Written outside the builder, so it’s shown as it is and saved exactly as it was.</p>
                      <JsonView value={item.custom} label={`Action ${number}`} openDepth={1} />
                    </>
                  ) : (
                    <ActionFields
                      id={item.id}
                      number={number}
                      draft={item.draft}
                      workflows={workflows}
                      teams={teams}
                      readOnly={readOnly}
                      onChange={(draft) => replace(item.id, draft)}
                    />
                  )}
                  {error ? (
                    <p className="app-FieldProblem" id={`${item.id}-error`} role="alert">
                      <Icon name="circle-alert" size="xs" />
                      {error}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {readOnly ? null : items.length >= MAX_ACTIONS ? (
        <p className="app-Actions__limit">A rule can have at most {MAX_ACTIONS} actions.</p>
      ) : (
        <Menu
          label="Add an action"
          trigger={
            <Button variant="secondary" size="sm" iconStart="plus" data-control="add-action">
              Add action
            </Button>
          }
          items={types.map((type) => ({ id: type.value, label: type.label, icon: TYPE_ICONS[type.value as ActionType], onSelect: () => add(type.value as ActionType) }))}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- fields */

const option = (entry: { readonly value: string; readonly label: string; readonly description?: string }): ComboboxOption => ({
  value: entry.value,
  label: entry.label,
  ...(entry.description ? { description: entry.description } : {}),
});

function ActionFields({
  id,
  number,
  draft,
  workflows,
  teams,
  readOnly,
  onChange,
}: {
  readonly id: string;
  readonly number: number;
  readonly draft: ActionDraft;
  readonly workflows: readonly Choice[] | null;
  readonly teams: readonly Choice[] | null;
  readonly readOnly: boolean;
  readonly onChange: (draft: ActionDraft) => void;
}): ReactNode {
  const set = (patch: Partial<ActionDraft>): void => {
    if (!readOnly) onChange({ ...draft, ...patch });
  };
  const valueId = `${id}-value`;
  // The segmented controls have no disabled state of their own; read-only, each segment is.
  const segments = (entries: readonly { readonly value: string; readonly label: string }[]): SegmentedOption[] =>
    entries.map((entry) => ({ value: entry.value, label: entry.label, ...(readOnly ? { disabled: true } : {}) }));

  switch (draft.type) {
    case 'setPriority':
      return (
        <div className="app-ActionCard__fields">
          <SegmentedControl
            label={`Priority for action ${number}`}
            mode="value"
            size="sm"
            value={draft.value}
            onValueChange={(value) => set({ value })}
            options={segments(PRIORITIES.map((entry) => ({ value: entry.value, label: entry.value })))}
          />
          <FormField label="Reason" optional hint="Shown in the ticket’s history beside the change.">
            <Input data-control="value" id={valueId} value={draft.reason} maxLength={200} disabled={readOnly} onChange={(event) => set({ reason: event.currentTarget.value })} />
          </FormField>
        </div>
      );

    case 'setStatus': {
      const known = TICKET_STATUSES.find((entry) => entry.value === draft.value);
      const selected: ComboboxOption | null = draft.value === '' ? null : known ? option(known) : { value: draft.value, label: draft.value, description: 'Not one of the desk’s statuses' };
      return (
        <div className="app-ActionCard__fields">
          <FormField label="Status" required id={valueId}>
            {(control) => (
              <Combobox
                {...control}
                options={TICKET_STATUSES.map(option)}
                value={selected}
                clearable={false}
                disabled={readOnly}
                placeholder="Choose a status"
                emptyMessage="No status matches"
                onChange={(next) => set({ value: next?.value ?? '' })}
              />
            )}
          </FormField>
          <FormField label="Reason" optional hint="Shown in the ticket’s history.">
            <Input value={draft.reason} maxLength={200} disabled={readOnly} onChange={(event) => set({ reason: event.currentTarget.value })} />
          </FormField>
        </div>
      );
    }

    case 'sendNotification': {
      const selected: ComboboxOption | null = draft.value === '' ? null : { value: draft.value, label: templateLabel(draft.value) };
      const unknown = draft.value !== '' && !isKnownTemplate(draft.value);
      return (
        <div className="app-ActionCard__fields">
          <FormField label="Notification" required id={valueId} hint="Choose one of the desk’s notifications, or type a template key.">
            {(control) => (
              <Combobox
                {...control}
                options={TEMPLATES.map((entry) => ({ value: entry.value, label: entry.label, description: entry.value }))}
                value={selected}
                clearable={false}
                disabled={readOnly}
                creatable={{ label: (query) => `Use the template “${query}”` }}
                placeholder="Choose a notification"
                onChange={(next) => set({ value: next?.value ?? '' })}
              />
            )}
          </FormField>
          {unknown ? (
            <InlineAlert tone="warning">This isn’t one of the desk’s notifications. If no template has this key, nothing is sent.</InlineAlert>
          ) : null}
          <SegmentedControl label={`Who is told, action ${number}`} mode="value" size="sm" value={draft.to} onValueChange={(to) => set({ to })} options={segments(RECIPIENTS)} />
        </div>
      );
    }

    case 'assignStrategy':
      return (
        <div className="app-ActionCard__fields">
          <SegmentedControl label={`How to choose, action ${number}`} mode="value" size="sm" value={draft.value} onValueChange={(value) => set({ value })} options={segments(STRATEGIES)} />
          <p className="app-ActionCard__note">
            Picks someone in the ticket’s team. It does nothing when the ticket has no team, and never takes a ticket off someone already working on it.
          </p>
        </div>
      );

    case 'assignGroup':
      return (
        <div className="app-ActionCard__fields">
          <FormField label="Team" required id={valueId}>
            <Select
              data-control="value"
              value={draft.value}
              disabled={readOnly}
              options={(teams ?? []).map((team) => ({ value: team.value, label: team.label }))}
              {...(draft.value === '' ? { placeholder: 'Choose a team' } : {})}
              onChange={(event) => set({ value: event.target.value })}
            />
          </FormField>
        </div>
      );

    case 'addTag':
      return (
        <div className="app-ActionCard__fields">
          <FormField label="Tag" required id={valueId} counter={{ max: 40 }}>
            <Input data-control="value" value={draft.value} maxLength={40} disabled={readOnly} onChange={(event) => set({ value: event.currentTarget.value })} />
          </FormField>
        </div>
      );

    case 'startWorkflow': {
      if (workflows === null) {
        return (
          <div className="app-ActionCard__fields">
            <FormField label="Workflow key" required id={valueId} hint="You can’t list workflows, so type the key of a published one.">
              <Input data-control="value" value={draft.value} disabled={readOnly} onChange={(event) => set({ value: event.currentTarget.value })} />
            </FormField>
          </div>
        );
      }
      const chosen = workflows.find((entry) => entry.value === draft.value);
      const options = chosen || draft.value === '' ? workflows : [...workflows, { value: draft.value, label: draft.value, description: 'No workflow has this key' }];
      return (
        <div className="app-ActionCard__fields">
          <FormField label="Workflow" required id={valueId}>
            <Select
              data-control="value"
              value={draft.value}
              disabled={readOnly}
              options={options.map((entry) => ({ value: entry.value, label: entry.label }))}
              {...(draft.value === '' ? { placeholder: 'Choose a workflow' } : {})}
              onChange={(event) => set({ value: event.target.value })}
            />
          </FormField>
          {draft.value !== '' && (!chosen || chosen.description) ? (
            <InlineAlert tone="warning">
              {chosen ? 'This workflow isn’t published, so the rule can’t start it until it is.' : 'No workflow has this key, so nothing would start.'}
            </InlineAlert>
          ) : null}
        </div>
      );
    }

    case 'setField':
      return (
        <div className="app-ActionCard__fields">
          <SegmentedControl
            label={`Field for action ${number}`}
            mode="value"
            size="sm"
            value={draft.field ?? 'impact'}
            onValueChange={(field) => set({ field: (LEVEL_FIELDS as readonly string[]).includes(field) ? (field as ActionDraft['field']) : 'impact' })}
            options={segments([
              { value: 'impact', label: 'Impact' },
              { value: 'urgency', label: 'Urgency' },
            ])}
          />
          <SegmentedControl
            label={`Level for action ${number}`}
            mode="value"
            size="sm"
            value={draft.value}
            onValueChange={(value) => set({ value })}
            options={segments(LEVELS)}
          />
          <p className="app-ActionCard__note">The priority follows from impact and urgency through the priority matrix.</p>
        </div>
      );
  }
}
