import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isUuid } from '../../../../../inbox/views.js';

/**
 * Refuses a team reference that is not an id before anything streams, so a
 * mistyped link answers 404 (the loading skeleton sits below, SPEC §3.6 rule 6).
 */
export default async function TeamInboxLayout({
  params,
  children,
}: {
  params: Promise<{ teamId: string }>;
  children: ReactNode;
}): Promise<ReactNode> {
  if (!isUuid((await params).teamId)) notFound();
  return children;
}
