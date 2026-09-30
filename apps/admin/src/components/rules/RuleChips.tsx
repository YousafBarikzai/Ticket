import type { ReactNode } from 'react';
import { Badge } from '@itsm/ui';
import { actionChip, conditionSummary } from './presentation.js';
import type { RuleNames } from './types.js';

/**
 * A rule's *If* and *Then* as chips, for the list and the history
 * (SPEC §6.1): `Priority is P1 · Critical` `and` `Channel is Email`;
 * `Set priority → P1` `Notify the assignee`. Server-safe: no state.
 */

export function ConditionChips({ conditions, names }: { readonly conditions: unknown; readonly names?: RuleNames }): ReactNode {
  const summary = conditionSummary(conditions, names);
  if (summary.kind === 'every') return <span className="app-RuleChips__quiet">Every time</span>;
  if (summary.kind === 'custom') {
    return (
      <Badge size="sm" tone="neutral" icon="settings-2">
        Custom condition
      </Badge>
    );
  }
  return (
    <ul className="app-RuleChips" aria-label={summary.join === 'and' ? 'All of these' : 'Any of these'}>
      {summary.chips.map((chip, index) => (
        <li key={`${index}:${chip}`} className="app-RuleChips__item">
          {index > 0 ? (
            <span className="app-RuleChips__join" aria-hidden="true">
              {summary.join === 'and' ? 'and' : 'or'}
            </span>
          ) : null}
          <Badge size="sm" tone="neutral">
            {chip}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function ActionChips({ actions, names }: { readonly actions: readonly unknown[]; readonly names?: RuleNames }): ReactNode {
  if (actions.length === 0) return <span className="app-RuleChips__quiet">Nothing</span>;
  return (
    <ul className="app-RuleChips">
      {actions.map((action, index) => {
        const chip = actionChip(action, names);
        return (
          <li key={`${index}:${chip.label}`} className="app-RuleChips__item">
            <Badge size="sm" tone="neutral" icon={chip.icon}>
              {chip.label}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
