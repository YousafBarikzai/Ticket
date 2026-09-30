import { cache, type ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ApiError, type CatalogueItem, type CatalogueItemDetail } from '@itsm/sdk';
import { Button, EmptyState } from '@itsm/ui';
import { serviceHref } from '../../../../catalogue/group.js';
import { RequestFlow } from '../../../../catalogue/RequestFlow.js';
import { SectionProblem } from '../../../../home/SectionProblem.js';
import { settle } from '../../../../home/settle.js';
import { mayOpen } from '../../../../navigation.js';
import { apiFor, currentMe, heldPermissions, loginHref, requireSession } from '../../../../server/session.js';
import '../catalogue.css';

export const dynamic = 'force-dynamic';

type Params = Promise<{ key: string }>;

/** One read of the item per request, shared by the page and its `<title>`. */
const readItem = cache(async (key: string): Promise<CatalogueItemDetail> => apiFor(await requireSession()).catalogueItem(key));

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { key } = await params;
  try {
    // The item's name, never its key (F38).
    return { title: (await readItem(key)).name };
  } catch {
    return { title: 'Services' };
  }
}

/**
 * `/catalogue/[key]` — asking for one thing (SPEC §6.3, F38): "‹ Services",
 * the item's name, what it is, then the request in steps beside a summary of
 * what happens next.
 *
 * A 404 here means one of two things — the item does not exist, or this person
 * is not entitled to it — and MOD-05 deliberately does not distinguish them.
 * So neither does this page: an item somebody cannot have must not be
 * discoverable by the error it produces. Any other failure keeps the way back
 * and a heading, and says so with Retry.
 *
 * The catalogue list is read beside the item for the one thing the item does
 * not say — which service it sits under — and is allowed to fail.
 */
export default async function CatalogueItemPage({ params }: { params: Params }): Promise<ReactNode> {
  const { key } = await params;
  const session = await requireSession();
  const me = await currentMe();

  if (!mayOpen('/catalogue/[key]', heldPermissions(me))) {
    return (
      <div className="app-Page app-ServiceRequest">
        <BackToServices href="/catalogue" />
        <h1 className="app-ServiceRequest__title" tabIndex={-1}>
          Services
        </h1>
        <EmptyState
          tone="forbidden"
          icon="lock"
          headingLevel={2}
          title="Services aren’t available to you"
          description="Your account can’t request services here. You can still report an issue or follow your requests."
          action={{ id: 'requests', label: 'My requests', href: '/tickets' }}
        />
      </div>
    );
  }

  const [item, list] = await Promise.all([settleItem(readItem(key)), settle(apiFor(session).catalogue())]);

  if (item.kind !== 'ok') {
    if (item.kind === 'missing') notFound();
    if (item.kind === 'signed-out') redirect(await loginHref());
    return (
      <div className="app-Page app-ServiceRequest">
        <BackToServices href="/catalogue" />
        <h1 className="app-ServiceRequest__title" tabIndex={-1}>
          Request a service
        </h1>
        <SectionProblem what="this service" />
      </div>
    );
  }

  const listed: CatalogueItem | undefined = list.ok ? list.value.data.find((entry) => entry.key === item.value.key) : undefined;
  const service = listed?.service ? { name: listed.service, key: listed.serviceKey } : null;

  return (
    <div className="app-Page app-ServiceRequest">
      <BackToServices href={serviceHref(listed?.serviceKey)} />
      <header className="app-ServiceRequest__header">
        {service ? <p className="app-ServiceRequest__eyebrow">{service.name}</p> : null}
        <h1 className="app-ServiceRequest__title" tabIndex={-1}>
          {item.value.name}
        </h1>
        {item.value.description ? <p className="app-ServiceRequest__lede">{item.value.description}</p> : null}
      </header>
      <RequestFlow
        item={{ key: item.value.key, name: item.value.name }}
        service={service}
        form={item.value.form}
        me={{ id: me.actor.id, name: me.actor.displayName, locale: me.locale }}
      />
    </div>
  );
}

type ItemRead = { readonly kind: 'ok'; readonly value: CatalogueItemDetail } | { readonly kind: 'missing' | 'signed-out' | 'failed' };

async function settleItem(read: Promise<CatalogueItemDetail>): Promise<ItemRead> {
  try {
    return { kind: 'ok', value: await read };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { kind: 'missing' };
    if (error instanceof ApiError && error.status === 401) return { kind: 'signed-out' };
    return { kind: 'failed' };
  }
}

/** "‹ Services": back to the item's own service on the catalogue, as the request detail's "‹ My requests" does. */
function BackToServices({ href }: { readonly href: string }): ReactNode {
  return (
    <Button variant="ghost" size="sm" iconStart="chevron-left" href={href} className="app-ServiceRequest__back">
      Services
    </Button>
  );
}
