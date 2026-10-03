import type { ReactNode } from 'react';
import type { CatalogueItem } from '@itsm/sdk';
import { Button, Icon, IconTile, SectionHeader, Skeleton } from '@itsm/ui';
import { AppLink } from '../app/AppLink.js';
import { serviceIcon } from '../catalogue/icons.js';

/**
 * "Common requests" on Home (v3 §7.2, A6 §6.1.2): six things people can ask
 * for, as cards, then "Browse all services". In the catalogue's own order —
 * administrators order the catalogue, and there is no popularity data, so
 * the heading never claims "most requested".
 *
 * Each card is an `IconTile` (the catalogue's keyword icon), the item's name
 * as the one link, stretched over the card, and its short summary. The
 * "Needs approval" badge waits for the approval-route read (R9L), which the
 * catalogue list does not carry yet; the card has its place.
 *
 * Server-drawn, and written to be shared with Services (§6.4).
 */

/** How many cards Home shows. */
export const COMMON_REQUESTS = 6;

function Heading(): ReactNode {
  return (
    <SectionHeader
      id="home-common"
      title="Common requests"
      actions={
        <Button variant="ghost" size="sm" href="/catalogue" iconEnd="arrow-right">
          Browse all services
        </Button>
      }
    />
  );
}

export function CommonRequestCard({ item }: { readonly item: CatalogueItem }): ReactNode {
  return (
    <li className="app-CommonRequest">
      <IconTile icon={serviceIcon(item.service, item.name, item.shortSummary)} size={32} />
      <span className="app-CommonRequest__text">
        <AppLink className="app-CommonRequest__link" href={`/catalogue/${encodeURIComponent(item.key)}`}>
          {item.name}
        </AppLink>
        {item.shortSummary ? <span className="app-CommonRequest__summary">{item.shortSummary}</span> : null}
      </span>
      <Icon name="chevron-right" size="sm" className="app-CommonRequest__chevron" directional />
    </li>
  );
}

export function CommonRequests({ items }: { readonly items: readonly CatalogueItem[] }): ReactNode {
  const shown = items.slice(0, COMMON_REQUESTS);
  if (shown.length === 0) return null;
  return (
    <section className="app-Home__section app-Home__common" aria-labelledby="home-common">
      <Heading />
      <ul className="app-CommonRequests">
        {shown.map((item) => (
          <CommonRequestCard key={item.key} item={item} />
        ))}
      </ul>
    </section>
  );
}

export function CommonRequestsSkeleton(): ReactNode {
  return (
    <section className="app-Home__section app-Home__common" aria-labelledby="home-common" aria-busy="true">
      <Heading />
      <div className="app-CommonRequests" aria-hidden="true">
        {Array.from({ length: COMMON_REQUESTS }, (_, index) => (
          <Skeleton key={index} height="var(--app-home-common-height)" radius="lg" />
        ))}
      </div>
    </section>
  );
}
