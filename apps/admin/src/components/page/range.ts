import type { MetricRange } from '@itsm/sdk';

/**
 * The periods a page's range control can offer, and the links between them.
 *
 * Pure and server-safe: the toolbar's `RangeControl` (a client island) and a
 * server page building a card's "View all" link use the same `rangeHref`, so a
 * link never drops the filters the person had set.
 *
 * Which periods a page offers is decided on the server by `rangesFor()` in
 * `server/periods.ts` (A7 §2.3); its `RangeKey` is a subset of
 * `PageRangeKey`, so its answer can be handed to `RangeControl` as it is. The
 * AI triage pages keep their `180d` here too, until they move to the toolbar.
 */
export type PageRangeKey = MetricRange | '180d';

/** How each period reads on its segment: short, because the toolbar wraps on a phone. */
export const RANGE_LABELS: Readonly<Record<PageRangeKey, string>> = Object.freeze({
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '180d': '180 days',
  '12m': '12 months',
  ytd: 'Year to date',
  custom: 'Custom',
});

/**
 * The periods the shared demo never offers (D17): its data covers 120 days,
 * so a 12-month or year-to-date view would be mostly empty and read as broken.
 * `rangesFor()` drops them already; the control drops them again, so a page
 * that forgets to ask cannot show them to a visitor.
 */
export const DEMO_HIDDEN_RANGES: ReadonlySet<PageRangeKey> = new Set<PageRangeKey>(['12m', 'ytd', '180d']);

export function isPageRangeKey(value: unknown): value is PageRangeKey {
  return typeof value === 'string' && Object.hasOwn(RANGE_LABELS, value);
}

/** An option as `rangesFor()` may give it: the key alone, or the key with its own label. */
export type RangeOptionInput = PageRangeKey | { readonly value: PageRangeKey; readonly label?: string };

export interface RangeOption {
  readonly value: PageRangeKey;
  readonly label: string;
}

/** The options to draw, in the order given, without duplicates, and without the demo's hidden periods. */
export function visibleRanges(options: readonly RangeOptionInput[], demo: boolean): RangeOption[] {
  const seen = new Set<PageRangeKey>();
  const out: RangeOption[] = [];
  for (const option of options) {
    const value = typeof option === 'string' ? option : option.value;
    if (!isPageRangeKey(value) || seen.has(value)) continue;
    if (demo && DEMO_HIDDEN_RANGES.has(value)) continue;
    seen.add(value);
    out.push({ value, label: (typeof option === 'string' ? undefined : option.label) ?? RANGE_LABELS[value] });
  }
  return out;
}

/** The query a page was rendered with, in any of the shapes Next hands it over. */
export type QueryInput = URLSearchParams | string | Readonly<Record<string, string | readonly string[] | undefined>>;

function toSearchParams(query: QueryInput): URLSearchParams {
  if (query instanceof URLSearchParams) return new URLSearchParams(query);
  if (typeof query === 'string') return new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') params.append(key, value);
    else if (Array.isArray(value)) for (const item of value) params.append(key, item);
  }
  return params;
}

/**
 * The same page for another period: every other query parameter kept, `range`
 * replaced, and `from`/`to` kept only for a custom period. A list's cursor
 * (`cursor`, `after`) is dropped, because a page of results from one period
 * means nothing in another.
 *
 * Moved here from the Command centre's `VolumeView` (A7 §2.3), which knew only
 * its own path and its own three periods.
 */
export function rangeHref(
  path: string,
  query: QueryInput,
  range: PageRangeKey,
  custom?: { readonly from?: string; readonly to?: string },
): string {
  const params = toSearchParams(query);
  params.delete('cursor');
  params.delete('after');
  params.set('range', range);
  params.delete('from');
  params.delete('to');
  if (range === 'custom') {
    if (custom?.from) params.set('from', custom.from);
    if (custom?.to) params.set('to', custom.to);
  }
  const search = params.toString();
  const base = path.startsWith('/') && !path.startsWith('//') ? path : '/';
  return search ? `${base}?${search}` : base;
}
