import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, request, type TestTenant } from '../support/harness.js';

/**
 * Bringing a retired custom field back (A11), and `includeInactive` read as
 * the boolean it is.
 *
 * `DELETE /field-definitions/:key` deactivates and says there is no DELETE
 * because values stay behind; until now there was no way back either, short
 * of a new key that stranded every value stored under the old one.
 */

let tenant: TestTenant;
const asAdmin = () => tenant.people.admin!.token;

interface Field {
  key: string;
  isActive: boolean;
}

async function fields(query = ''): Promise<Field[]> {
  const response = await request<{ data: Field[] }>(`/api/v1/field-definitions${query}`, { token: asAdmin() });
  expect(response.status).toBe(200);
  return response.body.data;
}

const reactivate = (key: string, token = asAdmin()) =>
  request<Field & { detail?: string }>(`/api/v1/field-definitions/${key}/reactivate`, { method: 'POST', token });

async function auditActions(): Promise<string[]> {
  const ctx = contextFor(tenant.id);
  return withContext(ctx, () =>
    transaction(ctx, async (tx) => {
      const rows = await tx.auditEvent.findMany({ where: { targetType: 'field_definition' }, orderBy: { occurredAt: 'asc' } });
      return rows.map((row) => row.action);
    }),
  );
}

beforeAll(async () => {
  tenant = await createTestTenant('field-reactivate');
  const saved = await request('/api/v1/field-definitions/costCentre', {
    method: 'PUT',
    token: asAdmin(),
    body: { label: 'Cost centre', type: 'text' },
  });
  expect(saved.status).toBe(200);
  const retired = await request<Field>('/api/v1/field-definitions/costCentre', { method: 'DELETE', token: asAdmin() });
  expect(retired.body.isActive).toBe(false);
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('field-reactivate');
  await closeHarness();
});

describe('includeInactive', () => {
  it('leaves a retired field out by default and when false', async () => {
    expect((await fields()).some((field) => field.key === 'costCentre')).toBe(false);
    // The regression: `false` used to read as true.
    expect((await fields('?includeInactive=false')).some((field) => field.key === 'costCentre')).toBe(false);
  });

  it('includes it when true', async () => {
    expect((await fields('?includeInactive=true')).find((field) => field.key === 'costCentre')).toMatchObject({ isActive: false });
  });

  it('refuses a spelling it would have to guess', async () => {
    expect((await request('/api/v1/field-definitions?includeInactive=1', { token: asAdmin() })).status).toBe(422);
  });
});

describe('reactivating', () => {
  it('refuses anybody who may not manage fields', async () => {
    expect((await reactivate('costCentre', tenant.people.agent!.token)).status).toBe(403);
    expect((await reactivate('costCentre', tenant.people.requester!.token)).status).toBe(403);
  });

  it('while retired, the field takes no value', async () => {
    const refused = await request('/api/v1/tickets', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { type: 'incident', title: 'Charge to the old code', sourceChannel: 'api', custom: { costCentre: 'CC-1' } },
    });
    expect(refused.status).toBe(422);
  });

  it('brings it back, audited, and it takes values again', async () => {
    const response = await reactivate('costCentre');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ key: 'costCentre', isActive: true });
    expect((await fields()).some((field) => field.key === 'costCentre')).toBe(true);
    expect(await auditActions()).toEqual(['ticket.field.created', 'ticket.field.deactivated', 'ticket.field.reactivated']);

    const accepted = await request<{ custom: Record<string, unknown> }>('/api/v1/tickets', {
      method: 'POST',
      token: tenant.people.agent!.token,
      body: { type: 'incident', title: 'Charge to the old code', sourceChannel: 'api', custom: { costCentre: 'CC-1' } },
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body.custom).toEqual({ costCentre: 'CC-1' });
  });

  it('is idempotent: an active field comes back as it is, with nothing audited', async () => {
    const again = await reactivate('costCentre');
    expect(again.status).toBe(200);
    expect(again.body.isActive).toBe(true);
    expect((await auditActions()).filter((action) => action === 'ticket.field.reactivated')).toHaveLength(1);
  });

  it('404s for a field that was never defined', async () => {
    expect((await reactivate('neverDefined')).status).toBe(404);
  });
});
