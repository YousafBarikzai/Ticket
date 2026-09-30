import 'server-only';
import type { ApprovalDetail, ApprovalRequest, Portal } from '@itsm/sdk';
import { settle } from '../home/settle.js';
import { answeredAny, answeredCurrentStep, type ApprovalScope } from './model.js';

/**
 * The reads behind the Approvals page (SPEC §6.3 `/approvals`), and the rule
 * the frame's count shares with it.
 *
 * The API lists an approval as waiting on everyone named on its open step,
 * and a step that needs two approvals stays open after the first. So a
 * person who has approved it already would still find it under *To decide*
 * — and counted on their avatar, and pinned on Home — and pressing Approve
 * again would only earn a 409. The few approvals where that can be true —
 * more than one approval needed, and some given — are opened to see whose
 * they were (`withoutAnswered`, used by `currentApprovals()`). The decided
 * list needs the same care the other way round: the API builds it from every
 * step a person is named on, including a later one that has not reached them
 * yet.
 */

/** At most this many approvals are opened, per list, to check whose the decisions were. */
export const CHECK_LIMIT = 20;

async function details(api: Portal, approvals: readonly ApprovalRequest[]): Promise<Map<string, ApprovalDetail>> {
  const reads = await Promise.all(approvals.slice(0, CHECK_LIMIT).map((approval) => settle(api.approval(approval.id))));
  const out = new Map<string, ApprovalDetail>();
  for (const read of reads) if (read.ok) out.set(read.value.id, read.value);
  return out;
}

/**
 * What still waits on this person's answer: the undecided list, less any
 * approval whose open step already has their decision on it. Only approvals
 * needing more than one approval, with some given, can be like that, so only
 * those are opened; one that cannot be read stays listed.
 */
export async function withoutAnswered(api: Portal, actorId: string | null, open: readonly ApprovalRequest[]): Promise<ApprovalRequest[]> {
  const shared = open.filter((approval) => (approval.currentStep?.quorum ?? 1) > 1 && (approval.currentStep?.decidedCount ?? 0) > 0);
  if (shared.length === 0 || !actorId) return [...open];
  const checked = await details(api, shared);
  const answered = new Set([...checked.values()].filter((detail) => answeredCurrentStep(detail, actorId)).map((detail) => detail.id));
  return open.filter((approval) => !answered.has(approval.id));
}

export interface ApprovalsRead {
  /** What waits on this person; null when it could not be read. */
  readonly waiting: readonly ApprovalRequest[] | null;
  /** What they have dealt with (the Decided segment only); null when it could not be read or was not asked for. */
  readonly decided: readonly ApprovalRequest[] | null;
}

/**
 * `waiting` is the layout's list (`currentApprovals()`, shared through
 * `cache()` and already without what this person has answered), or null
 * when it failed.
 */
export async function readApprovals(
  api: Portal,
  actorId: string | null,
  waiting: readonly ApprovalRequest[] | null,
  scope: ApprovalScope,
): Promise<ApprovalsRead> {
  if (scope !== 'decided') return { waiting, decided: null };
  const everything = await settle(api.approvals({ includeDecided: true }));
  if (!everything.ok) return { waiting, decided: null };

  const waitingIds = new Set((waiting ?? []).map((approval) => approval.id));
  const rest = everything.value.data.filter((approval) => !waitingIds.has(approval.id));
  // Still going and not waiting on them: did they answer a step of it, or has it not reached them yet?
  const unsure = rest.filter((approval) => approval.status === 'pending');
  const checked = unsure.slice(0, CHECK_LIMIT);
  const opened = await details(api, checked);
  const decided = rest.filter((approval) => {
    if (approval.status !== 'pending') return true;
    const detail = opened.get(approval.id);
    // Beyond the check, it is at least not waiting on them now, which is what this list promises; unreadable within it, left out.
    return detail ? answeredAny(detail, actorId) : !checked.includes(approval);
  });
  return { waiting, decided };
}
