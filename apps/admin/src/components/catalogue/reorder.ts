/**
 * Moving one row up or down in a list whose order is a number on each row
 * (`sortOrder` on request types, `order` on ticket fields) — the plan of
 * writes, kept pure so the menu, Alt+↑/↓ and the tests agree.
 *
 * When the row and its neighbour have different numbers they swap them:
 * two writes. When they share one — both left at the default — no swap can
 * change anything, so the whole list is numbered afresh in steps of ten
 * (room to move later without renumbering again), and only the rows whose
 * number actually changes are written.
 */
export interface Ordered {
  readonly key: string;
  readonly order: number;
}

export function planMove(rows: readonly Ordered[], key: string, direction: 'up' | 'down', { max = 10_000 }: { max?: number } = {}): Ordered[] {
  const index = rows.findIndex((row) => row.key === key);
  const target = index + (direction === 'up' ? -1 : 1);
  if (index < 0 || target < 0 || target >= rows.length) return [];
  const row = rows[index]!;
  const neighbour = rows[target]!;
  if (row.order !== neighbour.order) {
    return [
      { key: row.key, order: neighbour.order },
      { key: neighbour.key, order: row.order },
    ];
  }
  const moved = [...rows];
  moved.splice(index, 1);
  moved.splice(target, 0, row);
  const step = Math.max(1, Math.min(10, Math.floor(max / Math.max(1, moved.length))));
  return moved.map((entry, at) => ({ key: entry.key, order: (at + 1) * step })).filter((entry) => rows.find((row) => row.key === entry.key)?.order !== entry.order);
}

/** The rows with a plan applied, in their new order (stable for equal numbers). */
export function applyMoves<T extends { readonly key: string }>(rows: readonly T[], orderOf: (row: T) => number, changes: ReadonlyMap<string, number>): T[] {
  return rows
    .map((row, index) => ({ row, index, order: changes.get(row.key) ?? orderOf(row) }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map((entry) => entry.row);
}
