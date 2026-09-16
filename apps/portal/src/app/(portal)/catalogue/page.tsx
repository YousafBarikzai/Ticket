import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ApiError, type CatalogueItem } from '@itsm/sdk';
import { Card, EmptyState } from '@itsm/ui';
import { groupByService } from '../../../catalogue/group.js';
import { apiFor, requireSession } from '../../../server/session.js';

export const metadata: Metadata = { title: 'Request something' };
export const dynamic = 'force-dynamic';

/**
 * The catalogue.
 *
 * The list is already filtered by entitlement on the server (MOD-05): what is
 * not here is not here because this person cannot have it, and nothing on this
 * page says so. That is deliberate — a catalogue that showed locked items
 * would be a list of things to ask about.
 */
export default async function CataloguePage(): Promise<ReactNode> {
  const session = await requireSession();

  let items: readonly CatalogueItem[];
  try {
    items = (await apiFor(session).catalogue()).data;
  } catch (error) {
    return (
      <EmptyState
        tone="error"
        title="The catalogue could not be loaded"
        description={error instanceof ApiError ? error.message : 'The service could not be reached.'}
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing to request yet"
        description="Your IT team has not published anything here. You can still report an issue."
        action={<Link href="/report">Report an issue</Link>}
      />
    );
  }

  return (
    <div className="itsm-Page">
      <h1 className="itsm-Page__heading">Request something</h1>
      <p className="itsm-Page__lede">Pick what you need. Some of these need an approval before they start.</p>

      {groupByService(items).map(({ service, items: list }) => (
        <section key={service} className="itsm-Catalogue__group" aria-label={service}>
          <h2>{service}</h2>
          <div className="itsm-Catalogue__items">
            {list.map((item) => (
              <Card key={item.key} title={item.name} subtitle={item.shortSummary ?? undefined}>
                <Link className="itsm-Catalogue__link" href={`/catalogue/${encodeURIComponent(item.key)}`}>
                  Request this<span className="itsm-visually-hidden">: {item.name}</span>
                </Link>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
