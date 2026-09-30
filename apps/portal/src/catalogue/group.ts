import type { CatalogueItem } from '@itsm/sdk';
import { serviceMatches } from '../client/palette.js';

/**
 * Grouping the catalogue by service.
 *
 * That is how somebody looks for a thing: they know they want "a second
 * monitor", not which request type it is. Two decisions worth a test:
 *
 * An item whose service was removed after it was published still appears,
 * under "Everything else", rather than disappearing. An item you can order is
 * an item you should see, and a dangling `serviceId` is an administrator's
 * problem rather than a requester's.
 *
 * "Everything else" sorts last however the locale collates, because a bucket
 * that lands in the middle of the alphabet reads as a service called
 * Everything.
 *
 * Each group carries its `anchor`, the id of its section on `/catalogue`: the
 * service's own key, so Home's topic tiles (`/catalogue#<serviceKey>`, WP14's
 * `topicHref`) land on it.
 */

export const UNGROUPED = 'Everything else';

/** The section id for items with no service. Not a key a service can have (keys never contain a colon). */
export const UNGROUPED_ANCHOR = 'services:other';

export interface CatalogueGroup {
  readonly service: string;
  /** The section's id: the service's key, or a slug of its name when the key is missing. */
  readonly anchor: string;
  readonly items: CatalogueItem[];
}

/** An id from a service's name, for a service whose key did not come through. */
function slug(name: string): string {
  const folded = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `service-${folded || 'unnamed'}`;
}

export function groupByService(items: readonly CatalogueItem[]): CatalogueGroup[] {
  const byService = new Map<string, CatalogueItem[]>();
  for (const item of items) {
    const key = item.service ?? UNGROUPED;
    const list = byService.get(key);
    if (list) list.push(item);
    else byService.set(key, [item]);
  }

  return [...byService.entries()]
    .sort(([a], [b]) => {
      if (a === UNGROUPED) return 1;
      if (b === UNGROUPED) return -1;
      return a.localeCompare(b, 'en-GB');
    })
    .map(([service, list]) => ({
      service,
      anchor: service === UNGROUPED ? UNGROUPED_ANCHOR : (list.find((item) => item.serviceKey)?.serviceKey ?? slug(service)),
      items: list,
    }));
}

/**
 * The items a search keeps: every word somewhere in the name, summary,
 * description or service — the rule Home's suggestions, the palette and
 * `/search` already use, so the four never disagree about what matches.
 */
export function filterCatalogue(items: readonly CatalogueItem[], query: string): CatalogueItem[] {
  const words = query.trim();
  return words ? items.filter((item) => serviceMatches(item, words)) : [...items];
}

/** Where "‹ Services" goes from an item: its service's section, so Back lands where the person came from. */
export function serviceHref(serviceKey: string | null | undefined): string {
  return serviceKey ? `/catalogue#${encodeURIComponent(serviceKey)}` : '/catalogue';
}
