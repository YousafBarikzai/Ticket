import type { CatalogueItem } from '@itsm/sdk';

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
 */

export const UNGROUPED = 'Everything else';

export interface CatalogueGroup {
  readonly service: string;
  readonly items: CatalogueItem[];
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
    .map(([service, list]) => ({ service, items: list }));
}
