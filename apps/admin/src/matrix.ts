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
export type Priority = (typeof PRIORITIES)[number];

/** Title-cased axis words: the grid's visible legend reads "High", never "high". */
export const LEVEL_LABELS: Readonly<Record<Level, string>> = { high: 'High', medium: 'Medium', low: 'Low' };

/** What each priority means, beside its code — the chip reads "P2 · High". */
export const PRIORITY_LABELS: Readonly<Record<Priority, string>> = { P1: 'Critical', P2: 'High', P3: 'Medium', P4: 'Low' };

/**
 * The recommended priority for a cell: the diagonal. High impact and high
 * urgency is a P1, low and low is a P4, and everything else falls between.
 *
 * Exported because it is also "Reset to recommended" on the matrix page, and
 * the starting point for a grid that has never been saved — once a tenant has
 * a matrix, theirs is used.
 */
export function defaultFor(impact: Level, urgency: Level): Priority {
  const rank = LEVELS.indexOf(impact) + LEVELS.indexOf(urgency);
  return PRIORITIES[Math.min(rank, PRIORITIES.length - 1)]!;
}

/** The recommended grid, all nine cells, in the stable order. */
export function recommendedMatrix(): PriorityMatrixRow[] {
  return LEVELS.flatMap((impact) => LEVELS.map((urgency) => ({ impact, urgency, priority: defaultFor(impact, urgency) })));
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
export function matrixValue(rows: readonly PriorityMatrixRow[], impact: Level, urgency: Level): Priority {
  return rows.find((row) => row.impact === impact && row.urgency === urgency)?.priority ?? defaultFor(impact, urgency);
}

/** The grid with one cell changed; always nine cells, never a duplicate. */
export function withCell(rows: readonly PriorityMatrixRow[], impact: Level, urgency: Level, priority: Priority): PriorityMatrixRow[] {
  return completeMatrix(rows).map((cell) => (cell.impact === impact && cell.urgency === urgency ? { ...cell, priority } : cell));
}

/** How many cells differ between two grids: the dirty bar's "2 unsaved changes". */
export function changedCells(before: readonly PriorityMatrixRow[], after: readonly PriorityMatrixRow[]): number {
  const base = completeMatrix(before);
  const next = completeMatrix(after);
  return base.filter((cell, index) => cell.priority !== next[index]!.priority).length;
}

/**
 * A stable fingerprint of what is stored, so the editor knows when the server
 * has sent something new (after a save and refresh, or another person's
 * change) and resyncs from it — the old grid kept its first draft for ever.
 */
export function matrixSignature(rows: readonly PriorityMatrixRow[]): string {
  return completeMatrix(rows)
    .map((cell) => cell.priority)
    .join('');
}
