import { z } from 'zod';
import { events } from '@itsm/contracts';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  newId,
  nextNumber,
  publish,
  recordAudit,
  transaction,
} from '@itsm/platform';

/**
 * The register of things you own.
 *
 * Separate from the CMDB on purpose. An asset answers finance's question — what
 * did it cost, who has it, when does the warranty run out — and a configuration
 * item answers operations' — what depends on it, what falls over if it goes.
 * The same laptop is both; a spare monitor in a cupboard is only an asset; a
 * SaaS platform you consume is only a configuration item. Collapsing the two
 * produces a register where every column is optional for half the rows, and a
 * register like that gets filled in badly and then trusted.
 */

export const ASSET_STATUSES = ['in_stock', 'assigned', 'in_repair', 'retired', 'disposed'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

// ---- Models ----------------------------------------------------------------

export const modelSchema = z.object({
  manufacturer: z.string().min(1).max(120),
  model: z.string().min(1).max(120),
  category: z.enum(['hardware', 'software', 'mobile', 'peripheral', 'network', 'other']).default('hardware'),
  lifespanMonths: z.number().int().min(1).max(600).optional(),
});

export async function createModel(ctx: TenantContext, input: z.input<typeof modelSchema>) {
  authz.require(ctx, 'asset.manage');
  return transaction(ctx, (tx) => findOrCreateModel(tx, ctx, modelSchema.parse(input)));
}

/**
 * Takes the caller's transaction, so registering an asset and the model it is
 * an instance of is one commit. The version that opened its own transaction
 * would leave a model behind whenever the asset creation that asked for it
 * failed, and nothing would ever clean those up.
 */
async function findOrCreateModel(tx: Tx, ctx: TenantContext, parsed: z.infer<typeof modelSchema>) {
  const existing = await tx.assetModel.findFirst({
    where: { manufacturer: parsed.manufacturer, model: parsed.model },
  });
  if (existing) return existing;

  const id = newId();
  const created = await tx.assetModel.create({
    data: {
      id,
      tenantId: ctx.tenantId,
      manufacturer: parsed.manufacturer,
      model: parsed.model,
      category: parsed.category,
      lifespanMonths: parsed.lifespanMonths ?? null,
    },
  });
  await recordAudit(tx, ctx, {
    action: 'asset.model.created',
    targetType: 'asset_model',
    targetId: id,
    after: { manufacturer: parsed.manufacturer, model: parsed.model },
  });
  return created;
}

export function listModels(ctx: TenantContext) {
  authz.require(ctx, 'asset.read');
  return transaction(ctx, (tx) =>
    tx.assetModel.findMany({ orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }] }),
  );
}

// ---- Assets ----------------------------------------------------------------

export const createAssetSchema = z.object({
  /** Omitted when nobody has stuck a label on it yet; one is allocated. */
  tag: z.string().min(1).max(60).optional(),
  serial: z.string().min(1).max(120).optional(),
  manufacturer: z.string().min(1).max(120).optional(),
  model: z.string().min(1).max(120).optional(),
  ciId: z.string().uuid().optional(),
  purchasedOn: z.coerce.date().optional(),
  purchaseCost: z.number().nonnegative().max(100_000_000).optional(),
  currency: z.string().length(3).optional(),
  warrantyEndsOn: z.coerce.date().optional(),
  supplier: z.string().max(200).optional(),
  costCentre: z.string().max(60).optional(),
  location: z.string().max(200).optional(),
});

export async function createAsset(ctx: TenantContext, input: z.input<typeof createAssetSchema>) {
  authz.require(ctx, 'asset.manage');
  const parsed = createAssetSchema.parse(input);
  if (parsed.purchaseCost !== undefined && !parsed.currency) {
    // A cost with no currency is a number nobody can add up, and the mistake is
    // only ever found when somebody totals a mixed register and gets a figure
    // that looks plausible.
    throw new ValidationError('a purchase cost needs a currency');
  }
  if (Boolean(parsed.manufacturer) !== Boolean(parsed.model)) {
    throw new ValidationError('give both a manufacturer and a model, or neither');
  }

  return transaction(ctx, async (tx) => {
    const tag = parsed.tag ?? (await nextNumber(tx, ctx, 'asset', 'AST', 5));
    const clash = await tx.asset.findFirst({ where: { tag } });
    if (clash) throw new ConflictError(`the tag ${tag} is already on another asset`, { id: clash.id });

    let modelId: string | null = null;
    if (parsed.manufacturer && parsed.model) {
      const model = await findOrCreateModel(tx, ctx, modelSchema.parse({
        manufacturer: parsed.manufacturer,
        model: parsed.model,
      }));
      modelId = model.id;
    }

    if (parsed.ciId) await assertCiFree(tx, parsed.ciId, null);

    const id = newId();
    const asset = await tx.asset.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        tag,
        serial: parsed.serial ?? null,
        modelId,
        ciId: parsed.ciId ?? null,
        purchasedOn: parsed.purchasedOn ?? null,
        purchaseCost: parsed.purchaseCost ?? null,
        currency: parsed.currency ?? null,
        warrantyEndsOn: parsed.warrantyEndsOn ?? null,
        supplier: parsed.supplier ?? null,
        costCentre: parsed.costCentre ?? null,
        location: parsed.location ?? null,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'asset.created',
      targetType: 'asset',
      targetId: id,
      after: { tag, serial: parsed.serial ?? null, ciId: parsed.ciId ?? null },
    });
    return asset;
  });
}

export const updateAssetSchema = createAssetSchema.partial().omit({ tag: true });

export async function updateAsset(ctx: TenantContext, tag: string, input: z.input<typeof updateAssetSchema>) {
  authz.require(ctx, 'asset.manage');
  const parsed = updateAssetSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const asset = await loadByTag(tx, tag);
    if (parsed.ciId) await assertCiFree(tx, parsed.ciId, asset.id);

    const updated = await tx.asset.update({
      where: { id: asset.id },
      data: {
        serial: parsed.serial ?? asset.serial,
        ciId: parsed.ciId ?? asset.ciId,
        purchasedOn: parsed.purchasedOn ?? asset.purchasedOn,
        purchaseCost: parsed.purchaseCost ?? asset.purchaseCost,
        currency: parsed.currency ?? asset.currency,
        warrantyEndsOn: parsed.warrantyEndsOn ?? asset.warrantyEndsOn,
        supplier: parsed.supplier ?? asset.supplier,
        costCentre: parsed.costCentre ?? asset.costCentre,
        location: parsed.location ?? asset.location,
        version: { increment: 1 },
      },
    });

    await recordAudit(tx, ctx, {
      action: 'asset.updated',
      targetType: 'asset',
      targetId: asset.id,
      before: { ciId: asset.ciId, location: asset.location },
      after: { ciId: updated.ciId, location: updated.location },
    });
    return updated;
  });
}

export const assignSchema = z.object({
  userId: z.string().uuid().optional(),
  location: z.string().max(200).optional(),
  note: z.string().max(2_000).optional(),
});

/**
 * Hands it to somebody, or puts it somewhere.
 *
 * Closes the previous holding first, in the same transaction, so the history
 * never shows one asset in two places at once — which is the state that makes
 * "who had this in March?" unanswerable, and that question is asked precisely
 * when the answer matters most.
 */
export async function assignAsset(ctx: TenantContext, tag: string, input: z.input<typeof assignSchema>) {
  authz.require(ctx, 'asset.manage');
  const parsed = assignSchema.parse(input);
  if (!parsed.userId && !parsed.location) throw new ValidationError('say who has it, or where it is');

  return transaction(ctx, async (tx) => {
    const asset = await loadByTag(tx, tag);
    if (asset.retiredAt) throw new ValidationError('this asset is retired');

    await tx.assetAssignment.updateMany({
      where: { assetId: asset.id, returnedAt: null },
      data: { returnedAt: new Date() },
    });

    const id = newId();
    const assignment = await tx.assetAssignment.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        assetId: asset.id,
        userId: parsed.userId ?? null,
        location: parsed.location ?? null,
        note: parsed.note ?? null,
        createdBy: ctx.actor.id,
      },
    });

    const updated = await tx.asset.update({
      where: { id: asset.id },
      data: {
        status: parsed.userId ? 'assigned' : 'in_stock',
        location: parsed.location ?? asset.location,
        version: { increment: 1 },
      },
    });

    await recordAudit(tx, ctx, {
      action: 'asset.assigned',
      targetType: 'asset',
      targetId: asset.id,
      before: { status: asset.status },
      after: { status: updated.status, userId: parsed.userId ?? null, location: parsed.location ?? null },
    });
    await publish(tx, ctx, {
      definition: events.assetAssigned,
      aggregateId: asset.id,
      payload: {
        assetId: asset.id,
        tag: asset.tag,
        userId: parsed.userId ?? null,
        location: parsed.location ?? null,
        ciId: asset.ciId,
      },
    });
    return { asset: updated, assignment };
  });
}

/** Takes it back off whoever has it, without pretending it went anywhere else. */
export async function returnAsset(ctx: TenantContext, tag: string, location?: string) {
  authz.require(ctx, 'asset.manage');

  return transaction(ctx, async (tx) => {
    const asset = await loadByTag(tx, tag);
    const closed = await tx.assetAssignment.updateMany({
      where: { assetId: asset.id, returnedAt: null },
      data: { returnedAt: new Date() },
    });

    const updated = await tx.asset.update({
      where: { id: asset.id },
      data: { status: 'in_stock', location: location ?? asset.location, version: { increment: 1 } },
    });

    await recordAudit(tx, ctx, {
      action: 'asset.returned',
      targetType: 'asset',
      targetId: asset.id,
      before: { status: asset.status },
      after: { status: 'in_stock', closed: closed.count, location: location ?? asset.location },
    });
    return updated;
  });
}

export async function retireAsset(ctx: TenantContext, tag: string, reason: string, disposed = false) {
  authz.require(ctx, 'asset.manage');
  if (!reason.trim()) throw new ValidationError('say why it is being retired');

  return transaction(ctx, async (tx) => {
    const asset = await loadByTag(tx, tag);
    if (asset.retiredAt) return asset;

    await tx.assetAssignment.updateMany({
      where: { assetId: asset.id, returnedAt: null },
      data: { returnedAt: new Date() },
    });

    const updated = await tx.asset.update({
      where: { id: asset.id },
      data: { status: disposed ? 'disposed' : 'retired', retiredAt: new Date(), version: { increment: 1 } },
    });

    await recordAudit(tx, ctx, {
      action: 'asset.retired',
      targetType: 'asset',
      targetId: asset.id,
      before: { status: asset.status },
      after: { status: updated.status, reason },
    });
    await publish(tx, ctx, {
      definition: events.assetRetired,
      aggregateId: asset.id,
      payload: { assetId: asset.id, tag: asset.tag, reason, disposed, ciId: asset.ciId },
    });
    return updated;
  });
}

export function getAsset(ctx: TenantContext, tag: string) {
  authz.require(ctx, 'asset.read');
  return transaction(ctx, async (tx) => {
    const asset = await loadByTag(tx, tag);
    const assignments = await tx.assetAssignment.findMany({
      where: { assetId: asset.id },
      orderBy: { assignedAt: 'desc' },
      take: 50,
    });
    return { ...asset, assignments };
  });
}

export const listAssetSchema = z.object({
  status: z.enum(ASSET_STATUSES).optional(),
  userId: z.string().uuid().optional(),
  costCentre: z.string().max(60).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listAssets(ctx: TenantContext, query: z.input<typeof listAssetSchema> = {}) {
  authz.require(ctx, 'asset.read');
  const parsed = listAssetSchema.parse(query);

  return transaction(ctx, async (tx) => {
    let ids: string[] | undefined;
    if (parsed.userId) {
      const held = await tx.assetAssignment.findMany({
        where: { userId: parsed.userId, returnedAt: null },
        select: { assetId: true },
      });
      ids = held.map((row) => row.assetId);
      if (ids.length === 0) return [];
    }

    return tx.asset.findMany({
      where: {
        ...(ids ? { id: { in: ids } } : {}),
        ...(parsed.status ? { status: parsed.status } : {}),
        ...(parsed.costCentre ? { costCentre: parsed.costCentre } : {}),
        ...(parsed.search
          ? {
              OR: [
                { tag: { contains: parsed.search, mode: 'insensitive' as const } },
                { serial: { contains: parsed.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { tag: 'asc' },
      take: parsed.limit,
    });
  });
}

/**
 * Warranties running out.
 *
 * The one report that pays for an asset register: a machine repaired the week
 * after its warranty lapsed costs more than the whole exercise of keeping the
 * dates. Includes those already past, because an expired warranty nobody
 * noticed is the case worth surfacing, not hiding.
 */
export async function warrantiesExpiring(ctx: TenantContext, withinDays: number, now: Date = new Date()) {
  authz.require(ctx, 'asset.read');
  const until = new Date(now.getTime() + withinDays * 86_400_000);

  return transaction(ctx, (tx) =>
    tx.asset.findMany({
      where: { retiredAt: null, warrantyEndsOn: { not: null, lte: until } },
      orderBy: { warrantyEndsOn: 'asc' },
      take: 500,
    }),
  );
}

async function loadByTag(tx: Tx, tag: string) {
  const asset = await tx.asset.findFirst({ where: { tag } });
  if (!asset) throw new NotFoundError('asset', tag);
  return asset;
}

/** One configuration item is at most one asset; the link is what makes the two
 *  registers agree, and two assets claiming one item make them disagree. */
async function assertCiFree(tx: Tx, ciId: string, exceptAssetId: string | null): Promise<void> {
  const ci = await tx.configurationItem.findFirst({ where: { id: ciId }, select: { id: true } });
  if (!ci) throw new NotFoundError('configuration item', ciId);
  const holder = await tx.asset.findFirst({ where: { ciId }, select: { id: true, tag: true } });
  if (holder && holder.id !== exceptAssetId) {
    throw new ConflictError(`that configuration item is already asset ${holder.tag}`, { tag: holder.tag });
  }
}
