import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  contractService,
  discoveryService,
  proposalService,
  contractSchema,
  coverageSchema,
  listContractSchema,
  listProposalSchema,
  ruleSchema,
  sourceSchema,
  supplierSchema,
  updateSourceSchema,
} from '@itsm/module-assets';
import { contextOf } from '../plugins/context.js';

/** MOD-10-E2 discovery sources, the proposal queue, suppliers and contracts. */
export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  const byKey = z.object({ key: z.string().min(1).max(60) });
  const byId = z.object({ id: z.string().uuid() });

  const source = (row: {
    key: string; name: string; kind: string; status: string; credentialRef: string | null;
    intervalMinutes: number | null; lastRunAt: Date | null; lastRunStatus: string | null;
  }) => ({
    key: row.key,
    name: row.name,
    kind: row.kind,
    status: row.status,
    // The credential is a name, never a value: an operator sees which one is
    // attached, and no route can read it back.
    credentialRef: row.credentialRef,
    intervalMinutes: row.intervalMinutes,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastRunStatus: row.lastRunStatus,
  });

  // ---- sources -----------------------------------------------------------
  app.get('/discovery/kinds', async (request) => {
    const ctx = contextOf(request);
    return { data: discoveryService.listKinds(ctx) };
  });

  app.get('/discovery/sources', async (request) => {
    const ctx = contextOf(request);
    return { data: (await discoveryService.listSources(ctx)).map(source) };
  });

  app.post('/discovery/sources', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await discoveryService.createSource(ctx, sourceSchema.strict().parse(request.body));
    return reply.code(201).send(source(created));
  });

  app.patch('/discovery/sources/:key', async (request) => {
    const ctx = contextOf(request);
    return source(
      await discoveryService.updateSource(ctx, byKey.parse(request.params).key, updateSourceSchema.strict().parse(request.body)),
    );
  });

  /** Runs it now. Proposes; writes only what a reconciliation rule allows. */
  app.post('/discovery/sources/:key/run', async (request) => {
    const ctx = contextOf(request);
    return discoveryService.runSource(ctx, byKey.parse(request.params).key);
  });

  // ---- reconciliation rules ----------------------------------------------
  app.get('/discovery/rules', async (request) => {
    const ctx = contextOf(request);
    const rules = await discoveryService.listRules(ctx);
    return { data: rules.map((rule) => ({ id: rule.id, field: rule.field, policy: rule.policy, sourceId: rule.sourceId })) };
  });

  app.put('/discovery/rules', async (request) => {
    const ctx = contextOf(request);
    const rule = await discoveryService.setRule(ctx, ruleSchema.strict().parse(request.body));
    return { id: rule.id, field: rule.field, policy: rule.policy };
  });

  // ---- the proposal queue ------------------------------------------------
  app.get('/discovery/proposals', async (request) => {
    const ctx = contextOf(request);
    const proposals = await proposalService.listProposals(ctx, request.query as never);
    return {
      data: proposals.map((proposal) => ({
        id: proposal.id,
        kind: proposal.kind,
        externalKey: proposal.externalKey,
        ciId: proposal.ciId,
        status: proposal.status,
        // Both sides, because a proposal whose current value is not shown is
        // one nobody can judge.
        proposed: proposal.proposed,
        current: proposal.current,
        reason: proposal.reason,
        createdAt: proposal.createdAt.toISOString(),
      })),
    };
  });

  app.post('/discovery/proposals/:id/accept', async (request) => {
    const ctx = contextOf(request);
    return proposalService.acceptProposal(ctx, byId.parse(request.params).id);
  });

  app.post('/discovery/proposals/:id/reject', async (request) => {
    const ctx = contextOf(request);
    const body = z.object({ reason: z.string().min(1).max(2000) }).strict().parse(request.body);
    const rejected = await proposalService.rejectProposal(ctx, byId.parse(request.params).id, body.reason);
    return { id: rejected.id, status: rejected.status, reason: rejected.reason };
  });

  /** One source, one kind: "yes, import the eighty laptops Intune found". */
  app.post('/discovery/proposals/accept-all', async (request) => {
    const ctx = contextOf(request);
    const body = z
      .object({
        sourceKey: z.string().min(1).max(60),
        kind: z.enum(['create_ci', 'update_ci', 'create_relationship']),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .strict().parse(request.body);
    return proposalService.acceptAll(ctx, body);
  });

  // ---- suppliers and contracts -------------------------------------------
  app.get('/suppliers', async (request) => {
    const ctx = contextOf(request);
    const suppliers = await contractService.listSuppliers(ctx);
    return {
      data: suppliers.map((row) => ({
        id: row.id,
        name: row.name,
        accountRef: row.accountRef,
        contactEmail: row.contactEmail,
        supportUrl: row.supportUrl,
        supportPhone: row.supportPhone,
      })),
    };
  });

  app.post('/suppliers', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await contractService.createSupplier(ctx, supplierSchema.strict().parse(request.body));
    return reply.code(201).send({ id: created.id, name: created.name });
  });

  const contract = (row: {
    id: string; reference: string; name: string; kind: string; status: string;
    startsOn: Date; endsOn: Date; noticeDays: number | null; autoRenews: boolean;
    currency: string | null; costPeriod: string | null; costCentre: string | null;
    supplier?: { name: string };
  }) => ({
    id: row.id,
    reference: row.reference,
    name: row.name,
    kind: row.kind,
    status: row.status,
    supplier: row.supplier?.name ?? null,
    startsOn: row.startsOn.toISOString().slice(0, 10),
    endsOn: row.endsOn.toISOString().slice(0, 10),
    noticeDays: row.noticeDays,
    autoRenews: row.autoRenews,
    currency: row.currency,
    costPeriod: row.costPeriod,
    costCentre: row.costCentre,
  });

  app.get('/contracts', async (request) => {
    const ctx = contextOf(request);
    const contracts = await contractService.listContracts(ctx, listContractSchema.parse(request.query));
    return { data: contracts.map(contract) };
  });

  app.post('/contracts', async (request, reply) => {
    const ctx = contextOf(request);
    const created = await contractService.createContract(ctx, contractSchema.strict().parse(request.body));
    return reply.code(201).send(contract(created));
  });

  app.post('/contracts/:id/coverage', async (request, reply) => {
    const ctx = contextOf(request);
    const added = await contractService.addCoverage(
      ctx,
      byId.parse(request.params).id,
      coverageSchema.parse(request.body),
    );
    return reply.code(201).send({ id: added.id, assetId: added.assetId, ciId: added.ciId });
  });

  app.get('/contracts/:id/coverage', async (request) => {
    const ctx = contextOf(request);
    const coverage = await contractService.coverageFor(ctx, byId.parse(request.params).id);
    return { data: coverage.map((row) => ({ id: row.id, assetId: row.assetId, ciId: row.ciId, note: row.note })) };
  });

  /**
   * What needs a decision, ordered by the notice date rather than the end date.
   * After the notice date, renewal is no longer a choice.
   */
  app.get('/contracts-attention', async (request) => {
    const ctx = contextOf(request);
    const query = z.object({ warnDays: z.coerce.number().int().min(1).max(365).default(30) }).parse(request.query);
    const rows = await contractService.needingAttention(ctx, query.warnDays);
    return {
      data: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        name: row.name,
        supplier: row.supplier,
        endsOn: row.endsOn.toISOString().slice(0, 10),
        autoRenews: row.autoRenews,
        urgency: row.assessment.urgency,
        daysToEnd: row.assessment.daysToEnd,
        daysToNotice: row.assessment.daysToNotice,
        message: row.assessment.message,
      })),
      missedNotice: rows.filter((row) => row.assessment.urgency === 'notice_missed').length,
    };
  });
}
