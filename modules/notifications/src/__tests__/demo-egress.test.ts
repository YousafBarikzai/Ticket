import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * E2 (SPEC v3 §4.7.2): the shared demo sends no e-mail.
 *
 * `dispatch` runs against a recording stand-in for the tenant transaction:
 * what is under test is which rows are written and whether the transport is
 * asked, for a demo tenant and for a real one with the same notification.
 * In-app delivery is the product being shown, so it must stay exactly as it
 * is; the e-mail leg must leave a record that says why nothing went.
 */

interface Attempt {
  notificationId: string;
  channel: string;
  attempt: number;
  status: string;
  error?: string | null;
  providerRef?: string | null;
}

const db = vi.hoisted(() => ({
  notification: null as null | { id: string; recipientId: string; eventType: string; subject: string | null; body: string; status: string },
  attempts: [] as Attempt[],
  published: [] as string[],
  notices: 0,
}));

vi.mock('@itsm/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@itsm/platform')>();
  const tx = {
    notification: {
      findFirst: async () => db.notification,
      update: async ({ data }: { data: { status: string } }) => {
        if (db.notification) db.notification.status = data.status;
        return db.notification;
      },
    },
    user: {
      findFirst: async () => ({ id: 'user-1', email: 'emma.clarke@northwind.example', timeZone: 'Europe/London' }),
    },
    notificationPreference: { findFirst: async () => null },
    deliveryAttempt: {
      count: async ({ where }: { where: { notificationId: string; channel: string; status?: string } }) =>
        db.attempts.filter(
          (row) =>
            row.notificationId === where.notificationId &&
            row.channel === where.channel &&
            (where.status === undefined || row.status === where.status),
        ).length,
      create: async ({ data }: { data: Attempt }) => {
        db.attempts.push(data);
        return data;
      },
    },
  };
  return {
    ...actual,
    transaction: async (_ctx: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    publish: async (_tx: unknown, _ctx: unknown, input: { definition: { type: string } }) => {
      db.published.push(input.definition.type);
    },
    publishNotice: async () => {
      db.notices += 1;
    },
    enqueue: async () => undefined,
  };
});

const { buildPermissionSet, createContext, metrics, setTenantKindReader } = await import('@itsm/platform');
const { SUPPRESSED_DELIVERY, dispatch, registerTransport } = await import('../service/notification-service.js');

const DEMO = '0192a000-0000-7000-8000-00000000de00';
const STANDARD = '0192a000-0000-7000-8000-000000000001';

function contextOf(tenantId: string) {
  return createContext({ tenantId, actor: { type: 'system', id: null }, permissions: buildPermissionSet([]) });
}

function suppressed(): number {
  return metrics.snapshot().counters['demo_egress_suppressed_total{choke=E2}'] ?? 0;
}

const send = vi.fn(async () => ({ providerRef: 'msg-1' }));
const kindReader = vi.fn(async (tenantId: string) => (tenantId === DEMO ? 'demo' : 'standard'));

beforeEach(() => {
  db.notification = {
    id: 'n-1',
    recipientId: 'user-1',
    eventType: 'ticket.assigned',
    subject: 'INC-000101 was assigned to you',
    body: 'The VPN is down for everyone.',
    status: 'queued',
  };
  db.attempts = [];
  db.published = [];
  db.notices = 0;
  send.mockClear();
  kindReader.mockClear();
  setTenantKindReader(kindReader);
  registerTransport({ channel: 'email', send });
});

afterEach(() => {
  setTenantKindReader(null);
});

describe('an e-mail notification in the shared demo', () => {
  it('is not sent, and the notification says it was held back', async () => {
    const before = suppressed();
    await expect(dispatch(contextOf(DEMO), 'n-1', 'email')).resolves.toBe('skipped');

    expect(send).not.toHaveBeenCalled();
    expect(db.notification!.status).toBe('suppressed');
    expect(suppressed()).toBe(before + 1);
  });

  it('leaves a delivery attempt the delivery log can name: suppressed, because demo', async () => {
    await dispatch(contextOf(DEMO), 'n-1', 'email');

    expect(SUPPRESSED_DELIVERY).toEqual({ status: 'suppressed', error: 'demo' });
    expect(db.attempts).toEqual([
      expect.objectContaining({ notificationId: 'n-1', channel: 'email', attempt: 1, status: 'suppressed', error: 'demo' }),
    ]);
    // Neither sent nor failed: nothing for the analytics projection to count
    // as a delivery, and nothing for a queue to retry.
    expect(db.published).toEqual([]);
  });

  it('writes the attempt once when the job is delivered again', async () => {
    await dispatch(contextOf(DEMO), 'n-1', 'email');
    await expect(dispatch(contextOf(DEMO), 'n-1', 'email')).resolves.toBe('skipped');

    expect(db.attempts).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('an in-app notification in the shared demo', () => {
  it('is delivered exactly as for a real tenant, without asking whose tenant it is', async () => {
    const before = suppressed();
    await expect(dispatch(contextOf(DEMO), 'n-1', 'inapp')).resolves.toBe('sent');

    expect(db.notification!.status).toBe('sent');
    expect(db.notices).toBe(1);
    expect(db.attempts).toEqual([]);
    expect(kindReader).not.toHaveBeenCalled();
    expect(suppressed()).toBe(before);
  });
});

describe('the same e-mail for a real tenant', () => {
  it('is sent and recorded as before', async () => {
    const before = suppressed();
    await expect(dispatch(contextOf(STANDARD), 'n-1', 'email')).resolves.toBe('sent');

    expect(send).toHaveBeenCalledWith({
      to: 'emma.clarke@northwind.example',
      subject: 'INC-000101 was assigned to you',
      body: 'The VPN is down for everyone.',
    });
    expect(db.attempts).toEqual([expect.objectContaining({ channel: 'email', attempt: 1, status: 'sent', providerRef: 'msg-1' })]);
    expect(db.notification!.status).toBe('sent');
    expect(db.published).toEqual(['notification.sent']);
    expect(suppressed()).toBe(before);
  });
});
