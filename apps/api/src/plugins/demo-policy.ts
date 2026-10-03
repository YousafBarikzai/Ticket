import type { DemoCapCategory, DemoFeature } from '@itsm/contracts/demo';

/**
 * The shared demo's route policy, as data (SPEC v3 §4.7.3, §4.7.4, §4.7.7;
 * annex A3 §7.5, §7.6 rows 1–37, §7.9).
 *
 * Every unsafe route the API mounts is decided here, one line each, by its
 * exact Fastify path — the `routeOptions.url` a request carries, parameter
 * names included. `demo-policy.test.ts` builds the real app and fails on any
 * unsafe route that is in none of the three tables below, and on any key
 * that names no route, so a new route cannot reach the shared demo without
 * somebody deciding what visitors may do with it, and a renamed one cannot
 * silently drop its cap.
 *
 * What the kinds mean (`plugins/demo.ts` applies them):
 *
 * - `allow` — the write budgets of §4.8 only. Working tickets, changes,
 *   problems, the CMDB, time, availability and surveys is the demo.
 * - `cap` — a high-visibility action every later visitor sees: a few per
 *   visit and a few more per generation (`DEMO_CAPS`), given back when the
 *   request fails.
 * - `guard` — `persona`: the personas' own accounts may not be switched off
 *   (`personas`); then the cap.
 * - `locked-setting` — a setting in `DEMO_LOCKED_SETTINGS` is refused
 *   (`settings`); any other is capped as `setting.change` (Y-M12).
 * - `hero-ticket` — the story's tickets keep their title and description
 *   (`story`, Y-m5); every other change to a ticket is allowed.
 * - `read-only` — refused with the feature's sentence. Each of these is also
 *   refused by the strip-list (§4.7.1) one layer down; answering here first
 *   means no handler runs and no file is parsed for a request that cannot
 *   succeed.
 * - `outside-session` — a route no demo session reaches: it is
 *   unauthenticated and proves itself another way, or it takes only a kind
 *   of token the demo tenant refuses. Listed with the reason so that the
 *   claim is written down where a reviewer reads it.
 */

/** `METHOD /exact/fastify/path`. */
export type DemoRouteKey = string;

export type DemoRoutePolicy =
  | { readonly kind: 'allow'; readonly note?: string }
  | { readonly kind: 'cap'; readonly category: DemoCapCategory }
  | { readonly kind: 'guard'; readonly guard: 'persona'; readonly category: DemoCapCategory }
  | { readonly kind: 'read-only'; readonly feature: DemoFeature }
  | { readonly kind: 'locked-setting' }
  | { readonly kind: 'hero-ticket' }
  | { readonly kind: 'outside-session'; readonly reason: string };

/** A request answered before any budget is counted (§4.7.3). */
export type DemoShortCircuit =
  | { readonly kind: 'answer'; readonly status: 204 }
  | { readonly kind: 'answer'; readonly status: 200; readonly body: unknown }
  | { readonly kind: 'refuse'; readonly feature: DemoFeature };

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The methods that can change something: everything but GET, HEAD and OPTIONS. */
export function isUnsafeMethod(method: string): boolean {
  return UNSAFE.has(method.toUpperCase());
}

/** The policy key of a matched route; `null` when nothing matched (a 404). */
export function demoRouteKey(method: string, url: string | undefined): DemoRouteKey | null {
  return url ? `${method.toUpperCase()} ${url}` : null;
}

/**
 * The personas are shared by every visitor, so one visitor must not be able
 * to sign the others out or see their devices (A3 §7.5). The BFF records no
 * session for a demo visit, so these answer as if there were none to manage.
 */
export const DEMO_SHORT_CIRCUITS: Readonly<Record<DemoRouteKey, DemoShortCircuit>> = Object.freeze({
  'POST /api/v1/auth/session': { kind: 'answer', status: 204 },
  'GET /api/v1/me/sessions': { kind: 'answer', status: 200, body: { data: [] } },
  'DELETE /api/v1/me/sessions/:id': { kind: 'refuse', feature: 'sessions' },
});

/**
 * POSTs that only read, so they spend the read budget and not the write
 * budgets (Y-M3): metric questions, forecasts and arrivals carry their
 * question in a body because it does not fit a query string, and the rule
 * and workflow tests run a definition without saving anything. A policy may
 * still cap one (`rule.test`), because a test is a heavy read.
 */
export const READ_LIKE_POSTS: ReadonlySet<DemoRouteKey> = new Set([
  'POST /api/v1/analytics/query',
  'POST /api/v1/analytics/query/batch',
  'POST /api/v1/analytics/forecast',
  'POST /api/v1/analytics/arrivals',
  'POST /api/v1/rules/dry-run',
  'POST /api/v1/rules/:idOrKey/test',
  'POST /api/v1/workflows/:key/validate',
  'POST /api/v1/workflows/:key/test',
]);

/**
 * Entries of `READ_LIKE_POSTS` whose route a later package mounts:
 * arrivals arrives with WP-62 (wave 4). Listed now so that the route is a
 * read the moment it exists; the policy test accepts either state.
 */
export const READ_LIKE_PENDING: ReadonlySet<DemoRouteKey> = new Set(['POST /api/v1/analytics/arrivals']);

const allow: DemoRoutePolicy = Object.freeze({ kind: 'allow' });
const cap = (category: DemoCapCategory): DemoRoutePolicy => Object.freeze({ kind: 'cap', category });
const readOnly = (feature: DemoFeature): DemoRoutePolicy => Object.freeze({ kind: 'read-only', feature });
const outside = (reason: string): DemoRoutePolicy => Object.freeze({ kind: 'outside-session', reason });

const PUBLIC = 'unauthenticated: it proves itself with a signature or a signed token, and builds no session context';
const SCIM = 'takes only a SCIM token, which the demo tenant refuses (plugins/context.ts)';
const PLATFORM = readOnly('platform');

export const DEMO_ROUTE_POLICY: Readonly<Record<DemoRouteKey, DemoRoutePolicy>> = Object.freeze({
  /* ---------------------------------------------------------------- Tickets (A3 §7.6 rows 11–13, 33, 36) */
  'POST /api/v1/tickets': cap('ticket.create'),
  'PATCH /api/v1/tickets/:idOrNumber': { kind: 'hero-ticket' },
  'POST /api/v1/tickets/:idOrNumber/transitions': allow,
  'POST /api/v1/tickets/:idOrNumber/assign': allow,
  'POST /api/v1/tickets/:idOrNumber/comments': allow,
  'POST /api/v1/tickets/:idOrNumber/tasks': allow,
  'POST /api/v1/tasks/:taskId/complete': allow,
  'POST /api/v1/tickets/:idOrNumber/links': allow,
  'POST /api/v1/tickets/:idOrNumber/watchers': allow,
  'POST /api/v1/tickets/:idOrNumber/attachments:presign': readOnly('uploads'),
  'POST /api/v1/tickets/:idOrNumber/attachments': readOnly('uploads'),
  'PUT /api/v1/field-definitions/:key': cap('field.change'),
  'DELETE /api/v1/field-definitions/:key': cap('field.change'),
  'POST /api/v1/field-definitions/:key/reactivate': cap('field.change'),

  /* ---------------------------------------------------------------- People, roles, teams (rows 14–17; §4.7.3) */
  'POST /api/v1/users': cap('user.create'),
  'POST /api/v1/users/:id/deactivate': { kind: 'guard', guard: 'persona', category: 'user.deactivate' },
  'POST /api/v1/users/:id/reactivate': allow,
  'POST /api/v1/role-assignments': readOnly('roles'),
  'DELETE /api/v1/role-assignments/:id': readOnly('roles'),
  'POST /api/v1/organisations': readOnly('organisation'),
  'POST /api/v1/teams': readOnly('organisation'),
  'POST /api/v1/teams/:id/members': readOnly('organisation'),
  'PUT /api/v1/me/notification-preferences': allow,
  'PUT /api/v1/users/:id/notification-preferences': allow,
  'POST /api/v1/notifications/:id/read': allow,

  /* ---------------------------------------------------------------- Settings, flags, modules (rows 30, 31; Y-M12) */
  'PUT /api/v1/settings/:key': { kind: 'locked-setting' },
  'POST /api/v1/settings/:key/rollback': { kind: 'locked-setting' },
  'PUT /api/v1/feature-flags/:key': readOnly('feature-switches'),
  'POST /api/v1/modules/:id/:action': readOnly('modules'),

  /* ---------------------------------------------------------------- Rules and workflows (rows 24–26) */
  'POST /api/v1/rules': cap('rule.change'),
  'PATCH /api/v1/rules/:idOrKey': cap('rule.change'),
  'POST /api/v1/rules/:idOrKey/publish': cap('rule.change'),
  'POST /api/v1/rules/:idOrKey/rollback': cap('rule.change'),
  'POST /api/v1/rules/:idOrKey/archive': cap('rule.change'),
  'POST /api/v1/rules/:idOrKey/test': cap('rule.test'),
  'POST /api/v1/rules/dry-run': cap('rule.test'),
  'POST /api/v1/workflows': cap('workflow.change'),
  'PATCH /api/v1/workflows/:key': cap('workflow.change'),
  'POST /api/v1/workflows/:key/publish': cap('workflow.change'),
  'POST /api/v1/workflows/:key/rollback': cap('workflow.change'),
  'POST /api/v1/workflows/:key/validate': allow,
  'POST /api/v1/workflows/:key/test': allow,
  'POST /api/v1/workflow-runs/:id/retry': allow,
  'POST /api/v1/workflow-runs/:id/skip': allow,
  'POST /api/v1/workflow-runs/:id/cancel': allow,

  /* ---------------------------------------------------------------- Approvals and service levels (rows 27–29) */
  // Emma's three and Jordan's two decisions are the story's to consume;
  // presenters reset before a meeting (D28).
  'POST /api/v1/approvals/:id/decide': allow,
  'POST /api/v1/approval-delegations': allow,
  'POST /api/v1/approval-policies': cap('approval-policy.change'),
  'POST /api/v1/approval-policies/:idOrKey/publish': cap('approval-policy.change'),
  'POST /api/v1/sla-policies': cap('sla.change'),
  'PUT /api/v1/sla-policies/:idOrKey/targets': cap('sla.change'),
  'POST /api/v1/sla-calendars': cap('sla.change'),
  'PUT /api/v1/priority-matrix': cap('sla.change'),

  /* ---------------------------------------------------------------- Catalogue (row 10) */
  // A submission raises a ticket in every visitor's queue, as `POST
  // /tickets` does, so it spends the same cap.
  'POST /api/v1/catalogue/:key/submit': cap('ticket.create'),
  'POST /api/v1/services': cap('catalogue.change'),
  'PATCH /api/v1/services/:key': cap('catalogue.change'),
  'POST /api/v1/request-types': cap('catalogue.change'),
  'PATCH /api/v1/request-types/:key': cap('catalogue.change'),
  'POST /api/v1/request-types/:key/publish': cap('catalogue.change'),
  'POST /api/v1/forms': cap('catalogue.change'),
  'PATCH /api/v1/forms/:key': cap('catalogue.change'),
  'POST /api/v1/forms/:key/publish': cap('catalogue.change'),

  /* ---------------------------------------------------------------- Knowledge (rows 8, 9) */
  'POST /api/v1/knowledge': cap('kb.draft'),
  'PATCH /api/v1/knowledge/:key': cap('kb.draft'),
  'POST /api/v1/knowledge/:key/submit': cap('kb.draft'),
  'POST /api/v1/knowledge/:key/publish': cap('kb.publish'),
  'POST /api/v1/knowledge/:key/rollback': cap('kb.publish'),
  'POST /api/v1/knowledge/:key/retire': cap('kb.publish'),
  'POST /api/v1/knowledge/:key/feedback': allow,
  'POST /api/v1/knowledge/:key/link': allow,

  /* ---------------------------------------------------------------- Major incidents (rows 1–4) */
  'POST /api/v1/major-incidents': cap('mi.declare'),
  'POST /api/v1/major-incidents/:number/updates': cap('mi.update'),
  'POST /api/v1/major-incidents/:number/transition': cap('mi.transition'),
  'POST /api/v1/major-incidents/:number/close': cap('mi.transition'),
  'PATCH /api/v1/major-incidents/:number/roles': cap('mi.review'),
  'PATCH /api/v1/major-incidents/:number/review': cap('mi.review'),
  'POST /api/v1/major-incidents/:number/review/actions': cap('mi.review'),
  'PATCH /api/v1/major-incidents/review/actions/:id': cap('mi.review'),
  'POST /api/v1/major-incidents/:number/review/publish': cap('mi.review'),

  /* ---------------------------------------------------------------- Problems and changes (row 34; "allow" rows) */
  'POST /api/v1/problems': allow,
  'POST /api/v1/problems/:number/tickets': allow,
  'DELETE /api/v1/problems/:number/tickets/:ticketId': allow,
  'POST /api/v1/problems/:number/transition': allow,
  'PUT /api/v1/problems/:number/known-error': cap('problem.publish'),
  'DELETE /api/v1/problems/:number/known-error': cap('problem.publish'),
  'POST /api/v1/changes': allow,
  'POST /api/v1/changes/:number/submit': allow,
  'POST /api/v1/changes/:number/schedule': allow,
  'POST /api/v1/changes/:number/transition': allow,
  'POST /api/v1/changes/:number/retrospective-approval': allow,
  'POST /api/v1/change-windows': allow,
  'DELETE /api/v1/change-windows/:id': allow,
  'POST /api/v1/standard-changes': allow,
  'POST /api/v1/standard-changes/:key/publish': allow,

  /* ---------------------------------------------------------------- CMDB, assets, contracts, discovery */
  'POST /api/v1/ci-classes': allow,
  'PATCH /api/v1/ci-classes/:key': allow,
  'POST /api/v1/cis': allow,
  'PATCH /api/v1/cis/:id': allow,
  'POST /api/v1/cis/:id/status': allow,
  'POST /api/v1/cis/:id/retire': allow,
  'POST /api/v1/ci-relationships': allow,
  'DELETE /api/v1/ci-relationships': allow,
  'POST /api/v1/ci-links': allow,
  'DELETE /api/v1/ci-links': allow,
  'POST /api/v1/assets': allow,
  'PATCH /api/v1/assets/:tag': allow,
  'POST /api/v1/assets/:tag/assign': allow,
  'POST /api/v1/assets/:tag/return': allow,
  'POST /api/v1/assets/:tag/retire': allow,
  'POST /api/v1/asset-models': allow,
  'POST /api/v1/suppliers': allow,
  'POST /api/v1/contracts': allow,
  'POST /api/v1/contracts/:id/coverage': allow,
  // Running discovery reaches real systems; the generation's own proposals
  // are CMDB curation (`cmdb.manage`), which the demo keeps.
  'POST /api/v1/discovery/sources': readOnly('discovery'),
  'PATCH /api/v1/discovery/sources/:key': readOnly('discovery'),
  'POST /api/v1/discovery/sources/:key/run': readOnly('discovery'),
  'PUT /api/v1/discovery/rules': readOnly('discovery'),
  'POST /api/v1/discovery/proposals/:id/accept': allow,
  'POST /api/v1/discovery/proposals/:id/reject': allow,
  'POST /api/v1/discovery/proposals/accept-all': allow,

  /* ---------------------------------------------------------------- Analytics (rows 19–23) */
  'POST /api/v1/analytics/query': allow,
  'POST /api/v1/analytics/query/batch': allow,
  'POST /api/v1/analytics/forecast': allow,
  // The seeded shared dashboards are refused by the service itself
  // (`dashboard-service.ts` `requireEditable`, `shared-dashboards`), which
  // gives the cap back by failing.
  'POST /api/v1/analytics/dashboards': cap('dashboard.change'),
  'PATCH /api/v1/analytics/dashboards/:id': cap('dashboard.change'),
  'DELETE /api/v1/analytics/dashboards/:id': cap('dashboard.change'),
  'POST /api/v1/analytics/metrics': cap('metric.change'),
  'PATCH /api/v1/analytics/metrics/:key': cap('metric.change'),
  'DELETE /api/v1/analytics/metrics/:key': cap('metric.change'),
  'POST /api/v1/analytics/reports': cap('report.change'),
  'PATCH /api/v1/analytics/reports/:id': cap('report.change'),
  'DELETE /api/v1/analytics/reports/:id': cap('report.change'),
  'POST /api/v1/analytics/reports/:id/schedules': cap('report.change'),
  'PATCH /api/v1/analytics/report-schedules/:id': cap('report.change'),
  'DELETE /api/v1/analytics/report-schedules/:id': cap('report.change'),
  'POST /api/v1/analytics/reports/:id/run': cap('report.run'),
  'POST /api/v1/analytics/rebuild': readOnly('analytics-admin'),
  'POST /api/v1/analytics/replay': readOnly('analytics-admin'),
  'POST /api/v1/analytics/drift-check': readOnly('analytics-admin'),

  /* ---------------------------------------------------------------- Workforce, time, surveys */
  'PUT /api/v1/workload/availability': allow,
  'POST /api/v1/workload/shifts': allow,
  'DELETE /api/v1/workload/shifts/:key': allow,
  'POST /api/v1/workload/shifts/:key/assignments': allow,
  'DELETE /api/v1/workload/shift-assignments/:id': allow,
  'POST /api/v1/workload/rotations': allow,
  'PATCH /api/v1/workload/rotations/:key': allow,
  'POST /api/v1/workload/rotations/:key/overrides': allow,
  'DELETE /api/v1/workload/overrides/:id': allow,
  'POST /api/v1/workload/skills': allow,
  'PUT /api/v1/workload/skills/:key/agents': allow,
  'DELETE /api/v1/workload/skills/:key/agents/:userId': allow,
  'PUT /api/v1/workload/routing/:teamId': allow,
  'POST /api/v1/time-entries': allow,
  'PATCH /api/v1/time-entries/:id': allow,
  'DELETE /api/v1/time-entries/:id': allow,
  'POST /api/v1/time/timer/start': allow,
  'POST /api/v1/time/timer/stop': allow,
  'POST /api/v1/activity-types': allow,
  'PATCH /api/v1/activity-types/:key': allow,
  'PUT /api/v1/activity-types/:key/rates': allow,
  'DELETE /api/v1/activity-types/:key/rates/:teamId': allow,
  'POST /api/v1/budgets': allow,
  'PATCH /api/v1/budgets/:key': allow,
  'DELETE /api/v1/budgets/:key': allow,
  'POST /api/v1/surveys': allow,
  'PATCH /api/v1/surveys/:key': allow,
  'POST /api/v1/surveys/:key/publish': allow,
  'POST /api/v1/surveys/:key/retire': allow,
  'POST /api/v1/surveys/:key/triggers': allow,
  'PATCH /api/v1/survey-triggers/:id': allow,
  'DELETE /api/v1/survey-triggers/:id': allow,

  /* ---------------------------------------------------------------- Status page (rows 5–7) */
  'PATCH /api/v1/status-page': readOnly('status-page'),
  'POST /api/v1/status-page/components': readOnly('status-page'),
  'PATCH /api/v1/status-page/components/:key': readOnly('status-page'),
  'DELETE /api/v1/status-page/components/:key': readOnly('status-page'),
  'POST /api/v1/status-page/incidents': readOnly('status-page'),
  'PATCH /api/v1/status-page/incidents/:id': readOnly('status-page'),
  'POST /api/v1/status-page/incidents/:id/updates': readOnly('status-page'),
  'POST /api/v1/status-page/maintenance': readOnly('status-page'),
  'PATCH /api/v1/status-page/maintenance/:id': readOnly('status-page'),
  'DELETE /api/v1/status-page/subscribers/:id': readOnly('status-page'),

  /* ---------------------------------------------------------------- Integrations, channels, import, SSO, AI settings */
  'POST /api/v1/credentials': readOnly('integrations'),
  'POST /api/v1/credentials/:ref/rotate': readOnly('integrations'),
  'DELETE /api/v1/credentials/:ref': readOnly('integrations'),
  'POST /api/v1/actions': readOnly('integrations'),
  'POST /api/v1/actions/:key/publish': readOnly('integrations'),
  'POST /api/v1/error-queue/:id/replay': readOnly('integrations'),
  'POST /api/v1/error-queue/:id/dismiss': readOnly('integrations'),
  'POST /api/v1/webhooks': readOnly('integrations'),
  'DELETE /api/v1/webhooks/:id': readOnly('integrations'),
  'POST /api/v1/channels/identities': readOnly('channels'),
  'POST /api/v1/import/files': readOnly('import'),
  'PUT /api/v1/import/mappings/:key': readOnly('import'),
  'DELETE /api/v1/import/mappings/:key': readOnly('import'),
  'POST /api/v1/import/jobs': readOnly('import'),
  'POST /api/v1/import/jobs/:id/commit': readOnly('import'),
  'POST /api/v1/import/jobs/:id/cancel': readOnly('import'),
  'POST /api/v1/scim/token': readOnly('sso'),
  'DELETE /api/v1/scim/token': readOnly('sso'),
  'PUT /api/v1/scim/role-mappings': readOnly('sso'),
  'PUT /api/v1/ai/budget': readOnly('ai-settings'),

  /* ---------------------------------------------------------------- Usage and packs (rows 32, 35) */
  'PUT /api/v1/usage/limits/:meter': cap('usage.change'),
  'POST /api/v1/packs/:key/install': cap('pack.install'),
  'POST /api/v1/packs/:key/upgrade': cap('pack.install'),

  /* ---------------------------------------------------------------- AI (the gateway refuses live calls, E9) */
  'POST /api/v1/ai/suggest': allow,
  'POST /api/v1/ai/suggestions/:id/outcome': allow,
  'POST /api/v1/ai/decisions/:id/suggestions/:question/accept': allow,
  'POST /api/v1/ai/decisions/:id/suggestions/:question/dismiss': allow,
  'POST /api/v1/ai/decisions/:id/applied/:question/undo': allow,

  /* ---------------------------------------------------------------- The demo's own reset (§4.6.4) */
  'POST /api/demo/v1/reset': {
    kind: 'allow',
    note: 'its cooldown, lock and request marker already rate it; it also spends one write',
  },

  /* ---------------------------------------------------------------- The platform console: no platform permission survives the strip */
  'POST /api/platform/v1/tenants': PLATFORM,
  'PUT /api/platform/v1/tenants/:id/ai-regions': PLATFORM,
  'POST /api/platform/v1/tenants/:id/suspend': PLATFORM,
  'POST /api/platform/v1/tenants/:id/resume': PLATFORM,
  'PUT /api/platform/v1/plans/:key': PLATFORM,
  'PUT /api/platform/v1/tenants/:id/plan': PLATFORM,
  'POST /api/platform/v1/ai/prompts/:key/versions': PLATFORM,
  'POST /api/platform/v1/ai/prompts/:key/versions/:version/evaluate': PLATFORM,
  'POST /api/platform/v1/ai/prompts/:key/versions/:version/promote': PLATFORM,

  /* ---------------------------------------------------------------- Never a demo session */
  'POST /api/v1/auth/dev-session': outside('the development sign-in: it has no token yet, and does not exist in a deployment'),
  'POST /status/:slug/subscribe': outside(`${PUBLIC}; a demo page stores no subscriber (E4)`),
  'POST /api/v1/public/surveys/:token': outside(`${PUBLIC}; a demo survey answers 404 (E12)`),
  'POST /api/v1/channels/email/:accountKey/inbound': outside(`${PUBLIC}; demo mail is ignored (E11)`),
  'POST /api/v1/channels/:channel/:accountKey/inbound': outside(`${PUBLIC}; demo chat is ignored (E11)`),
  'POST /scim/v2/Users': outside(SCIM),
  'PUT /scim/v2/Users/:id': outside(SCIM),
  'PATCH /scim/v2/Users/:id': outside(SCIM),
  'DELETE /scim/v2/Users/:id': outside(SCIM),
  'POST /scim/v2/Groups': outside(SCIM),
  'PUT /scim/v2/Groups/:id': outside(SCIM),
  'PATCH /scim/v2/Groups/:id': outside(SCIM),
  'DELETE /scim/v2/Groups/:id': outside(SCIM),
} satisfies Record<DemoRouteKey, DemoRoutePolicy>);
