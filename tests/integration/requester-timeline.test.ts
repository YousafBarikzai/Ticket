import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * The requester's timeline (PA4; MOD-02-E1-S2: "internal notes and agent-only
 * fields are never returned by the portal API").
 *
 * `GET /tickets/:id/timeline` used to return the ticket's `custom` unlensed and
 * every event with its payload, whoever asked. The portal never rendered
 * either, but a requester calling the API through the portal's proxy received
 * both. So this suite is a contract test on the response body, not on any
 * screen: it plants a distinct marker in every place the desk writes
 * something down, and asserts none of them leaves the API for a requester
 * while all of them still reach the people entitled to them.
 */

let tenant: TestTenant;
let number: string;

const mark = (what: string) => `${what}-${Math.random().toString(36).slice(2, 10)}`;
const secrets = {
  internalField: mark('internal-field'),
  internalFieldEdited: mark('internal-field-edited'),
  restrictedField: mark('restricted-field'),
  statusReason: mark('status-reason'),
  internalNote: mark('internal-note'),
  internalFile: `${mark('internal-file')}.xlsx`,
};
const shared = {
  publicField: mark('public-field'),
  publicReply: mark('public-reply'),
  publicFile: `${mark('public-file')}.png`,
  ticketFile: `${mark('ticket-file')}.pdf`,
};

const asAdmin = () => tenant.people.admin!.token;
const asAgent = () => tenant.people.agent!.token;
const asRequester = () => tenant.people.requester!.token;

interface Timeline {
  ticket: { custom: Record<string, unknown> };
  includesInternal: boolean;
  includesEvents: boolean;
  entries: { kind: string; type?: string; body?: string; payload?: Record<string, unknown> }[];
  attachments: { filename: string }[];
}

async function timeline(token: string): Promise<Timeline> {
  const response = await request<Timeline>(`/api/v1/tickets/${number}/timeline`, { token });
  expect(response.status).toBe(200);
  return response.body;
}

async function attach(filename: string, commentId?: string): Promise<void> {
  const registered = await request<{ id: string }>(`/api/v1/tickets/${number}/attachments`, {
    method: 'POST',
    token: asAgent(),
    body: { objectKey: `tenants/${tenant.id}/attachments/${filename}`, filename, mime: 'application/octet-stream', size: 1024, ...(commentId ? { commentId } : {}) },
  });
  expect(registered.status).toBe(201);
  // The scan worker is not running here; mark the file clean the way it would,
  // since only clean files are ever listed.
  const ctx = contextFor(tenant.id);
  await withContext(ctx, () =>
    transaction(ctx, (tx) => tx.attachment.updateMany({ where: { id: registered.body.id }, data: { scanStatus: 'clean' } })),
  );
}

beforeAll(async () => {
  tenant = await createTestTenant('requester-timeline');

  const fields = [
    { key: 'publicNote', label: 'Public note', type: 'text', classification: 'public' },
    { key: 'internalNote', label: 'Internal note', type: 'text', classification: 'internal' },
    // Readable only with a permission the agent does not hold.
    { key: 'restrictedNote', label: 'Restricted note', type: 'text', classification: 'restricted', visibleTo: ['ticket.config.manage'] },
  ];
  for (const { key, ...body } of fields) {
    const saved = await request(`/api/v1/field-definitions/${key}`, { method: 'PUT', token: asAdmin(), body });
    expect(saved.status).toBe(200);
  }

  const created = await request<{ number: string; version: number }>('/api/v1/tickets', {
    method: 'POST',
    token: asAgent(),
    body: {
      type: 'incident',
      title: 'Laptop will not charge',
      sourceChannel: 'api',
      requesterId: tenant.people.requester!.id,
      groupId: tenant.teamId,
      custom: { publicNote: shared.publicField, internalNote: secrets.internalField, restrictedNote: secrets.restrictedField },
    },
  });
  expect(created.status).toBe(201);
  number = created.body.number;

  // An edit, so an `updated` event records the internal value before and after.
  const edited = await request(`/api/v1/tickets/${number}`, {
    method: 'PATCH',
    token: asAdmin(),
    headers: { 'if-match': `"${created.body.version}"` },
    body: { custom: { internalNote: secrets.internalFieldEdited, restrictedNote: `${secrets.restrictedField}-2` } },
  });
  expect(edited.status).toBe(200);

  await request(`/api/v1/tickets/${number}/assign`, { method: 'POST', token: asAgent(), body: { assigneeId: tenant.people.agent!.id } });
  const moved = await request(`/api/v1/tickets/${number}/transitions`, {
    method: 'POST',
    token: asAgent(),
    body: { to: 'pending_requester', reason: secrets.statusReason },
  });
  expect(moved.status).toBe(200);

  const note = await request<{ id: string }>(`/api/v1/tickets/${number}/comments`, {
    method: 'POST',
    token: asAgent(),
    body: { body: secrets.internalNote, visibility: 'internal' },
  });
  const reply = await request<{ id: string }>(`/api/v1/tickets/${number}/comments`, {
    method: 'POST',
    token: asAgent(),
    body: { body: shared.publicReply, visibility: 'public' },
  });
  await attach(secrets.internalFile, note.body.id);
  await attach(shared.publicFile, reply.body.id);
  await attach(shared.ticketFile);
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('requester-timeline');
  await closeHarness();
});

describe('what a requester is given', () => {
  it('contains none of what the desk wrote for itself', async () => {
    const body = JSON.stringify(await timeline(asRequester()));
    for (const [what, secret] of Object.entries(secrets)) {
      expect(body.includes(secret), what).toBe(false);
    }
  });

  it('lenses custom fields exactly as the ticket read does', async () => {
    const view = await timeline(asRequester());
    expect(view.ticket.custom).toEqual({ publicNote: shared.publicField });

    const read = await request<{ custom: Record<string, unknown> }>(`/api/v1/tickets/${number}`, { token: asRequester() });
    expect(view.ticket.custom).toEqual(read.body.custom);
  });

  it('leaves events out, and says it has', async () => {
    const view = await timeline(asRequester());
    expect(view.entries.some((entry) => entry.kind === 'event')).toBe(false);
    expect(view.includesEvents).toBe(false);
    expect(view.includesInternal).toBe(false);
  });

  it('still carries the public conversation and the files that belong to it', async () => {
    const view = await timeline(asRequester());
    expect(view.entries.filter((entry) => entry.kind === 'comment').map((entry) => entry.body)).toEqual([shared.publicReply]);
    expect(view.attachments.map((attachment) => attachment.filename).sort()).toEqual([shared.publicFile, shared.ticketFile].sort());
  });
});

describe('what the desk is given', () => {
  it('keeps the whole history for an agent, minus fields the agent may not read', async () => {
    const view = await timeline(asAgent());
    expect(view.includesEvents).toBe(true);
    expect(view.includesInternal).toBe(true);

    const body = JSON.stringify(view);
    for (const secret of [secrets.internalFieldEdited, secrets.statusReason, secrets.internalNote, secrets.internalFile]) {
      expect(body).toContain(secret);
    }
    expect(view.ticket.custom).toEqual({ publicNote: shared.publicField, internalNote: secrets.internalFieldEdited });

    // The restricted value is in the `updated` event as recorded; lensed out
    // of the history as it is out of the ticket.
    expect(body).not.toContain(secrets.restrictedField);
    const updated = view.entries.find((entry) => entry.kind === 'event' && entry.type === 'updated');
    expect(updated?.payload).toMatchObject({
      changed: { custom: { before: { internalNote: secrets.internalField }, after: { internalNote: secrets.internalFieldEdited } } },
    });
  });

  it('shows a restricted field, in the ticket and in its history, to whoever it names', async () => {
    const body = JSON.stringify(await timeline(asAdmin()));
    expect(body).toContain(secrets.restrictedField);
    expect(body).toContain(`${secrets.restrictedField}-2`);
  });
});
