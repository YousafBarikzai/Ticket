import { demoEntryHref, demoPersonaForArea, isDemoArea, type DemoArea, type DemoPersona, type DemoPersonaKey } from '@itsm/contracts/demo';
import { safeRedirectTarget } from '../redirects.js';
import type { Session } from '../session.js';

/**
 * What `/demo` and `/sign-in` show (SPEC §4.5 rows P1–P8 and I1–I3, A3 §5.3,
 * §6.2, §6.6), decided by pure functions.
 *
 * Pure so that every row is a unit test with no page, no Redis and no
 * clock, and so the three apps' pages cannot drift: each page gathers its
 * inputs (the session, the demo's records, the query, two request headers,
 * the configured origins), asks here, and renders the answer. Copy is the
 * page's — the decision carries the facts the copy needs (the area, the
 * persona, the reason, whether this is a return visit).
 *
 * The invariants these tables keep (A3 §5.2): **no GET ever mints** — a
 * decision is at most a form to submit; **a third-party page cannot silently
 * put a browser into the demo** — the form submits itself only when the
 * request came from this app or from one of the product's own origins (D22);
 * **a real sign-in always wins** — a person signed in to their own account is
 * asked, never switched (P5).
 */

/** The form's `id`, which `AutoSubmitForm` is given (§4.6.2). */
export const DEMO_ENTRY_FORM_ID = 'itsm-demo-entry';

/** Where the form posts: this app's `POST /api/session/demo` (M rows). */
export const DEMO_SIGN_IN_ACTION = '/api/session/demo';

/** How often "being prepared" checks again by itself (P3, `<meta http-equiv="refresh">`). */
export const DEMO_PREPARING_REFRESH_SECONDS = 15;

/**
 * Why an earlier attempt came back (P6), as the page words it (A3 §6.2):
 * `busy` "The demo is busy", `capacity` "The demo is very busy right now",
 * `invalid` "That link didn't work", `ended` "Your demo session ended".
 */
export type DemoEntryReason = 'busy' | 'capacity' | 'invalid' | 'ended';

/**
 * The `reason` codes the BFF puts on `/demo` (M3, M6, the apps' session
 * redirects) mapped to what the page says. `unavailable` is a session the
 * API stopped honouring, which reads as an ended session; `paused` and
 * `preparing` are refusals from a moment ago that no longer hold (P2 and P3
 * come first), so they read as "busy, try again". Anything else — an old link,
 * a hand-edited one — reads as a link that did not work.
 */
const REASONS: Readonly<Record<string, DemoEntryReason>> = Object.freeze({
  busy: 'busy',
  capacity: 'capacity',
  invalid: 'invalid',
  ended: 'ended',
  unavailable: 'ended',
  paused: 'busy',
  preparing: 'busy',
});

export function demoEntryReason(value: string): DemoEntryReason {
  return Object.prototype.hasOwnProperty.call(REASONS, value) ? REASONS[value]! : 'invalid';
}

/** The form a decision renders: hidden fields only, posted same-origin. */
export interface DemoEntryForm {
  readonly id: typeof DEMO_ENTRY_FORM_ID;
  readonly method: 'post';
  readonly action: typeof DEMO_SIGN_IN_ACTION;
  readonly fields: {
    readonly persona: DemoPersonaKey;
    readonly redirectTo: string;
    /** P5 only: the visitor chose to put their own session aside (M5 → M7). */
    readonly confirm?: 'replace';
  };
}

interface Entry {
  readonly area: DemoArea;
  readonly persona: DemoPersona;
  /** Where the visit lands: the query's `redirectTo` when it is a same-origin path, else the app's landing page. */
  readonly redirectTo: string;
}

export type DemoEntryDecision =
  /** P1: the demo is off here — `notFound()`. */
  | { readonly row: 'P1'; readonly kind: 'not-found' }
  /** P2: paused by the operator; no form. */
  | (Entry & { readonly row: 'P2'; readonly kind: 'paused' })
  /** P3: no generation is live yet; no form; the page refreshes itself. */
  | (Entry & {
      readonly row: 'P3';
      readonly kind: 'preparing';
      readonly refreshSeconds: typeof DEMO_PREPARING_REFRESH_SECONDS;
      /** The running build's estimate for `demoEtaPhrase`, or `null` ("a few minutes"). */
      readonly etaSec: number | null;
    })
  /** P4: this browser is already in today's demo here — 307 to `redirectTo`. */
  | (Entry & { readonly row: 'P4'; readonly kind: 'redirect'; readonly status: 307; readonly location: string })
  /** P5: signed in to a real account; ask, never auto-submit. */
  | (Entry & {
      readonly row: 'P5';
      readonly kind: 'confirm';
      readonly signedInAs: string | null;
      readonly form: DemoEntryForm;
    })
  /** P6: an earlier attempt came back with a reason; a button, never auto-submit (loop guard). */
  | (Entry & { readonly row: 'P6'; readonly kind: 'reason'; readonly reason: DemoEntryReason; readonly form: DemoEntryForm })
  /**
   * P7h: an area switch from a sibling app (X-M11) — the session-bar look
   * (`StatusScreen variant="hop"`), auto-submitted, so moving between areas
   * never flashes the navy sign-in panel.
   */
  | (Entry & {
      readonly row: 'P7h';
      readonly kind: 'hop';
      readonly autoSubmit: true;
      /** The area the visitor came from. */
      readonly from: DemoArea;
      readonly form: DemoEntryForm;
    })
  /** P7: from this app or one of the product's origins — "Opening the {area}…", auto-submitted. */
  | (Entry & {
      readonly row: 'P7';
      readonly kind: 'form';
      readonly autoSubmit: true;
      /** `resumed=1`: copy only ("Welcome back — reopening the demo…"). */
      readonly resumed: boolean;
      readonly form: DemoEntryForm;
    })
  /** P8: from anywhere else, or a typed URL — "Explore the {area} as {name}" and a button. */
  | (Entry & {
      readonly row: 'P8';
      readonly kind: 'form';
      readonly autoSubmit: false;
      readonly resumed: boolean;
      readonly form: DemoEntryForm;
    });

/** A query, as a page has it: `URLSearchParams`, or Next's `searchParams` record. */
export type QuerySource =
  | { get(name: string): string | null }
  | Readonly<Record<string, string | readonly string[] | undefined>>;

/** The two request headers the decision reads. */
export interface HeaderSource {
  get(name: string): string | null;
}

/** The product's public origins, as `appOrigins(env)` gives them (`@itsm/contracts/areas`). */
export interface DemoEntryOrigins {
  readonly portal?: string;
  readonly workbench?: string;
  readonly admin?: string;
  readonly site?: string;
}

export interface DemoEntryInput {
  /** This app. */
  readonly app: DemoArea;
  /** `DEMO_MODE=on` here (`BffConfig.demo !== null`). */
  readonly mode: boolean;
  /** `demo:paused` exists (P). */
  readonly paused: boolean;
  /** `demo:live`'s generation, or `null` when nothing is live (¬L). */
  readonly liveGeneration: number | null;
  /** The running build's estimate (`demo:build.etaSec`), for P3's copy. */
  readonly buildEtaSec?: number | null;
  /** The browser's session as `sessionFor` resolved it, or `null`. */
  readonly session: Pick<Session, 'kind' | 'persona' | 'demoGeneration' | 'displayName'> | null;
  readonly query: QuerySource;
  /** `Sec-Fetch-Site` and `Referer`. */
  readonly headers: HeaderSource;
  readonly origins: DemoEntryOrigins;
  /** This app's own origin (`BffConfig.appOrigin`). */
  readonly ownOrigin: string;
  /** Where a visit lands without a `redirectTo` (`BffConfig.defaultLanding`). */
  readonly defaultLanding: string;
}

/** One query value; for a repeated parameter, the first. */
export function queryValue(query: QuerySource, name: string): string | null {
  if (typeof (query as { get?: unknown }).get === 'function') return (query as { get(name: string): string | null }).get(name);
  const value = (query as Readonly<Record<string, string | readonly string[] | undefined>>)[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

/** The origin a `Referer` names, or `null` for none or for anything unparseable. */
export function refererOrigin(referer: string | null | undefined): string | null {
  if (!referer) return null;
  try {
    const url = new URL(referer);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

const APPS: readonly DemoArea[] = Object.freeze(['portal', 'workbench', 'admin'] as const);

/** The sibling app (never this one, never the site) whose origin is `origin`, or `null`. */
function siblingFor(origin: string, app: DemoArea, origins: DemoEntryOrigins): DemoArea | null {
  for (const other of APPS) {
    if (other !== app && origins[other] !== undefined && origins[other] === origin) return other;
  }
  return null;
}

/** `Ref∈A`: one of the four configured origins, or this app's own. */
function isProductOrigin(origin: string, origins: DemoEntryOrigins, ownOrigin: string): boolean {
  if (origin === ownOrigin) return true;
  return [origins.portal, origins.workbench, origins.admin, origins.site].some((known) => known !== undefined && known === origin);
}

function form(persona: DemoPersonaKey, redirectTo: string, confirm?: 'replace'): DemoEntryForm {
  return {
    id: DEMO_ENTRY_FORM_ID,
    method: 'post',
    action: DEMO_SIGN_IN_ACTION,
    fields: confirm ? { persona, redirectTo, confirm } : { persona, redirectTo },
  };
}

/**
 * `GET /demo` (§4.5 P rows). The first matching row wins.
 *
 * `q:persona` is never read: the app decides its persona (D11), so a link
 * naming another one simply opens this app's. `redirectTo` passes
 * `safeRedirectTarget`, as every landing page does.
 */
export function decideDemoEntry(input: DemoEntryInput): DemoEntryDecision {
  if (!input.mode) return { row: 'P1', kind: 'not-found' };

  const persona = demoPersonaForArea(input.app);
  const rawRedirect = queryValue(input.query, 'redirectTo');
  const redirectTo = safeRedirectTarget(rawRedirect, input.defaultLanding);
  const entry: Entry = { area: input.app, persona, redirectTo };

  if (input.paused) return { ...entry, row: 'P2', kind: 'paused' };
  if (input.liveGeneration === null) {
    const eta = input.buildEtaSec;
    return {
      ...entry,
      row: 'P3',
      kind: 'preparing',
      refreshSeconds: DEMO_PREPARING_REFRESH_SECONDS,
      etaSec: typeof eta === 'number' && Number.isFinite(eta) && eta > 0 ? eta : null,
    };
  }

  const session = input.session;
  if (
    session?.kind === 'demo' &&
    session.persona === persona.key &&
    session.demoGeneration === input.liveGeneration
  ) {
    return { ...entry, row: 'P4', kind: 'redirect', status: 307, location: redirectTo };
  }

  if (session?.kind === 'oidc' || session?.kind === 'dev') {
    return { ...entry, row: 'P5', kind: 'confirm', signedInAs: session.displayName, form: form(persona.key, redirectTo, 'replace') };
  }

  const resumed = queryValue(input.query, 'resumed') === '1';
  const reason = queryValue(input.query, 'reason');
  if (reason !== null && reason !== '') {
    // M5's `reason=confirm` asked a real session to choose; with no real
    // session any more there is nothing to choose between, so the visitor
    // gets the plain button. Still never an auto-submit.
    if (reason === 'confirm') return { ...entry, row: 'P8', kind: 'form', autoSubmit: false, resumed, form: form(persona.key, redirectTo) };
    return { ...entry, row: 'P6', kind: 'reason', reason: demoEntryReason(reason), form: form(persona.key, redirectTo) };
  }

  const site = input.headers.get('sec-fetch-site');
  const from = refererOrigin(input.headers.get('referer'));

  // P7h: an area switch. The Referer is a sibling app and the link carries a
  // landing page (`/resume`, or a deep link from a cross-area control); both
  // are what `crossAreaHref` builds in a demo, and neither is what a typed
  // URL or a third-party page produces.
  const sibling = from !== null ? siblingFor(from, input.app, input.origins) : null;
  const explicitLanding = rawRedirect !== null && rawRedirect !== '' && safeRedirectTarget(rawRedirect, '') === rawRedirect;
  if (sibling !== null && explicitLanding) {
    return { ...entry, row: 'P7h', kind: 'hop', autoSubmit: true, from: sibling, form: form(persona.key, redirectTo) };
  }

  if (site === 'same-origin' || (from !== null && isProductOrigin(from, input.origins, input.ownOrigin))) {
    return { ...entry, row: 'P7', kind: 'form', autoSubmit: true, resumed, form: form(persona.key, redirectTo) };
  }

  return { ...entry, row: 'P8', kind: 'form', autoSubmit: false, resumed, form: form(persona.key, redirectTo) };
}

/* ------------------------------------------------------------------ /sign-in (I rows) */

export type SignInDecision =
  /** I1: the development form; with `MODE ∧ D`, also "Continue the demo as {name}". */
  | {
      readonly row: 'I1';
      readonly kind: 'development';
      readonly continueDemo: { readonly persona: DemoPersona; readonly href: string } | null;
      readonly redirectTo: string;
    }
  /** I2: the D22 chooser — "Welcome back": continue the demo, or sign in with a work account. */
  | {
      readonly row: 'I2';
      readonly kind: 'chooser';
      readonly persona: DemoPersona;
      readonly continueHref: string;
      readonly workAccountHref: string;
      readonly homeHref: string | null;
      readonly redirectTo: string;
    }
  /** I3: "Sign in to the {area}" and, with the demo on, "New here? Explore the demo". */
  | {
      readonly row: 'I3';
      readonly kind: 'sign-in';
      readonly workAccountHref: string;
      readonly exploreHref: string | null;
      readonly homeHref: string | null;
      readonly redirectTo: string;
    };

export interface SignInInput {
  readonly app: string;
  /** `DEMO_MODE=on` here. */
  readonly mode: boolean;
  /** `developmentSignInAvailable()`: no provider and not production. */
  readonly development: boolean;
  /** The persona `__Host-itsm-demo` names for this app today (`readDemoReentry`), or `null`. */
  readonly reentry: DemoPersonaKey | null;
  /** The query's `redirectTo`, unchecked; checked here. */
  readonly redirectTo: string | null | undefined;
  readonly defaultLanding: string;
  readonly ownOrigin: string;
  /** The public site, for "IT Service Management home"; `null` when not configured. */
  readonly siteOrigin?: string | null;
}

/** `/api/session/login?account=1&redirectTo=…`: a real sign-in, which always wins (L1). */
export function workAccountHref(redirectTo: string): string {
  return `/api/session/login?${new URLSearchParams({ account: '1', redirectTo }).toString()}`;
}

/**
 * `GET /sign-in` (§4.5 I rows, A3 §6.6). The cookie decides I2, never a query
 * parameter: only a browser that was in the demo today is offered it back.
 * Every href is same-origin, for plain `<a>` links (no prefetch of a login).
 */
export function decideSignIn(input: SignInInput): SignInDecision {
  const redirectTo = safeRedirectTarget(input.redirectTo, input.defaultLanding);
  const area = isDemoArea(input.app) ? input.app : null;
  const persona = area !== null && input.mode && input.reentry !== null ? demoPersonaForArea(area) : null;
  // `demoEntryHref` with no origin: a same-origin path, which P7 auto-submits.
  const continueHref = persona !== null ? demoEntryHref('', persona.key, redirectTo) : null;
  const homeHref = input.siteOrigin ?? null;

  if (input.development) {
    return {
      row: 'I1',
      kind: 'development',
      continueDemo: persona !== null && continueHref !== null ? { persona, href: continueHref } : null,
      redirectTo,
    };
  }
  if (persona !== null && continueHref !== null) {
    return { row: 'I2', kind: 'chooser', persona, continueHref, workAccountHref: workAccountHref(redirectTo), homeHref, redirectTo };
  }
  return {
    row: 'I3',
    kind: 'sign-in',
    workAccountHref: workAccountHref(redirectTo),
    exploreHref: input.mode && area !== null ? demoEntryHref(input.ownOrigin, demoPersonaForArea(area).key) : null,
    homeHref: input.mode ? homeHref : null,
    redirectTo,
  };
}
