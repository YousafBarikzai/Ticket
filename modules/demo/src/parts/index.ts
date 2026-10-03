import type { DemoBuildStep, DemoResetReason } from '@itsm/contracts/demo';
import { DEMO_BUILD_REASON } from '@itsm/contracts/demo';
import { systemContext, type TenantContext } from '@itsm/platform';
import type { DemoPlan } from '../plan/types.js';

/**
 * The parts: one writer per area of the story (A4 §2.2, §3.2).
 *
 * Each part takes the plan and the ids earlier parts created, writes its rows
 * through the owning modules' public services — never Prisma, never another
 * module's table (W1) — and returns the ids it created, by the plan's keys.
 * The configuration parts (01–07) live in `parts/config/` and the history
 * parts (08–19) in `parts/history/`, so two packages can build them side by
 * side; this file fixes the shape both implement and the order they run in.
 *
 * Every part runs as the system actor `demo-build` (X-M8). Its `id` is
 * `null`: an actor id lands in uuid columns, and `DEMO_BUILD_ACTOR.id` is a
 * label, so the label travels as the display name. Configuration rows carry
 * `DEMO_BUILD_REASON` where the owning service takes a reason; import chunks
 * write one batch audit row each (D19).
 */

/** The parts, in the order they run. */
export const PART_KEYS = [
  '01-tenant',
  '02-people',
  '03-catalogue',
  '04-sla',
  '05-knowledge',
  '06-cmdb',
  '07-workforce',
  '08-tickets',
  '09-sla-replay',
  '10-approvals',
  '11-catalogue',
  '12-feedback',
  '13-time',
  '14-problems-changes',
  '15-incidents',
  '16-statuspage',
  '17-ai-notifications',
  '18-analytics',
  '19-search',
] as const;
export type PartKey = (typeof PART_KEYS)[number];

export type ConfigPartKey = Extract<PartKey, `0${1 | 2 | 3 | 4 | 5 | 6 | 7}-${string}`>;
export type HistoryPartKey = Exclude<PartKey, ConfigPartKey>;

/**
 * The build step each part reports in `demo:build` (A4 §3.3). The steps only
 * ever move forward through `DEMO_BUILD_STEPS`, and visitors see none of them.
 */
export const PART_STEPS: Readonly<Record<PartKey, DemoBuildStep>> = Object.freeze({
  '01-tenant': 'company',
  '02-people': 'people',
  '03-catalogue': 'catalogue',
  '04-sla': 'catalogue',
  '05-knowledge': 'catalogue',
  '06-cmdb': 'catalogue',
  '07-workforce': 'catalogue',
  '08-tickets': 'tickets',
  '09-sla-replay': 'service-levels',
  '10-approvals': 'history',
  '11-catalogue': 'history',
  '12-feedback': 'history',
  '13-time': 'history',
  '14-problems-changes': 'history',
  '15-incidents': 'history',
  '16-statuspage': 'history',
  '17-ai-notifications': 'history',
  '18-analytics': 'reports',
  '19-search': 'search',
});

/** The generation a part is writing. */
export interface DemoBuildInfo {
  /** The build tenant's id, chosen before its row exists so `beginQuiet` covers the first write (S2). */
  readonly tenantId: string;
  /** `demo-build-g<n>-<6 hex>`. */
  readonly slug: string;
  readonly generation: number;
  readonly reason: DemoResetReason;
  /** The ledger row (`openGeneration`). */
  readonly ledgerId: string;
  /** `DEMO_BUILD_PARALLELISM` (R3): replay and reprojection batches run at once. */
  readonly parallelism: number;
}

/** The kinds of id the parts hand on, each keyed by the plan's own key. */
export type IdKind =
  | 'users'
  | 'teams'
  | 'organisations'
  | 'calendars'
  | 'categories'
  | 'services'
  | 'forms'
  | 'requestTypes'
  | 'policies'
  | 'articles'
  | 'assets'
  | 'cis'
  | 'suppliers'
  | 'contracts'
  | 'skills'
  | 'tickets'
  | 'approvals'
  | 'problems'
  | 'changes'
  | 'majorIncidents'
  | 'statusComponents';

/**
 * Every id created so far, by kind, then by the plan's key: `users['emma-clarke']`,
 * `teams['service-desk']`, `tickets['demo:hero:H1']`, `changes['1192']`.
 */
export type DemoIds = Readonly<Record<IdKind, Readonly<Record<string, string>>>>;

/** What a part returns: the ids it created, merged into `DemoIds` for the parts after it. */
export type PartOutput = Partial<Record<IdKind, Readonly<Record<string, string>>>>;

/** What every part is given. */
export interface PartInput {
  /** The build tenant's context: the system actor `demo-build`, every permission. */
  readonly ctx: TenantContext;
  readonly plan: DemoPlan;
  readonly ids: DemoIds;
  readonly build: DemoBuildInfo;
  /** Raised when the worker shuts down; a part stops at its next chunk, and the build at the next part (A4 §3.6). */
  readonly signal?: AbortSignal;
}

export interface DemoPart<K extends PartKey = PartKey> {
  readonly key: K;
  readonly step: DemoBuildStep;
  run(input: PartInput): Promise<PartOutput>;
}

/** The ids before any part has run. */
export function emptyIds(): DemoIds {
  const kinds: IdKind[] = [
    'users',
    'teams',
    'organisations',
    'calendars',
    'categories',
    'services',
    'forms',
    'requestTypes',
    'policies',
    'articles',
    'assets',
    'cis',
    'suppliers',
    'contracts',
    'skills',
    'tickets',
    'approvals',
    'problems',
    'changes',
    'majorIncidents',
    'statusComponents',
  ];
  return Object.fromEntries(kinds.map((kind) => [kind, {}])) as unknown as DemoIds;
}

/** `ids` with a part's output added; a part may not overwrite an id an earlier part created. */
export function mergeIds(ids: DemoIds, output: PartOutput, part: PartKey): DemoIds {
  const next: Record<string, Record<string, string>> = { ...(ids as Record<IdKind, Record<string, string>>) };
  for (const [kind, created] of Object.entries(output) as [IdKind, Readonly<Record<string, string>>][]) {
    const existing = ids[kind] ?? {};
    for (const key of Object.keys(created)) {
      if (Object.hasOwn(existing, key) && existing[key] !== created[key]) {
        throw new PartContractError(`${part} re-created ${kind} "${key}", which an earlier part already created`);
      }
    }
    next[kind] = { ...existing, ...created };
  }
  return next as unknown as DemoIds;
}

export class PartContractError extends Error {}

/** A part that the build reached before its package was written. */
export class PartNotBuiltError extends Error {
  constructor(readonly part: PartKey) {
    super(`demo build part ${part} is not built yet`);
  }
}

/** The build tenant's context: the system actor `demo-build` (X-M8), every permission, the build's correlation id. */
export function demoBuildContext(tenantId: string, correlationId?: string): TenantContext {
  return systemContext(tenantId, {
    actor: { type: 'system', id: null, displayName: 'demo-build' },
    ...(correlationId ? { correlationId } : {}),
    locale: 'en-GB',
    timeZone: 'Europe/London',
  });
}

/** The audit reason every configuration write of a build carries (X-M8). */
export const BUILD_REASON = DEMO_BUILD_REASON;

export interface RunPartsHooks {
  /** Before a part runs: the orchestrator refreshes `demo:build` and renews its lock here. */
  readonly beforePart?: (part: DemoPart) => Promise<void> | void;
  /** After a part: its duration, for the ledger's `step_ms`. */
  readonly afterPart?: (part: DemoPart, ms: number, output: PartOutput) => Promise<void> | void;
}

/**
 * Runs `parts` in order, handing each the ids the ones before it created. A
 * raised `signal` stops the build between parts (`signal.reason` is thrown),
 * so a shutdown never leaves a part half-written by choice.
 */
export async function runParts(
  parts: readonly DemoPart[],
  input: Omit<PartInput, 'ids'> & { readonly ids?: DemoIds },
  hooks: RunPartsHooks = {},
): Promise<DemoIds> {
  let ids = input.ids ?? emptyIds();
  for (const part of parts) {
    input.signal?.throwIfAborted();
    await hooks.beforePart?.(part);
    const started = performance.now();
    const output = await part.run({ ...input, ids });
    ids = mergeIds(ids, output, part.key);
    await hooks.afterPart?.(part, Math.round(performance.now() - started), output);
  }
  return ids;
}

/** A part whose package has not landed: it refuses, so a build can never swap in half a story. */
export function pendingPart<K extends PartKey>(key: K): DemoPart<K> {
  return {
    key,
    step: PART_STEPS[key],
    run: async () => {
      throw new PartNotBuiltError(key);
    },
  };
}
