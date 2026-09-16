import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transaction, withContext } from '@itsm/platform';
import { catalogueService } from '@itsm/module-catalogue';
import { packFor, type DiffLine, type InstallResult, type UpgradePreview, type UpgradeResult } from '@itsm/module-esm';
import { closeHarness, contextFor, createTestTenant, deleteTestTenant, drainEvents, request, type TestTenant } from '../support/harness.js';

/**
 * ESM packs (MOD-22).
 *
 * The unit suite proves the shipped packs are valid and the diff is right.
 * This proves the two things only a database can: that installing a pack
 * leaves behind ordinary configuration a requester can actually use, and that
 * a newer version of the pack never takes an edit away from the tenant that
 * made it.
 */

let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant('packs');
}, 120_000);

afterAll(async () => {
  await deleteTestTenant('packs');
  await closeHarness();
});

const asAdmin = () => tenant.people.admin!.token;
const asRequester = () => tenant.people.requester!.token;

function ctx() {
  return contextFor(tenant.id);
}

async function read<T>(fn: (tx: Parameters<Parameters<typeof transaction>[1]>[0]) => Promise<T>): Promise<T> {
  const context = ctx();
  return withContext(context, () => transaction(context, fn));
}

interface PackList {
  packs: { key: string; name: string; desk: string; version: number; items: number; installed: { version: number; lastRequestAt: string | null } | null; upgradeAvailable: boolean }[];
}

async function packs(): Promise<PackList['packs']> {
  const response = await request<PackList>('/api/v1/packs', { token: asAdmin() });
  expect(response.status).toBe(200);
  return response.body.packs;
}

async function install(key: string, token = asAdmin()) {
  return request<InstallResult & { detail?: string }>(`/api/v1/packs/${key}/install`, { method: 'POST', token });
}

async function upgradePreview(key: string): Promise<UpgradePreview> {
  const response = await request<UpgradePreview>(`/api/v1/packs/${key}/upgrade`, { token: asAdmin() });
  expect(response.status).toBe(200);
  return response.body;
}

function lineFor(preview: UpgradePreview, selector: string): DiffLine {
  const line = preview.lines.find((candidate) => candidate.selector === selector);
  expect(line, `${selector} is not in the diff`).toBeDefined();
  return line!;
}

describe('installing a pack', () => {
  it('lists what the deployment ships, with nothing installed yet', async () => {
    const shipped = await packs();
    expect(shipped.map((pack) => pack.key).sort()).toEqual(['facilities', 'finance', 'hr', 'legal']);
    for (const pack of shipped) {
      expect(pack.installed).toBeNull();
      expect(pack.upgradeAvailable).toBe(false);
      expect(pack.items).toBeGreaterThan(0);
    }
  });

  it('shows what it would create before it creates anything', async () => {
    const response = await request<{ willCreate: { kind: string; key: string }[]; collisions: unknown[]; alreadyInstalled: unknown[] }>(
      '/api/v1/packs/hr/preview',
      { token: asAdmin() },
    );
    expect(response.status).toBe(200);
    expect(response.body.collisions).toEqual([]);
    expect(response.body.alreadyInstalled).toEqual([]);
    expect(response.body.willCreate.map((item) => `${item.kind}:${item.key}`)).toContain('request_type:hr-onboarding');

    // A preview writes nothing.
    const before = await read((tx) => tx.service.findFirst({ where: { key: 'hr' } }));
    expect(before).toBeNull();
  });

  it('writes the whole desk through the modules that own it', async () => {
    const response = await install('hr');
    expect(response.status).toBe(201);
    expect(response.body.stoppedAt).toBeNull();
    expect(response.body.nextSteps.length).toBeGreaterThan(0);

    const shipped = packFor('hr')!;
    expect(response.body.installed).toHaveLength(
      shipped.services.length + shipped.forms.length + shipped.requestTypes.length +
        shipped.workflows.length + shipped.slaPolicies.length + shipped.articles.length,
    );

    const landed = await read(async (tx) => ({
      service: await tx.service.findFirst({ where: { key: 'hr' } }),
      form: await tx.formDefinitionRecord.findFirst({ where: { key: 'hr-onboarding' } }),
      requestType: await tx.requestType.findFirst({ where: { key: 'hr-onboarding' } }),
      workflow: await tx.workflowDefinition.findFirst({ where: { key: 'hr-onboarding' } }),
      policy: await tx.slaPolicy.findFirst({ where: { key: 'hr-standard' } }),
      targets: await tx.slaTarget.count({ where: { policy: { key: 'hr-standard' } } }),
      article: await tx.knowledgeArticle.findFirst({ where: { key: 'hr-leave-policy' } }),
    }));

    expect(landed.service?.name).toBe('People services');
    // Published, not draft: a form nobody published cannot be filled in, and a
    // request type pointing at one is refused.
    expect(landed.form?.status).toBe('published');
    expect(landed.requestType?.status).toBe('published');
    expect(landed.workflow?.status).toBe('published');
    expect(landed.workflow?.currentVersionId).not.toBeNull();
    expect(landed.policy?.name).toBe('HR standard');
    expect(landed.targets).toBe(shipped.slaPolicies[0]!.targets.length);
    expect(landed.article?.status).toBe('published');
  });

  it('leaves behind a catalogue a requester can actually use', async () => {
    const browse = await request<{ data: { key: string; name: string }[] }>('/api/v1/catalogue', { token: asRequester() });
    expect(browse.status).toBe(200);
    expect(browse.body.data.map((item) => item.key)).toEqual(expect.arrayContaining(['hr-onboarding', 'hr-leave']));

    const submitted = await request<{ ticketNumber: string }>('/api/v1/catalogue/hr-leave/submit', {
      method: 'POST',
      token: asRequester(),
      body: { answers: { leaveType: 'annual', from: '2026-10-05', to: '2026-10-09' } },
    });
    expect(submitted.status).toBe(201);
    expect(submitted.body.ticketNumber).toMatch(/^REQ-/);
  });

  it('records when the desk was last used, and does not double it on redelivery', async () => {
    await drainEvents(tenant.id);
    const first = (await packs()).find((pack) => pack.key === 'hr')!;
    expect(first.installed?.lastRequestAt).not.toBeNull();

    // Draining again offers every event a second time. Whether the inbox
    // claims it or the handler runs again, a maximum cannot be inflated the
    // way a count would be (ADR-0031).
    await drainEvents(tenant.id);
    const again = (await packs()).find((pack) => pack.key === 'hr')!;
    expect(again.installed?.lastRequestAt).toBe(first.installed?.lastRequestAt);
  });

  it('is safe to run twice: everything already there is skipped', async () => {
    const response = await install('hr');
    expect(response.status).toBe(201);
    expect(response.body.installed).toEqual([]);
    expect(response.body.skipped.length).toBeGreaterThan(0);
  });

  it('refuses rather than overwrites when a key is already somebody else’s', async () => {
    const context = ctx();
    await withContext(context, () =>
      catalogueService.createService(context, { key: 'legal', name: 'A service somebody made by hand' }),
    );

    const preview = await request<{ collisions: { kind: string; key: string }[] }>('/api/v1/packs/legal/preview', { token: asAdmin() });
    expect(preview.body.collisions).toContainEqual({ kind: 'service', key: 'legal' });

    const response = await install('legal');
    expect(response.status).toBe(409);
    // Nothing from the refused pack was written.
    const form = await read((tx) => tx.formDefinitionRecord.findFirst({ where: { key: 'legal-nda' } }));
    expect(form).toBeNull();
  });

  it('is an administrator’s act and nobody else’s', async () => {
    const response = await install('facilities', asRequester());
    expect(response.status).toBe(403);
    expect((await packs()).find((pack) => pack.key === 'facilities')!.installed).toBeNull();
  });
});

describe('a newer version of a pack', () => {
  /**
   * Simulates the deployment shipping version 2, by editing the pack the
   * module holds in memory. That is exactly what a release would do to it,
   * and it is the only way to have two versions in one test run.
   */
  function shipVersionTwo(): void {
    const pack = packFor('hr')!;
    pack.version = 2;
    // Untouched here: a clean update.
    pack.articles[0]!.summary = 'Rewritten for version two.';
    // Edited by the tenant below: a conflict.
    pack.services[0]!.description = 'Rewritten by the deployment.';
    // Brand new in version two: an addition.
    pack.articles.push({
      key: 'hr-joining',
      title: 'Your first week',
      summary: 'What happens on your first day.',
      body: [],
      keywords: [],
    } as never);
  }

  it('offers a clean update, flags an edit as a conflict, and adds what is new', async () => {
    const context = ctx();
    await withContext(context, () =>
      catalogueService.updateService(context, 'hr', { description: 'What this desk does here, in our words.' }),
    );

    shipVersionTwo();

    const preview = await upgradePreview('hr');
    expect(preview.shippedVersion).toBe(2);
    expect(preview.installedVersion).toBe(1);
    expect(lineFor(preview, 'service:hr').state).toBe('conflict');
    expect(lineFor(preview, 'article:hr-leave-policy').state).toBe('update');
    expect(lineFor(preview, 'article:hr-joining').state).toBe('add');
    expect(lineFor(preview, 'request_type:hr-onboarding').state).toBe('unchanged');
    expect(preview.outstanding).toBe(3);

    expect((await packs()).find((pack) => pack.key === 'hr')!.upgradeAvailable).toBe(true);
  });

  it('moves only what was named, and leaves the edit alone', async () => {
    const response = await request<UpgradeResult>('/api/v1/packs/hr/upgrade', {
      method: 'POST',
      token: asAdmin(),
      body: { take: ['article:hr-leave-policy', 'article:hr-joining'], decline: ['service:hr'] },
    });
    expect(response.status).toBe(200);
    expect(response.body.taken).toEqual(['article:hr-leave-policy', 'article:hr-joining']);
    expect(response.body.declined).toEqual(['service:hr']);
    expect(response.body.outstanding).toBe(0);

    const after = await read(async (tx) => ({
      service: await tx.service.findFirst({ where: { key: 'hr' } }),
      added: await tx.knowledgeArticle.findFirst({ where: { key: 'hr-joining' } }),
      updated: await tx.knowledgeArticleVersion.findFirst({
        where: { article: { key: 'hr-leave-policy' }, status: 'published' },
        orderBy: { version: 'desc' },
      }),
    }));

    // The tenant's own words survived an upgrade that wanted to replace them.
    expect(after.service?.description).toBe('What this desk does here, in our words.');
    expect(after.added?.status).toBe('published');
    expect(after.updated?.summary).toBe('Rewritten for version two.');
  });

  it('does not offer again what was declined at this version', async () => {
    const preview = await upgradePreview('hr');
    expect(lineFor(preview, 'service:hr').state).toBe('declined');
    expect(preview.outstanding).toBe(0);
    expect((await packs()).find((pack) => pack.key === 'hr')!.upgradeAvailable).toBe(false);
  });

  it('offers it again once the pack moves past the version that was declined', async () => {
    const pack = packFor('hr')!;
    pack.version = 3;
    pack.services[0]!.description = 'Rewritten again, differently.';

    const preview = await upgradePreview('hr');
    expect(lineFor(preview, 'service:hr').state).toBe('conflict');
    expect(preview.outstanding).toBe(1);
  });

  it('refuses to take something that is not on offer', async () => {
    const response = await request<{ detail: string }>('/api/v1/packs/hr/upgrade', {
      method: 'POST',
      token: asAdmin(),
      body: { take: ['request_type:hr-onboarding'] },
    });
    expect(response.status).toBe(422);
    expect(response.body.detail).toContain('not on offer');
  });

  it('takes everything outstanding when asked for all of it', async () => {
    const response = await request<UpgradeResult>('/api/v1/packs/hr/upgrade', {
      method: 'POST',
      token: asAdmin(),
      body: { take: ['*'] },
    });
    expect(response.status).toBe(200);
    expect(response.body.taken).toEqual(['service:hr']);
    expect(response.body.outstanding).toBe(0);

    const service = await read((tx) => tx.service.findFirst({ where: { key: 'hr' } }));
    expect(service?.description).toBe('Rewritten again, differently.');
  });

  it('offers back an item somebody deleted, rather than forgetting it', async () => {
    await read(async (tx) => {
      const article = await tx.knowledgeArticle.findFirst({ where: { key: 'hr-joining' } });
      await tx.knowledgeArticleVersion.deleteMany({ where: { articleId: article!.id } });
      await tx.knowledgeArticle.delete({ where: { id: article!.id } });
    });

    const preview = await upgradePreview('hr');
    expect(lineFor(preview, 'article:hr-joining').state).toBe('missing');

    const response = await request<UpgradeResult>('/api/v1/packs/hr/upgrade', {
      method: 'POST',
      token: asAdmin(),
      body: { take: ['article:hr-joining'] },
    });
    expect(response.status).toBe(200);
    const back = await read((tx) => tx.knowledgeArticle.findFirst({ where: { key: 'hr-joining' } }));
    expect(back?.title).toBe('Your first week');
  });

  it('reports, and never withdraws, something the pack stops shipping', async () => {
    const pack = packFor('hr')!;
    pack.version = 4;
    pack.articles = pack.articles.filter((article) => article.key !== 'hr-joining');

    const preview = await upgradePreview('hr');
    expect(lineFor(preview, 'article:hr-joining').state).toBe('retired');
    expect(preview.outstanding).toBe(0);

    const still = await read((tx) => tx.knowledgeArticle.findFirst({ where: { key: 'hr-joining' } }));
    expect(still).not.toBeNull();
  });
});
