import { redirect } from 'next/navigation';
import { mayOpen } from '../../../../navigation.js';
import { loadActor } from '../../../../server/session.js';

export const dynamic = 'force-dynamic';

/**
 * The old automation hub, now a permission-aware redirect (SPEC §5.2):
 * `/automation` → `/rules` for people who may open Rules, otherwise
 * `/workflows`. A route handler rather than a page, so the answer is a real
 * 307 before anything renders: a page under the console's loading boundary
 * streams its frame first, and its `redirect()` could then only be a
 * client-side hop with a 200.
 *
 * Someone who may open neither lands on Rules, which says in the frame why
 * they can't see it — the same Forbidden every page shows. A session that
 * has gone is sent to sign in by `loadActor`, with this path to come back to.
 */
export async function GET(): Promise<never> {
  const actor = await loadActor();
  const me = actor.kind === 'ok' ? actor.me : null;
  redirect(me && !mayOpen(me, '/rules') && mayOpen(me, '/workflows') ? '/workflows' : '/rules');
}
