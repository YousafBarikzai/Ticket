import 'dotenv/config';

process.env.LOG_SILENT ??= '1';

import {
  SYSTEM_PERMISSIONS,
  createContext,
  disconnectDb,
  disconnectRedis,
  withContext,
} from '@itsm/platform';
import { bootstrapModules } from '@itsm/runtime';
import { tenantService } from '@itsm/module-tenancy';
import { signDevelopmentToken } from '../../apps/api/src/auth/verify.js';

/**
 * The Phase 1 walking skeleton (docs/architecture/20 §1).
 *
 * Drives the exit criterion end to end against a running API and worker:
 *
 *   sign in → create a ticket → comment → audit event → notification →
 *   search index → SLA timer → tenant isolation
 *
 * It asserts rather than narrates: a step that does not hold fails the run, so
 * this is usable as a smoke test in the deployment pipeline as well as a demo.
 */

const BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';

interface Step {
  name: string;
  detail: string;
}

const passed: Step[] = [];
const failures: Step[] = [];

function check(condition: boolean, name: string, detail: string): void {
  if (condition) passed.push({ name, detail });
  else failures.push({ name, detail });
}

async function api<T>(
  path: string,
  options: { token?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: T; headers: Headers }> {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as T) : ({} as T);
  return { status: response.status, body, headers: response.headers };
}

async function tokenFor(slug: string, email: string): Promise<string> {
  const tenant = await tenantService.findTenantBySlug(slug);
  if (!tenant) throw new Error(`no tenant ${slug}; run \`pnpm seed\` first`);
  const ctx = createContext({ tenantId: tenant.id, actor: { type: 'system', id: null }, permissions: SYSTEM_PERMISSIONS });
  const user = await withContext(ctx, async () => {
    const { db } = await import('@itsm/platform');
    return db().user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null } });
  });
  if (!user) throw new Error(`no user ${email} in tenant ${slug}`);
  return signDevelopmentToken({
    sub: user.id,
    itsm_user_id: user.id,
    tenant_id: tenant.id,
    email: user.email,
    name: user.displayName,
    sid: `skeleton-${user.id}`,
  });
}

/** Waits for asynchronous work (the outbox, a consumer) to catch up. */
async function eventually<T>(what: string, attempt: () => Promise<T | null>, timeoutMs = 20_000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await attempt();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  process.stderr.write(`  (timed out waiting for ${what})\n`);
  return null;
}

bootstrapModules();

try {
  const agent = await tokenFor('acme', 'sam.agent@acme.test');
  const requester = await tokenFor('acme', 'ada.requester@acme.test');
  const administrator = await tokenFor('acme', 'alex.admin@acme.test');
  const otherTenantAgent = await tokenFor('beta', 'sam.agent@beta.test');

  // 1. Sign in -------------------------------------------------------------
  const me = await api<{ actor: { displayName: string }; tenant: { name: string }; permissions: unknown[]; teamIds: string[] }>(
    '/api/v1/me',
    { token: agent },
  );
  check(
    me.status === 200 && me.body.tenant.name === 'Acme Group',
    'sign in',
    `${me.body.actor?.displayName} in ${me.body.tenant?.name}, ${me.body.permissions?.length} permissions, ${me.body.teamIds?.length} team(s)`,
  );

  check(
    (await api('/api/v1/me')).status === 401,
    'unauthenticated request refused',
    'a request without a token is rejected with 401',
  );

  // 2. Create a ticket ------------------------------------------------------
  const created = await api<{ id: string; number: string; status: string; version: number; priority: string }>('/api/v1/tickets', {
    token: requester,
    method: 'POST',
    body: {
      type: 'incident',
      title: 'Printer on the third floor is jammed',
      description: 'It has been jammed since this morning.',
      priority: 'P3',
      sourceChannel: 'portal',
    },
    headers: { 'idempotency-key': `skeleton-${Date.now()}` },
  });
  check(created.status === 201, 'create a ticket', `${created.body.number} (${created.body.status}, ${created.body.priority})`);
  const ticketNumber = created.body.number;
  const ticketId = created.body.id;

  // 3. Idempotency ----------------------------------------------------------
  const idempotencyKey = `skeleton-replay-${Date.now()}`;
  const first = await api<{ number: string }>('/api/v1/tickets', {
    token: requester,
    method: 'POST',
    body: { type: 'incident', title: 'Duplicate submission test', sourceChannel: 'portal' },
    headers: { 'idempotency-key': idempotencyKey },
  });
  const replay = await api<{ number: string }>('/api/v1/tickets', {
    token: requester,
    method: 'POST',
    body: { type: 'incident', title: 'Duplicate submission test', sourceChannel: 'portal' },
    headers: { 'idempotency-key': idempotencyKey },
  });
  check(
    first.body.number === replay.body.number && replay.headers.get('idempotent-replay') === 'true',
    'idempotency key replays',
    `both calls returned ${first.body.number}`,
  );

  // 4. Optimistic locking ---------------------------------------------------
  const withoutIfMatch = await api('/api/v1/tickets/' + ticketNumber, {
    token: agent,
    method: 'PATCH',
    body: { title: 'Changed without a version' },
  });
  check(withoutIfMatch.status === 428, 'update without If-Match refused', `returned ${withoutIfMatch.status} Precondition Required`);

  const stale = await api('/api/v1/tickets/' + ticketNumber, {
    token: agent,
    method: 'PATCH',
    body: { title: 'Changed with a stale version' },
    headers: { 'if-match': '"999"' },
  });
  check(stale.status === 409, 'stale update refused', `returned ${stale.status} Conflict`);

  // 5. Agent works the ticket ----------------------------------------------
  const assigned = await api<{ assigneeId: string }>(`/api/v1/tickets/${ticketNumber}/assign`, {
    token: agent,
    method: 'POST',
    body: { method: 'manual' },
  });
  check(assigned.status === 200, 'assign', 'the agent took the ticket');

  const note = await api<{ visibility: string }>(`/api/v1/tickets/${ticketNumber}/comments`, {
    token: agent,
    method: 'POST',
    body: { body: 'Spoke to the floor manager; ordering a replacement roller.', visibility: 'internal' },
  });
  check(note.status === 201 && note.body.visibility === 'internal', 'internal note', 'agent added an internal note');

  const reply = await api(`/api/v1/tickets/${ticketNumber}/comments`, {
    token: agent,
    method: 'POST',
    body: { body: 'We are on our way with a replacement part.', visibility: 'public' },
  });
  check(reply.status === 201, 'public reply', 'agent replied to the requester');

  // 6. Internal notes never reach the requester ----------------------------
  const requesterTimeline = await api<{ includesInternal: boolean; entries: { kind: string }[] }>(
    `/api/v1/tickets/${ticketNumber}/timeline`,
    { token: requester },
  );
  const requesterSawInternal = JSON.stringify(requesterTimeline.body).includes('floor manager');
  check(
    !requesterSawInternal && requesterTimeline.body.includesInternal === false,
    'internal notes stay internal',
    'the requester timeline contains no internal note',
  );

  const agentTimeline = await api<{ includesInternal: boolean }>(`/api/v1/tickets/${ticketNumber}/timeline`, { token: agent });
  check(
    JSON.stringify(agentTimeline.body).includes('floor manager'),
    'agents see internal notes',
    'the agent timeline contains the internal note',
  );

  // 7. State machine --------------------------------------------------------
  const badTransition = await api(`/api/v1/tickets/${ticketNumber}/transitions`, {
    token: agent,
    method: 'POST',
    body: { to: 'closed' },
  });
  check(badTransition.status === 422, 'invalid transition refused', 'new cannot go straight to closed');

  const progressed = await api<{ status: string }>(`/api/v1/tickets/${ticketNumber}/transitions`, {
    token: agent,
    method: 'POST',
    body: { to: 'in_progress' },
  });
  check(progressed.body.status === 'in_progress', 'transition', 'moved to in progress');

  const resolved = await api<{ status: string; resolvedAt: string | null }>(`/api/v1/tickets/${ticketNumber}/transitions`, {
    token: agent,
    method: 'POST',
    body: { to: 'resolved', reason: 'Replaced the roller and cleared the jam.' },
  });
  check(resolved.body.status === 'resolved' && Boolean(resolved.body.resolvedAt), 'resolve', 'resolution timestamp recorded');

  // 8. Audit trail ----------------------------------------------------------
  // Audit search is an administrator's permission, not an agent's.
  const agentAudit = await api(`/api/v1/audit-events?limit=1`, { token: agent });
  check(agentAudit.status === 403, 'audit search is restricted', `an agent got ${agentAudit.status}`);

  const audit = await api<{ data: { action: string; targetId: string }[] }>(
    `/api/v1/audit-events?targetId=${ticketId}&limit=50`,
    { token: administrator },
  );
  const actions = audit.body.data?.map((row) => row.action) ?? [];
  check(
    actions.includes('ticket.created') && actions.includes('ticket.status.changed') && actions.includes('ticket.comment.added'),
    'audit trail',
    `${actions.length} events: ${[...new Set(actions)].join(', ')}`,
  );

  // 9. SLA timers -----------------------------------------------------------
  const sla = await eventually('SLA timers', async () => {
    const response = await api<{ timers: { targetType: string; state: string; dueAt: string | null }[] }>(
      `/api/v1/tickets/${ticketNumber}/sla`,
      { token: agent },
    );
    return response.body.timers?.length ? response.body : null;
  });
  check(
    Boolean(sla?.timers.length),
    'SLA timers started from the event',
    sla ? sla.timers.map((timer) => `${timer.targetType}=${timer.state}`).join(', ') : 'no timers appeared',
  );

  // 10. Notifications -------------------------------------------------------
  const inbox = await eventually('notifications', async () => {
    const response = await api<{ unread: number; data: { subject: string; eventType: string }[] }>(
      '/api/v1/notifications?limit=20',
      { token: requester },
    );
    return response.body.data?.length ? response.body : null;
  });
  check(
    Boolean(inbox?.data.length),
    'notifications delivered from events',
    inbox ? `${inbox.data.length} in the requester inbox, e.g. "${inbox.data[0]?.subject}"` : 'inbox stayed empty',
  );

  // 11. Search --------------------------------------------------------------
  const search = await eventually('search index', async () => {
    const response = await api<{ data: { title: string }[] }>('/api/v1/search?q=printer&limit=10', { token: agent });
    return response.body.data?.length ? response.body : null;
  });
  check(
    Boolean(search?.data.length),
    'search index built from events',
    search ? `found "${search.data[0]?.title}"` : 'nothing indexed',
  );

  // 12. Tenant isolation ----------------------------------------------------
  const crossTenantRead = await api(`/api/v1/tickets/${ticketId}`, { token: otherTenantAgent });
  check(
    crossTenantRead.status === 404,
    'cross-tenant read is invisible',
    `the other tenant's agent got ${crossTenantRead.status}, not 403 (existence is never revealed)`,
  );

  const betaList = await api<{ data: { id: string }[] }>('/api/v1/tickets?limit=100', { token: otherTenantAgent });
  check(
    !betaList.body.data?.some((ticket) => ticket.id === ticketId),
    'cross-tenant list excludes other tenants',
    `the other tenant sees ${betaList.body.data?.length ?? 0} tickets, none of them this one`,
  );

  // 13. Permission scope ----------------------------------------------------
  const requesterInternalNote = await api(`/api/v1/tickets/${ticketNumber}/comments`, {
    token: requester,
    method: 'POST',
    body: { body: 'trying to add an internal note', visibility: 'internal' },
  });
  check(
    requesterInternalNote.status === 403,
    'permissions enforced in the service layer',
    'a requester cannot add an internal note',
  );

  // 14. Realtime and health -------------------------------------------------
  const ready = await api<{ status: string; checks: Record<string, string> }>('/health/ready');
  check(
    ready.body.status === 'ready',
    'health',
    Object.entries(ready.body.checks ?? {}).map(([key, value]) => `${key}=${value}`).join(', '),
  );

  const metricsText = await fetch(`${BASE}/metrics`).then((response) => response.text());
  check(
    metricsText.includes('http_request_ms') && metricsText.includes('outbox_events_published_total'),
    'metrics exposed',
    'request latency and outbox counters are published',
  );
} catch (error) {
  failures.push({ name: 'run', detail: (error as Error).message });
} finally {
  await disconnectDb();
  await disconnectRedis();
}

const width = Math.max(...[...passed, ...failures].map((step) => step.name.length), 10);
process.stdout.write('\nWalking skeleton\n\n');
for (const step of passed) process.stdout.write(`  PASS  ${step.name.padEnd(width)}  ${step.detail}\n`);
for (const step of failures) process.stdout.write(`  FAIL  ${step.name.padEnd(width)}  ${step.detail}\n`);
process.stdout.write(`\n${passed.length} passed, ${failures.length} failed\n\n`);

process.exit(failures.length === 0 ? 0 : 1);
