/**
 * Which moves a ticket in a given state may make.
 *
 * A copy of MOD-04's canonical state machine, and a copy on purpose. The
 * workbench must not import `@itsm/module-ticket`: a module package carries
 * Prisma, and pulling it into a Next bundle would put the database client in
 * an application that has no database and must never acquire one.
 *
 * A copy that nobody checks is a copy that drifts, so the test beside this
 * file imports the real `STATES` and asserts the two agree, state for state
 * and transition for transition. When MOD-04 grows a state the test fails
 * here, which is the point: it fails in the place that has to change.
 *
 * The API is still the authority. This decides which options a person is
 * offered; the API decides whether the move happens.
 */

export const ALLOWED_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  new: ['in_progress', 'pending_requester', 'pending_third_party', 'pending_approval', 'resolved', 'cancelled'],
  in_progress: ['pending_requester', 'pending_third_party', 'pending_approval', 'resolved', 'cancelled'],
  pending_requester: ['in_progress', 'resolved', 'cancelled'],
  pending_third_party: ['in_progress', 'resolved'],
  pending_approval: ['in_progress', 'resolved', 'cancelled'],
  resolved: ['closed', 'reopened'],
  reopened: ['in_progress', 'pending_requester', 'pending_third_party', 'pending_approval', 'resolved', 'cancelled'],
  closed: [],
  cancelled: [],
};

/**
 * An unknown state offers nothing rather than everything. A tenant may rename
 * its statuses (MOD-04 maps them onto the canonical set), and a state this
 * table has never heard of is a reason to show no buttons, not every button.
 */
export function transitionsFrom(state: string): readonly string[] {
  return ALLOWED_TRANSITIONS[state] ?? [];
}
