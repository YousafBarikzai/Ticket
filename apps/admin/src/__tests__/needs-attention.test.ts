import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Admin, type Ticket } from '@itsm/sdk';
import type { Grants } from '../permissions.js';

// The module guards itself against client bundles; everything in it is plain code over an SDK passed in.
vi.mock('server-only', () => ({}));

const { collectNeedsAttention, countText, meterSentence, openMajorIncidents, reachable, sourcesFor, SOURCES } = await import(
  '../server/needs-attention.js'
);

/**
 * Needs attention (SPEC §6.1): each source asked only of someone who may
 * ask, in parallel, each failing on its own; a row only when there is
 * something to do, with one action to a page the person can open; danger
 * first; counts honest ("50+"), and never "nothing needs you" while a
 * source went unread.
 */

const NOW = new Date('2026-09-30T09:00:00Z');
const minutes = (n: number): string => new Date(NOW.getTime() + n * 60_000).toISOString();
const days = (n: number): string => new Date(NOW.getTime() + n * 86_400_000).toISOString();

function person(...keys: string[]): Grants {
  return { permissions: keys.map((key) => ({ key, scope: 'any' })) };
}

const EVERYTHING = person(
  'workflow.read',
  'integration.action.read',
  'ticket.read',
  'ticket.update',
  'security.alert.read',
  'integration.credential.read',
  'integration.credential.manage',
  'rules.rule.read',
  'catalogue.manage',
  'tenant.usage.read',
  'admin.setting.read',
  'ai.read',
  'asset.read',
  'incident.major.read',
);

function ticket(number: string, extra: Partial<Ticket> = {}): Ticket {
  return {
    id: `id-${number}`,
    number,
    type: 'incident',
    title: `Ticket ${number}`,
    description: null,
    status: 'new',
    statusCategory: 'open',
    priority: 'P3',
    impact: 'medium',
    urgency: 'medium',
    requesterId: null,
    affectedUserId: null,
    assigneeId: null,
    groupId: null,
    serviceId: null,
    categoryId: null,
    orgId: null,
    sourceChannel: 'portal',
    parentId: null,
    dueAt: null,
    resolvedAt: null,
    closedAt: null,
    reopenCount: 0,
    custom: {},
    version: 1,
    createdAt: minutes(-60),
    updatedAt: minutes(-60),
    ...extra,
  };
}

type Answers = {
  runs?: unknown;
  errors?: unknown;
  urgent?: unknown;
  due?: unknown;
  alerts?: unknown;
  credentials?: unknown;
  rules?: unknown;
  requestTypes?: unknown;
  workflows?: unknown;
  usage?: unknown;
  budget?: unknown;
  warranties?: unknown;
  incidents?: unknown;
};

/** A fake SDK: each call answers from `answers` (an `Error` is thrown), and every call is recorded. */
function fakeApi(answers: Answers = {}): { api: Admin; calls: string[] } {
  const calls: string[] = [];
  const answer = (name: keyof Answers, fallback: unknown) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push(name === 'urgent' || name === 'due' ? `${name}:${JSON.stringify(args[0])}` : name);
      const value = name in answers ? answers[name] : fallback;
      if (value instanceof Error) throw value;
      return value;
    });
  const tickets = vi.fn(async (filter: { assignee?: string; sort?: string }) => {
    const name = filter.assignee === 'none' ? 'urgent' : 'due';
    calls.push(name);
    const value = name in answers ? answers[name as keyof Answers] : { data: [], nextCursor: null };
    if (value instanceof Error) throw value;
    return value;
  });
  const api = {
    configure: {
      workflows: { runs: answer('runs', []), list: answer('workflows', []) },
      rules: { list: answer('rules', []) },
      catalogue: { requestTypes: answer('requestTypes', []) },
    },
    observe: {
      integrations: { errorQueue: answer('errors', []), credentials: answer('credentials', []) },
      tickets,
      securityAlerts: answer('alerts', []),
      ai: { budget: answer('budget', { state: 'ok', spentDisplay: '£0.00' }) },
      estate: { warranties: answer('warranties', []) },
      majorIncidents: answer('incidents', []),
    },
    tenant: { usage: answer('usage', { plan: null, meters: [] }) },
  } as unknown as Admin;
  return { api, calls };
}

const fault = (status: number): ApiError => new ApiError(status, { type: 'about:blank', title: 'Nope', status, correlationId: 'test' }, 'Nope');

describe('who is asked what', () => {
  it('consults only the sources a person may read, and calls nothing else', async () => {
    const { api, calls } = fakeApi();
    const result = await collectNeedsAttention(person('ticket.read'), api, { now: NOW });
    expect(sourcesFor(person('ticket.read')).map((source) => source.id)).toEqual(['urgent-unowned', 'sla-risk']);
    expect(result.consulted).toBe(2);
    expect(calls.sort()).toEqual(['due', 'urgent']);
  });

  it('asks nobody anything for a person with none of the permissions', async () => {
    const { api, calls } = fakeApi();
    const result = await collectNeedsAttention(person('analytics.read'), api, { now: NOW });
    expect(result).toMatchObject({ consulted: 0, items: [], failures: [], incidents: [] });
    expect(calls).toEqual([]);
  });

  it('gates every source on the permission its route checks', () => {
    const needs = Object.fromEntries(SOURCES.map((source) => [source.id, [...source.needs]]));
    expect(needs['failed-runs']).toEqual(['workflow.read', 'workflow.manage']);
    expect(needs['failed-deliveries']).toEqual(['integration.action.read', 'integration.action.manage']);
    expect(needs['security-alerts']).toEqual(['security.alert.read']);
    expect(needs.credentials).toEqual(['integration.credential.read', 'integration.credential.manage']);
    expect(needs.usage).toEqual(['tenant.usage.read']);
    expect(needs['ai-budget']).toEqual(['ai.read']);
    expect(needs.warranties).toEqual(['asset.read', 'asset.manage']);
  });

  it('asks each drafts list only of someone who may read it', async () => {
    const { api, calls } = fakeApi({ rules: [{ status: 'draft' }, { status: 'published' }] });
    const result = await collectNeedsAttention(person('rules.rule.read'), api, { now: NOW });
    expect(calls).toEqual(['rules']);
    expect(result.items.map((item) => item.title)).toEqual(['1 draft is waiting to be published']);
  });
});

describe('rows', () => {
  it('shows a row only when there is something to do', async () => {
    const { api } = fakeApi();
    const result = await collectNeedsAttention(EVERYTHING, api, { now: NOW });
    expect(result.items).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.consulted).toBe(SOURCES.length);
  });

  it('orders danger, warning, information, and gives each row one action', async () => {
    const { api } = fakeApi({
      warranties: [{ tag: 'LT-1', expired: false }],
      runs: [{ id: 'r1', status: 'failed', startedAt: minutes(-30), endedAt: minutes(-12) }],
      alerts: [{ id: 'a1', type: 'login', severity: 'high', details: {}, createdAt: minutes(-90) }],
      rules: [{ status: 'draft' }, { status: 'draft' }],
      requestTypes: [{ status: 'draft' }],
    });
    const result = await collectNeedsAttention(EVERYTHING, api, { now: NOW });
    expect(result.items.map((item) => [item.id, item.tone])).toEqual([
      ['failed-runs', 'danger'],
      ['security-alerts', 'warning'],
      ['drafts', 'info'],
      ['warranties', 'info'],
    ]);
    const runs = result.items[0]!;
    expect(runs.title).toBe('1 workflow run failed');
    expect(runs.at).toBe(minutes(-12));
    // The runs page exists (WP18): the row goes straight to the failed runs.
    expect(runs.action).toEqual({ label: 'Review', href: '/workflows/runs?status=failed' });
    const drafts = result.items.find((item) => item.id === 'drafts')!;
    expect(drafts.title).toBe('3 drafts are waiting to be published');
    expect(drafts.detail).toBe('2 rules · 1 request type');
    expect(drafts.action?.href).toBe('/rules?status=draft');
  });

  it('says "50+" when a list came back full, never a guess', async () => {
    const full = Array.from({ length: 50 }, (_, index) => ({ id: `r${index}`, startedAt: minutes(-5), endedAt: null }));
    const { api } = fakeApi({ runs: full });
    const [item] = (await collectNeedsAttention(person('workflow.read'), api, { now: NOW })).items;
    expect(item?.title).toBe('50+ workflow runs failed');
    expect(countText(50, true)).toBe('50+');
    expect(countText(1234, false)).toBe('1,234');
  });

  it('lists urgent unowned tickets, danger when a P1 is among them, linked where the person can open them', async () => {
    const { api } = fakeApi({
      urgent: { data: [ticket('INC-000004', { priority: 'P1' }), ticket('INC-000003', { priority: 'P2' })], nextCursor: null },
    });
    const [item] = (await collectNeedsAttention(person('ticket.read'), api, { now: NOW })).items;
    expect(item).toMatchObject({ id: 'urgent-unowned', tone: 'danger', title: '2 urgent tickets have no owner' });
    expect(item?.rows?.map((row) => [row.label, row.href])).toEqual([
      ['INC-000004 · Ticket INC-000004', '/tickets?open=ticket:INC-000004'],
      ['INC-000003 · Ticket INC-000003', '/tickets?open=ticket:INC-000003'],
    ]);
    expect(item?.action).toEqual({ label: 'Open', href: '/tickets?status=open&assignee=none' });
  });

  it('opens tickets in the workbench for someone who works them there', async () => {
    const { api } = fakeApi({ urgent: { data: [ticket('INC-000004', { priority: 'P2' })], nextCursor: 'more' } });
    const agent = person('ticket.read', 'ticket.update');
    const [item] = (await collectNeedsAttention(agent, api, { now: NOW, workbenchOrigin: 'https://desk.example/' })).items;
    expect(item?.title).toBe('1+ urgent tickets have no owner');
    expect(item?.tone).toBe('warning');
    expect(item?.rows?.[0]?.href).toBe('https://desk.example/tickets/INC-000004');
    expect(item?.action?.href).toBe('https://desk.example/inbox/unassigned');
  });

  it('counts SLA risk only for tickets due within two hours, danger once one is overdue', async () => {
    const page = (data: Ticket[]) => ({ data, nextCursor: null });
    const soon = await collectNeedsAttention(
      person('ticket.read'),
      fakeApi({ due: page([ticket('INC-1', { dueAt: minutes(38) }), ticket('INC-2', { dueAt: minutes(400) })]) }).api,
      { now: NOW },
    );
    expect(soon.items).toHaveLength(1);
    expect(soon.items[0]).toMatchObject({ id: 'sla-risk', tone: 'warning', title: 'INC-1 is due within 2 hours' });
    expect(soon.items[0]?.rows?.[0]).toMatchObject({ at: minutes(38), when: 'Due' });

    const late = await collectNeedsAttention(
      person('ticket.read'),
      fakeApi({ due: page([ticket('INC-1', { dueAt: minutes(-10) }), ticket('INC-2', { dueAt: minutes(30) })]) }).api,
      { now: NOW },
    );
    expect(late.items[0]).toMatchObject({ tone: 'danger', title: '2 tickets are close to breaching', detail: '1 already overdue' });

    const calm = await collectNeedsAttention(person('ticket.read'), fakeApi({ due: page([ticket('INC-3', { dueAt: days(3) })]) }).api, { now: NOW });
    expect(calm.items).toEqual([]);
  });

  it('counts only high and critical security alerts from the last seven days', async () => {
    const { api } = fakeApi({
      alerts: [
        { id: '1', type: 'x', severity: 'critical', details: null, createdAt: days(-1) },
        { id: '2', type: 'x', severity: 'medium', details: null, createdAt: days(-1) },
        { id: '3', type: 'x', severity: 'high', details: null, createdAt: days(-9) },
      ],
    });
    const [item] = (await collectNeedsAttention(person('security.alert.read'), api, { now: NOW })).items;
    expect(item).toMatchObject({ tone: 'danger', title: '1 serious security alert this week', action: { label: 'Review', href: '/security' } });
  });

  it('offers Rotate in place for one expiring credential, only to someone who may rotate it', async () => {
    const credential = { ref: 'slack-bot', expiresAt: days(9), needsRewrap: false };
    const far = { ref: 'jira', expiresAt: days(90), needsRewrap: false };
    const manager = await collectNeedsAttention(person('integration.credential.manage'), fakeApi({ credentials: [credential, far] }).api, {
      now: NOW,
    });
    expect(manager.items[0]).toMatchObject({ tone: 'info', title: 'Credential slack-bot expires soon', at: credential.expiresAt, when: 'Expires' });
    expect(manager.items[0]?.action).toMatchObject({ label: 'Rotate', rotate: { ref: 'slack-bot' } });

    const reader = await collectNeedsAttention(
      person('integration.credential.read', 'integration.action.read'),
      fakeApi({ credentials: [credential, { ref: 'old', expiresAt: days(-1), needsRewrap: false }] }).api,
      { now: NOW },
    );
    const item = reader.items.find((entry) => entry.id === 'credentials');
    expect(item).toMatchObject({ tone: 'danger', title: '2 credentials need rotating', action: { label: 'Review', href: '/integrations/credentials' } });
    expect(item?.rows?.map((row) => [row.label, row.when])).toEqual([
      ['old', 'Expired'],
      ['slack-bot', 'Expires'],
    ]);
  });

  it('words usage meters and the AI budget, and points at the page that can change them', async () => {
    const { api } = fakeApi({
      usage: {
        plan: null,
        meters: [
          { meter: 'agents', unit: 'people', shape: 'live', period: 'now', value: 47, display: '47 people', state: 'warned', soft: 45, hard: 50, description: '' },
          { meter: 'storage', unit: 'bytes', shape: 'live', period: 'now', value: 1, display: '1 B', state: 'ok', soft: null, hard: null, description: '' },
        ],
      },
      budget: { state: 'blocked', spentDisplay: '£120.00' },
    });
    const result = await collectNeedsAttention(person('tenant.usage.read', 'ai.read', 'admin.setting.read'), api, { now: NOW });
    expect(result.items.map((item) => [item.id, item.tone, item.title])).toEqual([
      ['ai-budget', 'danger', 'Monthly AI budget reached'],
      ['usage', 'warning', 'Agents: 47 people of 50 people'],
    ]);
    // Settings › Usage and › AI are still being built: both fall back to Settings.
    expect(result.items.map((item) => item.action?.href)).toEqual(['/settings', '/settings']);
    expect(meterSentence({ meter: 'agents', unit: 'people', display: '50 people', value: 50, hard: 50, soft: 45, state: 'blocked' })).toBe(
      'Agents: plan limit reached (50 people)',
    );
  });

  it('leaves the action off when there is no page this person can open', async () => {
    const { api } = fakeApi({ warranties: [{ tag: 'LT-1', expired: false }, { tag: 'LT-2', expired: true }] });
    const [item] = (await collectNeedsAttention(person('asset.read'), api, { now: NOW })).items;
    // The Assets page is still being built.
    expect(item).toMatchObject({ title: '1 asset warranty ends within 30 days' });
    expect(item?.action).toBeUndefined();
    expect(reachable(person('ticket.read'), '/rules')).toBeUndefined();
    // The first choice is a page this person cannot open, so the next one is used.
    expect(reachable(person('rules.rule.read'), '/workflows/runs', '/rules')).toBe('/rules');
  });
});

describe('failures', () => {
  it('reports a source that failed by name, and keeps the others', async () => {
    const { api } = fakeApi({ errors: fault(503), runs: [{ id: 'r', startedAt: minutes(-3), endedAt: null }] });
    const result = await collectNeedsAttention(person('workflow.read', 'integration.action.read'), api, { now: NOW });
    expect(result.items.map((item) => item.id)).toEqual(['failed-runs']);
    expect(result.failures).toEqual([expect.objectContaining({ id: 'failed-deliveries', label: 'failed deliveries', problem: expect.objectContaining({ status: 503 }) })]);
  });

  it('counts the drafts it could read and names the list it could not', async () => {
    const { api } = fakeApi({ rules: fault(500), requestTypes: [{ status: 'draft' }] });
    const result = await collectNeedsAttention(person('rules.rule.read', 'catalogue.manage'), api, { now: NOW });
    expect(result.items.map((item) => item.title)).toEqual(['1 draft is waiting to be published']);
    expect(result.failures.map((failure) => failure.id)).toEqual(['drafts']);
  });

  it('fails the drafts source only when every list it asked failed', async () => {
    const { api } = fakeApi({ rules: fault(403) });
    const result = await collectNeedsAttention(person('rules.rule.read'), api, { now: NOW });
    expect(result.items).toEqual([]);
    expect(result.failures).toEqual([expect.objectContaining({ id: 'drafts', problem: expect.objectContaining({ status: 403 }) })]);
  });

  it('turns a network failure into a retryable problem rather than throwing', async () => {
    const { api } = fakeApi({ budget: new TypeError('fetch failed') });
    const result = await collectNeedsAttention(person('ai.read'), api, { now: NOW });
    expect(result.failures[0]?.problem).toEqual({ status: 503, retryable: true });
  });
});

describe('major incidents', () => {
  it('are read only with incident.major.read, open ones only, most severe first', async () => {
    const incidents = [
      { number: 'MI-2', title: 'Slow VPN', severity: 'sev2', status: 'open', declaredAt: minutes(-60), resolvedAt: null },
      { number: 'MI-3', title: 'Email outage', severity: 'sev1', status: 'open', declaredAt: minutes(-12), resolvedAt: null },
      { number: 'MI-1', title: 'Gone', severity: 'sev1', status: 'resolved', declaredAt: days(-3), resolvedAt: days(-2) },
    ];
    const { api, calls } = fakeApi({ incidents });
    expect(await openMajorIncidents(person('ticket.read'), api)).toEqual([]);
    expect(calls).toEqual([]);
    const shown = await openMajorIncidents(person('incident.major.read'), api);
    expect(shown.map((incident) => incident.number)).toEqual(['MI-3', 'MI-2']);
  });

  it('are quietly absent when the module does not answer', async () => {
    const { api } = fakeApi({ incidents: fault(500) });
    expect(await openMajorIncidents(person('incident.major.read'), api)).toEqual([]);
  });
});
