import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ApiError } from '@itsm/sdk';
import { RequestForm } from '../../../../components/RequestForm.js';
import { apiFor, requireSession } from '../../../../server/session.js';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  return { title: key };
}

/**
 * One catalogue item, and its form.
 *
 * A 404 here means one of two things — the item does not exist, or this person
 * is not entitled to it — and MOD-05 deliberately does not distinguish them.
 * So neither does this page: an item somebody cannot have must not be
 * discoverable by the error it produces.
 */
export default async function CatalogueItemPage({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<ReactNode> {
  const { key } = await params;
  const session = await requireSession();

  try {
    const item = await apiFor(session).catalogueItem(key);
    return (
      <div className="itsm-Page">
        <h1 className="itsm-Page__heading">{item.name}</h1>
        {item.description ? <p className="itsm-Page__lede">{item.description}</p> : null}
        <RequestForm itemKey={item.key} itemName={item.name} definition={item.form} />
      </div>
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
