import type { PriorityMatrixRow } from '@itsm/sdk';

/**
 * The nine cells of the impact-and-urgency grid.
 *
 * Pure, and separate from the component, because the rule it enforces is the
 * one the API enforces back: `matrixSchema` is `.length(9)` and the service
 * rejects a duplicate impact-and-urgency pair. Sending the cells somebody
 * happened to change would be refused; sending eight would be refused. So the
 * grid is always completed from what is stored before it is sent.
 */

export const LEVELS = ['high', 'medium', 'low'] as const;
export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;

export type Level = (typeof LEVELS)[number];

/**
 * A sensible priority for a cell nobody has set.
 *
 * The diagonal: high impact and high urgency is a P1, low and low is a P4, and
 * everything else falls between. This is only ever a starting point for a grid
 * that has never been saved — once a tenant has a matrix, theirs is used.
 */
function defaultFor(impact: Level, urgency: Level): (typeof PRIORITIES)[number] {
  const rank = LEVELS.indexOf(impact) + LEVELS.indexOf(urgency);
  return PRIORITIES[Math.min(rank, PRIORITIES.length - 1)]!;
}

/** What is stored, completed to all nine cells in a stable order. */
export function completeMatrix(rows: readonly PriorityMatrixRow[]): PriorityMatrixRow[] {
  const stored = new Map(rows.map((row) => [`${row.impact}:${row.urgency}`, row.priority]));
  return LEVELS.flatMap((impact) =>
    LEVELS.map((urgency) => ({
      impact,
      urgency,
      priority: stored.get(`${impact}:${urgency}`) ?? defaultFor(impact, urgency),
    })),
  );
}

/** One cell, for the grid to render. */
export function matrixValue(rows: readonly PriorityMatrixRow[], impact: Level, urgency: Level): string {
  return rows.find((row) => row.impact === impact && row.urgency === urgency)?.priority ?? defaultFor(impact, urgency);
}
