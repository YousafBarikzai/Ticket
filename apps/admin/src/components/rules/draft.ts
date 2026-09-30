import type { RuleDefinition } from '@itsm/sdk';
import { ACTION_TYPES, fromAction, fromExpression, isUnary, toAction, type ActionDraft } from '../../rules.js';
import type { KeyState } from '../../keys.js';
import { factFor } from '../../rules/facts.js';
import type { RuleSnapshot, RuleView } from './types.js';

/**
 * The rule on the builder's canvas, and the three shapes it leaves as: the
 * definition "Try it" replays (`POST /rules/dry-run`), the body that creates
 * it, and the patch that saves an edit. Pure, so the builder and its tests
 * agree on exactly what is sent.
 */

/** An action the builder can edit, or one it keeps exactly as stored (a *Custom action*). */
export type ActionItem = { readonly id: string; readonly draft: ActionDraft } | { readonly id: string; readonly custom: unknown };

export interface RuleDraft {
  readonly name: string;
  readonly key: string;
  readonly description: string;
  readonly event: string;
  /** The engine's expression, as `ConditionBuilder` emits it. */
  readonly conditions: unknown;
  readonly actions: readonly ActionItem[];
  readonly order: number;
  readonly mode: 'continue' | 'stop';
}

let nextActionId = 0;
export const actionId = (): string => `action-${++nextActionId}`;

export function isCustom(item: ActionItem): item is { readonly id: string; readonly custom: unknown } {
  return 'custom' in item;
}

/**
 * A stored action as an item. `assignGroup` needs the team list to be edited
 * by name; without it (no A6, or no permission) it is kept as a custom action
 * rather than shown as an id.
 */
export function itemFrom(action: unknown, { teams }: { readonly teams: boolean }, id: string = actionId()): ActionItem {
  const draft = fromAction(action);
  if (!draft || (draft.type === 'assignGroup' && !teams)) return { id, custom: action };
  return { id, draft };
}

export function draftFrom(rule: RuleView | (RuleSnapshot & { readonly description?: string | null }), options: { readonly teams: boolean }): RuleDraft {
  return {
    name: rule.name ?? '',
    key: rule.key ?? '',
    description: rule.description ?? '',
    event: rule.event ?? 'ticket.created',
    conditions: rule.conditions ?? { always: true },
    // Ids from the position: the server's render and the browser's first one must agree.
    actions: (rule.actions ?? []).map((action, index) => itemFrom(action, options, `stored-${index}`)),
    order: typeof rule.order === 'number' ? rule.order : 100,
    mode: rule.mode === 'stop' ? 'stop' : 'continue',
  };
}

export function emptyDraft(order: number): RuleDraft {
  return { name: '', key: '', description: '', event: 'ticket.created', conditions: { always: true }, actions: [], order, mode: 'continue' };
}

export function actionsOf(draft: RuleDraft): unknown[] {
  return draft.actions.map((item) => (isCustom(item) ? item.custom : toAction(item.draft)));
}

const KEY_SHAPE = /^[a-z][a-z0-9-]{1,62}$/;

/**
 * What "Try it" sends: the canvas as it is, saved or not (A8). The key and
 * the name go only when they are already valid — the dry run does not read
 * them, and an unnamed rule is worth testing.
 */
export function definitionOf(draft: RuleDraft): RuleDefinition {
  const name = draft.name.trim();
  const description = draft.description.trim();
  return {
    ...(KEY_SHAPE.test(draft.key) ? { key: draft.key } : {}),
    ...(name && name.length <= 120 ? { name } : {}),
    ...(description && description.length <= 500 ? { description } : {}),
    event: draft.event,
    conditions: draft.conditions ?? { always: true },
    actions: actionsOf(draft),
    order: draft.order,
    mode: draft.mode,
  };
}

/** `POST /rules`: the whole definition. An empty description is left out (the API takes a string or nothing). */
export function createPayload(draft: RuleDraft): Record<string, unknown> {
  const description = draft.description.trim();
  return {
    key: draft.key,
    name: draft.name.trim(),
    ...(description ? { description } : {}),
    event: draft.event,
    conditions: draft.conditions ?? { always: true },
    actions: actionsOf(draft),
    order: draft.order,
    mode: draft.mode,
  };
}

/** `PATCH /rules/:key`: everything but the key, which is permanent. An emptied description is sent as "" to clear it. */
export function patchPayload(draft: RuleDraft): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    event: draft.event,
    conditions: draft.conditions ?? { always: true },
    actions: actionsOf(draft),
    order: draft.order,
    mode: draft.mode,
  };
}

/** Two drafts that would save the same rule are the same, whatever the item ids. */
export function signature(draft: RuleDraft): string {
  return JSON.stringify({ ...patchPayload(draft), key: draft.key });
}

/** What the replay depends on: a change to the name does not make a test stale, a change to a condition does. */
export function testSignature(draft: RuleDraft): string {
  return JSON.stringify({ event: draft.event, conditions: draft.conditions, actions: actionsOf(draft), order: draft.order, mode: draft.mode });
}

/* ------------------------------------------------------------- checking */

export type IssueTarget = 'name' | 'key' | 'description' | 'event' | 'conditions' | 'actions' | { readonly action: string };

export interface DraftIssue {
  readonly target: IssueTarget;
  readonly message: string;
}

export const MAX_ACTIONS = 20;

/** The problems the API would refuse the rule for, found before it is sent, in the order they appear on the page. */
export function checkDraft(draft: RuleDraft, { keyState, isNew }: { readonly keyState: KeyState; readonly isNew: boolean }): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const name = draft.name.trim();
  if (name === '') issues.push({ target: 'name', message: 'Give the rule a name.' });
  else if (name.length > 120) issues.push({ target: 'name', message: 'Keep the name to 120 characters.' });
  if (isNew && name !== '' && keyState !== 'ok') {
    issues.push({
      target: 'key',
      message:
        keyState === 'taken'
          ? 'Another rule already uses this key. Edit the key or change the name.'
          : keyState === 'reserved'
            ? 'That key is reserved. Edit the key.'
            : 'This name can’t make a key. Edit the key by hand.',
    });
  }
  if (draft.description.trim().length > 500) issues.push({ target: 'description', message: 'Keep the description to 500 characters.' });

  const parsed = fromExpression(draft.conditions ?? { always: true });
  if (parsed) {
    parsed.conditions.forEach((row, index) => {
      if (row.fact !== '' && !isUnary(row.operator) && row.value.trim() === '') {
        issues.push({ target: 'conditions', message: `Condition ${index + 1} (${factFor(row.fact).label}) needs a value.` });
      }
    });
  }

  if (draft.actions.length === 0) issues.push({ target: 'actions', message: 'Add at least one action — a rule with none does nothing.' });
  else if (draft.actions.length > MAX_ACTIONS) issues.push({ target: 'actions', message: `A rule can have at most ${MAX_ACTIONS} actions.` });

  draft.actions.forEach((item) => {
    if (isCustom(item)) return;
    const message = actionProblem(item.draft);
    if (message) issues.push({ target: { action: item.id }, message });
  });
  return issues;
}

/** What is wrong with one action, in words, or null. */
export function actionProblem(action: ActionDraft): string | null {
  const value = action.value.trim();
  switch (action.type) {
    case 'setPriority':
      if (!['P1', 'P2', 'P3', 'P4'].includes(value)) return 'Choose the priority to set.';
      return action.reason.trim().length > 200 ? 'Keep the reason to 200 characters.' : null;
    case 'setStatus':
      if (value === '') return 'Choose the status to set.';
      return action.reason.trim().length > 200 ? 'Keep the reason to 200 characters.' : null;
    case 'addTag':
      if (value === '') return 'Enter the tag to add.';
      return value.length > 40 ? 'Tags are at most 40 characters.' : null;
    case 'sendNotification':
      return value === '' ? 'Choose the notification to send.' : null;
    case 'startWorkflow':
      return value === '' ? 'Choose the workflow to start.' : null;
    case 'assignGroup':
      return value === '' ? 'Choose the team.' : null;
    case 'assignStrategy':
    case 'setField':
      return null;
  }
}

/** The action types a builder offers: *Assign to a team* only when teams can be named. */
export function offeredTypes({ teams }: { readonly teams: boolean }): { readonly value: string; readonly label: string }[] {
  return ACTION_TYPES.filter((type) => type.value !== 'assignGroup' || teams).map((type) => ({ value: type.value, label: type.label }));
}
