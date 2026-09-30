import { redirect } from 'next/navigation';
import { queueRedirectTarget, type SearchParams } from '../../../inbox/views.js';

/**
 * The old queue URL, kept working (SPEC §5.3): bookmarks, links in chats and
 * the notification emails that point at `/queue?assignee=me` land on the
 * matching inbox view with their filters carried. `redirect()` answers 307,
 * so nothing caches it as permanent while the old URLs are still in the wild.
 */
export default async function QueueRedirect({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<never> {
  redirect(queueRedirectTarget(await searchParams));
}
