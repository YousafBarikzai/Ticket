import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, transaction, withContext } from '@itsm/platform';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * `GET /notifications?unread=` read as the boolean it is (Q1).
 *
 * `z.coerce.boolean()` made `?unread=false` mean "unread only", so a client
 * that spelled out the default — the notification centre's "All" tab — got
 * the unread tab instead, and read notifications vanished from it.
 */

let tenant: TestTenant;
const asRequester = () => tenant.people.requester!.token;

interface Inbox {
  unread: number;
  data: { id: string; subject: string | null; readAt: string | null }[];
}

async function inbox(query = '', token = asRequester()): Promise<Inbox> {
  const response = await request<Inbox>(`/api/v1/notifications${query}`, { token });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body;
}

beforeAll(async () => {
  tenant = await createTestTenant('notifications-unread');
  // Written directly: what is under test is the reading, and producing these
  // through events would test the notification rules as well.
  const ctx = contextFor(tenant.id);
  const row = (recipient: string, subject: string, readAt: Date | null) => ({
    id: newId(),
    tenantId: tenant.id,
    eventId: newId(),
    eventType: 'ticket.updated',
    recipientId: tenant.people[recipient]!.id,
    ruleKey: 'test',
    templateKey: 'test',
    ticketId: tenant.ticketIds[0]!,
    subject,
    body: subject,
    status: 'sent',
    readAt,
  });
  await withContext(ctx, () =>
    transaction(ctx, (tx) =>
      tx.notification.createMany({
        data: [
          row('requester', 'Unread one', null),
          row('requester', 'Unread two', null),
          row('requester', 'Already read', new Date()),
          row('agent', 'Somebody else’s', null),
        ],
      }),
    ),
  );
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('notifications-unread');
  await closeHarness();
});

describe('unread', () => {
  it('lists everything by default', async () => {
    const all = await inbox();
    expect(all.data.map((row) => row.subject).sort()).toEqual(['Already read', 'Unread one', 'Unread two']);
    expect(all.unread).toBe(2);
  });

  it('lists everything when false — the regression', async () => {
    const all = await inbox('?unread=false');
    expect(all.data.map((row) => row.subject).sort()).toEqual(['Already read', 'Unread one', 'Unread two']);
    expect(all.unread).toBe(2);
  });

  it('lists only the unread when true', async () => {
    const unread = await inbox('?unread=true');
    expect(unread.data.map((row) => row.subject).sort()).toEqual(['Unread one', 'Unread two']);
    expect(unread.data.every((row) => row.readAt === null)).toBe(true);
  });

  it('refuses a spelling it would have to guess', async () => {
    for (const spelling of ['1', 'yes', '']) {
      expect((await request(`/api/v1/notifications?unread=${spelling}`, { token: asRequester() })).status, spelling).toBe(422);
    }
  });
});
