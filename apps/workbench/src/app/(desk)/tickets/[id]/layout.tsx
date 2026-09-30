import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { ApiError } from '@itsm/sdk';
import { loginHref } from '../../../../server/session.js';
import { gateTicket } from './bundle.js';

/**
 * The ticket page's gate, before anything streams (SPEC §3.6 rule 6, §5.3):
 * a ticket that does not exist — or is outside the reader's teams — answers
 * 404 with the in-shell not-found page, and a ticket reached by its id is
 * sent to its number URL (307), so the skeleton beside the page never turns
 * either into a 200.
 *
 * Any other failure (the API unwell, the network) is left to the page, which
 * shows the workspace's own error with Retry rather than an error page.
 */
export default async function TicketLayout({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }): Promise<ReactNode> {
  const { id: wanted } = await params;
  let number: string | null = null;
  try {
    number = (await gateTicket(wanted)).number;
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect(await loginHref());
      if (error.status === 403 || error.status === 404 || error.status === 400) notFound();
    }
  }
  if (number && number !== wanted) redirect(`/tickets/${encodeURIComponent(number)}`);
  return children;
}
