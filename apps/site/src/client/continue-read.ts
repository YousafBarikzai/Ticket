/**
 * The reader half of the "Continue the demo" hint (SPEC v3 §6.1; A5 §3.9,
 * §6.6): `HINT_READ`, an inline script placed straight after the chooser's
 * hidden continue cards. The writer half (`HINT_LISTEN`, role-button clicks
 * and "Forget") is the root layout's (`continue-hint.ts`).
 *
 * Why a hint in `localStorage` at all: the app's re-entry cookie is host-only
 * on each app origin, so the site can never see it, and must not try (D22).
 * A hint can be wrong only harmlessly — the app's `/demo` decides — so the
 * script runs before first paint, unhides at most one server-rendered card and
 * causes no layout shift after it.
 *
 * What it does, in order:
 *   1. `?ended=1` (the apps' signed-out page links home with it): forget.
 *   2. `?from=<persona>` (an app's demo bar links home with it): remember
 *      that persona until the next reset, read from `<html data-next-reset>`.
 *   3. A remembered persona whose reset time is still ahead: unhide its card
 *      (`[data-continue="<persona>"]`). Anything else stored: remove it.
 *
 * Every step sits in one `try`: a browser that blocks storage (private mode,
 * a policy) simply never sees a card. Written by hand in ES5 so the string is
 * what ships; `continue-read.test.ts` runs it in jsdom and holds its size.
 */

/** The one storage key the site writes; listed on the cookies page. */
export const CONTINUE_KEY = 'itsm-site:continue';

/** The persona keys the script accepts, as a pattern: the table's three (`DEMO_PERSONAS`), pinned by the test. */
const PERSONA_PATTERN = '^(employee|agent|admin)$';

export const HINT_READ =
  '(function(){try{' +
  `var k="${CONTINUE_KEY}",s=localStorage,d=document,r=/${PERSONA_PATTERN}/,q=new URLSearchParams(location.search),f=q.get("from"),n=Date.now(),u,v;` +
  'if(q.get("ended")=="1")s.removeItem(k);' +
  'else if(r.test(f)){u=+d.documentElement.dataset.nextReset;u>n&&s.setItem(k,JSON.stringify({p:f,u:u}))}' +
  'try{v=JSON.parse(s.getItem(k))}catch(e){v=0}' +
  'if(v&&r.test(v.p)&&v.u>n)(d.querySelector(\'[data-continue="\'+v.p+\'"]\')||{}).hidden=!1;' +
  'else v!==null&&s.removeItem(k)' +
  '}catch(e){}})()';
