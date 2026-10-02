import type { SiteArea, SiteConfig } from './config.js';

/**
 * Every href that leaves the site (SPEC v3 §6.1 "Links"; A5 §3.8).
 *
 * Pure apart from the configuration it is handed, so the rules below are
 * tested as strings rather than discovered in a browser. Each one is rendered
 * as a plain `<a>`: never `next/link` (client code, and it may prefetch
 * `/api/session/login`), never a `<form>` (`form-action 'self'` blocks a
 * cross-origin post, which is the point), never `target="_blank"` (the area
 * switcher and the demo re-entry both keep people in one tab).
 *
 * A function returns `null` when the origin it needs is not configured. The
 * caller renders that as text saying the part is unavailable, so a broken
 * deploy shows a sentence instead of a link to `undefined/…`; the post-deploy
 * check warns about the same case from outside (`siteLinkWarnings`).
 */

/** The demo persona of each area, and the persona key the app's `/demo` takes (SPEC §4.1, `DEMO_PERSONA_FOR_AREA`). */
export type SitePersona = 'employee' | 'agent' | 'admin';

/**
 * Which area each persona opens in. The bijection `@itsm/contracts/demo`
 * holds as `DEMO_PERSONAS` (SPEC §4.1); repeated here only until that module
 * is a dependency the site can use (see `config.ts`), and pinned by
 * `links.test.ts` to the same three pairs.
 */
export const PERSONA_AREA: Readonly<Record<SitePersona, SiteArea>> = {
  employee: 'portal',
  agent: 'workbench',
  admin: 'admin',
};

/** Longest `?to=` deep link a role page passes on: past this it is not a link anybody typed. */
export const DEEP_LINK_MAX = 512;

/**
 * First path segments a deep link may not name.
 *
 * `/api` is the BFF and its sign-in; `/demo` is the very page the link is
 * about to go through, so landing on it again would loop; `/sign-in` and
 * `/signed-out` are the ends of a session, not places in a product. Matched as
 * whole segments, so `/demographics` and `/api-docs` stay ordinary pages.
 */
const REFUSED_SEGMENTS = new Set(['api', 'demo', 'sign-in', 'signed-out']);

/**
 * A same-origin path the site may hand to an app as `redirectTo`, or null.
 *
 * The rules of `safeRedirectTarget` (`packages/bff/src/redirects.ts`) — a
 * path, not `//host`, no backslash, no control character — because the app
 * applies them again and a link the app would refuse is a link that silently
 * goes somewhere else. Plus the refused first segments above and a length
 * limit. An invalid value is dropped, never an error: a role page with a bad
 * `?to=` still opens the demo, at the area's home.
 */
export function safeDeepLink(to: unknown): string | null {
  if (typeof to !== 'string') return null;
  if (to.length === 0 || to.length > DEEP_LINK_MAX) return null;
  if (!to.startsWith('/') || to.startsWith('//')) return null;
  if (to.includes('\\')) return null;
  for (const character of to) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return null;
  }
  const segment = /^\/([^/?#]*)/.exec(to)?.[1] ?? '';
  if (REFUSED_SEGMENTS.has(segment)) return null;
  return to;
}

/**
 * A role button: `${origin}/demo?persona=<key>&demo=1[&redirectTo=…]`, the one
 * link shape the apps' `/demo` page accepts (SPEC §4.1 `demoEntryHref`).
 *
 * Rendered with `rel="nofollow"` and **never** `noreferrer`: the app
 * auto-submits only when the Referer is an allowed origin (D22), and the site
 * sends `Referrer-Policy: strict-origin-when-cross-origin` for exactly that.
 * `demo=1` asks the app to re-enter a live demo session rather than mint a new
 * one.
 */
export function demoHref(config: SiteConfig, persona: SitePersona, redirectTo?: string): string | null {
  const origin = config.origins[PERSONA_AREA[persona]];
  if (!origin) return null;
  const params = new URLSearchParams({ persona, demo: '1' });
  const target = redirectTo === undefined ? null : safeDeepLink(redirectTo);
  if (target) params.set('redirectTo', target);
  return `${origin}/demo?${params.toString()}`;
}

/**
 * A work-account row: `${origin}/api/session/login?account=1&redirectTo=%2Fresume`.
 *
 * `/api/session/login`, not `/resume` (A5 §3.8): a visitor still holding a
 * demo re-entry cookie for that app would otherwise meet the app's own
 * chooser and choose a second time. `account=1` makes the choice made here
 * final — a real sign-in always wins and clears the demo cookie — and
 * `redirectTo=/resume` still returns a returning user to their last page.
 */
export function workAccountHref(config: SiteConfig, area: SiteArea): string | null {
  const origin = config.origins[area];
  if (!origin) return null;
  return `${origin}/api/session/login?account=1&redirectTo=${encodeURIComponent('/resume')}`;
}
