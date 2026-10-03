/**
 * `@itsm/contracts/areas` — the product's three areas and the way between them
 * (SPEC v3 §3.1–§3.3; A2 §3).
 *
 * People got stuck in the Help Portal because nothing on screen said there was
 * anywhere else to go, and the copies of "who may use which app" that did
 * exist had drifted: the portal and the Service Desk each kept their own
 * permission list, their own idea of an app's name and their own reading of
 * the `*_ORIGIN` variables. So the names, the gates, the switcher's rows and
 * every link that crosses from one area to another are computed here, once,
 * and the frames, the pages and the public site read the result.
 *
 * Pure and isomorphic on purpose. Server components build the model; client
 * components (the area switcher, the account menu, the admin tables that link
 * to tickets) receive it as a prop and call `crossAreaHref` on it; the site's
 * sign-in chooser reads the same names. So nothing here reads `process.env` or
 * a Node API — the BFF's `areasFor()` (`@itsm/bff/areas`) is the one place an
 * app reads the origins, and it passes them in — and nothing here reaches zod:
 * the only import is the persona table in `./demo.js`, which has none.
 * `__tests__/client-safe.test.ts` keeps it that way (Y-B2).
 *
 * Demo sessions never link straight to another area. Every cross-area href in
 * a demo goes through that area's `/demo` page (`demoEntryHref`), which hands
 * the visitor to the area's own persona (D11) and only ever re-uses or mints a
 * demo session — so a link built here cannot carry a visitor into a real
 * tenant, and a real person is never sent to a demo.
 */
import { DEMO_PERSONA_FOR_AREA, demoEntryHref, demoPersona, type DemoPersonaKey } from './demo.js';

/* ------------------------------------------------------------------ Names */

export const PRODUCT_NAME = 'IT Service Management';

/** The three areas. Equal to `DemoArea` in `./demo.ts` (a type test holds it) and to `AppName` in `packages/ui/src/theme/prefs.ts`. */
export type AreaId = 'portal' | 'workbench' | 'admin';

/** Employee → agent → administrator, the order of the landing's role buttons and of every list of areas. */
export const AREA_ORDER: readonly AreaId[] = Object.freeze(['portal', 'workbench', 'admin'] as const);

export interface AreaDefinition {
  readonly id: AreaId;
  readonly name: 'Help Portal' | 'Service Desk' | 'Administration';
  /** The one-liner under the name in every area row. No full stop (R-6). */
  readonly description: string;
  /** `@itsm/ui` icon registry names, mirrored rather than imported so this module stays design-system free. */
  readonly icon: 'life-buoy' | 'inbox' | 'settings-2';
  /** The area's own home, where a row for the current area goes. */
  readonly home: string;
  /** What the command palette's "Switch to …" items also answer to. */
  readonly keywords: readonly string[];
  /** The variable the deployment sets the area's public origin in. */
  readonly originEnv: 'PORTAL_ORIGIN' | 'WORKBENCH_ORIGIN' | 'ADMIN_ORIGIN';
  /** Where `pnpm dev:<app>` serves it: `defaultOrigin` in `apps/<app>/src/bff.ts`. */
  readonly devOrigin: string;
}

function area(definition: AreaDefinition): AreaDefinition {
  return Object.freeze({ ...definition, keywords: Object.freeze([...definition.keywords]) });
}

/** The single source of each area's name: titles, manifests, the switcher, the palette and the Keycloak client names read it. */
export const AREAS: Readonly<Record<AreaId, AreaDefinition>> = Object.freeze({
  portal: area({
    id: 'portal',
    name: 'Help Portal',
    description: 'Get help, request things and follow your requests',
    icon: 'life-buoy',
    home: '/',
    keywords: ['portal', 'help', 'requester', 'self-service', 'employee'],
    originEnv: 'PORTAL_ORIGIN',
    devOrigin: 'http://localhost:3200',
  }),
  workbench: area({
    id: 'workbench',
    name: 'Service Desk',
    description: 'Work tickets, queues and SLAs',
    icon: 'inbox',
    home: '/overview',
    keywords: ['ticketing', 'workbench', 'agent', 'desk', 'tickets', 'queues'],
    originEnv: 'WORKBENCH_ORIGIN',
    devOrigin: 'http://localhost:3100',
  }),
  admin: area({
    id: 'admin',
    name: 'Administration',
    description: 'Set up rules, SLAs, people and reports',
    icon: 'settings-2',
    home: '/',
    keywords: ['admin', 'settings', 'configure', 'console'],
    originEnv: 'ADMIN_ORIGIN',
    devOrigin: 'http://localhost:3300',
  }),
});

/** The public site: not an area (nobody signs in to it), but demo sessions link home to it (D18). */
export const SITE = Object.freeze({
  originEnv: 'SITE_ORIGIN',
  devOrigin: 'http://localhost:3400',
  homeLabel: 'IT Service Management home',
} as const);

export function isAreaId(value: unknown): value is AreaId {
  return typeof value === 'string' && (AREA_ORDER as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ Gates (§3.2) */

/**
 * Anyone holding one of these works tickets, so the Service Desk is theirs.
 * `ticket.read` alone is not enough: a requester reads their own tickets.
 */
export const SERVICE_DESK_GATE: readonly string[] = Object.freeze(['ticket.update', 'ticket.assign', 'ticket.comment.internal']);

/**
 * Anyone holding one of these sets something up in Administration. An agent
 * can open a few read-only Administration pages by URL, but holds none of
 * these, so the switcher does not offer it: it lists the areas a person works
 * in, not every page they could reach.
 *
 * The last key is `platform.tenant.manage`: platform operators hold it, and
 * Administration's Tenants and Plans pages are gated on it, so every key here
 * opens at least one page. The v2 copies this list replaces named
 * `platform.tenant.read`, which no module declares and so nobody can hold: an
 * operator with only the real key was never offered Administration.
 */
export const ADMINISTRATION_GATE: readonly string[] = Object.freeze([
  'admin.setting.read',
  'admin.setting.manage',
  'admin.flag.manage',
  'identity.user.manage',
  'rules.rule.read',
  'workflow.manage',
  'sla.policy.read',
  'analytics.read',
  'audit.read',
  'integration.action.read',
  'catalogue.manage',
  'ticket.config.manage',
  'platform.tenant.manage',
]);

/** Whether a real (non-demo) session lists an area. The Help Portal is everyone's: anyone signed in can raise and follow a request. */
export function holdsArea(id: AreaId, held: ReadonlySet<string>): boolean {
  if (id === 'portal') return true;
  const gate = id === 'workbench' ? SERVICE_DESK_GATE : ADMINISTRATION_GATE;
  return gate.some((key) => held.has(key));
}

/* ------------------------------------------------------------------ Origins */

export interface Origins {
  readonly portal?: string;
  readonly workbench?: string;
  readonly admin?: string;
  readonly site?: string;
}

/**
 * An `http(s)` origin, or `undefined`.
 *
 * `new URL(value).origin` drops a path, a query or a trailing slash pasted in
 * with the host, so `https://help.example.com/` and `https://help.example.com`
 * build the same links. Anything else — a bare host, `javascript:`, a typo —
 * is treated as unset rather than rendered into an `href`.
 */
export function normaliseOrigin(value: string | null | undefined): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

const ORIGIN_SOURCES: readonly (readonly [keyof Origins, string, string])[] = Object.freeze([
  ['portal', AREAS.portal.originEnv, AREAS.portal.devOrigin],
  ['workbench', AREAS.workbench.originEnv, AREAS.workbench.devOrigin],
  ['admin', AREAS.admin.originEnv, AREAS.admin.devOrigin],
  ['site', SITE.originEnv, SITE.devOrigin],
] as const);

/**
 * The four public origins from an environment.
 *
 * An unset variable becomes the `pnpm dev` address outside production, so a
 * fresh checkout links between its apps with no configuration; in production
 * it stays unset, and the row that needed it is left out rather than linked to
 * localhost. A value that is set but is not an http(s) URL is never replaced
 * by the default: a typo in a deployment should show as a missing row, not as
 * a link that quietly works in development only.
 */
export function appOrigins(env: Readonly<Record<string, string | undefined>>): Origins {
  const production = env.NODE_ENV === 'production';
  const origins: { -readonly [K in keyof Origins]?: string } = {};
  for (const [key, variable, devOrigin] of ORIGIN_SOURCES) {
    const raw = env[variable];
    if (typeof raw === 'string' && raw.trim()) {
      const origin = normaliseOrigin(raw);
      if (origin) origins[key] = origin;
    } else if (!production) {
      origins[key] = devOrigin;
    }
  }
  return Object.freeze(origins);
}

/* ------------------------------------------------------------------ The model (§3.3) */

export interface AreaPersona {
  readonly key: DemoPersonaKey;
  readonly name: string;
  readonly title: string;
}

export interface AreaLink {
  readonly id: AreaId;
  readonly name: string;
  readonly description: string;
  readonly icon: AreaDefinition['icon'];
  /** The current area → its home; a real row → `${origin}/resume`; a demo row → the area's `/demo` page, resuming. */
  readonly href: string;
  /** Null for the current area (same origin). */
  readonly origin: string | null;
  readonly current: boolean;
  /** Demo only: who you are here (current row) or who you will be there (other rows). */
  readonly persona?: AreaPersona;
}

export interface AreaModel {
  readonly product: typeof PRODUCT_NAME;
  readonly current: AreaId;
  /** The tenant's display name, e.g. "Northwind Traders (UK)". */
  readonly workspace?: string;
  readonly demo: boolean;
  /** The switcher is interactive: more than one area, or a demo session (D7). */
  readonly visible: boolean;
  /** In `AREA_ORDER`, only the listed ones. */
  readonly areas: readonly AreaLink[];
  /** D18: demo sessions only, and only when the site's origin is known. */
  readonly home?: { readonly href: string; readonly label: typeof SITE.homeLabel };
  /** Demo only (X-B2): the teams the Service Desk persona works, from `/me.demo`, for `crossAreaTicketHref`. */
  readonly agentTeamIds?: readonly string[];
}

export interface AreaInput {
  readonly app: AreaId;
  /** The permission keys the person holds (`me.permissions`). */
  readonly held: Iterable<string>;
  readonly session: { readonly kind: 'oidc' | 'dev' | 'demo'; readonly persona?: DemoPersonaKey };
  readonly origins: Origins;
  readonly workspace?: string;
  /** The current area's home when it is not `AREAS[app].home` (the Service Desk before `/overview` ships). */
  readonly homePath?: string;
  readonly agentTeamIds?: readonly string[];
}

/**
 * A path on the target's own origin, by `safeRedirectTarget`'s rules
 * (`packages/bff/src/redirects.ts`): it starts with `/`, is not
 * protocol-relative, has no backslash a browser might turn into a slash, and
 * no control character. DEL and the C1 range count as control characters
 * here too, because the path is written into an `href` verbatim.
 */
function isSafePath(path: unknown): path is string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return false;
  for (const character of path) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return true;
}

function personaLine(key: DemoPersonaKey): AreaPersona | undefined {
  const persona = demoPersona(key);
  return persona ? Object.freeze({ key: persona.key, name: persona.name, title: persona.title }) : undefined;
}

/**
 * The areas a person may switch to, and where each row goes.
 *
 * Listed: the Help Portal always; the Service Desk and Administration by their
 * gates; all three in a demo session (D7, D11); the current area whatever the
 * gates say. A sibling whose origin is unknown is left out — never a link to
 * nowhere — and `areasFor()` says so in the log once.
 *
 * Real rows go to `${origin}/resume`, which opens the last page the person
 * had open in that area during this session, or its home. Demo rows go to the
 * area's `/demo` page with `redirectTo=/resume`, so the hop lands on the same
 * page as the persona who belongs there.
 */
export function buildAreaModel(input: AreaInput): AreaModel {
  const demo = input.session.kind === 'demo';
  const held = new Set(input.held);
  const sessionPersona = demoPersona(input.session.persona)?.key ?? DEMO_PERSONA_FOR_AREA[input.app];
  const rows: AreaLink[] = [];

  for (const id of AREA_ORDER) {
    const current = id === input.app;
    if (!current && !demo && !holdsArea(id, held)) continue;
    const definition = AREAS[id];
    const persona = demo ? personaLine(current ? sessionPersona : DEMO_PERSONA_FOR_AREA[id]) : undefined;
    const base = { id, name: definition.name, description: definition.description, icon: definition.icon };

    if (current) {
      const href = isSafePath(input.homePath) ? input.homePath : definition.home;
      rows.push(Object.freeze({ ...base, href, origin: null, current: true, ...(persona ? { persona } : {}) }));
      continue;
    }

    const origin = normaliseOrigin(input.origins[id]);
    if (!origin) continue;
    const href = demo ? demoEntryHref(origin, DEMO_PERSONA_FOR_AREA[id], '/resume') : `${origin}/resume`;
    rows.push(Object.freeze({ ...base, href, origin, current: false, ...(persona ? { persona } : {}) }));
  }

  const site = demo ? normaliseOrigin(input.origins.site) : undefined;
  return Object.freeze({
    product: PRODUCT_NAME,
    current: input.app,
    ...(input.workspace ? { workspace: input.workspace } : {}),
    demo,
    visible: demo || rows.length > 1,
    areas: Object.freeze(rows),
    ...(site ? { home: Object.freeze({ href: `${site}/`, label: SITE.homeLabel }) } : {}),
    ...(demo && input.agentTeamIds ? { agentTeamIds: Object.freeze([...input.agentTeamIds]) } : {}),
  });
}

/**
 * The link to `path` in `area`, demo-safe, or `null`.
 *
 * Null when the area is not listed for this person (so a contextual "Open in
 * Service Desk" is simply not drawn) or when `path` is not a same-origin path.
 * The current area gets the path itself; a real sibling gets the deep link,
 * which its proxy keeps through a sign-in; a demo sibling gets its `/demo`
 * page with the path as `redirectTo`, so the visitor arrives as that area's
 * persona. Render the result as a plain same-tab `<a>`, never `next/link` and
 * never `rel="noreferrer"`: the sibling's `/demo` needs the Referer (D22).
 */
export function crossAreaHref(model: AreaModel, area: AreaId, path: string): string | null {
  if (!isSafePath(path)) return null;
  const row = model.areas.find((one) => one.id === area);
  if (!row) return null;
  if (row.current) return path;
  if (!row.origin) return null;
  if (model.demo) return demoEntryHref(row.origin, row.persona?.key ?? DEMO_PERSONA_FOR_AREA[area], path);
  return `${row.origin}${path}`;
}

/** What a disabled "Open in Service Desk" control says in a demo, when the ticket is outside the persona's teams. */
export const CROSS_AREA_DEMO_TEAM_NOTE = 'In the demo the Service Desk opens as Alex Morgan, who works the Service Desk queue.';

/**
 * A ticket's page in the Service Desk, or `null` (X-B2).
 *
 * In a demo the Service Desk opens as Alex Morgan, who reads tickets at team
 * scope: a link to a ticket outside his teams would land a prospect on a 404.
 * So a demo session gets `null` unless the ticket's group is one of
 * `agentTeamIds`, and the caller renders the control disabled with
 * `CROSS_AREA_DEMO_TEAM_NOTE`. Real sessions are linked whenever the Service
 * Desk is listed; the API decides what they may read.
 */
export function crossAreaTicketHref(
  model: AreaModel,
  ticket: { readonly number: string; readonly groupId: string | null },
): string | null {
  if (typeof ticket.number !== 'string' || ticket.number.length === 0) return null;
  if (model.demo && (ticket.groupId === null || !(model.agentTeamIds ?? []).includes(ticket.groupId))) return null;
  return crossAreaHref(model, 'workbench', `/tickets/${encodeURIComponent(ticket.number)}`);
}

/* ------------------------------------------------------------------ The Service Desk as data */

/** Overview's purpose line: the Service Desk nav's `description` for Overview imports it, and so does the landing's preview. */
export const SERVICE_DESK_OVERVIEW_PURPOSE = "Your queue at a glance — what's due, what's waiting and how the team is doing";

export interface ServiceDeskNavPreviewItem {
  readonly id: string;
  readonly label: string;
  /** An `@itsm/ui` icon registry name. */
  readonly icon: string;
  /** The nav group the item sits under; Overview has none. */
  readonly section?: string;
}

/**
 * The Service Desk's sidebar as the landing page draws it (X-M2).
 *
 * The public site cannot import the Service Desk app, and a hand-drawn preview
 * had already invented an "Inbox", a "Board" and an "SLA" item the product
 * does not have. So the preview reads this list, and the Service Desk's own
 * navigation test (`apps/workbench/src/__tests__/navigation.test.ts`) fails
 * when any entry stops matching a real nav item's label and icon. Only the
 * shipped, fixed items: team items are per person, and the Operations items
 * are pending until their pages land.
 */
export const SERVICE_DESK_NAV_PREVIEW: readonly ServiceDeskNavPreviewItem[] = Object.freeze(
  [
    { id: 'overview', label: 'Overview', icon: 'home' },
    { id: 'mine', label: 'My work', icon: 'user', section: 'Tickets' },
    { id: 'unassigned', label: 'Unassigned', icon: 'user-plus', section: 'Tickets' },
    { id: 'due', label: 'Due soon', icon: 'clock', section: 'Tickets' },
    { id: 'waiting', label: 'Waiting on others', icon: 'hourglass', section: 'Tickets' },
    { id: 'all', label: 'All open', icon: 'inbox', section: 'Tickets' },
    { id: 'resolved', label: 'Recently resolved', icon: 'circle-check', section: 'Tickets' },
  ].map((item) => Object.freeze(item)),
);

/**
 * Service Desk routes not shipped in this build yet (RV6).
 *
 * `/board` arrives in wave 5 and the Phase 2 and 3 pages in waves 6 and 7, but
 * the frames that link to them (the tab bar, the palette, the live major
 * incident chip in both frames, the Overview's footer) are written in wave 3.
 * So those links read this set at render time, and each wave's integrator
 * deletes the entries its pages ship — no later edit of a frame is needed, and
 * nothing links to a 404 in between. Empty at release.
 */
export const SERVICE_DESK_PENDING: ReadonlySet<string> = new Set([
  '/board',
  '/major-incidents',
  '/team',
  '/changes',
  '/problems',
  '/knowledge',
]);

/**
 * Whether a Service Desk route is still pending: the route itself or anything
 * under it (`/major-incidents/MI-0004` while `/major-incidents` is), matched
 * by whole segments, so `/team` never holds back `/teams`. A query or a
 * fragment is ignored.
 */
export function isServiceDeskRoutePending(route: string): boolean {
  if (typeof route !== 'string') return false;
  const path = route.split(/[?#]/, 1)[0] ?? '';
  for (const pending of SERVICE_DESK_PENDING) {
    if (path === pending || path.startsWith(`${pending}/`)) return true;
  }
  return false;
}
