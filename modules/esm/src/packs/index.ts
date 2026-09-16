import { packSchema, type Pack } from '../domain/pack.js';
import { hrPack } from './hr.js';
import { facilitiesPack } from './facilities.js';
import { financePack } from './finance.js';
import { legalPack } from './legal.js';

/**
 * The packs this deployment ships.
 *
 * Authored here rather than uploaded, which is the decision recorded in
 * ADR-0039: an installed pack is executable configuration — a workflow, a set
 * of conditions, an SLA — and letting a tenant administrator upload one turns
 * a configuration surface into a code path. These are reviewed, released and
 * validated with everything else in the repository, and the unit suite refuses
 * a pack that could not be installed.
 */
const SHIPPED: Pack[] = [hrPack, facilitiesPack, financePack, legalPack];

export const ALL_PACKS: readonly Pack[] = SHIPPED.map((pack) => packSchema.parse(pack));

export function packFor(key: string): Pack | null {
  return ALL_PACKS.find((pack) => pack.key === key) ?? null;
}

export { hrPack, facilitiesPack, financePack, legalPack };
