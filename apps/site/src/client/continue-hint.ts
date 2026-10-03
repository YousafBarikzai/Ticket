/**
 * The "Continue the demo" hint, writer half (SPEC v3 §6.1 "Continue hint";
 * A5 §3.9).
 *
 * The site sets no cookie and cannot read the apps' cookies, yet a visitor who
 * opened the demo as Alex and comes back to the site should be offered "Return
 * to the Service Desk as Alex Morgan". So the site remembers the last role
 * pressed, in this browser only, under one `localStorage` key:
 *
 *   `itsm-site:continue` = `{"p":"agent","u":<the next reset, epoch ms>}`
 *
 * written when a role link is pressed (any `[data-persona]`), and removed by
 * `?ended=1`, by a "Forget" button (`[data-forget]`) or once `u` has passed —
 * the demo it pointed at no longer exists after a reset. It is never sent
 * anywhere.
 *
 * This module holds `HINT_LISTEN`, the inline script the root layout places
 * at the end of `<body>`: one capture-phase click listener and `?ended=1`.
 * The reader that unhides a server-rendered "Continue" card before
 * paint (`HINT_READ`) is the chooser's (`continue-read.ts`). Both are inline
 * HTML rather than bundles — no first-load JavaScript, covered by the CSP's
 * `'unsafe-inline'` — and small: this one is under 380 bytes (tested).
 *
 * Every storage access is in `try`, so a browser with storage blocked (Safari
 * private windows, a locked-down profile) gets a page that works the same and
 * a script that throws nothing. `u` comes from `<html data-next-reset>`,
 * rendered by the server from the pure UK clock on every request.
 */

/** The one storage key the site uses (listed on the cookies page; the reader in `continue-read.ts` names the same). */
export const CONTINUE_KEY = 'itsm-site:continue';

/**
 * The listener, written by hand in the form it ships (there is no minifier
 * for an inline string). In order: `s` stores a value, or removes the key
 * when given none, inside `try`; `?ended=1` — the apps' signed-out pages link
 * home with it — removes the hint; then one capture-phase click listener
 * (capture, so nothing on the page can stop it first): a role link
 * (`[data-persona]`) stores `{p, u}` with `u` from `<html data-next-reset>`,
 * and a "Forget" button (`[data-forget]`) removes the hint and hides the card
 * it sits in.
 *
 * It does not validate the persona: the only `data-persona` attributes on the
 * site are rendered by its own server from the persona table, and the reader
 * drops anything it does not recognise. `?from=` is the reader's alone: the
 * chooser is the only page with a card to show, and no app links anywhere
 * else with it.
 */
export const HINT_LISTEN =
  '{let d=document,s=v=>{try{localStorage[v?"setItem":"removeItem"]("' +
  CONTINUE_KEY +
  '",v)}catch(e){}};/ended=1/.test(location.search)&&s();' +
  'd.addEventListener("click",e=>{let a=e.target.closest("[data-persona],[data-forget]"),p=a?.dataset.persona;' +
  'a&&(p?s(JSON.stringify({p,u:+d.documentElement.dataset.nextReset})):(s(),(a.closest("[data-continue]")||{}).hidden=1))},!0)}';
