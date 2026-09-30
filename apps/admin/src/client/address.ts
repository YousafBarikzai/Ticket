'use client';

/**
 * The address bar, between a write and the refresh that follows it.
 *
 * A successful write refreshes the page's server data (`useMutation`), and
 * the caller very often changes the address in the same breath: a create
 * sheet closes (`?new=` goes, usually by going Back), or the new record's
 * drawer opens (`?open=`). A refresh that starts *before* that change is
 * answered for the old address, and when it lands Next puts the old address
 * back — the sheet re-opens, empty, over the row that was just added (and in
 * development the page can reload outright). So the refresh waits for the
 * address to settle:
 *
 *   - `pushState`/`replaceState` are synchronous, and a caller that uses them
 *     has done so before the next task;
 *   - Back is not: the address changes when its `popstate` arrives. Every
 *     Back this console takes for a drawer or a sheet goes through `goBack()`,
 *     which counts it, so the refresh knows to wait for that `popstate`.
 *
 * A Back that never produces a `popstate` (nothing to go back to) is given
 * up on after a second, and the refresh runs anyway.
 */

let pendingBacks = 0;

/** `history.back()`, counted until its `popstate` arrives. */
export function goBack(): void {
  pendingBacks += 1;
  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    pendingBacks = Math.max(0, pendingBacks - 1);
    window.removeEventListener('popstate', settle);
  };
  window.addEventListener('popstate', settle);
  window.setTimeout(settle, GIVE_UP_MS);
  window.history.back();
}

/** How long a Back may take before a waiting refresh stops waiting for it. */
export const GIVE_UP_MS = 1000;

/** Runs `run` once the caller's address change, if any, has happened. */
export function afterAddressSettles(run: () => void): void {
  if (typeof window === 'undefined') {
    run();
    return;
  }
  window.setTimeout(() => {
    if (pendingBacks === 0) {
      run();
      return;
    }
    let done = false;
    const go = (): void => {
      if (done) return;
      done = true;
      window.removeEventListener('popstate', onPop);
      run();
    };
    // After Next has handled the same popstate, so the refresh is for the new address.
    const onPop = (): void => void window.setTimeout(go, 0);
    window.addEventListener('popstate', onPop);
    window.setTimeout(go, GIVE_UP_MS);
  }, 0);
}

/** For tests: forget any Back still being waited for. */
export function resetAddress(): void {
  pendingBacks = 0;
}
