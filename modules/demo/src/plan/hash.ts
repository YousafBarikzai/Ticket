import { createHash } from 'node:crypto';
import type { DemoPlan } from './types.js';

/**
 * SHA-256 of a plan's JSON: equal for equal (seed, T0, scale, history days,
 * generator version), recorded in the generation ledger (A4 §1.15, W8). The
 * plan is built in a fixed order, so its JSON is too.
 */
export function planHash(plan: DemoPlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}
