import type { DemoContent } from './content-types.js';
import { planWithContent } from './generate.js';
import { DEMO_CONTENT } from './library.js';
import type { DemoPlan } from './types.js';
import { DEMO_GENERATOR_VERSION } from './version.js';

/**
 * The planner's entry point (A4 §3.1 S3): a generation's whole story, from
 * the seed, T0, the scale and the history's length, before a row is written.
 *
 * Pure: no clock, no I/O, no `Math.random`. Equal inputs give an equal plan
 * and an equal `planHash`, which the build records in the generation ledger
 * (W8), so a generation can be told apart from one built by other rules.
 */

export interface PlanGenerationInput {
  readonly seed: number;
  /** T0, the build instant; floored to the minute. */
  readonly anchor: Date | number;
  /** `DEMO_SCALE`, 0.1–1: tickets and their history scale; people and configuration do not. */
  readonly scale: number;
  /** `DEMO_HISTORY_DAYS`, 60–150. */
  readonly historyDays: number;
  /** Defaults to this build's `DEMO_GENERATOR_VERSION`. */
  readonly generatorVersion?: string;
}

export function planGeneration(input: PlanGenerationInput, content: DemoContent = DEMO_CONTENT): DemoPlan {
  return planWithContent({ ...input, generatorVersion: input.generatorVersion ?? DEMO_GENERATOR_VERSION }, content);
}

export { planHash } from './hash.js';

export type { DemoPlan };
