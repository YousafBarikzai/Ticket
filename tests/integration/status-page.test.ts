import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { registerTransport } from '@itsm/module-notifications';
import { incidentService, publicService } from '@itsm/module-statuspage';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, drainEvents, request, type TestTenant } from '../support/harness.js';

/**
 * The status page (MOD-23).
 *
 * The unit tests prove the vocabulary. This proves the loop: a customer-facing
 * major incident against a service appears on the page with that service's
 * component marked, an internal update stays internal while a public one is
 * shown, resolution clears the component, a scheduled change becomes a
 * maintenance notice, a subscriber is asked to confirm before hearing
 * anything and then hears about the next update, and a private page is
 * nobody's business.
 */

let tenant: TestTenant;
let serviceId: string;
let componentKey: string;

/** Everything the module tried to email, captured in place of a transport. */
const sent: { to: string; subject: string; body: string }[] = [];

beforeAll(async () => {
  tenant = await createTestTenant('statuspage');
  registerTransport({
    channel: 'email',
    async send(input) {
      sent.push({ to: input.to, subject: input.subject ?? '', body: input.body });
      return { providerRef: null };
    },
  });

  const created = await request<{ id: string; key: string }>('/api/v1/services', {
    method: 'POST',
    token: tenant.people.admin!.token,
    body: { key: 'payroll', name: 'Payroll', description: 'Monthly pay run' },
  });
  expect(created.status).toBe(201);
  serviceId = created.body.id;

  // The seed ran before the service existed; re-running it lists the new
  // service as a component without disturbing the ones already there.
  const ctx = contextFor(tenant.id);
  const { seedStatusDefaults } = await import('@itsm/module-statuspage');
  const seeded = await withContext(ctx, () => seedStatusDefaults(ctx));
  expect(seeded.created).toBe(false);
  expect(seeded.components).toBe(1);
  componentKey = 'payroll';
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('statuspage');
  await closeHarness();
});

function asAdmin() {
  return tenant.people.admin!.token;
}

function asLead() {
  return tenant.people.lead!.token;
}

async function read<T>(fn: (tx: Parameters<Parameters<typeof transaction>[1]>[0]) => Promise<T>): Promise<T> {
  const context = contextFor(tenant.id);
  return withContext(context, () => transaction(context, fn));
}

interface PublicPage {
  page: { slug: string; name: string; path: string };
  overall: string;
  components: { key: string; status: string }[];
  incidents: { id: string; title: string; status: string; impact: string; components: string[]; updates: { status: string; body: string }[] }[];
  maintenance: { id: string; title: string; status: string; components: string[] }[];
}

async function publicPage(): Promise<PublicPage> {
  const response = await request<PublicPage>(`/status/${tenant.slug}`);
  expect(response.status).toBe(200);
  return response.body;
}

function linkFrom(body: string, kind: 'confirm' | 'unsubscribe'): string {
  const match = new RegExp(`https?://\\S+(/status/[^/]+/${kind}/\\S+)`).exec(body);
  expect(match).not.toBeNull();
  return match![1]!;
}

describe('what a tenant starts with', () => {
  it('serves a public page at the tenant slug, with a component per service', async () => {
    const page = await publicPage();
    expect(page.page.slug).toBe(tenant.slug);
    expect(page.page.path).toBe(`/status/${tenant.slug}`);
    expect(page.overall).toBe('operational');
    expect(page.components.map((component) => component.key)).toContain(componentKey);
    expect(page.components.map((component) => component.key)).toContain('business-applications');
  });

  it('serves the same page as HTML to a browser, and needs no session for either', async () => {
    const html = await request<string>(`/status/${tenant.slug}`, { headers: { accept: 'text/html' } });
    expect(html.status).toBe(200);
    expect(String(html.headers['content-type'])).toContain('text/html');
    expect(html.body).toContain('All systems operational');
    expect(html.body).toContain('Payroll');
  });

  it('is nobody\'s page at a slug that is not a tenant', async () => {
    const missing = await request(`/status/no-such-tenant`);
    expect(missing.status).toBe(404);
    const html = await request<string>(`/status/no-such-tenant`, { headers: { accept: 'text/html' } });
    expect(html.status).toBe(404);
    expect(html.body).toContain('There is no status page here.');
  });

  it('shows the operator the page with its subscribers, behind a permission', async () => {
    const admin = await request<{ slug: string; subscribers: number; components: unknown[] }>('/api/v1/status-page', { token: asAdmin() });
    expect(admin.status).toBe(200);
    expect(admin.body.slug).toBe(tenant.slug);
    expect(admin.body.subscribers).toBe(0);

    const lead = await request('/api/v1/status-page', { token: asLead() });
    expect(lead.status).toBe(403);
  });
});

describe('a major incident against a service', () => {
  let number: string;
  let incidentId: string;

  it('appears on the page when it is customer-facing, with the component marked', async () => {
    const declared = await request<{ number: string }>('/api/v1/major-incidents', {
      method: 'POST',
      token: asLead(),
      body: {
        title: 'Payroll is unavailable',
        severity: 'SEV2',
        commanderId: tenant.people.lead!.id,
        customerFacing: true,
        affectedServiceIds: [serviceId],
        impactSummary: 'Payslips cannot be viewed.',
      },
    });
    expect(declared.status).toBe(201);
    number = declared.body.number;
    incidentId = (await read((tx) => tx.majorIncident.findFirst({ where: { number } })))!.id;
    await drainEvents(tenant.id);

    const page = await publicPage();
    expect(page.incidents).toHaveLength(1);
    expect(page.incidents[0]!.title).toBe('Payroll is unavailable');
    expect(page.incidents[0]!.impact).toBe('major');
    expect(page.incidents[0]!.status).toBe('investigating');
    expect(page.incidents[0]!.components).toEqual([componentKey]);
    expect(page.incidents[0]!.updates.map((update) => update.body)).toEqual(['Payslips cannot be viewed.']);
    expect(page.components.find((component) => component.key === componentKey)!.status).toBe('partial_outage');
    expect(page.overall).toBe('partial_outage');
  });

  it('does not repeat the declaration when the event is delivered again', async () => {
    await drainEvents(tenant.id);
    const rows = await read((tx) => tx.statusIncident.findMany({ where: { majorIncidentId: incidentId } }));
    expect(rows).toHaveLength(1);
    const page = await publicPage();
    expect(page.incidents[0]!.updates).toHaveLength(1);
  });

  it('keeps an internal update internal and shows a public one', async () => {
    const internal = await request(`/api/v1/major-incidents/${number}/updates`, {
      method: 'POST',
      token: asLead(),
      body: { body: 'Vendor engaged; root cause looks like the batch scheduler.', audience: 'internal' },
    });
    expect(internal.status).toBe(201);
    const stakeholders = await request(`/api/v1/major-incidents/${number}/updates`, {
      method: 'POST',
      token: asLead(),
      body: { body: 'Finance directors: expect a delay to today\'s run.', audience: 'stakeholders' },
    });
    expect(stakeholders.status).toBe(201);
    const moved = await request(`/api/v1/major-incidents/${number}/transition`, {
      method: 'POST',
      token: asLead(),
      body: { to: 'identified', note: 'We have found the cause and are applying a fix.', audience: 'public' },
    });
    expect(moved.status).toBe(200);
    await drainEvents(tenant.id);

    const page = await publicPage();
    const shown = page.incidents[0]!;
    expect(shown.status).toBe('identified');
    const bodies = shown.updates.map((update) => update.body);
    expect(bodies).toContain('We have found the cause and are applying a fix.');
    expect(bodies.join(' ')).not.toContain('Vendor engaged');
    expect(bodies.join(' ')).not.toContain('Finance directors');
  });

  it('resolves on the page and restores the component when the bridge resolves it', async () => {
    for (const to of ['mitigating', 'monitoring']) {
      const moved = await request(`/api/v1/major-incidents/${number}/transition`, {
        method: 'POST',
        token: asLead(),
        body: { to, note: `Moving to ${to}.`, audience: 'internal' },
      });
      expect(moved.status).toBe(200);
    }
    const resolved = await request(`/api/v1/major-incidents/${number}/transition`, {
      method: 'POST',
      token: asLead(),
      body: { to: 'resolved', note: 'The pay run has completed.', audience: 'public' },
    });
    expect(resolved.status).toBe(200);
    await drainEvents(tenant.id);

    const page = await publicPage();
    const shown = page.incidents.find((incident) => incident.title === 'Payroll is unavailable')!;
    expect(shown.status).toBe('resolved');
    // Resolved once, from whichever of the two events arrived first.
    expect(shown.updates.filter((update) => update.status === 'resolved')).toHaveLength(1);
    expect(page.components.find((component) => component.key === componentKey)!.status).toBe('operational');
    expect(page.overall).toBe('operational');
  });

  it('never shows one that was not declared customer-facing', async () => {
    const declared = await request<{ number: string }>('/api/v1/major-incidents', {
      method: 'POST',
      token: asLead(),
      body: { title: 'Internal build farm is slow', severity: 'SEV3', commanderId: tenant.people.lead!.id, customerFacing: false, affectedServiceIds: [serviceId] },
    });
    expect(declared.status).toBe(201);
    await drainEvents(tenant.id);
    const page = await publicPage();
    expect(page.incidents.map((incident) => incident.title)).not.toContain('Internal build farm is slow');
    expect(page.components.find((component) => component.key === componentKey)!.status).toBe('operational');
  });
});

describe('a scheduled change', () => {
  let number: string;

  it('becomes a maintenance notice over the service\'s component', async () => {
    const raised = await request<{ number: string }>('/api/v1/changes', {
      method: 'POST',
      token: asLead(),
      body: { title: 'Upgrade the payroll database', kind: 'normal', serviceId, backoutPlan: 'Restore the snapshot.', description: 'Payslips will be unavailable for the duration.' },
    });
    expect(raised.status).toBe(201);
    number = raised.body.number;
    await request(`/api/v1/changes/${number}/submit`, { method: 'POST', token: asLead() });
    const scheduled = await request(`/api/v1/changes/${number}/schedule`, {
      method: 'POST',
      token: asLead(),
      body: { plannedStartAt: '2030-01-05T22:00:00Z', plannedEndAt: '2030-01-06T02:00:00Z' },
    });
    expect(scheduled.status).toBe(200);
    await drainEvents(tenant.id);

    const page = await publicPage();
    expect(page.maintenance).toHaveLength(1);
    expect(page.maintenance[0]!.title).toBe('Upgrade the payroll database');
    expect(page.maintenance[0]!.status).toBe('scheduled');
    expect(page.maintenance[0]!.components).toEqual([componentKey]);
    // Scheduled, not live: the component is untouched until the window opens.
    expect(page.components.find((component) => component.key === componentKey)!.status).toBe('operational');
  });

  it('moves the notice rather than adding one when the change is re-scheduled', async () => {
    const moved = await request(`/api/v1/changes/${number}/schedule`, {
      method: 'POST',
      token: asLead(),
      body: { plannedStartAt: '2030-01-12T22:00:00Z', plannedEndAt: '2030-01-13T02:00:00Z' },
    });
    expect(moved.status).toBe(200);
    await drainEvents(tenant.id);
    const page = await publicPage();
    expect(page.maintenance).toHaveLength(1);
  });

  it('marks the component under maintenance while the window is live, by the sweep', async () => {
    const ctx = contextFor(tenant.id);
    const during = new Date('2030-01-12T23:00:00Z');
    const moved = await withContext(ctx, () => incidentService.sweepMaintenance(ctx, during));
    expect(moved).toBe(1);
    const page = await publicPage();
    expect(page.maintenance[0]!.status).toBe('in_progress');
    expect(page.components.find((component) => component.key === componentKey)!.status).toBe('maintenance');
    expect(page.overall).toBe('maintenance');
  });

  it('completes the notice when the change closes', async () => {
    for (const to of ['implementing', 'review']) {
      const moved = await request(`/api/v1/changes/${number}/transition`, { method: 'POST', token: asLead(), body: { to } });
      expect(moved.status).toBe(200);
    }
    const closed = await request(`/api/v1/changes/${number}/transition`, {
      method: 'POST',
      token: asLead(),
      body: { to: 'closed', closeCode: 'successful' },
    });
    expect(closed.status).toBe(200);
    await drainEvents(tenant.id);
    const page = await publicPage();
    expect(page.maintenance).toHaveLength(0);
    expect(page.components.find((component) => component.key === componentKey)!.status).toBe('operational');
  });
});

describe('subscribing', () => {
  const address = 'someone@example.test';
  let confirmPath: string;
  let unsubscribePath: string;

  it('asks for confirmation and sends nothing else until it gets it', async () => {
    sent.length = 0;
    const asked = await request<{ ok: boolean }>(`/status/${tenant.slug}/subscribe`, { method: 'POST', body: { email: address } });
    expect(asked.status).toBe(200);
    expect(asked.body.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(address);
    expect(sent[0]!.subject).toMatch(/confirm/i);
    confirmPath = linkFrom(sent[0]!.body, 'confirm');

    const pending = await read((tx) => tx.statusSubscriber.findFirst({ where: { email: address } }));
    expect(pending?.confirmedAt).toBeNull();
  });

  it('says the same thing about an address it cannot confirm, and to a page that does not exist', async () => {
    const again = await request<{ ok: boolean; message: string }>(`/status/${tenant.slug}/subscribe`, { method: 'POST', body: { email: address } });
    const nowhere = await request<{ ok: boolean; message: string }>('/status/no-such-tenant/subscribe', { method: 'POST', body: { email: address } });
    expect(again.status).toBe(200);
    expect(nowhere.status).toBe(200);
    expect(again.body.message).toBe(nowhere.body.message);
  });

  it('refuses a tampered confirmation link', async () => {
    const tampered = await request(`${confirmPath.slice(0, -4)}AAAA`);
    expect(tampered.status).toBe(404);
    const pending = await read((tx) => tx.statusSubscriber.findFirst({ where: { email: address } }));
    expect(pending?.confirmedAt).toBeNull();
  });

  it('confirms through the link, as a browser would', async () => {
    const confirmed = await request<string>(confirmPath, { headers: { accept: 'text/html' } });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toContain('You will be emailed');
    const row = await read((tx) => tx.statusSubscriber.findFirst({ where: { email: address } }));
    expect(row?.confirmedAt).not.toBeNull();

    const admin = await request<{ subscribers: number }>('/api/v1/status-page', { token: asAdmin() });
    expect(admin.body.subscribers).toBe(1);
  });

  it('hears about the next update, exactly once, with a way out', async () => {
    sent.length = 0;
    const opened = await request<{ id: string }>('/api/v1/status-page/incidents', {
      method: 'POST',
      token: asAdmin(),
      body: { title: 'Email delivery delays', impact: 'minor', componentKeys: ['business-applications'], body: 'Some messages are taking longer than usual.' },
    });
    expect(opened.status).toBe(201);

    // The job runs in the worker; here it is run in place, twice, to show the
    // second run finds the update already told.
    const ctx = contextFor(tenant.id);
    const update = await read((tx) => tx.statusUpdate.findFirst({ where: { incidentId: opened.body.id } }));
    const first = await withContext(ctx, () => publicService.notifySubscribers(ctx, { updateId: update!.id }));
    const second = await withContext(ctx, () => publicService.notifySubscribers(ctx, { updateId: update!.id }));
    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(address);
    expect(sent[0]!.subject).toContain('Email delivery delays');
    expect(sent[0]!.body).toContain('Some messages are taking longer than usual.');
    unsubscribePath = linkFrom(sent[0]!.body, 'unsubscribe');
  });

  it('shows the operator\'s incident on the page, opened by hand', async () => {
    const page = await publicPage();
    const byHand = page.incidents.find((incident) => incident.title === 'Email delivery delays');
    expect(byHand).toBeDefined();
    expect(byHand!.components).toEqual(['business-applications']);
    expect(page.components.find((component) => component.key === 'business-applications')!.status).toBe('degraded');
  });

  it('stops on the unsubscribe link and is not told again', async () => {
    const gone = await request<{ ok: boolean }>(unsubscribePath);
    expect(gone.status).toBe(200);
    expect(gone.body.ok).toBe(true);

    sent.length = 0;
    const byHand = await read((tx) => tx.statusIncident.findFirst({ where: { title: 'Email delivery delays' } }));
    const posted = await request<{ id: string }>(`/api/v1/status-page/incidents/${byHand!.id}/updates`, {
      method: 'POST',
      token: asAdmin(),
      body: { status: 'resolved', body: 'Delivery is back to normal.' },
    });
    expect(posted.status).toBe(201);
    const ctx = contextFor(tenant.id);
    const told = await withContext(ctx, () => publicService.notifySubscribers(ctx, { updateId: posted.body.id }));
    expect(told).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('lets the operator see who is subscribed and remove somebody', async () => {
    const list = await request<{ data: { id: string; email: string; unsubscribedAt: string | null }[] }>('/api/v1/status-page/subscribers', { token: asAdmin() });
    expect(list.status).toBe(200);
    expect(list.body.data.map((row) => row.email)).toContain(address);
    expect(list.body.data.find((row) => row.email === address)!.unsubscribedAt).not.toBeNull();

    const removed = await request(`/api/v1/status-page/subscribers/${list.body.data[0]!.id}`, { method: 'DELETE', token: asAdmin() });
    expect(removed.status).toBe(204);
  });
});

describe('a private page', () => {
  it('is nobody\'s business, and subscribing to it says nothing either way', async () => {
    const hidden = await request('/api/v1/status-page', { method: 'PATCH', token: asAdmin(), body: { name: 'Acme', isPublic: false } });
    expect(hidden.status).toBe(200);

    expect((await request(`/status/${tenant.slug}`)).status).toBe(404);
    sent.length = 0;
    const asked = await request<{ ok: boolean }>(`/status/${tenant.slug}/subscribe`, { method: 'POST', body: { email: 'other@example.test' } });
    expect(asked.status).toBe(200);
    expect(asked.body.ok).toBe(true);
    expect(sent).toHaveLength(0);

    const shown = await request('/api/v1/status-page', { method: 'PATCH', token: asAdmin(), body: { name: 'Acme', isPublic: true } });
    expect(shown.status).toBe(200);
    expect((await request(`/status/${tenant.slug}`)).status).toBe(200);
  });
});
