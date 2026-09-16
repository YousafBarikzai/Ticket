import { z } from 'zod';
import {
  type TenantContext,
  type Tx,
  ConflictError,
  NotFoundError,
  ValidationError,
  authz,
  newId,
  recordAudit,
  transaction,
} from '@itsm/platform';
import { CONTRACT_KINDS, COST_PERIODS, assess, needsAttention, type Assessment } from '../domain/contracts.js';

/**
 * Who you buy from, what you agreed, and by when you have to say otherwise.
 *
 * The half of MOD-10 that finance asks for. It earns its place through one
 * report — contracts inside their notice period — and everything else here
 * exists to make that report right.
 */

// ---- Suppliers -------------------------------------------------------------

export const supplierSchema = z.object({
  name: z.string().min(1).max(200),
  accountRef: z.string().max(60).optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().max(320).optional(),
  contactPhone: z.string().max(60).optional(),
  supportUrl: z.string().url().max(2_000).optional(),
  supportPhone: z.string().max(60).optional(),
});

export async function createSupplier(ctx: TenantContext, input: z.input<typeof supplierSchema>) {
  authz.require(ctx, 'contract.manage');
  const parsed = supplierSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const existing = await tx.supplier.findFirst({ where: { name: parsed.name } });
    if (existing) throw new ConflictError(`a supplier called ${parsed.name} already exists`, { id: existing.id });

    const id = newId();
    const created = await tx.supplier.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        name: parsed.name,
        accountRef: parsed.accountRef ?? null,
        contactName: parsed.contactName ?? null,
        contactEmail: parsed.contactEmail ?? null,
        contactPhone: parsed.contactPhone ?? null,
        supportUrl: parsed.supportUrl ?? null,
        supportPhone: parsed.supportPhone ?? null,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'supplier.created',
      targetType: 'supplier',
      targetId: id,
      after: { name: parsed.name },
    });
    return created;
  });
}

export function listSuppliers(ctx: TenantContext) {
  authz.require(ctx, 'contract.read');
  return transaction(ctx, (tx) => tx.supplier.findMany({ where: { status: 'active' }, orderBy: { name: 'asc' } }));
}

// ---- Contracts -------------------------------------------------------------

export const contractSchema = z.object({
  supplierName: z.string().min(1).max(200),
  reference: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  kind: z.enum(CONTRACT_KINDS).default('support'),
  startsOn: z.coerce.date(),
  endsOn: z.coerce.date(),
  noticeDays: z.number().int().min(0).max(365).optional(),
  autoRenews: z.boolean().default(false),
  cost: z.number().nonnegative().max(1_000_000_000).optional(),
  currency: z.string().length(3).optional(),
  costPeriod: z.enum(COST_PERIODS).optional(),
  costCentre: z.string().max(60).optional(),
  ownerId: z.string().uuid().optional(),
  documentUrl: z.string().url().max(2_000).optional(),
});

export async function createContract(ctx: TenantContext, input: z.input<typeof contractSchema>) {
  authz.require(ctx, 'contract.manage');
  const parsed = contractSchema.parse(input);

  if (parsed.endsOn.getTime() <= parsed.startsOn.getTime()) {
    throw new ValidationError('a contract ends after it starts');
  }
  if (parsed.cost !== undefined && (!parsed.currency || !parsed.costPeriod)) {
    // A cost with no currency cannot be added up; a cost with no period cannot
    // be compared. £40,000 a year and £40,000 once are not the same contract.
    throw new ValidationError('a cost needs a currency and a period: annual, monthly or one_off');
  }
  const span = Math.round((parsed.endsOn.getTime() - parsed.startsOn.getTime()) / 86_400_000);
  if (parsed.noticeDays !== undefined && parsed.noticeDays > span) {
    throw new ValidationError(
      `notice of ${parsed.noticeDays} days is longer than the contract itself, so it could never be given in time`,
    );
  }

  return transaction(ctx, async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { name: parsed.supplierName } });
    if (!supplier) throw new NotFoundError('supplier', parsed.supplierName);

    const clash = await tx.contract.findFirst({ where: { supplierId: supplier.id, reference: parsed.reference } });
    if (clash) throw new ConflictError(`${parsed.supplierName} already has a contract ${parsed.reference}`);

    const id = newId();
    const created = await tx.contract.create({
      data: {
        id,
        tenantId: ctx.tenantId,
        supplierId: supplier.id,
        reference: parsed.reference,
        name: parsed.name,
        kind: parsed.kind,
        startsOn: parsed.startsOn,
        endsOn: parsed.endsOn,
        noticeDays: parsed.noticeDays ?? null,
        autoRenews: parsed.autoRenews,
        cost: parsed.cost ?? null,
        currency: parsed.currency ?? null,
        costPeriod: parsed.costPeriod ?? null,
        costCentre: parsed.costCentre ?? null,
        ownerId: parsed.ownerId ?? null,
        documentUrl: parsed.documentUrl ?? null,
      },
    });

    await recordAudit(tx, ctx, {
      action: 'contract.created',
      targetType: 'contract',
      targetId: id,
      after: {
        reference: parsed.reference,
        supplier: parsed.supplierName,
        endsOn: parsed.endsOn,
        noticeDays: parsed.noticeDays ?? null,
        autoRenews: parsed.autoRenews,
      },
    });
    return created;
  });
}

export const listContractSchema = z.object({
  supplierName: z.string().max(200).optional(),
  kind: z.enum(CONTRACT_KINDS).optional(),
  status: z.enum(['active', 'ended', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listContracts(ctx: TenantContext, query: z.input<typeof listContractSchema> = {}) {
  authz.require(ctx, 'contract.read');
  const parsed = listContractSchema.parse(query);

  return transaction(ctx, async (tx) => {
    const supplier = parsed.supplierName
      ? await tx.supplier.findFirst({ where: { name: parsed.supplierName } })
      : null;
    if (parsed.supplierName && !supplier) throw new NotFoundError('supplier', parsed.supplierName);

    return tx.contract.findMany({
      where: {
        ...(supplier ? { supplierId: supplier.id } : {}),
        ...(parsed.kind ? { kind: parsed.kind } : {}),
        ...(parsed.status ? { status: parsed.status } : {}),
      },
      include: { supplier: { select: { name: true } } },
      orderBy: { endsOn: 'asc' },
      take: parsed.limit,
    });
  });
}

export const coverageSchema = z
  .object({
    assetTag: z.string().max(60).optional(),
    ciId: z.string().uuid().optional(),
    note: z.string().max(2_000).optional(),
  })
  // Strict here rather than at the route, for the same reason as
  // `windowSchema`: a refinement makes this a `ZodEffects`, and `.strict()`
  // does not exist on one.
  .strict()
  .refine((value) => Boolean(value.assetTag) !== Boolean(value.ciId), {
    message: 'cover an asset or a configuration item, not both and not neither',
  });

/** Says a contract covers this thing. */
export async function addCoverage(ctx: TenantContext, contractId: string, input: z.input<typeof coverageSchema>) {
  authz.require(ctx, 'contract.manage');
  const parsed = coverageSchema.parse(input);

  return transaction(ctx, async (tx) => {
    const contract = await loadContract(tx, contractId);

    let assetId: string | null = null;
    if (parsed.assetTag) {
      const asset = await tx.asset.findFirst({ where: { tag: parsed.assetTag }, select: { id: true } });
      if (!asset) throw new NotFoundError('asset', parsed.assetTag);
      assetId = asset.id;
    }
    if (parsed.ciId) {
      const ci = await tx.configurationItem.findFirst({ where: { id: parsed.ciId }, select: { id: true } });
      if (!ci) throw new NotFoundError('configuration item', parsed.ciId);
    }

    const existing = await tx.contractCoverage.findFirst({
      where: { contractId: contract.id, assetId, ciId: parsed.ciId ?? null },
    });
    if (existing) return existing;

    const created = await tx.contractCoverage.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        contractId: contract.id,
        assetId,
        ciId: parsed.ciId ?? null,
        note: parsed.note ?? null,
      },
    });
    await recordAudit(tx, ctx, {
      action: 'contract.coverage.added',
      targetType: 'contract',
      targetId: contract.id,
      after: { assetId, ciId: parsed.ciId ?? null },
    });
    return created;
  });
}

/** What a contract covers, and what covers a thing. */
export async function coverageFor(ctx: TenantContext, contractId: string) {
  authz.require(ctx, 'contract.read');
  return transaction(ctx, async (tx) => {
    const contract = await loadContract(tx, contractId);
    return tx.contractCoverage.findMany({ where: { contractId: contract.id }, orderBy: { addedAt: 'asc' }, take: 500 });
  });
}

export async function contractsCovering(ctx: TenantContext, input: { assetTag?: string; ciId?: string }) {
  authz.require(ctx, 'contract.read');
  return transaction(ctx, async (tx) => {
    let assetId: string | undefined;
    if (input.assetTag) {
      const asset = await tx.asset.findFirst({ where: { tag: input.assetTag }, select: { id: true } });
      if (!asset) throw new NotFoundError('asset', input.assetTag);
      assetId = asset.id;
    }
    const coverage = await tx.contractCoverage.findMany({
      where: { ...(assetId ? { assetId } : {}), ...(input.ciId ? { ciId: input.ciId } : {}) },
      select: { contractId: true },
    });
    if (coverage.length === 0) return [];
    return tx.contract.findMany({
      where: { id: { in: coverage.map((row) => row.contractId) } },
      include: { supplier: { select: { name: true, supportPhone: true, supportUrl: true } } },
      orderBy: { endsOn: 'asc' },
    });
  });
}

export interface ContractAttention {
  id: string;
  reference: string;
  name: string;
  supplier: string;
  endsOn: Date;
  autoRenews: boolean;
  assessment: Assessment;
}

/**
 * Contracts that need somebody to do something.
 *
 * Ordered by the notice date rather than the end date, because that is the one
 * that stops being a decision.
 */
export async function needingAttention(
  ctx: TenantContext,
  warnDays = 30,
  now: Date = new Date(),
): Promise<ContractAttention[]> {
  authz.require(ctx, 'contract.read');

  return transaction(ctx, async (tx) => {
    // Everything ending within the window, plus the notice window, so a
    // contract with ninety days' notice is caught while notice is still
    // possible rather than a month after it stopped being.
    const horizon = new Date(now.getTime() + (warnDays + 365) * 86_400_000);
    const contracts = await tx.contract.findMany({
      where: { status: 'active', endsOn: { lte: horizon } },
      include: { supplier: { select: { name: true } } },
      orderBy: { endsOn: 'asc' },
      take: 1_000,
    });

    return contracts
      .map((contract) => ({
        id: contract.id,
        reference: contract.reference,
        name: contract.name,
        supplier: contract.supplier.name,
        endsOn: contract.endsOn,
        autoRenews: contract.autoRenews,
        assessment: assess(
          { endsOn: contract.endsOn, noticeDays: contract.noticeDays, autoRenews: contract.autoRenews },
          now,
          warnDays,
        ),
      }))
      .filter((row) => needsAttention(row.assessment))
      .sort((a, b) => {
        const left = a.assessment.daysToNotice ?? a.assessment.daysToEnd;
        const right = b.assessment.daysToNotice ?? b.assessment.daysToEnd;
        return left - right;
      });
  });
}

async function loadContract(tx: Tx, contractId: string) {
  const contract = await tx.contract.findFirst({ where: { id: contractId } });
  if (!contract) throw new NotFoundError('contract', contractId);
  return contract;
}
