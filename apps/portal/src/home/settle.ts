/**
 * A read that is allowed to fail: the section that shows it says so ("Couldn't
 * load your requests · Retry"), and the page around it carries on. Its own
 * module (no components) so any page can use it without pulling a section's
 * client components into its bundle.
 */
export type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

export function settle<T>(work: Promise<T>): Promise<Settled<T>> {
  return work.then(
    (value) => ({ ok: true as const, value }),
    () => ({ ok: false as const }),
  );
}
