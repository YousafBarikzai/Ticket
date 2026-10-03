import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * E3, E4, E5 and E12 (SPEC v3 §4.7.2) and the demo page (A3 §7.4): the shared
 * demo's public status page is read-only. It e-mails nobody, stores no
 * visitor's address, mirrors nothing a visitor declares, honours no forged
 * link, and says that subscriptions are off instead of offering a form.
 *
 * The tenant transaction is a recording stand-in, so each case can say not
 * only what was returned but that no row was read or written at all. Every
 * case is run for a real tenant too: the guards must change nothing there.
 */

type Rows = Record<string, (args: unknown) => unknown>;

const ids = vi.hoisted(() => ({
  DEMO: '0192a000-0000-7000-8000-00000000de00',
  STANDARD: '0192a000-0000-7000-8000-000000000001',
}));

const db = vi.hoisted(() => ({
  /** `model.method` for every call the code made on the transaction. */
  calls: [] as string[],
  writes: [] as { call: string; args: unknown }[],
  rows: {} as Rows,
}));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  const tx = new Proxy(
    {},
    {
      get: (_target, model: string) =>
        new Proxy(
          {},
          {
            get: (_inner, method: string) => async (args: unknown) => {
              const call = `${model}.${method}`;
              db.calls.push(call);
              if (/^(create|update|upsert|delete)/.test(method)) db.writes.push({ call, args });
              const answer = db.rows[call];
              if (answer) return answer(args);
              return method === 'findMany' ? [] : null;
            },
          },
        ),
    },
  );
  return {
    ...actual,
    transaction: async (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
});

vi.mock('@itsm/module-tenancy', () => ({
  tenantService: {
    findTenantById: async (id: string) => ({ id, slug: id === ids.DEMO ? 'demo' : 'northwind', status: 'active' }),
    findTenantBySlug: async () => null,
    findTenantByHost: async () => null,
  },
}));

const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string | null; body: string }[] }));

vi.mock('@itsm/module-notifications', () => ({
  transportFor: () => ({
    channel: 'email',
    send: async (input: { to: string; subject: string | null; body: string }) => {
      mail.sent.push(input);
      return { providerRef: null };
    },
  }),
}));

const { DEMO, STANDARD } = ids;

const { buildPermissionSet, createContext, handlersFor, metrics, setTenantKindReader, signToken } = await import('@itsm/platform');
const { confirm, notifySubscribers, readPublicStatus, subscribe, unsubscribe } = await import('../service/public-service.js');
const { DEMO_SUBSCRIPTIONS_OFF, renderStatusPage } = await import('../service/page-render.js');
await import('../handlers/index.js');

function contextOf(tenantId: string) {
  return createContext({ tenantId, actor: { type: 'system', id: null }, permissions: buildPermissionSet([]) });
}

function suppressed(choke: string): number {
  return metrics.snapshot().counters[`demo_egress_suppressed_total{choke=${choke}}`] ?? 0;
}

function tenant(id: string) {
  return { id, slug: id === DEMO ? 'demo' : 'northwind' };
}

function link(tenantId: string, kind: 'status_confirm' | 'status_unsubscribe'): string {
  return signToken({ tenantId, kind, subjectId: 'sub-1', expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
}

const PAGE = { id: 'page-1', name: 'Northwind Traders', description: null, supportUrl: null, isPublic: true };

beforeEach(() => {
  db.calls = [];
  db.writes = [];
  db.rows = {
    'statusPage.findFirst': () => PAGE,
    'tenant.findFirst': () => ({ slug: 'northwind' }),
    'statusSubscriber.findFirst': () => ({ id: 'sub-1', email: 'someone@example.test', confirmedAt: null, unsubscribedAt: null }),
    'statusSubscriber.create': (args) => ({ id: 'sub-1', ...(args as { data: object }).data }),
    'statusSubscriber.findMany': () => [{ id: 'sub-1', email: 'subscriber@example.test' }],
    'statusUpdate.findFirst': () => ({
      id: 'upd-1',
      status: 'investigating',
      body: 'Payslips cannot be viewed.',
      notifiedAt: null,
      incident: { title: 'Payroll is unavailable', impact: 'major' },
    }),
  };
  mail.sent = [];
  setTenantKindReader(async (tenantId) => (tenantId === DEMO ? 'demo' : 'standard'));
});

afterEach(() => {
  setTenantKindReader(null);
});

describe('E4 · subscribing', () => {
  it('gives the demo the same answer, and stores and sends nothing', async () => {
    const before = suppressed('E4');
    await expect(subscribe(tenant(DEMO), 'Visitor@Example.test')).resolves.toEqual({ ok: true });

    expect(db.calls).toEqual([]);
    expect(mail.sent).toEqual([]);
    expect(suppressed('E4')).toBe(before + 1);
  });

  it('asks a real tenant’s subscriber to confirm, as before', async () => {
    db.rows['statusSubscriber.findFirst'] = () => null;
    const before = suppressed('E4');
    await expect(subscribe(tenant(STANDARD), 'Visitor@Example.test')).resolves.toEqual({ ok: true });

    expect(db.writes).toEqual([
      { call: 'statusSubscriber.create', args: { data: expect.objectContaining({ email: 'visitor@example.test', pageId: 'page-1' }) } },
    ]);
    expect(mail.sent.map((message) => [message.to, message.subject])).toEqual([
      ['visitor@example.test', 'Confirm your status updates subscription'],
    ]);
    expect(suppressed('E4')).toBe(before);
  });
});

describe('E3 · telling subscribers', () => {
  it('sends the demo’s subscribers nothing', async () => {
    const before = suppressed('E3');
    await expect(notifySubscribers(contextOf(DEMO), { updateId: 'upd-1' })).resolves.toBe(0);

    expect(mail.sent).toEqual([]);
    expect(suppressed('E3')).toBe(before + 1);
  });

  it('sends a real tenant’s subscribers the update', async () => {
    const before = suppressed('E3');
    await expect(notifySubscribers(contextOf(STANDARD), { updateId: 'upd-1' })).resolves.toBe(1);

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'subscriber@example.test', subject: '[Northwind Traders status] Payroll is unavailable: investigating' });
    expect(suppressed('E3')).toBe(before);
  });
});

describe('E12 · confirm and unsubscribe links', () => {
  it('answers a link into the demo as invalid, and touches no row', async () => {
    // No genuine link to the demo exists, so one that verifies was forged.
    const before = suppressed('E12');
    await expect(confirm(link(DEMO, 'status_confirm'))).resolves.toEqual({ ok: false, slug: null });
    await expect(unsubscribe(link(DEMO, 'status_unsubscribe'))).resolves.toEqual({ ok: false, slug: null });

    expect(db.calls).toEqual([]);
    expect(suppressed('E12')).toBe(before + 2);
  });

  it('confirms and unsubscribes a real tenant’s subscriber, as before', async () => {
    const before = suppressed('E12');
    await expect(confirm(link(STANDARD, 'status_confirm'))).resolves.toEqual({ ok: true, slug: 'northwind' });
    db.rows['statusSubscriber.findFirst'] = () => ({ id: 'sub-1', confirmedAt: new Date(), unsubscribedAt: null });
    await expect(unsubscribe(link(STANDARD, 'status_unsubscribe'))).resolves.toEqual({ ok: true, slug: 'northwind' });

    expect(db.writes.map((write) => write.call)).toEqual(['statusSubscriber.update', 'statusSubscriber.update']);
    expect(suppressed('E12')).toBe(before);
  });

  it('still refuses a link that does not verify before asking whose tenant it is', async () => {
    const before = suppressed('E12');
    await expect(confirm(`${link(DEMO, 'status_confirm')}x`)).resolves.toEqual({ ok: false, slug: null });
    expect(suppressed('E12')).toBe(before);
  });
});

describe('the demo’s page', () => {
  it('is marked as the demo’s when it is read, and a real tenant’s is not', async () => {
    expect((await readPublicStatus(tenant(DEMO)))?.demo).toBe(true);
    expect((await readPublicStatus(tenant(STANDARD)))?.demo).toBe(false);
  });

  it('says subscriptions are off where a real page offers the form', async () => {
    const demoPage = await readPublicStatus(tenant(DEMO));
    const realPage = await readPublicStatus(tenant(STANDARD));

    const demoHtml = renderStatusPage(demoPage!);
    expect(DEMO_SUBSCRIPTIONS_OFF).toBe('Subscriptions are turned off for this demo.');
    expect(demoHtml).toContain(DEMO_SUBSCRIPTIONS_OFF);
    expect(demoHtml).not.toContain('<form');
    expect(demoHtml).not.toContain('/subscribe');

    const realHtml = renderStatusPage(realPage!);
    expect(realHtml).toContain('action="/status/northwind/subscribe"');
    expect(realHtml).not.toContain(DEMO_SUBSCRIPTIONS_OFF);
  });
});

describe('the support link, in every tenant (D23)', () => {
  // Here rather than in `render.test.ts`, which is not this package's file
  // this wave: a link stored before the https:/mailto: rule must not run.
  async function pageWith(supportUrl: string) {
    db.rows['statusPage.findFirst'] = () => ({ ...PAGE, supportUrl });
    return renderStatusPage((await readPublicStatus(tenant(STANDARD)))!);
  }

  it.each(['javascript:alert(document.cookie)', 'JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://help.example'])(
    'shows %s as text, never as a link',
    async (unsafe) => {
      const html = await pageWith(unsafe);
      expect(html).toContain('<p class="muted">Need help? Contact support.</p>');
      expect(html).not.toContain('href="javascript');
      expect(html).not.toContain('href="JavaScript');
      expect(html).not.toContain('href="data:');
      expect(html).not.toContain('href="http:');
      expect(html).not.toContain('<script>');
    },
  );

  it.each(['https://help.northwind.example/it', 'mailto:it.help@northwind.example'])('links %s, as before', async (safe) => {
    expect(await pageWith(safe)).toContain(`<a href="${safe}">Contact support</a>`);
  });
});

describe('E5 · mirroring onto the page', () => {
  const EVENTS: [string, Record<string, string>, string][] = [
    ['incident.major.declared', { incidentId: 'mi-1' }, 'majorIncident.findFirst'],
    ['incident.major.updated', { incidentId: 'mi-1', updateId: 'miu-1' }, 'majorIncidentUpdate.findFirst'],
    ['incident.major.resolved', { incidentId: 'mi-1' }, 'statusIncident.findFirst'],
    ['change.scheduled', { changeId: 'chg-1' }, 'change.findFirst'],
    ['change.closed', { changeId: 'chg-1' }, 'maintenanceWindow.findFirst'],
  ];

  function handlerFor(type: string) {
    const handler = handlersFor(type).find((one) => one.consumer === 'statuspage');
    expect(handler, type).toBeDefined();
    return handler!;
  }

  function envelope(type: string, tenantId: string, payload: Record<string, string>) {
    return { id: 'evt-1', type, tenantId, payload, occurredAt: new Date().toISOString() } as never;
  }

  it.each(EVENTS)('ignores %s in the demo before reading anything', async (type, payload) => {
    const before = suppressed('E5');
    await handlerFor(type).handle(contextOf(DEMO), envelope(type, DEMO, payload), {} as never);

    expect(db.calls).toEqual([]);
    expect(suppressed('E5')).toBe(before + 1);
  });

  it.each(EVENTS)('reads the source row for %s in a real tenant, as before', async (type, payload, firstRead) => {
    const before = suppressed('E5');
    const tx = (await import('@itsm/platform')).transaction;
    await tx(contextOf(STANDARD), (recording) => handlerFor(type).handle(contextOf(STANDARD), envelope(type, STANDARD, payload), recording));

    expect(db.calls[0]).toBe(firstRead);
    expect(suppressed('E5')).toBe(before);
  });
});
