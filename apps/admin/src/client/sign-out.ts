import { isDismissalKey, isRecentsKey } from '@itsm/ui';

/**
 * Signing out, from the account menu or the command palette alike.
 *
 * A POST to `/api/session/logout` (the frame's hidden `#itsm-signout` form),
 * never a link a prefetcher could follow — and before it, this person's
 * traces on this device are forgotten: recent items and pins, notices they
 * dismissed, drafts. The console keeps no offline caches and no outbox
 * (ADR-0049), so there is nothing else to clear. A failure to tidy up never
 * blocks the sign-out itself.
 */
export async function forgetThisPerson(): Promise<boolean> {
  try {
    const { clearLocalData } = await import('@itsm/pwa');
    await clearLocalData({ caches: null, store: null, alsoKeys: (key) => isRecentsKey(key) || isDismissalKey(key) });
  } catch {
    // Signing out matters more than tidying up.
  }
  return true;
}

/** Forget, then submit the frame's sign-out form. */
export async function signOut(): Promise<void> {
  await forgetThisPerson();
  const form = document.getElementById('itsm-signout');
  if (form instanceof HTMLFormElement) form.requestSubmit();
}
