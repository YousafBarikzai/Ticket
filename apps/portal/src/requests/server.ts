import 'server-only';
import { cache } from 'react';
import { ApiError, type Ticket } from '@itsm/sdk';
import { apiFor, requireSession } from '../server/session.js';

/**
 * A request, read once per server request: the page's `<title>` and the
 * page itself ask for the same one, and `cache()` makes that one call to the
 * API. `GET /tickets/:id` is the lensed read — only the fields this reader
 * may see — and carries the version every move is written against.
 *
 * Settled rather than thrown, so the page decides: 404 is "not found" (the
 * API answers the same for a request that is not theirs, deliberately), and
 * anything else is "Couldn't load this request" with the heading kept.
 */
export type TicketRead = { readonly ok: true; readonly ticket: Ticket } | { readonly ok: false; readonly status: number };

export const readTicket = cache(async (reference: string): Promise<TicketRead> => {
  const session = await requireSession();
  try {
    return { ok: true, ticket: await apiFor(session).ticket(reference) };
  } catch (error) {
    return { ok: false, status: error instanceof ApiError ? error.status : 0 };
  }
});
