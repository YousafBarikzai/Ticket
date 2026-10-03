import { pendingPart, type DemoPart, type HistoryPartKey } from '../index.js';

/**
 * The history parts, 08–19 (A4 §3.2 S5–S9): tickets in chunks of 50 and
 * their links, the SLA replay, approvals, catalogue submissions, feedback,
 * time, problems and changes, major incidents, the status page, the sample AI
 * decisions and notifications, then the analytics reprojection and search.
 *
 * A stub. The next wave's history package (SPEC §15 WP-57) replaces this
 * file with the real parts under the same name and shape: one `DemoPart` per
 * key, in this order. Until then each part refuses with `PartNotBuiltError`.
 */
export const HISTORY_PARTS: readonly DemoPart<HistoryPartKey>[] = Object.freeze([
  pendingPart('08-tickets'),
  pendingPart('09-sla-replay'),
  pendingPart('10-approvals'),
  pendingPart('11-catalogue'),
  pendingPart('12-feedback'),
  pendingPart('13-time'),
  pendingPart('14-problems-changes'),
  pendingPart('15-incidents'),
  pendingPart('16-statuspage'),
  pendingPart('17-ai-notifications'),
  pendingPart('18-analytics'),
  pendingPart('19-search'),
]);
