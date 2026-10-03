import 'server-only';
import type { Admin, TicketCountDimension, TicketFilter } from '@itsm/sdk';
import { read, type Read } from './read.js';
import { inParallel } from './metrics.js';

/**
 * Exact ticket counts for KPI tiles and register strips (A7 §2.4 rule 9).
 *
 * `GET /tickets/count` is exact up to a thousand and says when it stopped
 * counting (`capped`); a tile then reads "999+" rather than a number that
 * looks exact and is not. Breakdowns go through `GET /tickets/counts?groupBy=`
 * (R2g) when the API has it — one call whose groups always add up to its
 * total — and otherwise one count per key, six at a time.
 */

export interface CountValue {
  readonly value: number;
  /** The API stopped counting: show "999+", never the number. */
  readonly capped: boolean;
}

/** The largest number a capped count may claim. */
export const COUNT_CAP = 999;

/** A count as a tile shows it: "1,204" exact, "999+" when the API stopped counting. */
export function countText(count: CountValue, locale = 'en-GB'): string {
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return count.capped ? `${format.format(COUNT_CAP)}+` : format.format(count.value);
}

export async function countTickets(api: Admin, filter: TicketFilter = {}): Promise<Read<CountValue>> {
  return read(async () => {
    const answer = await api.observe.ticketCount(filter);
    return { value: answer.count, capped: answer.capped === true };
  });
}

/** The dimensions a breakdown can be asked by, one call per key when grouped counts are missing. */
export type CountDimension = Extract<TicketCountDimension, 'priority' | 'status' | 'statusCategory' | 'type' | 'group' | 'assignee' | 'service'>;

export interface CountGroup extends CountValue {
  /** `null` is "none": no team, nobody assigned, no service. */
  readonly key: string | null;
  readonly label: string;
}

export interface CountBreakdown {
  readonly groups: readonly CountGroup[];
  /** Whether every group is an exact count (`false` when any one stopped counting). */
  readonly exact: boolean;
}

/** What a "none" group is called, per dimension. */
export function noneLabel(dimension: CountDimension): string {
  switch (dimension) {
    case 'group':
      return 'No team';
    case 'assignee':
      return 'Unassigned';
    case 'service':
      return 'No service';
    default:
      return 'None';
  }
}

/** The filter that counts one key of a dimension on top of `base`; `null` when the API cannot express it. */
function filterFor(base: TicketFilter, dimension: CountDimension, key: string | null): TicketFilter | null {
  if (key === null) return dimension === 'assignee' ? { ...base, assignee: 'none' } : null;
  return { ...base, [dimension]: key };
}

/** Whether the API answered "no such route": one from before grouped counts (R2g). */
function groupedMissing(problem: { readonly status: number }): boolean {
  return problem.status === 404 || problem.status === 405;
}

/**
 * Open work by priority, by team, by status…: one group per key, in the
 * order of `keys`, each labelled (`label(key)`, then the key itself, and
 * `noneLabel` for `null`). Without `keys` the grouped answer is returned as
 * the API orders it; the per-key fallback needs them.
 */
export async function countBy(
  api: Admin,
  base: TicketFilter,
  dimension: CountDimension,
  keys?: readonly (string | null)[],
  label: (key: string) => string | null | undefined = () => null,
): Promise<Read<CountBreakdown>> {
  const name = (key: string | null): string => (key === null ? noneLabel(dimension) : (label(key) ?? key));
  const grouped = await read(() => api.observe.ticketCounts(dimension, base));
  if (grouped.ok) {
    const byKey = new Map(grouped.value.groups.map((group) => [group.key, group.count]));
    const wanted = keys ?? grouped.value.groups.map((group) => group.key);
    return {
      ok: true,
      value: { exact: true, groups: wanted.map((key) => ({ key, label: name(key), value: byKey.get(key) ?? 0, capped: false })) },
    };
  }
  // Only an API without grouped counts (404, 405) falls back; any other refusal is the answer.
  if (!groupedMissing(grouped.problem)) return grouped;
  if (!keys) return { ok: false, message: 'This breakdown needs grouped counts.', problem: { status: 501 } };

  const asked = keys.map((key) => ({ key, filter: filterFor(base, dimension, key) })).filter((entry) => entry.filter !== null);
  const answers = await inParallel(
    asked.map((entry) => () => countTickets(api, entry.filter!)),
    6,
  );
  const failed = answers.find((answer) => !answer.ok);
  if (failed && !failed.ok) return failed;
  const groups = asked.map((entry, index) => {
    const answer = answers[index]!;
    const count = answer.ok ? answer.value : { value: 0, capped: false };
    return { key: entry.key, label: name(entry.key), value: count.value, capped: count.capped };
  });
  return { ok: true, value: { exact: groups.every((group) => !group.capped), groups } };
}
