import { pendingPart, type ConfigPartKey, type DemoPart } from '../index.js';

/**
 * The configuration parts, 01–07 (A4 §3.2 S2, S4): the tenant, people and
 * teams, the catalogue, the SLA calendar and policy, knowledge, the CMDB and
 * the workforce.
 *
 * A stub. The next wave's configuration package (SPEC §15 WP-56) replaces
 * this file with the real parts under the same name and shape: one
 * `DemoPart` per key, in this order. Until then each part refuses with
 * `PartNotBuiltError`, so no build can get past the company step.
 */
export const CONFIG_PARTS: readonly DemoPart<ConfigPartKey>[] = Object.freeze([
  pendingPart('01-tenant'),
  pendingPart('02-people'),
  pendingPart('03-catalogue'),
  pendingPart('04-sla'),
  pendingPart('05-knowledge'),
  pendingPart('06-cmdb'),
  pendingPart('07-workforce'),
]);
