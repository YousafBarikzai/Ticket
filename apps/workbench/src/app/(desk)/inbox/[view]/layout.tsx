import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isViewId } from '../../../../inbox/views.js';

/**
 * Refuses a view that does not exist before anything streams, so
 * `/inbox/nonsense` answers 404 rather than a 200 carrying a not-found page:
 * the loading skeleton beside this file sits below it (SPEC §3.6 rule 6).
 */
export default async function InboxViewLayout({
  params,
  children,
}: {
  params: Promise<{ view: string }>;
  children: ReactNode;
}): Promise<ReactNode> {
  if (!isViewId((await params).view)) notFound();
  return children;
}
