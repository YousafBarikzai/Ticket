import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { permissionRegistry } from '@itsm/platform';
import { SYSTEM_ROLES } from '@itsm/module-identity';
import { closeHarness, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * The permission matrix suite (specification Appendix B).
 *
 * Release-blocking. For each persona and each endpoint, the expected allow or
 * deny is asserted against the running API — not against the permission
 * checker in isolation, because the thing worth proving is that the route, the
 * service and the scope resolver agree.
 *
 * "Denied" means 403 when the caller may know the record exists and 404 when
 * they may not (specification §7).
 */

type Persona = 'requester' | 'agent' | 'lead' | 'otherAgent' | 'admin';

interface MatrixEntry {
  what: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: (tenant: TestTenant) => string;
  body?: (tenant: TestTenant) => unknown;
  /** Personas that must be allowed. Everyone else must be refused. */
  allowed: Persona[];
  /** The status a refusal takes for personas that cannot see the record at all. */
  deniedStatus?: Record<string, number>;
}

const ALL_PERSONAS: Persona[] = ['requester', 'agent', 'lead', 'otherAgent', 'admin'];

const MATRIX: MatrixEntry[] = [
  {
    what: 'read own ticket',
    path: (t) => `/api/v1/tickets/${t.ticketNumbers[0]}`,
    // Ticket 0 belongs to `requester` and sits in the primary team's queue, so
    // the agent in the other team cannot see it at all.
    allowed: ['requester', 'agent', 'lead', 'admin'],
    deniedStatus: { otherAgent: 404 },
  },
  {
    what: 'read another person\'s ticket',
    path: (t) => `/api/v1/tickets/${t.ticketNumbers[1]}`,
    allowed: ['agent', 'lead', 'admin'],
    deniedStatus: { requester: 404, otherAgent: 404 },
  },
  {
    what: 'read a ticket in another team',
    path: (t) => `/api/v1/tickets/${t.ticketNumbers[2]}`,
    // Ticket 2 is the other team's and was raised by `requester`.
    allowed: ['requester', 'otherAgent', 'admin'],
    deniedStatus: { agent: 404, lead: 404 },
  },
  {
    what: 'create a ticket',
    method: 'POST',
    path: () => '/api/v1/tickets',
    body: () => ({ type: 'incident', title: 'Matrix test ticket', sourceChannel: 'portal' }),
    allowed: ALL_PERSONAS,
  },
  {
    what: 'add a public reply',
    method: 'POST',
    path: (t) => `/api/v1/tickets/${t.ticketNumbers[0]}/comments`,
    body: () => ({ body: 'a public reply', visibility: 'public' }),
    allowed: ['requester', 'agent', 'lead', 'admin'],
    deniedStatus: { otherAgent: 404 },
  },
  {
    what: 'add an internal note',
    method: 'POST',
    path: (t) => `/api/v1/tickets/${t.ticketNumbers[0]}/comments`,
    body: () => ({ body: 'an internal note', visibility: 'internal' }),
    // The requester may see this ticket, so the refusal is 403, not 404.
    allowed: ['agent', 'lead', 'admin'],
    deniedStatus: { requester: 403, otherAgent: 404 },
  },
  {
    what: 'assign a ticket',
    method: 'POST',
    path: (t) => `/api/v1/tickets/${t.ticketNumbers[0]}/assign`,
    body: () => ({ method: 'manual' }),
    allowed: ['agent', 'lead', 'admin'],
    deniedStatus: { requester: 403, otherAgent: 404 },
  },
  {
    what: 'search',
    path: () => '/api/v1/search?q=VPN',
    allowed: ALL_PERSONAS,
  },
  {
    what: 'list users',
    path: () => '/api/v1/users',
    // A requester holds `identity.user.read` at `own` scope, so the request
    // succeeds but returns only themselves; the assertion is on the contents.
    allowed: ['agent', 'lead', 'admin', 'otherAgent', 'requester'],
  },
  {
    what: 'create a user',
    method: 'POST',
    path: () => '/api/v1/users',
    body: () => ({ email: `matrix-${Date.now()}@example.test`, displayName: 'Matrix User' }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'grant a role',
    method: 'POST',
    path: () => '/api/v1/role-assignments',
    // Granted to the spare person: a matrix entry must not change what another
    // entry expects of a persona.
    body: (t) => ({ userId: t.people.spare!.id, roleKey: 'agent' }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'read the audit trail',
    path: () => '/api/v1/audit-events?limit=5',
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'read security alerts',
    path: () => '/api/v1/security/alerts',
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'publish a setting',
    method: 'PATCH',
    path: () => '/api/v1/settings/ticket.autoClose.days',
    body: () => ({ value: 10 }),
    allowed: [],
    // PATCH is not a method this route accepts; the matrix proves nobody gets in
    // through an unintended verb either.
    deniedStatus: { requester: 404, agent: 404, lead: 404, otherAgent: 404, admin: 404 },
  },
  {
    what: 'change a setting',
    method: 'POST',
    path: () => '/api/v1/settings/ticket.autoClose.days',
    body: () => ({ value: 10 }),
    allowed: [],
    deniedStatus: { requester: 404, agent: 404, lead: 404, otherAgent: 404, admin: 404 },
  },
  {
    what: 'manage webhooks',
    method: 'POST',
    path: () => '/api/v1/webhooks',
    body: () => ({ name: 'matrix', url: 'https://example.test/hook', eventTypes: ['ticket.created'] }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'enable a module',
    method: 'POST',
    path: () => '/api/v1/modules/MOD-09/enable',
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'read the business rules',
    path: () => '/api/v1/rules',
    // A lead needs to see why their queue is routed as it is; an agent does not.
    allowed: ['admin', 'lead'],
    deniedStatus: { requester: 403, agent: 403, otherAgent: 403 },
  },
  {
    what: 'write a business rule',
    method: 'POST',
    path: () => '/api/v1/rules',
    body: () => ({
      key: `matrix-${Date.now()}`,
      name: 'Matrix rule',
      event: 'ticket.created',
      conditions: { always: true },
      actions: [{ type: 'addTag', tag: 'matrix' }],
    }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'publish a business rule',
    method: 'POST',
    path: () => '/api/v1/rules/major-incident-p1/publish',
    // Publishing changes what happens to every team's tickets, so it is the
    // administrator's, not a lead's.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'see the approvals waiting on them',
    path: () => '/api/v1/approvals',
    // Anyone can be named an approver, so everyone may open their own queue.
    allowed: ALL_PERSONAS,
  },
  {
    what: 'read the approval policies',
    path: () => '/api/v1/approval-policies',
    allowed: ['admin', 'lead'],
    deniedStatus: { requester: 403, agent: 403, otherAgent: 403 },
  },
  {
    what: 'write an approval policy',
    method: 'POST',
    path: () => '/api/v1/approval-policies',
    body: () => ({
      key: `matrix-approval-${Date.now()}`,
      name: 'Matrix policy',
      subjectType: 'request',
      steps: [{ name: 'Manager', approvers: [{ kind: 'manager', levels: 1 }] }],
    }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'browse the catalogue',
    path: () => '/api/v1/catalogue',
    allowed: ALL_PERSONAS,
  },
  {
    what: 'raise a request from the catalogue',
    method: 'POST',
    path: () => '/api/v1/catalogue/system-access/submit',
    body: () => ({ answers: { system: 'crm', accessLevel: 'read' } }),
    allowed: ALL_PERSONAS,
  },
  {
    what: 'write a catalogue item',
    method: 'POST',
    path: () => '/api/v1/request-types',
    body: () => ({ key: `matrix-item-${Date.now()}`, serviceKey: 'business-applications', name: 'Matrix item' }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'write a form definition',
    method: 'POST',
    path: () => '/api/v1/forms',
    body: () => ({
      key: `matrix-form-${Date.now()}`,
      name: 'Matrix form',
      document: {
        key: 'matrix-form',
        schema: { type: 'object', properties: { note: { type: 'string' } } },
        ui: { elements: [{ kind: 'field', field: 'note', control: 'text' }] },
      },
    }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'read the knowledge base',
    path: () => '/api/v1/knowledge',
    // Everyone reads; what differs is what comes back, which the scope tests
    // below cover rather than this allow/deny matrix.
    allowed: ['requester', 'agent', 'lead', 'otherAgent', 'admin'],
  },
  {
    what: 'write an article',
    method: 'POST',
    path: () => '/api/v1/knowledge',
    body: () => ({
      key: `matrix-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Written during the permission matrix run',
      body: [{ kind: 'paragraph', runs: [{ text: 'Placeholder.' }] }],
      audience: 'internal',
    }),
    // An article is usually written by whoever just worked out the answer, so
    // an agent writes. A requester does not.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'see who is on call',
    path: () => '/api/v1/workload/rotations',
    // Anybody who takes tickets needs to know who to hand a P1 to at six in
    // the evening. A requester does not.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'say they are available for work',
    method: 'PUT',
    path: () => '/api/v1/workload/availability',
    body: () => ({ status: 'available' }),
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'write a shift pattern',
    method: 'POST',
    path: () => '/api/v1/workload/shifts',
    body: (t) => ({
      key: `matrix-shift-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Written during the permission matrix run',
      teamId: t.teamId,
      timeZone: 'Europe/London',
      pattern: { mon: [{ from: '09:00', to: '17:00' }] },
    }),
    // A lead runs the rota day to day; writing the pattern changes who works
    // every week to come, which is an administrator's.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'ask why the queue is not moving',
    path: (t) => `/api/v1/workload/routing/${t.teamId}/explain`,
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'see the major incidents',
    path: () => '/api/v1/major-incidents',
    // Anybody who takes tickets needs to know what is on fire. A requester
    // hears about it from the portal and the status page, not from here.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'declare a major incident',
    method: 'POST',
    path: () => '/api/v1/major-incidents',
    body: (t) => ({
      title: 'Declared during the permission matrix run',
      severity: 'SEV3',
      commanderId: t.people.lead!.id,
    }),
    // Declaring pages people, so it is a lead's. An agent runs one once it is
    // declared, which is `incident.major.command`, not this.
    allowed: ['lead', 'admin'],
    deniedStatus: { requester: 403, agent: 403, otherAgent: 403 },
  },
  {
    what: 'search the known errors',
    path: () => '/api/v1/known-errors',
    // What an agent reads before spending an hour on something already solved.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'raise a problem',
    method: 'POST',
    path: () => '/api/v1/problems',
    body: () => ({ title: 'Raised during the permission matrix run', priority: 'P4' }),
    // An agent raises one: they are the person who noticed it three times.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'see the change calendar',
    path: () => '/api/v1/changes',
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'declare a blackout window',
    method: 'POST',
    path: () => '/api/v1/change-windows',
    body: () => ({
      kind: 'blackout',
      name: `Matrix blackout ${Math.random().toString(36).slice(2, 10)}`,
      timeZone: 'Europe/London',
      startsAt: '2027-01-01T00:00:00Z',
      endsAt: '2027-01-02T00:00:00Z',
    }),
    // A blackout stops everybody's changes, so writing one is an
    // administrator's.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'read the configuration item register',
    path: () => '/api/v1/cis',
    // An agent reads the CMDB during triage; a requester has no business in it.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'say what a record touched',
    method: 'POST',
    path: () => '/api/v1/ci-links',
    body: () => ({
      entityType: 'ticket',
      entityId: '00000000-0000-4000-8000-000000000000',
      ciId: '00000000-0000-4000-8000-000000000001',
    }),
    // Nobody is allowed outright here because the configuration item does not
    // exist, so a permitted caller gets 404 and a refused one 403 — which is
    // the distinction worth asserting: an agent may link, a requester may not.
    allowed: [],
    deniedStatus: { requester: 403, agent: 404, lead: 404, otherAgent: 404, admin: 404 },
  },
  {
    what: 'read the asset register',
    path: () => '/api/v1/assets',
    // An agent is asked "what laptop does this person have?" all day. Changing
    // the answer is a lead's.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'see the discovery queue',
    path: () => '/api/v1/discovery/proposals',
    // A lead works the queue; an agent does not see it, because accepting from
    // it writes the register.
    allowed: ['lead', 'admin'],
    deniedStatus: { requester: 403, agent: 403, otherAgent: 403 },
  },
  {
    what: 'configure a discovery source',
    method: 'POST',
    path: () => '/api/v1/discovery/sources',
    body: () => ({ key: 'matrix-source', name: 'Matrix', kind: 'http_json', config: {} }),
    // Nobody outright: the config has no mapping, so a permitted caller gets
    // 422 and a refused one 403 — which is the line being drawn. Configuring a
    // source decides what may write the register without being asked.
    allowed: [],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403, admin: 422 },
  },
  {
    what: 'see the dashboards',
    path: () => '/api/v1/analytics/dashboards',
    // A lead sees their team's numbers; an agent works the queue and is not
    // measured against it in a dashboard they can open themselves.
    allowed: ['lead', 'admin'],
    deniedStatus: { requester: 403, agent: 403, otherAgent: 403 },
  },
  {
    what: 'define a metric',
    method: 'POST',
    path: () => '/api/v1/analytics/metrics',
    body: () => ({ key: 'matrix.raised', name: 'Matrix raised', fact: 'ticket', aggregate: 'count', filters: [] }),
    // Defining a metric changes what every dashboard can say, which is
    // management rather than reading.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'replay the reporting projection',
    method: 'POST',
    path: () => '/api/v1/analytics/replay',
    body: () => ({}),
    // Rewrites every figure the tenant is looking at: an administrator's act.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'see survey responses',
    path: () => '/api/v1/survey-responses',
    // A lead sees their team's; nobody below a lead sees any. Satisfaction is
    // about the team, and a single agent's view of it is a performance review.
    allowed: ['lead', 'admin'],
    deniedStatus: { requester: 403, agent: 403, otherAgent: 403 },
  },
  {
    what: 'design a survey',
    method: 'POST',
    path: () => '/api/v1/surveys',
    body: () => ({
      key: 'matrix-survey',
      name: 'Matrix survey',
      document: { title: 'Matrix', schema: { type: 'object', properties: {} }, ui: { elements: [] } },
    }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'log time on a ticket they can see',
    method: 'POST',
    path: () => '/api/v1/time-entries',
    body: (t) => ({ ticketId: t.ticketIds[0], activityKey: 'work', minutes: 5 }),
    // Ticket 0 is the primary team's. The other team's agent cannot see it, so
    // 404; the requester holds no time.log at all.
    allowed: ['agent', 'lead', 'admin'],
    deniedStatus: { requester: 403, otherAgent: 404 },
  },
  {
    what: 'set a budget',
    method: 'POST',
    path: () => '/api/v1/budgets',
    body: () => ({ key: 'matrix-budget', name: 'Matrix', scopeType: 'tenant', periodKind: 'month', amount: 1000, currency: 'GBP' }),
    // Money is the service owner's and the administrator's; neither is a
    // persona here, so only the administrator succeeds.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'see the status page as an operator',
    path: () => '/api/v1/status-page',
    // Subscriber addresses and hidden incidents: the service owner's and the
    // administrator's, and neither a lead nor an agent is either.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'open an incident on the status page',
    method: 'POST',
    path: () => '/api/v1/status-page/incidents',
    body: () => ({ title: 'Matrix incident', impact: 'minor', body: 'Looking into it.' }),
    // A statement to the public, so it is made by whoever answers for the
    // service, not by whoever noticed.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'start an import',
    method: 'POST',
    path: () => '/api/v1/import/jobs',
    body: () => ({ name: 'Matrix', entity: 'users', source: 'csv', config: {}, mapping: { externalKeyFrom: 'id', fields: { email: 'email', displayName: 'name' } } }),
    // Writes users, teams, services and tickets in bulk: an administrator's
    // act. The administrator gets 422 because no file was uploaded, which is
    // the line being drawn: refused on permission first, on content second.
    allowed: [],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403, admin: 422 },
  },
  {
    what: 'rotate the SCIM token',
    method: 'POST',
    path: () => '/api/v1/scim/token',
    body: () => ({}),
    // Whoever holds the token can create and deactivate every user: only an
    // administrator issues one.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'see what this tenant is using against its plan',
    path: () => '/api/v1/usage',
    // What the desk costs is the administrator's business, not an agent's.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'ask the AI service for a suggestion',
    method: 'POST',
    path: () => '/api/v1/ai/suggest',
    body: (t) => ({ capability: 'similar-work', ticketId: t.ticketIds[0] }),
    // Agent-facing by design (ADR-0006): a person reads the evidence and
    // decides, so a requester never asks and never sees one. The agent in the
    // other team gets 404 rather than 403 — they may not know this ticket
    // exists, and a suggestion must not be the thing that tells them.
    allowed: ['agent', 'lead', 'admin'],
    deniedStatus: { requester: 403, otherAgent: 404 },
  },
  {
    what: 'see what this tenant is spending on AI',
    path: () => '/api/v1/ai/budget',
    // Every agent holds `ai.read`, including one in another team: the budget
    // is the tenant's, not a team's, and an agent who is about to be refused
    // should be able to see why. Setting it is the administrator's, below.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'see the AI decisions about one ticket',
    path: (t) => `/api/v1/ai/decisions?subjectId=${t.ticketIds[0]}`,
    // A decision names the ticket and how it was classified, so it follows
    // the ticket's own visibility: the agent in the other team gets the same
    // 404 the ticket would give them (ADR-0051).
    allowed: ['agent', 'lead', 'admin'],
    deniedStatus: { requester: 403, otherAgent: 404 },
  },
  {
    what: 'list every AI decision in the tenant',
    path: () => '/api/v1/ai/decisions',
    // A list of every decision is a list of every triaged ticket.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'see how well AI triage has matched people',
    path: () => '/api/v1/ai/decisions/score',
    // Totals only — no ticket, no answer — so every holder of `ai.read`.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'set this tenant\u2019s AI budget',
    method: 'PUT',
    path: () => '/api/v1/ai/budget',
    body: () => ({ limitPence: 5000, warnPence: 4000 }),
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'write a prompt version',
    method: 'POST',
    path: () => '/api/platform/v1/ai/prompts/reply-draft/versions',
    body: () => ({ systemPrompt: 'You draft replies. Answer only from what you are given.', template: 'Title: {{ticket.title}}' }),
    // Prompts are the deployment's. No tenant role holds the permission, and
    // the platform prefix refuses everybody here before the service does.
    allowed: [],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403, admin: 403 },
  },
  {
    what: 'see the packs this deployment ships',
    path: () => '/api/v1/packs',
    // Which desks could be stood up is a configuration question, and the
    // catalogue an agent works from is downstream of the answer.
    allowed: ['admin'],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403 },
  },
  {
    what: 'install a pack',
    method: 'POST',
    path: () => '/api/v1/packs/facilities/install',
    body: () => ({}),
    // Writes services, forms, workflows and an SLA policy in one act. The
    // administrator gets 201 because it genuinely installs, which is the line
    // being drawn: everybody else is refused before anything is written.
    allowed: [],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403, admin: 201 },
  },
  {
    what: 'see which contracts need a decision',
    path: () => '/api/v1/contracts-attention',
    // An agent needs the supplier's support number when something breaks.
    allowed: ['agent', 'lead', 'otherAgent', 'admin'],
    deniedStatus: { requester: 403 },
  },
  {
    what: 'reach the platform console',
    path: () => '/api/platform/v1/tenants',
    // A tenant administrator is not a platform operator.
    allowed: [],
    deniedStatus: { requester: 403, agent: 403, lead: 403, otherAgent: 403, admin: 403 },
  },
];

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('matrix');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('matrix');
  await closeHarness();
});

describe('permission matrix', () => {
  for (const entry of MATRIX) {
    for (const persona of ALL_PERSONAS) {
      const shouldAllow = entry.allowed.includes(persona);
      const expectedDenied = entry.deniedStatus?.[persona];

      it(`${persona} ${shouldAllow ? 'may' : 'may not'} ${entry.what}`, async () => {
        const response = await request(entry.path(tenant), {
          method: entry.method ?? 'GET',
          token: tenant.people[persona]!.token,
          ...(entry.body ? { body: entry.body(tenant) } : {}),
        });

        if (expectedDenied !== undefined) {
          expect(response.status).toBe(expectedDenied);
          return;
        }
        if (shouldAllow) {
          expect(response.status).toBeLessThan(400);
        } else {
          expect([401, 403, 404]).toContain(response.status);
        }
      });
    }
  }
});

describe('publishing knowledge is a separate permission from writing it', () => {
  // Not in the matrix above, because publishing is not idempotent: once one
  // persona publishes the draft, the next finds nothing to publish and fails
  // for the wrong reason. Each persona gets its own article instead, which is
  // also closer to what actually happens.
  for (const persona of ALL_PERSONAS) {
    const mayPublish = persona === 'lead' || persona === 'admin';

    it(`${persona} ${mayPublish ? 'may' : 'may not'} publish an article`, async () => {
      const key = `matrix-publish-${persona.toLowerCase()}`;
      const created = await request('/api/v1/knowledge', {
        method: 'POST',
        token: tenant.people.admin!.token,
        body: {
          key,
          title: `An article for ${persona} to try to publish`,
          body: [{ kind: 'paragraph', runs: [{ text: 'Placeholder.' }] }],
          audience: 'tenant',
        },
      });
      // A 404 from a missing article would pass a deny assertion for the wrong
      // reason, which is how a permission test quietly stops testing anything.
      expect(created.status).toBe(201);

      const response = await request(`/api/v1/knowledge/${key}/publish`, {
        method: 'POST',
        token: tenant.people[persona]!.token,
      });

      if (mayPublish) {
        expect(response.status).toBeLessThan(400);
      } else {
        expect(response.status).toBe(403);
      }
    });
  }

  it('lets an agent write a draft but not make it live', async () => {
    // The distinction the two permissions exist for: anyone who works out an
    // answer should write it down; somebody accountable decides it is right.
    const key = 'matrix-agent-draft';
    const created = await request('/api/v1/knowledge', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: {
        key,
        title: 'Written by an agent',
        body: [{ kind: 'paragraph', runs: [{ text: 'What I just worked out.' }] }],
        audience: 'internal',
      },
    });
    expect(created.status).toBe(201);
    expect((await request(`/api/v1/knowledge/${key}/publish`, { method: 'POST', token: tenant.people.agent!.token })).status).toBe(403);
    expect((await request(`/api/v1/knowledge/${key}/publish`, { method: 'POST', token: tenant.people.lead!.token })).status).toBeLessThan(400);
  });
});

describe('writing the register is separate from reading it', () => {
  // Not in the matrix above, because the call needs a class that exists, and
  // creating one is itself a permitted write. Each persona is asserted against
  // a register that is already set up, which is the real situation.
  beforeAll(async () => {
    const created = await request('/api/v1/ci-classes', {
      method: 'POST',
      token: tenant.people.admin!.token,
      body: { key: 'matrix_server', name: 'Server' },
    });
    // A 409 means a previous run left it behind, which is fine; anything else
    // would make the deny assertions below pass for the wrong reason.
    expect([201, 409]).toContain(created.status);
  }, 60_000);

  for (const persona of ALL_PERSONAS) {
    const mayWrite = persona === 'lead' || persona === 'admin';

    it(`${persona} ${mayWrite ? 'may' : 'may not'} add a configuration item`, async () => {
      const response = await request('/api/v1/cis', {
        method: 'POST',
        token: tenant.people[persona]!.token,
        body: { classKey: 'matrix_server', name: `Matrix item for ${persona}` },
      });

      if (mayWrite) {
        expect(response.status).toBe(201);
      } else {
        // The value of a CMDB is that its contents were decided. A register
        // anybody may edit mid-incident stops being one anybody trusts.
        expect(response.status).toBe(403);
      }
    });
  }
});

describe('scope narrows what a permitted call returns', () => {
  it('shows a requester only themselves in the user directory', async () => {
    // Holding `identity.user.read` is not licence to enumerate the tenant: the
    // scope has to narrow the result, not merely open the door.
    const response = await request<{ data: { id: string }[] }>('/api/v1/users?limit=200', {
      token: tenant.people.requester!.token,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.map((user) => user.id)).toEqual([tenant.people.requester!.id]);
  });

  it('shows an administrator everyone', async () => {
    const response = await request<{ data: { id: string }[] }>('/api/v1/users?limit=200', {
      token: tenant.people.admin!.token,
    });
    expect(response.body.data.length).toBeGreaterThanOrEqual(Object.keys(tenant.people).length);
  });

  it('shows an agent only their own tenant\'s queues, not every ticket', async () => {
    const response = await request<{ data: { id: string }[] }>('/api/v1/tickets?limit=200', {
      token: tenant.people.agent!.token,
    });
    const ids = response.body.data.map((ticket) => ticket.id);
    // The third seeded ticket belongs to the other team.
    expect(ids).not.toContain(tenant.ticketIds[2]);
    expect(ids).toContain(tenant.ticketIds[0]);
  });
});

describe('the matrix and the registry agree', () => {
  it('grants only permissions some module actually declares', () => {
    // A role naming a permission no module defines would be silently inert: it
    // would look granted in the admin console and do nothing.
    const declared = new Set(permissionRegistry().map((permission) => permission.key));
    const unknown: string[] = [];
    for (const role of SYSTEM_ROLES) {
      for (const permission of role.permissions) {
        if (!declared.has(permission.key)) unknown.push(`${role.key} → ${permission.key}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('grants only scopes the declaring module supports', () => {
    const byKey = new Map(permissionRegistry().map((permission) => [permission.key, permission.scopes]));
    const mismatched: string[] = [];
    for (const role of SYSTEM_ROLES) {
      for (const permission of role.permissions) {
        const scopes = byKey.get(permission.key);
        if (scopes && !scopes.includes(permission.scope)) {
          mismatched.push(`${role.key} → ${permission.key} at ${permission.scope}`);
        }
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('gives the administrator role every tenant-level permission available in this phase', () => {
    // A permission no role can hold is a feature nobody can reach. Permissions
    // declared for a later phase are exempt, and say so in their declaration.
    const administrator = SYSTEM_ROLES.find((role) => role.key === 'administrator')!;
    const held = new Set(administrator.permissions.map((permission) => permission.key));
    const missing = permissionRegistry()
      .filter((permission) => !held.has(permission.key))
      // Platform operations belong to the platform team, not to a tenant.
      .filter((permission) => !permission.key.startsWith('platform.'))
      .filter((permission) => (permission.phase ?? 'PH-1') === 'PH-1')
      .map((permission) => permission.key);
    expect(missing).toEqual([]);
  });

  it('declares a phase for every permission no role holds yet', () => {
    const held = new Set(SYSTEM_ROLES.flatMap((role) => role.permissions.map((permission) => permission.key)));
    const unheldWithoutPhase = permissionRegistry()
      .filter((permission) => !held.has(permission.key))
      .filter((permission) => !permission.key.startsWith('platform.'))
      .filter((permission) => !permission.phase)
      .map((permission) => permission.key);
    expect(unheldWithoutPhase).toEqual([]);
  });
});
