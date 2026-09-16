import {
  NotFoundError,
  ValidationError,
  aiRegions,
  authz,
  logger,
  newId,
  platformDb,
  recordAudit,
  transaction,
  type TenantContext,
} from '@itsm/platform';
import { UnparseableCompletion, parseCompletion } from '../domain/output.js';
import { isCapability, type Capability } from '../domain/capabilities.js';
import { SHIPPED_DATASETS } from '../seed/prompts.js';
import { callModel } from './gateway.js';

/**
 * Evaluating a prompt version.
 *
 * A case is a context and a set of expectations, never a golden answer: two
 * good replies to the same ticket differ, and pinning one of them scores
 * fluency rather than usefulness. What is checked is that the answer parses,
 * says what it must, avoids what it must not, and stays within length.
 *
 * What an evaluation proves depends entirely on what is behind the provider
 * socket. Against the stub it proves the **machinery** — that a threshold
 * blocks a promotion, that a score is recorded, that a failing case names
 * itself. It does not prove that a prompt is any good, and nothing here should
 * be read as though it did. That becomes true on the day OD-04 is closed, with
 * no change to this file, which is the point of building it now.
 */

export interface CaseExpectation {
  mustMention?: string[];
  mustNotMention?: string[];
  maxWords?: number;
}

export interface CaseScore {
  key: string;
  score: number;
  failures: string[];
}

/** Every string a suggestion contains, flattened, for the mention checks. */
function textOf(content: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(content);
  return parts.join(' ');
}

/**
 * Scores one completion. Pure, so the scoring can be argued about in a unit
 * test rather than by re-running a provider.
 *
 * An unparseable answer scores zero rather than being skipped: a prompt whose
 * answers cannot be stored is a prompt that fails, and averaging it away would
 * hide exactly the regression the gate exists to catch.
 */
export function scoreCase(capability: Capability, key: string, raw: string, expect: CaseExpectation): CaseScore {
  let content: Record<string, unknown>;
  try {
    content = parseCompletion(capability, raw).content;
  } catch (error) {
    const detail = error instanceof UnparseableCompletion ? error.detail : String(error);
    return { key, score: 0, failures: [`the answer could not be stored: ${detail}`] };
  }

  const text = textOf(content);
  const lower = text.toLowerCase();
  const checks: boolean[] = [];
  const failures: string[] = [];

  for (const phrase of expect.mustMention ?? []) {
    const ok = lower.includes(phrase.toLowerCase());
    checks.push(ok);
    if (!ok) failures.push(`never mentions "${phrase}"`);
  }
  for (const phrase of expect.mustNotMention ?? []) {
    const ok = !lower.includes(phrase.toLowerCase());
    checks.push(ok);
    if (!ok) failures.push(`mentions "${phrase}", which it must not`);
  }
  if (expect.maxWords !== undefined) {
    const words = text.split(/\s+/).filter(Boolean).length;
    const ok = words <= expect.maxWords;
    checks.push(ok);
    if (!ok) failures.push(`${words} words, above the limit of ${expect.maxWords}`);
  }

  // No expectations means the only thing asked of the answer was that it
  // parse, and it did.
  if (checks.length === 0) return { key, score: 1, failures: [] };
  return { key, score: checks.filter(Boolean).length / checks.length, failures };
}

export async function listDatasets() {
  return platformDb().aiEvalDataset.findMany({ orderBy: { key: 'asc' }, include: { cases: true } });
}

export async function listRuns(promptKey: string, limit = 20) {
  const versions = await platformDb().aiPromptVersion.findMany({ where: { promptKey }, select: { id: true } });
  return platformDb().aiEvalRun.findMany({
    where: { promptVersionId: { in: versions.map((version) => version.id) } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Runs one prompt version against its dataset and records the result.
 *
 * The run costs money — it is a real call per case — so the cost is recorded
 * on the run rather than swallowed. It is the deployment's cost, not a
 * tenant's: an evaluation has no tenant to charge, and a cost nobody measures
 * is how prompt work quietly becomes the largest line on the bill.
 */
export async function runEvaluation(ctx: TenantContext, promptKey: string, version: number) {
  authz.require(ctx, 'platform.ai.prompt');
  const db = platformDb();

  const prompt = await db.aiPrompt.findFirst({ where: { key: promptKey } });
  if (!prompt) throw new NotFoundError('prompt', promptKey);
  if (!isCapability(prompt.capability)) throw new ValidationError(`${promptKey} names a capability this build does not have`);

  const promptVersion = await db.aiPromptVersion.findFirst({ where: { promptKey, version } });
  if (!promptVersion) throw new NotFoundError('prompt version', `${promptKey}@${version}`);

  let dataset = await db.aiEvalDataset.findFirst({ where: { capability: prompt.capability }, include: { cases: true } });
  if (!dataset) {
    // Same cold-start reasoning as the prompt registry: the boot seed is not
    // awaited, and seeding is idempotent.
    await seedAiDatasets();
    dataset = await db.aiEvalDataset.findFirst({ where: { capability: prompt.capability }, include: { cases: true } });
  }
  if (!dataset) throw new NotFoundError('evaluation dataset for', prompt.capability);
  if (dataset.cases.length === 0) throw new ValidationError(`the ${dataset.key} dataset has no cases, so a score would mean nothing`);

  const capability = prompt.capability as Capability;
  const scores: CaseScore[] = [];
  let costMicros = 0n;
  let model = '';

  for (const evalCase of dataset.cases) {
    const result = await callModel({
      capability,
      systemPrompt: promptVersion.systemPrompt,
      template: promptVersion.template,
      context: evalCase.context as Record<string, unknown>,
      // An evaluation sends the same prompts to the same provider as the real
      // thing, so it is bound by the same policy. A run that was exempt would
      // be a way to process a tenant's data outside its regions by calling it
      // a test.
      allowedRegions: aiRegions(ctx),
    });
    costMicros += result.costMicros;
    model = result.completion.model;
    scores.push(scoreCase(capability, evalCase.key, result.completion.text, evalCase.expect as CaseExpectation));
  }

  const score = scores.reduce((total, one) => total + one.score, 0) / scores.length;
  const passed = score >= dataset.threshold;

  const run = await db.aiEvalRun.create({
    data: {
      id: newId(),
      promptVersionId: promptVersion.id,
      datasetKey: dataset.key,
      model,
      score,
      threshold: dataset.threshold,
      passed,
      costMicros,
      cases: scores as never,
      ranBy: ctx.actor.id,
    },
  });

  await db.aiPromptVersion.update({
    where: { id: promptVersion.id },
    data: { score, evaluatedAt: new Date(), status: promptVersion.status === 'draft' ? 'evaluated' : promptVersion.status },
  });

  await transaction(ctx, (tx) =>
    recordAudit(tx, ctx, {
      action: 'ai.prompt.evaluated',
      targetType: 'ai_prompt',
      targetId: promptKey,
      after: { version, score, threshold: dataset.threshold, passed },
    }),
  );

  logger.info('AI prompt evaluated', { promptKey, version, score, passed, cases: scores.length });
  return { ...run, cases: scores };
}

/** Writes the shipped datasets at boot. Idempotent; never edits a case. */
export async function seedAiDatasets(): Promise<{ created: number }> {
  const db = platformDb();
  let created = 0;

  for (const dataset of SHIPPED_DATASETS) {
    const existing = await db.aiEvalDataset.findFirst({ where: { key: dataset.key } });
    if (existing) continue;

    await db.aiEvalDataset.create({
      data: { key: dataset.key, capability: dataset.capability, name: dataset.name, threshold: dataset.threshold },
    });
    for (const one of dataset.cases) {
      await db.aiEvalCase.create({
        data: {
          id: newId(),
          datasetKey: dataset.key,
          key: one.key,
          context: one.context as never,
          expect: one.expect as never,
        },
      });
    }
    created += 1;
  }

  if (created > 0) logger.info('AI evaluation datasets seeded', { created });
  return { created };
}
