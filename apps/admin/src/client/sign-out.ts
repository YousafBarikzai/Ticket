import { isDismissalKey, isRecentsKey } from '@itsm/ui';

/**
 * Signing out, from the account menu, the command palette or the demo bar's
 * *End demo* alike — and forgetting a demo visit's traces when the demo is
 * rebuilt underneath it.
 *
 * A sign-out is a POST to `/api/session/logout` (the frame's hidden
 * `#itsm-signout` form), never a link a prefetcher could follow. The frame's
 * form holds every submission until its `beforeSubmit` — `forgetThisPerson`
 * here — has run (SPEC v3 §3.7), so whichever control submits it, this
 * person's traces on this device are forgotten first: recent items and pins,
 * notices they dismissed, drafts. The console keeps no offline caches and no
 * outbox (ADR-0049), so there is nothing else to clear. A failure to tidy up
 * never blocks the sign-out itself.
 */

/** The browser keys that are this person's, beyond drafts: what sign-out and a demo reset both forget. */
export function isPersonalKey(key: string): boolean {
  return isRecentsKey(key) || isDismissalKey(key);
}

export async function forgetThisPerson(): Promise<boolean> {
  try {
    const { clearLocalData } = await import('@itsm/pwa');
    await clearLocalData({ caches: null, store: null, alsoKeys: isPersonalKey });
  } catch {
    // Signing out matters more than tidying up.
  }
  return true;
}

/**
 * Submit the frame's sign-out form, as the account menu does. The form's own
 * listener forgets this person first, so it is not done twice here.
 */
export function signOut(): void {
  const form = document.getElementById('itsm-signout');
  if (form instanceof HTMLFormElement) form.requestSubmit();
}

/**
 * The demo bar met a newer generation (`itsm:demo-generation-change`): the
 * visit's recents, pins and dismissed notices belong to data that no longer
 * exists, so they go, and the new generation is recorded so the notice is not
 * shown twice (`@itsm/pwa/demo`, A3 §6.10). Fetched only then — once a night
 * at most.
 */
export async function forgetForGeneration(generation: number): Promise<unknown> {
  const { clearDemoLocalData } = await import('@itsm/pwa/demo');
  return clearDemoLocalData({ generation, caches: null, store: null, alsoKeys: isPersonalKey });
}
