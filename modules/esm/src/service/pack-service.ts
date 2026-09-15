import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  logger,
  newId,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { events } from '@itsm/contracts';
import { ALL_PACKS, packFor } from '../packs/index.js';
import { entriesOf, hashOf, selectorOf, type Pack, type PackEntry, type PackKind } from '../domain/pack.js';
import {
  DECLINABLE,
  OUTSTANDING,
  TAKEABLE,
  diffPack,
  hasOutstanding,
  type DiffLine,
  type InstalledItem,
} from '../domain/diff.js';
import { applyEntry, articlesStayDraft } from './apply.js';
import { currentHashes, exists } from './snapshot.js';

/**
 * MOD-22: installing a desk, and keeping it in step with the pack it came
 * from without ever taking an edit away from the tenant that made it.
 *
 * Two things are worth reading the rest of this file with in mind.
 *
 * **An install is a copy, not a link.** What lands is the tenant's own
 * service, form, workflow, policy and article, written through the modules
 * that own them. Nothing here is consulted again at run time: a desk whose
 * pack was withdrawn tomorrow carries on working, because there is nothing
 * left of the pack in the path a request takes.
 *
 * **An install is resumable, not atomic.** Each of those modules opens its own
 * transaction, so a pack cannot land in one. Every item is recorded as it
 * lands, so running the install again continues from where it stopped rather
 * than starting over or doubling anything.
 */

export const upgradeInputSchema = z
  .object({
    /** `kind:key` selectors, or the single entry `*` for everything on offer. */
    take: z.array(z.string().max(80)).max(200).default([]),
    decline: z.array(z.string().max(80)).max(200).default([]),
  })
  .strict();

export type UpgradeInput = z.input<typeof upgradeInputSchema>;

export interface PackSummary {
  key: string;
  name: string;
  desk: string;
  description: string;
  version: number;
  items: number;
  nextSteps: string[];
  installed: { version: number; installedAt: Date; lastRequestAt: Date | null } | null;
  upgradeAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listPacks(ctx: TenantContext): Promise<PackSummary[]> {
  authz.require(ctx, 'pack.read');

  return transaction(ctx, async (tx) => {
    const summaries: PackSummary[] = [];
    for (const pack of ALL_PACKS) {
      const installation = await tx.packInstallation.findFirst({ where: { packKey: pack.key } });
      let upgradeAvailable = false;
      if (installation) {
        upgradeAvailable = hasOutstanding(await linesFor(tx, pack, installation.id));
      }
      summaries.push({
        key: pack.key,
        name: pack.name,
        desk: pack.desk,
        description: pack.description,
        version: pack.version,
        items: entriesOf(pack).length,
        nextSteps: pack.nextSteps,
        installed: installation
          ? { version: installation.packVersion, installedAt: installation.installedAt, lastRequestAt: installation.lastRequestAt }
          : null,
        upgradeAvailable,
      });
    }
    return summaries;
  });
}

/** The pack's contents, item by item, with what this tenant has of it. */
export async function describePack(ctx: TenantContext, key: string) {
  authz.require(ctx, 'pack.read');
  const pack = requirePack(key);

  return transaction(ctx, async (tx) => {
    const installation = await tx.packInstallation.findFirst({ where: { packKey: pack.key } });
    const lines = installation ? await linesFor(tx, pack, installation.id) : null;
    const bySelector = new Map((lines ?? []).map((line) => [line.selector, line.state]));

    return {
      key: pack.key,
      name: pack.name,
      desk: pack.desk,
      description: pack.description,
      version: pack.version,
      nextSteps: pack.nextSteps,
      installed: installation
        ? { version: installation.packVersion, installedAt: installation.installedAt, lastRequestAt: installation.lastRequestAt }
        : null,
      items: entriesOf(pack).map((entry) => ({
        kind: entry.kind,
        key: entry.key,
        name: nameOf(entry),
        state: bySelector.get(selectorOf(entry.kind, entry.key)) ?? null,
      })),
    };
  });
}

export interface InstallPreview {
  willCreate: { kind: PackKind; key: string; name: string }[];
  /** Keys somebody already has. The install is refused rather than merged. */
  collisions: { kind: PackKind; key: string }[];
  alreadyInstalled: { kind: PackKind; key: string }[];
}

export async function previewInstall(ctx: TenantContext, key: string): Promise<InstallPreview> {
  authz.require(ctx, 'pack.read');
  return lookAtInstalling(ctx, requirePack(key));
}

/**
 * The same look, without the permission check, so that installing does not
 * quietly require the permission to read as well as the permission to install.
 */
async function lookAtInstalling(ctx: TenantContext, pack: Pack): Promise<InstallPreview> {
  return transaction(ctx, async (tx) => {
    const recorded = await recordedKeys(tx, pack.key);
    const preview: InstallPreview = { willCreate: [], collisions: [], alreadyInstalled: [] };

    for (const entry of entriesOf(pack)) {
      const selector = selectorOf(entry.kind, entry.key);
      if (recorded.has(selector)) {
        preview.alreadyInstalled.push({ kind: entry.kind, key: entry.key });
        continue;
      }
      if (await exists(tx, entry.kind, entry.key)) {
        preview.collisions.push({ kind: entry.kind, key: entry.key });
        continue;
      }
      preview.willCreate.push({ kind: entry.kind, key: entry.key, name: nameOf(entry) });
    }
    return preview;
  });
}

// ---------------------------------------------------------------------------
// Installing
// ---------------------------------------------------------------------------

export interface InstallResult {
  packKey: string;
  version: number;
  installed: string[];
  skipped: string[];
  /** Where it stopped, if it did. Everything before this is committed. */
  stoppedAt: { selector: string; reason: string } | null;
  articlesLeftInDraft: boolean;
  nextSteps: string[];
}

export async function installPack(ctx: TenantContext, key: string): Promise<InstallResult> {
  authz.require(ctx, 'pack.install');
  const pack = requirePack(key);

  // Everything that can be refused is refused before anything is written. A
  // pack that stops half way because of a name clash it could have seen from
  // the start is the worst of both outcomes.
  const preview = await lookAtInstalling(ctx, pack);
  if (preview.collisions.length > 0) {
    throw new ConflictError(
      `this tenant already has ${preview.collisions.map((c) => `${c.kind} ${c.key}`).join(', ')}, which ${pack.name} would overwrite`,
    );
  }

  const installationId = await ensureInstallation(ctx, pack);
  const recorded = await transaction(ctx, (tx) => recordedKeys(tx, pack.key));

  const result: InstallResult = {
    packKey: pack.key,
    version: pack.version,
    installed: [],
    skipped: [],
    stoppedAt: null,
    articlesLeftInDraft: false,
    nextSteps: pack.nextSteps,
  };

  for (const entry of entriesOf(pack)) {
    const selector = selectorOf(entry.kind, entry.key);
    if (recorded.has(selector)) {
      result.skipped.push(selector);
      continue;
    }
    try {
      await applyEntry(ctx, entry, 'install');
      await rememberItem(ctx, installationId, entry);
      result.installed.push(selector);
    } catch (error) {
      // Stop rather than carry on: the rest of the pack is very likely to
      // depend on what just failed, and a partly-installed desk is easier to
      // reason about than a desk with a hole in the middle of it.
      const reason = error instanceof Error ? error.message : String(error);
      logger.error('a pack item could not be installed', { packKey: pack.key, selector, reason });
      result.stoppedAt = { selector, reason };
      break;
    }
  }

  result.articlesLeftInDraft = pack.articles.length > 0 && (await articlesStayDraft(ctx));

  await transaction(ctx, async (tx) => {
    await tx.packInstallation.update({ where: { id: installationId }, data: { packVersion: pack.version } });
    await recordAudit(tx, ctx, {
      action: 'pack.installed',
      targetType: 'pack_installation',
      targetId: installationId,
      after: { packKey: pack.key, version: pack.version, installed: result.installed.length },
    });
    // An install that found everything already there is a no-op, and an event
    // saying a desk was stood up when nothing happened is worse than silence:
    // every webhook subscriber would act on it.
    if (result.installed.length === 0) return;
    await publish(tx, ctx, {
      definition: events.packInstalled,
      aggregateId: installationId,
      payload: {
        packKey: pack.key,
        packVersion: pack.version,
        name: pack.name,
        desk: pack.desk,
        items: result.installed.length,
        nextSteps: pack.nextSteps,
        audience: ctx.actor.id ? [{ kind: 'user' as const, userId: ctx.actor.id }] : [],
      },
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// Upgrading
// ---------------------------------------------------------------------------

export interface UpgradePreview {
  packKey: string;
  shippedVersion: number;
  installedVersion: number;
  lines: (DiffLine & { name: string | null; takeable: boolean; declinable: boolean })[];
  outstanding: number;
}

export async function previewUpgrade(ctx: TenantContext, key: string): Promise<UpgradePreview> {
  authz.require(ctx, 'pack.read');
  const pack = requirePack(key);

  return transaction(ctx, async (tx) => {
    const installation = await requireInstallation(tx, pack.key);
    const lines = await linesFor(tx, pack, installation.id);
    const names = new Map(entriesOf(pack).map((entry) => [selectorOf(entry.kind, entry.key), nameOf(entry)]));

    return {
      packKey: pack.key,
      shippedVersion: pack.version,
      installedVersion: installation.packVersion,
      outstanding: lines.filter((line) => OUTSTANDING.has(line.state)).length,
      lines: lines.map((line) => ({
        ...line,
        name: names.get(line.selector) ?? null,
        takeable: TAKEABLE.has(line.state),
        declinable: DECLINABLE.has(line.state),
      })),
    };
  });
}

export interface UpgradeResult {
  packKey: string;
  fromVersion: number;
  toVersion: number;
  taken: string[];
  declined: string[];
  stoppedAt: { selector: string; reason: string } | null;
  outstanding: number;
}

/**
 * Takes some of a newer pack, and settles the rest.
 *
 * Nothing moves that was not named. That is the whole bargain with a tenant
 * that has edited what it was given: it sees exactly what changed, it chooses
 * item by item, and an item it says no to is not offered again until the pack
 * moves on past the version it refused.
 */
export async function applyUpgrade(ctx: TenantContext, key: string, input: UpgradeInput): Promise<UpgradeResult> {
  authz.require(ctx, 'pack.install');
  const pack = requirePack(key);
  const parsed = upgradeInputSchema.parse(input);

  const { installation, lines } = await transaction(ctx, async (tx) => {
    const found = await requireInstallation(tx, pack.key);
    return { installation: found, lines: await linesFor(tx, pack, found.id) };
  });

  const bySelector = new Map(lines.map((line) => [line.selector, line]));
  const entries = new Map(entriesOf(pack).map((entry) => [selectorOf(entry.kind, entry.key), entry]));

  const take = parsed.take.includes('*')
    ? lines.filter((line) => OUTSTANDING.has(line.state)).map((line) => line.selector)
    : parsed.take;

  assertActionable(take, bySelector, TAKEABLE, 'taken');
  assertActionable(parsed.decline, bySelector, DECLINABLE, 'declined');

  const result: UpgradeResult = {
    packKey: pack.key,
    fromVersion: installation.packVersion,
    toVersion: pack.version,
    taken: [],
    declined: [],
    stoppedAt: null,
    outstanding: 0,
  };

  // In the pack's own order, not the order they were named, so a request type
  // never lands before the form it points at.
  const ordered = entriesOf(pack).filter((entry) => take.includes(selectorOf(entry.kind, entry.key)));

  for (const entry of ordered) {
    const selector = selectorOf(entry.kind, entry.key);
    const line = bySelector.get(selector)!;
    // 'add' and 'missing' both mean there is nothing here to edit, so the
    // owning service is asked to create it; everything else is an edit.
    const mode = line.state === 'add' || line.state === 'missing' ? 'install' : 'update';
    try {
      await applyEntry(ctx, entry, mode);
      await rememberItem(ctx, installation.id, entry);
      result.taken.push(selector);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error('a pack item could not be brought forward', { packKey: pack.key, selector, reason });
      result.stoppedAt = { selector, reason };
      break;
    }
  }

  await transaction(ctx, async (tx) => {
    for (const selector of parsed.decline) {
      const line = bySelector.get(selector)!;
      const entry = entries.get(selector);
      if (!entry) continue;
      await tx.packItem.updateMany({
        where: { installationId: installation.id, kind: line.kind, itemKey: line.key },
        data: { declinedHash: line.shippedHash },
      });
      result.declined.push(selector);
    }

    await tx.packInstallation.update({
      where: { id: installation.id },
      data: { packVersion: pack.version },
    });
    await recordAudit(tx, ctx, {
      action: 'pack.upgraded',
      targetType: 'pack_installation',
      targetId: installation.id,
      before: { version: installation.packVersion },
      after: { version: pack.version, taken: result.taken, declined: result.declined },
    });
  });

  // Recomputed rather than counted from the lines above: taking an item
  // changes its state, and the figure an administrator reads next has to be
  // the one that is true now.
  const after = await transaction(ctx, (tx) => linesFor(tx, pack, installation.id));
  result.outstanding = after.filter((line) => OUTSTANDING.has(line.state)).length;

  await transaction(ctx, async (tx) => {
    await publish(tx, ctx, {
      definition: events.packUpgraded,
      aggregateId: installation.id,
      payload: {
        packKey: pack.key,
        fromVersion: result.fromVersion,
        toVersion: result.toVersion,
        taken: result.taken,
        declined: result.declined,
        outstanding: result.outstanding,
        audience: ctx.actor.id ? [{ kind: 'user' as const, userId: ctx.actor.id }] : [],
      },
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function requirePack(key: string): Pack {
  const pack = packFor(key);
  if (!pack) throw new NotFoundError('pack', key);
  return pack;
}

async function requireInstallation(tx: Tx, packKey: string) {
  const installation = await tx.packInstallation.findFirst({ where: { packKey } });
  if (!installation) throw new NotFoundError('pack installation', packKey);
  return installation;
}

function nameOf(entry: PackEntry): string {
  const definition = entry.definition as { name?: string; title?: string };
  return definition.name ?? definition.title ?? entry.key;
}

async function recordedKeys(tx: Tx, packKey: string): Promise<Set<string>> {
  const installation = await tx.packInstallation.findFirst({ where: { packKey } });
  if (!installation) return new Set();
  const items = await tx.packItem.findMany({ where: { installationId: installation.id } });
  return new Set(items.map((item) => selectorOf(item.kind as PackKind, item.itemKey)));
}

/** The diff for one installed pack, with the tenant's current shapes read in. */
async function linesFor(tx: Tx, pack: Pack, installationId: string): Promise<DiffLine[]> {
  const items = await tx.packItem.findMany({ where: { installationId } });
  const hashes = await currentHashes(
    tx,
    items.map((item) => ({ kind: item.kind as PackKind, key: item.itemKey })),
  );
  const installed: InstalledItem[] = items.map((item) => ({
    kind: item.kind as PackKind,
    key: item.itemKey,
    sourceHash: item.sourceHash,
    declinedHash: item.declinedHash,
    currentHash: hashes.get(selectorOf(item.kind as PackKind, item.itemKey)) ?? null,
  }));
  return diffPack(pack, installed);
}

async function ensureInstallation(ctx: TenantContext, pack: Pack): Promise<string> {
  return transaction(ctx, async (tx) => {
    const existing = await tx.packInstallation.findFirst({ where: { packKey: pack.key } });
    if (existing) return existing.id;

    const created = await tx.packInstallation.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        packKey: pack.key,
        packVersion: pack.version,
        name: pack.name,
        installedBy: ctx.actor.id ?? null,
      },
    });
    return created.id;
  });
}

/**
 * Records what was written, and the shipped definition it came from.
 *
 * Written after the item lands rather than before: a row claiming an item that
 * does not exist would report a missing item to everybody for ever, where the
 * other way round — an item that exists and is not recorded — is caught by the
 * collision check with a message naming exactly what to look at.
 */
async function rememberItem(ctx: TenantContext, installationId: string, entry: PackEntry): Promise<void> {
  const sourceHash = hashOf(entry.kind, entry.definition);
  await transaction(ctx, async (tx) => {
    const existing = await tx.packItem.findFirst({
      where: { installationId, kind: entry.kind, itemKey: entry.key },
    });
    if (existing) {
      await tx.packItem.update({ where: { id: existing.id }, data: { sourceHash, declinedHash: null } });
      return;
    }
    await tx.packItem.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        installationId,
        kind: entry.kind,
        itemKey: entry.key,
        sourceHash,
      },
    });
  });
}

function assertActionable(
  selectors: string[],
  lines: Map<string, DiffLine>,
  allowed: ReadonlySet<DiffLine['state']>,
  verb: string,
): void {
  const problems = selectors
    .filter((selector) => {
      const line = lines.get(selector);
      return !line || !allowed.has(line.state);
    })
    .map((selector) => ({
      field: selector,
      code: 'not_on_offer',
      message: lines.has(selector)
        ? `${selector} is ${lines.get(selector)!.state}, so it cannot be ${verb}`
        : `${selector} is not part of this pack`,
    }));
  if (problems.length > 0) {
    throw new ValidationError(`some of what you asked to have ${verb} is not on offer`, problems);
  }
}
