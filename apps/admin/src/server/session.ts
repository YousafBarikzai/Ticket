import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SESSION_COOKIE, safeRedirectTarget, type Session } from '@itsm/bff';
import { areasFor } from '@itsm/bff/areas';
import { AREA_ORDER, AREAS, crossAreaHref, crossAreaTicketHref, isServiceDeskRoutePending, type AreaId, type AreaModel } from '@itsm/contracts/areas';
import { DEMO_RESET, demoEntryHref, demoPersona, demoPersonaForArea, nextResetAt, periodMs, signInAgainHref } from '@itsm/contracts/demo';
import { admin, ApiError, type Admin, type MajorIncidentRow, type Me } from '@itsm/sdk';
import type { Problem } from '@itsm/ui';
import type { DemoBarProps } from '@itsm/ui/shell';
import { bff } from '../bff.js';
import { pageEntry } from '../navigation.js';
import { holds, holdsAny } from '../permissions.js';
import { isSessionEnded, isTenantSuspended, problemFrom } from '../problem.js';

/**
 * How a server component gets at the API, and who is asking.
 *
 * Server components call the API *directly* rather than through this app's own
 * proxy: the proxy exists so the browser never holds a token, and a server
 * component already holds the session. Going through the proxy would be the
 * app making an HTTP request to itself on every render.
 *
 * `server-only` is imported for its side effect: it is a module that fails to
 * build if it is ever pulled into a client bundle, which is the difference
 * between a rule about where tokens may live and a rule that is enforced.
 *
 * Every read here is wrapped in React's `cache()`, so the layout, the page and
 * the streamed badges share one session lookup and one `/me` per request —
 * there used to be two or three (F6). `cache()` lasts for one request on the
 * server, so nothing leaks from one person's render to the next.
 */

/** The request header `src/proxy.ts` sets to the path and query being asked for. */
export const PATH_HEADER = 'x-itsm-path';

/**
 * The path this request is for, safe to send back to as a `redirectTo`.
 *
 * Set by the proxy on every page request; anything not a same-origin path —
 * including a header a client set itself — reads as the Command centre.
 */
export const currentPath = cache(async (): Promise<string> => safeRedirectTarget((await headers()).get(PATH_HEADER), '/'));

/**
 * Where to sign in so that the person comes back to `path` afterwards (F5).
 *
 * `demo` marks the request as the demo client's (D22): the BFF then reopens
 * the demo (L2, L3) instead of sending a visitor to an identity provider they
 * have no account with. Built by `signInAgainHref`, the one shape every app
 * uses.
 */
export function signInHref(path: string, options: { readonly demo?: boolean } = {}): string {
  return signInAgainHref(path, options);
}

/** This app's area: Administration (`AREAS.admin`), and the demo persona it opens as. */
export const AREA: AreaId = 'admin';

/**
 * `/demo` for this app's persona, landing on `path` (SPEC v3 §4.6.4). Same
 * origin and plain, so `/demo` decides what happens: a visitor who arrives
 * from this app is reopened by the auto-submitted form (P7), and nothing here
 * ever mints by itself.
 */
export function demoEntryFor(path: string, extra: { readonly resumed?: boolean; readonly reason?: 'unavailable' } = {}): string {
  const href = demoEntryHref('', demoPersonaForArea(AREA).key, safeRedirectTarget(path, '/'));
  return `${href}${extra.resumed ? '&resumed=1' : ''}${extra.reason ? `&reason=${extra.reason}` : ''}`;
}

/**
 * A demo session younger than this whose `/me` is refused is not sent round
 * `/demo` again by itself: it has only just been opened there, so another
 * automatic round could loop. The person gets a button instead (§4.6.4).
 */
export const DEMO_LOOP_BREAKER_MS = 30_000;

export const currentSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  return bff.sessionFor(jar.get(SESSION_COOKIE)?.value);
});

/**
 * Redirects rather than throwing. A page that threw would render a 500, and
 * "your session expired" is not a server error. The deep link survives: the
 * sign-in comes back to the page the person asked for.
 */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect(signInHref(await currentPath()));
  return session;
}

/** The SDK, bound to this request's session. */
export function apiFor(session: Session): Admin {
  return admin(bff.clientFor(session));
}

export interface Actor {
  readonly session: Session;
  readonly me: Me;
  readonly api: Admin;
}

/**
 * The signed-in person, or why there is none to show.
 *
 * - `ok`: who, what they may do, and the SDK bound to them.
 * - `ended`: the session cookie resolved but the API refused the token —
 *   revoked, or signed out elsewhere. Shown as a screen with *Sign in again*
 *   rather than redirected automatically: an identity provider that signs
 *   people straight back in would otherwise loop.
 * - `suspended`: the API refuses every call for this workspace (F7), so the
 *   frame shows one screen instead of every section failing on its own.
 * - `unavailable`: the API could not be reached; the frame says so and offers
 *   to try again, rather than letting Next's default error page through.
 */
export type ActorLoad =
  | ({ readonly kind: 'ok' } & Actor)
  /** `demo`: the session was a demo visit, so the screen offers *Continue the demo* rather than a sign-in. */
  | { readonly kind: 'ended'; readonly demo: boolean }
  | { readonly kind: 'suspended' }
  | { readonly kind: 'unavailable'; readonly problem: Problem };

/**
 * What a refused `/me` means for a demo visit (SPEC v3 §4.6.4, A3 §6.8), as
 * a value so every branch is a unit test:
 *
 *   - `reload`: the API ended the visit and the BFF handed the person's own
 *     session back under the same cookie (X3, `restored: true`). The page is
 *     simply asked for again, and renders for them.
 *   - `reopen`: the BFF ended the visit (X3, `demo_session_ended`) — its
 *     record is gone, so `/demo` cannot bounce straight back here (P4) — and
 *     the visit is older than `DEMO_LOOP_BREAKER_MS`. `/demo` reopens it —
 *     "Welcome back — reopening the demo…", auto-submitted from this origin
 *     (P7) — and lands on this page.
 *   - `ended`: any other 401 of a demo visit, and every 401 of a visit opened
 *     under `DEMO_LOOP_BREAKER_MS` ago. The frame's ended screen, with
 *     *Continue the demo* as a link: a person's click, never another
 *     automatic round that could loop.
 *   - `unavailable`: 503 `demo_unavailable` (paused, being prepared, the store
 *     unreachable). `/demo?…&reason=unavailable`, which says which and never
 *     submits itself.
 *   - `null`: not a demo answer; the console's own screens handle it.
 */
export type DemoRefusal = 'reload' | 'reopen' | 'ended' | 'unavailable' | null;

export function demoRefusal(error: unknown, session: Pick<Session, 'kind' | 'createdAt'>, now: number = Date.now()): DemoRefusal {
  if (session.kind !== 'demo' || !(error instanceof ApiError)) return null;
  if (error.status === 503 && error.code === 'demo_unavailable') return 'unavailable';
  if (error.status !== 401) return null;
  if ((error.problem as { restored?: unknown } | null)?.restored === true) return 'reload';
  if (error.code === 'demo_session_ended' && now - session.createdAt >= DEMO_LOOP_BREAKER_MS) return 'reopen';
  return 'ended';
}

export const loadActor = cache(async (): Promise<ActorLoad> => {
  const session = await requireSession();
  const api = apiFor(session);
  let failure: unknown;
  try {
    return { kind: 'ok', session, me: await api.me(), api };
  } catch (error) {
    failure = error;
  }
  // `redirect()` throws by design, so the demo's answers are given outside the `catch` above.
  const refusal = demoRefusal(failure, session);
  if (refusal === 'reload') redirect(await currentPath());
  if (refusal === 'reopen') redirect(demoEntryFor(await currentPath(), { resumed: true }));
  if (refusal === 'unavailable') redirect(demoEntryFor(await currentPath(), { reason: 'unavailable' }));
  if (refusal === 'ended' || isSessionEnded(failure)) return { kind: 'ended', demo: session.kind === 'demo' };
  if (isTenantSuspended(failure)) return { kind: 'suspended' };
  return { kind: 'unavailable', problem: problemFrom(failure) };
});

/**
 * The signed-in person, for code that runs only once the frame has shown it
 * can. Throws otherwise — which never reaches the screen, because the
 * `(console)` layout renders its own state and no page under it.
 */
export async function currentActor(): Promise<Actor> {
  const load = await loadActor();
  if (load.kind !== 'ok') throw new Error(`The signed-in person could not be loaded (${load.kind}).`);
  return load;
}

/**
 * The page gate, read from `navigation.ts` — so a page is open to exactly the
 * people its sidebar item is shown to (SPEC §5.1; `navigation.test.ts` checks
 * that every page calls this with its own route).
 *
 * ```tsx
 * const access = await pageAccess('/rules');
 * if (!access.allowed) return <Forbidden route="/rules" />;
 * const { me, api } = access;
 * ```
 *
 * Not allowed is a value, not a throw, so the page keeps its header and says
 * which permission to ask for (the Forbidden view). A route the map does not
 * know is closed: a page added without a gate should fail its test, not open
 * to everyone.
 */
export type PageAccess = ({ readonly allowed: true } & Actor) | { readonly allowed: false; readonly me: Me | null };

export async function pageAccess(route: string): Promise<PageAccess> {
  const load = await loadActor();
  // The frame is already showing why nobody is signed in; the page renders nothing that matters.
  if (load.kind !== 'ok') return { allowed: false, me: null };
  const entry = pageEntry(route);
  if (!entry || !holdsAny(load.me, entry.read)) return { allowed: false, me: load.me };
  return { allowed: true, session: load.session, me: load.me, api: load.api };
}

/**
 * The gate on the platform section.
 *
 * `notFound`, not a 403. A console that answers "you may not see this" tells
 * somebody there is a platform section and that they are close to it; a 404
 * tells them nothing they did not already know. It is called from the section's
 * *layout*, so it runs before any page in it renders — a per-page check is one
 * page away from being forgotten, and the page somebody forgets is the one that
 * lists every tenant on the deployment.
 */
export async function requirePlatformOperator(): Promise<Actor> {
  const load = await loadActor();
  if (load.kind !== 'ok' || !holds(load.me, 'platform.tenant.manage')) notFound();
  return load;
}

/* -------------------------------------------------------------------------
 * The areas, the demo bar and the frame's chip (SPEC v3 §3.1, §3.4, §3.8)
 * ---------------------------------------------------------------------- */

/**
 * This person's areas in this request (SPEC v3 §3.1): which of the Help
 * Portal, the Service Desk and Administration they hold, and how to reach
 * each — `${origin}/resume` for a real session, the sibling's `/demo` for a
 * demo visit. The interface every Administration page uses for a link into
 * another area (`crossAreaHref`, `crossAreaTicketHref`; WP-42b's pages).
 *
 * Built by `@itsm/bff/areas`, the one place an app reads the `*_ORIGIN`
 * variables, and cached for the request like the session and `/me`. It never
 * throws: before the frame has a person (the ended or suspended screens), the
 * model is built from the session alone, which still names this area.
 */
export const currentAreas = cache(async (): Promise<AreaModel> => {
  const load = await loadActor();
  const session = load.kind === 'ok' ? load.session : await currentSession();
  const me = load.kind === 'ok' ? load.me : null;
  const workspace = me?.tenant?.name;
  const agentTeamIds = me?.demo?.agentTeamIds;
  return areasFor({
    app: AREA,
    held: me ? me.permissions.map((permission) => permission.key) : [],
    session: session ? { kind: session.kind, ...(session.persona ? { persona: session.persona } : {}) } : null,
    ...(workspace ? { workspace } : {}),
    ...(agentTeamIds ? { agentTeamIds } : {}),
  });
});

/**
 * The palette's words for each area ("ticketing" finds the Service Desk, D1),
 * from `AREAS` on the server: the palette's module rides in every route's
 * first load, and `@itsm/contracts/areas` would bring the demo's tables with
 * it.
 */
export function areaKeywords(): Readonly<Record<AreaId, readonly string[]>> {
  return Object.fromEntries(AREA_ORDER.map((id) => [id, AREAS[id].keywords])) as Record<AreaId, readonly string[]>;
}

/** What the session demo bar is given (SPEC v3 §3.8), everything but `areas`, which the frame already has. */
export type SessionDemoBar = Required<Pick<DemoBarProps, 'clock' | 'persona' | 'generation'>>;

/**
 * The demo bar's facts for a demo visit, or nothing for anyone else.
 *
 * The clock is the pure UK reset clock computed here, so the countdown's first
 * frame matches the server's HTML (§3.8); the persona is this area's
 * (`DEMO_PERSONAS`); the generation is the one the page's data was read from —
 * `latestSession`, so a page rendered just after a transparent re-mint names
 * the new generation, not the one the cookie started with (X3).
 */
export function demoBarFor(session: Session, now: number = Date.now()): SessionDemoBar | null {
  if (session.kind !== 'demo') return null;
  const persona = demoPersonaForArea(AREA);
  const generation = bff.latestSession(session).demoGeneration ?? session.demoGeneration ?? 1;
  return { clock: demoClock(now), persona: { name: persona.name, title: persona.title }, generation };
}

/** The pure UK reset clock at `now` (`@itsm/contracts/demo`), as the demo bar's countdown starts from it. */
export function demoClock(now: number = Date.now()): DemoBarProps['clock'] {
  return { nextResetAt: nextResetAt(now), serverNow: now, periodMs: periodMs(now), resetLabel: DEMO_RESET.label, timeZone: DEMO_RESET.timeZone };
}

/**
 * The public site's home, "IT Service Management home" (D18), for the pages
 * outside the frame that open and close a demo visit — `/demo`, `/sign-in`,
 * `/signed-out` — or `null` when the deployment has no site.
 *
 * The area model gives the site's home only to a demo visit (a real session
 * never links to the site), so it is asked as one: these pages are where the
 * demo is entered and left, which D18 allows. Through `@itsm/bff/areas`, the
 * one place an app reads an origin.
 */
export function siteHome(): NonNullable<AreaModel['home']> | null {
  return areasFor({ app: AREA, held: [], session: { kind: 'demo', persona: demoPersonaForArea(AREA).key } }).home ?? null;
}

/**
 * The three ways back into the demo from `/signed-out?demo=1` (§4.6.3):
 * "Explore as Employee · Emma Clarke, Finance Manager", one per area whose
 * origin is configured, each to that area's `/demo` (`demoEntryHref`) — the
 * area decides from there, so nothing here opens a session.
 */
export interface DemoExploreLink {
  readonly area: AreaId;
  readonly label: string;
  readonly href: string;
}

export function demoExploreLinks(): DemoExploreLink[] {
  const model = areasFor({ app: AREA, held: [], session: { kind: 'demo', persona: demoPersonaForArea(AREA).key } });
  const links: DemoExploreLink[] = [];
  for (const area of model.areas) {
    const persona = demoPersona(area.persona?.key) ?? demoPersonaForArea(area.id);
    links.push({
      area: area.id,
      label: `Explore as ${persona.button} · ${persona.name}, ${persona.title}`,
      href: demoEntryHref(area.current ? '' : (area.origin ?? ''), persona.key),
    });
  }
  return links;
}

/** Whether the shared demo is switched on in this deployment (`DEMO_MODE=on`; `BffConfig.demo`). */
export function demoModeOn(): boolean {
  return bff.config.demo !== null;
}

/** The frame's chip for a live major incident (SPEC v3 §3.4), as data the layout draws with `ContextChip`. */
export interface MajorIncidentChip {
  /** "MI-0004 · VPN sign-in failures · Sev 2", or "2 major incidents". */
  readonly label: string;
  /** "MI-0004 · Sev 2". */
  readonly compactLabel: string;
  /** Into the Service Desk, through the area model; absent when there is nowhere this person can open it. */
  readonly href?: string;
}

/** `SEV2` → "Sev 2"; anything else as it came. */
export function severityLabel(severity: string): string {
  const match = /^sev\s*(\d+)$/i.exec(severity.trim());
  return match ? `Sev ${match[1]}` : severity;
}

/** The two reads the chip makes when it links the major incident's ticket, as the admin SDK names them. */
export interface MajorIncidentReads {
  majorIncidents(filter: { open: true }): Promise<readonly MajorIncidentRow[]>;
  majorIncident(number: string): Promise<{ readonly ticketId: string | null }>;
  ticket(idOrNumber: string): Promise<{ readonly number: string; readonly groupId: string | null }>;
}

/**
 * The live major incident, read for the frame (`observe.majorIncidents`), or
 * nothing when none is open — or when the read fails: a chip is context, and
 * the page it sits on must not fail because of it.
 *
 * Where it leads is read at render time from `@itsm/contracts/areas` (RV6):
 * the Service Desk's `/major-incidents/MI-0004` once that route ships, and
 * until then the major incident's own ticket — through `crossAreaTicketHref`,
 * so in the demo it is a link only when Alex Morgan's teams can open it
 * (X-B2). Two or more read as "2 major incidents", to the register when it
 * exists.
 */
export async function majorIncidentChip(
  reads: MajorIncidentReads,
  areas: AreaModel,
  pending: (route: string) => boolean = isServiceDeskRoutePending,
): Promise<MajorIncidentChip | null> {
  let open: readonly MajorIncidentRow[];
  try {
    open = await reads.majorIncidents({ open: true });
  } catch {
    return null;
  }
  if (open.length === 0) return null;
  if (open.length > 1) {
    const label = `${open.length} major incidents`;
    const href = pending('/major-incidents') ? null : crossAreaHref(areas, 'workbench', '/major-incidents');
    return { label, compactLabel: label, ...(href ? { href } : {}) };
  }
  const incident = open[0]!;
  const severity = severityLabel(incident.severity);
  const chip = { label: `${incident.number} · ${incident.title} · ${severity}`, compactLabel: `${incident.number} · ${severity}` };
  const route = `/major-incidents/${encodeURIComponent(incident.number)}`;
  if (!pending(route)) {
    const href = crossAreaHref(areas, 'workbench', route);
    return href ? { ...chip, href } : chip;
  }
  try {
    const { ticketId } = await reads.majorIncident(incident.number);
    if (!ticketId) return chip;
    const ticket = await reads.ticket(ticketId);
    const href = crossAreaTicketHref(areas, { number: ticket.number, groupId: ticket.groupId });
    return href ? { ...chip, href } : chip;
  } catch {
    return chip;
  }
}

/** The chip's reads from a signed-in person's SDK. */
export function majorIncidentReads(api: Admin): MajorIncidentReads {
  return {
    majorIncidents: (filter) => api.observe.majorIncidents(filter),
    majorIncident: (number) => api.observe.majorIncident(number),
    ticket: (idOrNumber) => api.observe.ticket(idOrNumber),
  };
}
