import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LAST_VIEW_COOKIE, inboxLanding } from '../../../inbox/views.js';

/**
 * `/inbox` opens where the agent left off (SPEC §5.3): the view named by the
 * last-view cookie, which the proxy sets on every visit to a view, or My work
 * the first time. The cookie is checked against the registry, so a hand-made
 * value cannot send anybody anywhere but a view.
 */
export default async function InboxLanding(): Promise<never> {
  redirect(inboxLanding((await cookies()).get(LAST_VIEW_COOKIE)?.value));
}
