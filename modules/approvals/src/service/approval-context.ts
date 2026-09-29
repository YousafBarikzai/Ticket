import type { Tx } from '@itsm/platform';
import { labelAnswers, userIdsIn, type ApprovalAnswer } from '../domain/answers.js';

/**
 * What an approver needs in order to decide, and how far along a request is.
 *
 * An approval row on its own says only that somebody wants something: a policy,
 * a subject id and a status. An approver deciding from that is deciding blind,
 * and a requester watching their request sit in "Waiting for approval" cannot
 * tell whether it waits on the first of three people or the last.
 *
 * Two audiences, so two answers:
 *
 * - **Progress** (`stepCount`, `currentStep`) is for everybody who may see the
 *   approval at all. It says which step is open, when it is due and how many
 *   decisions it has — nothing about who is deciding or what they said.
 * - **Context** (`subject`, and on the detail `answers`) is for the people named
 *   as approvers on the request, and nobody else. It is read from the ticket,
 *   the catalogue submission and the directory *without* the reader's own
 *   ticket permissions, which is the point — a line manager must see what their
 *   report asked for, though the ticket is not theirs to open — and exactly why
 *   it goes no further than the people deciding. An administrator who may list
 *   every approval still cannot read, through one, a ticket they could not open.
 */

export interface CurrentStep {
  /** Position among all the request's steps, skipped ones included: "Step 2 of 3". */
  sequence: number;
  name: string;
  /** `blocked` when every approver on it has left and nobody can decide it. */
  status: 'open' | 'blocked';
  dueAt: Date | null;
  /** How many approvals the step needs. */
  quorum: number;
  /** How many decisions it has so far. A rejection settles a step, so on an open step these are approvals. */
  decidedCount: number;
}

export interface ApprovalSubject {
  /** The approval's subject type: `request`, `change`, `workflow_run`, … */
  kind: string;
  ticketNumber?: string;
  /** Null when the subject cannot be found; the reader falls back to the step name. */
  title: string | null;
  /** The catalogue item a request was raised from, when it had a form. */
  itemName?: string;
  /** Whoever the approval is for. Null when nobody is recorded or they cannot be found. */
  requesterName: string | null;
}

export interface Described {
  stepCount: number;
  /** The step waiting on a decision; null once the request is settled. */
  currentStep: CurrentStep | null;
  /** Null unless the reader is named as an approver on the request. */
  subject: ApprovalSubject | null;
}

export interface DescribedDetail extends Described {
  /**
   * The catalogue answers, labelled, for an approver of a request raised with a
   * form; an empty list when the item had no form. Null for anybody else, and
   * for subjects that are not catalogue requests.
   */
  answers: ApprovalAnswer[] | null;
}

interface RequestLike {
  id: string;
  subjectType: string;
  subjectId: string;
  ticketId: string | null;
  status: string;
  requestedBy: string | null;
}

interface StepLike {
  id: string;
  requestId: string;
  sequence: number;
  name: string;
  status: string;
  quorum: number;
  approverIds: string[];
  dueAt: Date | null;
}

/** Adds progress and, for approvers, context to each request. One query per table, whatever the number of rows. */
export async function describeRequests<R extends RequestLike>(
  tx: Tx,
  readerId: string | null,
  requests: R[],
): Promise<(R & Described)[]> {
  const described = await describe(tx, readerId, requests, false);
  return described.map(({ answers: _answers, ...row }) => row as R & Described);
}

/** The same for one request, with the catalogue answers when the reader is one of its approvers. */
export async function describeRequest<R extends RequestLike>(
  tx: Tx,
  readerId: string | null,
  request: R,
): Promise<R & DescribedDetail> {
  const [described] = await describe(tx, readerId, [request], true);
  return described!;
}

async function describe<R extends RequestLike>(
  tx: Tx,
  readerId: string | null,
  requests: R[],
  withAnswers: boolean,
): Promise<(R & DescribedDetail)[]> {
  if (requests.length === 0) return [];

  const steps: StepLike[] = await tx.approvalStep.findMany({
    where: { requestId: { in: requests.map((request) => request.id) } },
    orderBy: { sequence: 'asc' },
  });
  const stepsOf = groupBy(steps, (step) => step.requestId);

  // Only a pending request has a step waiting. A settled one can still hold a
  // step marked open (a request settled by a timeout, say), and calling that
  // "current" would tell a requester they are waiting on something that is over.
  const current = new Map<string, StepLike>();
  for (const request of requests) {
    if (request.status !== 'pending') continue;
    const step = stepsOf
      .get(request.id)
      ?.find((candidate) => candidate.status === 'open' || candidate.status === 'blocked');
    if (step) current.set(request.id, step);
  }

  const decided = new Map<string, number>();
  if (current.size > 0) {
    const decisions = await tx.approvalDecision.findMany({
      where: { stepId: { in: [...current.values()].map((step) => step.id) } },
      select: { stepId: true },
    });
    for (const { stepId } of decisions) decided.set(stepId, (decided.get(stepId) ?? 0) + 1);
  }

  // Named on any step, past or present: somebody who approved the first step
  // still needs to recognise the request when it comes back to them.
  const informed = requests.filter(
    (request) =>
      readerId !== null && (stepsOf.get(request.id) ?? []).some((step) => step.approverIds.includes(readerId)),
  );
  const context = await contextFor(tx, informed, withAnswers);

  return requests.map((request) => {
    const step = current.get(request.id);
    const known = context.get(request.id);
    return {
      ...request,
      stepCount: stepsOf.get(request.id)?.length ?? 0,
      currentStep: step
        ? {
            sequence: step.sequence,
            name: step.name,
            status: step.status as 'open' | 'blocked',
            dueAt: step.dueAt,
            quorum: step.quorum,
            decidedCount: decided.get(step.id) ?? 0,
          }
        : null,
      subject: known?.subject ?? null,
      answers: known?.answers ?? null,
    };
  });
}

/**
 * Reads the subject of each request: the ticket (for a catalogue request or a
 * workflow on a ticket), the change, and the people involved.
 *
 * Plain reads inside the tenant's transaction. Row-level security keeps them in
 * the tenant; who may see the result is decided by the caller, which only asks
 * for requests the reader approves.
 */
async function contextFor(
  tx: Tx,
  requests: RequestLike[],
  withAnswers: boolean,
): Promise<Map<string, { subject: ApprovalSubject; answers: ApprovalAnswer[] | null }>> {
  const out = new Map<string, { subject: ApprovalSubject; answers: ApprovalAnswer[] | null }>();
  if (requests.length === 0) return out;

  const ticketIds = unique(requests.map((request) => request.ticketId));
  const changeIds = unique(
    requests.filter((request) => request.subjectType === 'change').map((request) => request.subjectId),
  );
  const requestTicketIds = unique(
    requests.filter((request) => request.subjectType === 'request').map((request) => request.ticketId),
  );

  const tickets = ticketIds.length
    ? await tx.ticket.findMany({
        where: { id: { in: ticketIds } },
        select: { id: true, number: true, title: true, requesterId: true },
      })
    : [];
  const changes = changeIds.length
    ? await tx.change.findMany({
        where: { id: { in: changeIds } },
        select: { id: true, title: true, requestedBy: true },
      })
    : [];
  // A catalogue request's submission names the item it came from and holds the
  // answers. Only a request raised with a form has one.
  const submissions = requestTicketIds.length
    ? await tx.formSubmission.findMany({
        where: { ticketId: { in: requestTicketIds } },
        orderBy: { createdAt: 'asc' },
        select: { ticketId: true, requestTypeId: true, formVersionId: true, answers: true },
      })
    : [];
  const itemIds = unique(submissions.map((submission) => submission.requestTypeId));
  const items = itemIds.length
    ? await tx.requestType.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } })
    : [];

  const forms = new Map<string, unknown>();
  if (withAnswers) {
    const versionIds = unique(submissions.map((submission) => submission.formVersionId));
    const versions = versionIds.length
      ? await tx.formVersionRecord.findMany({ where: { id: { in: versionIds } }, select: { id: true, document: true } })
      : [];
    for (const version of versions) forms.set(version.id, version.document);
  }

  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const changeById = new Map(changes.map((change) => [change.id, change]));
  const itemById = new Map(items.map((item) => [item.id, item.name]));
  // The first submission per ticket: a catalogue request is raised once.
  const submissionByTicket = new Map<string, (typeof submissions)[number]>();
  for (const submission of submissions) {
    if (submission.ticketId && !submissionByTicket.has(submission.ticketId)) {
      submissionByTicket.set(submission.ticketId, submission);
    }
  }

  const requesterOf = (request: RequestLike): string | null => {
    const ticket = request.ticketId ? ticketById.get(request.ticketId) : undefined;
    if (ticket?.requesterId) return ticket.requesterId;
    const change = request.subjectType === 'change' ? changeById.get(request.subjectId) : undefined;
    return change?.requestedBy ?? request.requestedBy;
  };

  const personIds = new Set<string>();
  for (const request of requests) {
    const person = requesterOf(request);
    if (person) personIds.add(person);
  }
  if (withAnswers) {
    for (const submission of submissionByTicket.values()) {
      for (const id of userIdsIn(forms.get(submission.formVersionId), submission.answers)) personIds.add(id);
    }
  }
  const people = personIds.size
    ? await tx.user.findMany({
        // Ids from answers are whatever the requester typed into a user field;
        // anything that is not a uuid would make the query itself fail.
        where: { id: { in: [...personIds].filter(isUuid) } },
        select: { id: true, displayName: true },
      })
    : [];
  const names = new Map(people.map((person) => [person.id, person.displayName]));

  for (const request of requests) {
    const ticket = request.ticketId ? ticketById.get(request.ticketId) : undefined;
    const change = request.subjectType === 'change' ? changeById.get(request.subjectId) : undefined;
    const submission =
      request.subjectType === 'request' && request.ticketId ? submissionByTicket.get(request.ticketId) : undefined;
    const itemName = submission?.requestTypeId ? itemById.get(submission.requestTypeId) : undefined;
    const requester = requesterOf(request);

    const subject: ApprovalSubject = {
      kind: request.subjectType,
      ...(ticket ? { ticketNumber: ticket.number } : {}),
      title: ticket?.title ?? change?.title ?? null,
      ...(itemName ? { itemName } : {}),
      requesterName: requester ? (names.get(requester) ?? null) : null,
    };

    let answers: ApprovalAnswer[] | null = null;
    if (withAnswers && request.subjectType === 'request' && ticket) {
      answers = submission ? labelAnswers(forms.get(submission.formVersionId), submission.answers, names) : [];
    }
    out.set(request.id, { subject, answers });
  }
  return out;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
