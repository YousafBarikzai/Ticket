import { entriesOf, hashOf, selectorOf, type Pack, type PackKind } from './pack.js';

/**
 * What a newer version of a pack would do to a tenant that already has it.
 *
 * Pure, and separated from everything that reads a database, because the
 * awkward cases here are all combinations rather than queries: the pack moved
 * and the tenant did not, the tenant moved and the pack did not, both moved,
 * both moved and the tenant already said no to exactly this. Those are worth
 * a table of unit tests, and they are worth being able to read without a
 * database in the way.
 */

export type ItemState =
  /** In the pack, not here yet. */
  | 'add'
  /** Here, identical to what the pack ships. */
  | 'unchanged'
  /** The pack moved on; this copy is untouched, so it can be replaced safely. */
  | 'update'
  /** The pack moved on and so did this copy: taking it would replace an edit. */
  | 'conflict'
  /** The pack moved on and the tenant has already said no to this version. */
  | 'declined'
  /** Edited here, and the pack has not moved: nothing to offer, worth knowing. */
  | 'edited'
  /** Installed once, and no longer here: somebody deleted it. */
  | 'missing'
  /** Here, and the pack no longer ships it. Never deleted, only reported. */
  | 'retired';

export interface InstalledItem {
  kind: PackKind;
  key: string;
  /** The hash of the shipped definition this copy was made from. */
  sourceHash: string;
  declinedHash: string | null;
  /** The hash of what the tenant has right now, or null if it is gone. */
  currentHash: string | null;
}

export interface DiffLine {
  kind: PackKind;
  key: string;
  selector: string;
  state: ItemState;
  /** The hash the tenant would be moved to, for the states that offer one. */
  shippedHash: string | null;
}

/** States an administrator may act on by naming the item. */
export const TAKEABLE: ReadonlySet<ItemState> = new Set<ItemState>(['add', 'update', 'conflict', 'declined', 'missing']);

/** States where saying no is meaningful: there is a live offer to refuse. */
export const DECLINABLE: ReadonlySet<ItemState> = new Set<ItemState>(['update', 'conflict']);

/** States that still want a decision. `declined` is settled; `edited` is the tenant's. */
export const OUTSTANDING: ReadonlySet<ItemState> = new Set<ItemState>(['add', 'update', 'conflict', 'missing']);

export function diffPack(pack: Pack, installed: InstalledItem[]): DiffLine[] {
  const bySelector = new Map(installed.map((item) => [selectorOf(item.kind, item.key), item]));
  const lines: DiffLine[] = [];
  const seen = new Set<string>();

  for (const entry of entriesOf(pack)) {
    const selector = selectorOf(entry.kind, entry.key);
    seen.add(selector);
    const shippedHash = hashOf(entry.kind, entry.definition);
    const here = bySelector.get(selector);

    if (!here) {
      lines.push({ kind: entry.kind, key: entry.key, selector, state: 'add', shippedHash });
      continue;
    }
    if (here.currentHash === null) {
      lines.push({ kind: entry.kind, key: entry.key, selector, state: 'missing', shippedHash });
      continue;
    }

    const untouched = here.currentHash === here.sourceHash;
    if (shippedHash === here.sourceHash) {
      lines.push({
        kind: entry.kind,
        key: entry.key,
        selector,
        state: untouched ? 'unchanged' : 'edited',
        shippedHash: null,
      });
      continue;
    }
    if (here.declinedHash === shippedHash) {
      lines.push({ kind: entry.kind, key: entry.key, selector, state: 'declined', shippedHash });
      continue;
    }
    lines.push({
      kind: entry.kind,
      key: entry.key,
      selector,
      state: untouched ? 'update' : 'conflict',
      shippedHash,
    });
  }

  // Something the tenant has from an earlier version of this pack that the
  // pack no longer ships. Reported and left alone: a desk that has been using
  // a request type for a year does not want it withdrawn because the
  // deployment tidied its own catalogue.
  for (const item of installed) {
    const selector = selectorOf(item.kind, item.key);
    if (seen.has(selector)) continue;
    lines.push({ kind: item.kind, key: item.key, selector, state: 'retired', shippedHash: null });
  }

  return lines;
}

/** Whether a newer version of the pack has anything waiting for a decision. */
export function hasOutstanding(lines: DiffLine[]): boolean {
  return lines.some((line) => OUTSTANDING.has(line.state));
}

export function countByState(lines: DiffLine[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of lines) counts[line.state] = (counts[line.state] ?? 0) + 1;
  return counts;
}
