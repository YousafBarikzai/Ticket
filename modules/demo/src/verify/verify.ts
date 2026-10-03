import type { Priority } from '@itsm/contracts';
import { DEMO_PERSONAS, DEMO_SD_HEROES, demoHeroRef, type DemoPersonaKey } from '@itsm/contracts/demo';
import type { TicketChannel } from '../plan/content-types.js';
import { TICKET_CHANNELS } from '../plan/content-types.js';
import { CHANNEL_MIX, TARGET_TYPES, type TargetType } from '../plan/model.js';
import type { DemoPlan, PlannedVerdict } from '../plan/types.js';

/**
 * The build's checks, step S10 (SPEC §5.3, A4 §3.2).
 *
 * A generation is swapped in only when every check passes; any failure
 * leaves yesterday's demo where it is. The checks are pure decisions over
 * `VerifyFacts` — what the orchestrator reads back from the database through
 * the owning modules once the build has written it — so each is tested on a
 * crafted counter-example (`verify.test.ts`) and the bands live in one place
 * (A4 §10 R3).
 *
 * - V1 the ticket projection matches the tickets (`checkTicketDrift`);
 * - V2 the database replay agrees with the plan, per ticket and target, to
 *   0.5 % — a **warning** only (Y-M7): a boundary-rounding drift between two
 *   implementations of one maths must never cost a night's demo;
 * - V3 attainment, 30 days, overall and per target, within A4 §1.11's bands;
 * - V4 CSAT, 30 days;
 * - V5 the channel and priority mix, and no `import`, `api`, `slack` or
 *   `whatsapp` ticket;
 * - V6 the three personas exist, active, with exactly their roles, Alex the
 *   lead of `service-desk`;
 * - V7 the story's objects: one open major incident in the expected state,
 *   the pending approvals with their approvers, every hero in place — every
 *   `DEMO_SD_HEROES` ticket in `service-desk` — and 23 warranties ending
 *   within 30 days;
 * - V8 invariants: no cancelled ticket with an approval, no pending approval
 *   on a ticket outside `pending_approval`, no running timer due within ten
 *   minutes of T0, and no published form with a required file field (a guard
 *   for a question type the forms do not have yet [V-M1]);
 * - V9 the tenant stayed quiet: no published outbox row, no refused enqueue;
 * - V10 no `{` or `}` left in any ticket description.
 */

export const CHECK_IDS = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10'] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export type CheckOutcome = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  readonly id: CheckId;
  readonly outcome: CheckOutcome;
  /** One line for the ledger and the operator log. */
  readonly summary: string;
  /** What was measured, for the ledger's `checks` column. */
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface VerifyReport {
  /** True when no check failed; warnings do not stop the swap. */
  readonly ok: boolean;
  readonly checks: readonly CheckResult[];
  /** The checks that failed, in order; the first is what the ledger's `failure.check` names. */
  readonly failed: readonly CheckId[];
  readonly warned: readonly CheckId[];
}

/* ------------------------------------------------------------------ The bands (A4 §1.11) */

export interface Band {
  readonly min: number;
  readonly max: number;
}

/** Bands at `DEMO_SCALE = 1`; below 1 every band widens by three points (A4 §1.11). */
export const BANDS = Object.freeze({
  attainment: { overall: { min: 83, max: 87 }, response: { min: 89, max: 95 }, update: { min: 75, max: 85 }, resolution: { min: 80, max: 88 } } satisfies Record<
    TargetType | 'overall',
    Band
  >,
  /** `surveys.score` (0–100): 83–87 at scale 1, 80–90 below it (A4 §3.2 V4). */
  csat: { min: 83, max: 87 } satisfies Band,
  /** Points either side of A4's channel shares. */
  channelPoints: 3,
  /** Points either side of A4's priority shares. */
  priorityPoints: 2,
  /** Points a band widens by below full scale. */
  smallScaleWidening: 3,
  /** V2: the most (ticket, target) verdicts that may disagree before it warns. */
  replayDisagreement: 0.005,
});

/** A4 §1.11's priority mix, per cent. */
export const PRIORITY_MIX: Readonly<Record<Priority, number>> = Object.freeze({ P1: 2, P2: 10, P3: 48, P4: 40 });

/** Channels a demo ticket may never have (V5). */
export const FORBIDDEN_CHANNELS = Object.freeze(['import', 'api', 'slack', 'whatsapp'] as const);

/* ------------------------------------------------------------------ Facts */

/**
 * What S10 reads back from the build tenant. Each field names its source; the
 * orchestrator gathers them through the owning modules' public services in
 * the build tenant's context, mapping ids back to the plan's keys (people by
 * e-mail, teams by key, tickets by `externalRef`).
 */
export interface VerifyFacts {
  /** V1: `checkTicketDrift(ctx, { now: T0 })` (analytics). */
  readonly drift: { readonly expected: number; readonly actual: number; readonly breached: boolean };
  /** V2: every `replayTimers` result, per ticket and target, keyed by the ticket's `externalRef`. */
  readonly replay: readonly { readonly ref: string; readonly target: TargetType; readonly verdict: PlannedVerdict }[];
  /** V3: `sla.attainment` over `30d` at T0, overall and filtered by target (per cent; `null` with nothing finished). */
  readonly attainment: Readonly<Record<TargetType | 'overall', number | null>>;
  /** V4: `surveys.score` over `30d` at T0; `null` with no response. */
  readonly csat: number | null;
  /** V5: tickets by `sourceChannel` and by priority, over the whole tenant. */
  readonly channels: Readonly<Record<string, number>>;
  readonly priorities: Readonly<Record<string, number>>;
  /** V6: each persona's user, found by its `DEMO_PERSONAS` e-mail. */
  readonly personas: readonly {
    readonly key: DemoPersonaKey;
    readonly exists: boolean;
    readonly active: boolean;
    readonly roles: readonly string[];
    /** Team keys where this user is a lead member. */
    readonly leads: readonly string[];
  }[];
  /** V7: major incidents not `resolved` or `closed`, by number (`MI-0004`) and state. */
  readonly openMajorIncidents: readonly { readonly number: string; readonly state: string }[];
  /** V7: pending approval requests: their subject (`externalRef` or `CHG-n`) and the approver's person key. */
  readonly pendingApprovals: readonly { readonly subject: string; readonly approver: string }[];
  /** V7: tickets whose `externalRef` starts `demo:hero:`, with their status and team key. */
  readonly heroes: readonly { readonly ref: string; readonly status: string; readonly team: string | null }[];
  /** V7: assets whose warranty ends within 30 days of T0. */
  readonly warrantiesWithin30Days: number;
  /** V8: cancelled tickets that have any approval request. */
  readonly cancelledWithApproval: number;
  /** V8: pending approval requests on tickets not in `pending_approval`. */
  readonly pendingApprovalOutsidePendingStatus: number;
  /** V8: running SLA timers due in [T0, T0 + 10 min]. */
  readonly runningTimersDueWithin10Min: number;
  /** V8: published forms with a required field of a file type. */
  readonly publishedFormsWithRequiredFileField: number;
  /** V9: the build tenant's `outbox_event` rows with `published_at` set. */
  readonly publishedOutboxRows: number;
  /** V9: `quietRefusals()` before the build and now. */
  readonly quietRefusals: { readonly before: number; readonly after: number };
  /** V10: ticket descriptions containing `{` or `}`, by `externalRef` (a few are enough). */
  readonly descriptionsWithBraces: readonly string[];
}

export interface VerifyOptions {
  /** `DEMO_SCALE`: below 1 every band widens by three points. */
  readonly scale: number;
}

/* ------------------------------------------------------------------ The checks */

const widen = (band: Band, scale: number): Band =>
  scale < 1 ? { min: band.min - BANDS.smallScaleWidening, max: band.max + BANDS.smallScaleWidening } : band;
const inside = (value: number, band: Band): boolean => value >= band.min && value <= band.max;
const round = (value: number): number => Math.round(value * 10) / 10;

function result(id: CheckId, outcome: CheckOutcome, summary: string, detail: Record<string, unknown> = {}): CheckResult {
  return { id, outcome, summary, detail };
}

export function checkDrift(facts: Pick<VerifyFacts, 'drift'>): CheckResult {
  const { drift } = facts;
  return drift.breached
    ? result('V1', 'fail', `ticket projection drifted: ${drift.actual} facts for ${drift.expected} tickets`, drift)
    : result('V1', 'pass', `ticket projection matches: ${drift.actual} of ${drift.expected}`, drift);
}

/** V2 on its own: how far the database replay strays from the plan. */
export function compareReplay(
  plan: Pick<DemoPlan, 'tickets'>,
  replay: VerifyFacts['replay'],
): { compared: number; disagreements: number; missing: number; rate: number; examples: string[] } {
  const planned = new Map<string, PlannedVerdict>();
  for (const ticket of plan.tickets) for (const target of TARGET_TYPES) planned.set(`${ticket.ref}|${target}`, ticket.sla.verdicts[target]);
  let compared = 0;
  let disagreements = 0;
  const examples: string[] = [];
  const seen = new Set<string>();
  for (const row of replay) {
    const key = `${row.ref}|${row.target}`;
    const expected = planned.get(key);
    if (expected === undefined) continue;
    seen.add(key);
    compared += 1;
    if (expected !== row.verdict) {
      disagreements += 1;
      if (examples.length < 10) examples.push(`${row.ref} ${row.target}: planned ${expected}, replayed ${row.verdict}`);
    }
  }
  const missing = planned.size - seen.size;
  const rate = compared === 0 ? 0 : disagreements / compared;
  return { compared, disagreements, missing, rate, examples };
}

export function checkReplay(facts: Pick<VerifyFacts, 'replay'>, plan: Pick<DemoPlan, 'tickets'>): CheckResult {
  const comparison = compareReplay(plan, facts.replay);
  const detail = { ...comparison, rate: round(comparison.rate * 1000) / 10 };
  // A warning, never a refusal (Y-M7): logged and ledgered for whoever owns
  // the maths, while the generation still goes live.
  if (comparison.rate > BANDS.replayDisagreement || comparison.missing > 0) {
    return result(
      'V2',
      'warn',
      `replay disagrees with the plan on ${comparison.disagreements} of ${comparison.compared} verdicts (${(comparison.rate * 100).toFixed(2)} %)${comparison.missing > 0 ? `; ${comparison.missing} not replayed` : ''}`,
      detail,
    );
  }
  return result('V2', 'pass', `replay agrees with the plan on ${comparison.compared - comparison.disagreements} of ${comparison.compared} verdicts`, detail);
}

export function checkAttainment(facts: Pick<VerifyFacts, 'attainment'>, options: VerifyOptions): CheckResult {
  const misses: string[] = [];
  const measured: Record<string, number | null> = {};
  for (const key of ['overall', ...TARGET_TYPES] as const) {
    const value = facts.attainment[key];
    const band = widen(BANDS.attainment[key], options.scale);
    measured[key] = value === null ? null : round(value);
    if (value === null || !inside(value, band)) misses.push(`${key} ${value === null ? 'none' : `${round(value)} %`} outside ${band.min}–${band.max} %`);
  }
  return misses.length > 0
    ? result('V3', 'fail', `attainment out of band: ${misses.join('; ')}`, measured)
    : result('V3', 'pass', `attainment ${measured.overall} % (response ${measured.response}, update ${measured.update}, resolution ${measured.resolution})`, measured);
}

export function checkCsat(facts: Pick<VerifyFacts, 'csat'>, options: VerifyOptions): CheckResult {
  const band = options.scale < 1 ? { min: 80, max: 90 } : BANDS.csat;
  const value = facts.csat;
  if (value === null || !inside(value, band)) {
    return result('V4', 'fail', `CSAT ${value === null ? 'has no responses' : `${round(value)} is outside ${band.min}–${band.max}`}`, { csat: value });
  }
  return result('V4', 'pass', `CSAT ${round(value)} (${round(1 + (value / 100) * 4)} / 5)`, { csat: round(value) });
}

function shares(counts: Readonly<Record<string, number>>): { total: number; share: (key: string) => number } {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { total, share: (key) => (total === 0 ? 0 : ((counts[key] ?? 0) / total) * 100) };
}

export function checkMix(facts: Pick<VerifyFacts, 'channels' | 'priorities'>, options: VerifyOptions): CheckResult {
  const problems: string[] = [];
  const widening = options.scale < 1 ? BANDS.smallScaleWidening : 0;
  for (const channel of FORBIDDEN_CHANNELS) {
    if ((facts.channels[channel] ?? 0) > 0) problems.push(`${facts.channels[channel]} ticket(s) on the ${channel} channel`);
  }
  for (const channel of Object.keys(facts.channels)) {
    if (!(TICKET_CHANNELS as readonly string[]).includes(channel) && !(FORBIDDEN_CHANNELS as readonly string[]).includes(channel) && (facts.channels[channel] ?? 0) > 0) {
      problems.push(`${facts.channels[channel]} ticket(s) on the unexpected ${channel} channel`);
    }
  }
  const channels = shares(facts.channels);
  for (const channel of TICKET_CHANNELS) {
    const share = channels.share(channel);
    const target = CHANNEL_MIX[channel as TicketChannel];
    if (Math.abs(share - target) > BANDS.channelPoints + widening) problems.push(`${channel} ${round(share)} % (expected ${target} ± ${BANDS.channelPoints + widening})`);
  }
  const priorities = shares(facts.priorities);
  for (const priority of ['P1', 'P2', 'P3', 'P4'] as const) {
    const share = priorities.share(priority);
    if (Math.abs(share - PRIORITY_MIX[priority]) > BANDS.priorityPoints + widening) {
      problems.push(`${priority} ${round(share)} % (expected ${PRIORITY_MIX[priority]} ± ${BANDS.priorityPoints + widening})`);
    }
  }
  if (channels.total === 0) problems.push('no tickets');
  const detail = {
    channels: Object.fromEntries(Object.keys(facts.channels).map((key) => [key, round(channels.share(key))])),
    priorities: Object.fromEntries(Object.keys(facts.priorities).map((key) => [key, round(priorities.share(key))])),
  };
  return problems.length > 0 ? result('V5', 'fail', `mix out of band: ${problems.join('; ')}`, detail) : result('V5', 'pass', 'channel and priority mix within band', detail);
}

export function checkPersonas(facts: Pick<VerifyFacts, 'personas'>): CheckResult {
  const problems: string[] = [];
  for (const persona of DEMO_PERSONAS) {
    const found = facts.personas.find((candidate) => candidate.key === persona.key);
    if (!found || !found.exists) {
      problems.push(`${persona.name} does not exist`);
      continue;
    }
    if (!found.active) problems.push(`${persona.name} is not active`);
    const want = [...persona.roles].sort().join(', ');
    const have = [...found.roles].sort().join(', ');
    if (want !== have) problems.push(`${persona.name} holds ${have || 'no roles'}, not exactly ${want}`);
    if (persona.team?.lead && !found.leads.includes(persona.team.key)) problems.push(`${persona.name} is not a lead member of ${persona.team.key}`);
  }
  return problems.length > 0 ? result('V6', 'fail', problems.join('; ')) : result('V6', 'pass', 'the three personas exist, active, with exactly their roles');
}

function multiset(items: readonly { readonly subject: string; readonly approver: string }[]): string[] {
  return items.map((item) => `${item.subject} → ${item.approver}`).sort();
}

export function checkStory(
  facts: Pick<VerifyFacts, 'openMajorIncidents' | 'pendingApprovals' | 'heroes' | 'warrantiesWithin30Days'>,
  plan: Pick<DemoPlan, 'expectations'>,
): CheckResult {
  const expected = plan.expectations;
  const problems: string[] = [];
  // One open major incident, the live one, in the state its mode puts it in.
  if (facts.openMajorIncidents.length !== 1) problems.push(`${facts.openMajorIncidents.length} open major incidents, expected 1`);
  else if (facts.openMajorIncidents[0]!.state !== expected.liveIncidentState) {
    problems.push(`the live major incident is ${facts.openMajorIncidents[0]!.state}, expected ${expected.liveIncidentState}`);
  }
  // The pending approvals, exactly, with their approvers (A4 §1.9.5).
  const want = multiset(expected.pendingApprovals);
  const have = multiset(facts.pendingApprovals);
  if (want.join('|') !== have.join('|')) {
    const missing = want.filter((item) => !have.includes(item));
    const extra = have.filter((item) => !want.includes(item));
    problems.push(`pending approvals differ${missing.length ? `; missing ${missing.join(', ')}` : ''}${extra.length ? `; unexpected ${extra.join(', ')}` : ''}`);
  }
  // Every hero, in its state and team; every Service Desk hero in service-desk (R8, X-B2).
  const heroes = new Map(facts.heroes.map((hero) => [hero.ref, hero]));
  for (const hero of expected.heroes) {
    const found = heroes.get(hero.ref);
    if (!found) problems.push(`hero ${hero.key} is missing`);
    else {
      if (found.status !== hero.status) problems.push(`hero ${hero.key} is ${found.status}, expected ${hero.status}`);
      if (found.team !== hero.team) problems.push(`hero ${hero.key} is in ${found.team ?? 'no team'}, expected ${hero.team}`);
    }
  }
  for (const key of DEMO_SD_HEROES) {
    const found = heroes.get(demoHeroRef(key));
    if (found && found.team !== 'service-desk') problems.push(`Service Desk hero ${key} is in ${found.team ?? 'no team'}`);
  }
  if (facts.warrantiesWithin30Days !== expected.warrantiesWithin30Days) {
    problems.push(`${facts.warrantiesWithin30Days} warranties end within 30 days, expected ${expected.warrantiesWithin30Days}`);
  }
  return problems.length > 0 ? result('V7', 'fail', problems.join('; ')) : result('V7', 'pass', 'the story is in place: the live incident, the approvals, every hero, the warranties');
}

export function checkInvariants(
  facts: Pick<VerifyFacts, 'cancelledWithApproval' | 'pendingApprovalOutsidePendingStatus' | 'runningTimersDueWithin10Min' | 'publishedFormsWithRequiredFileField'>,
): CheckResult {
  const problems: string[] = [];
  if (facts.cancelledWithApproval > 0) problems.push(`${facts.cancelledWithApproval} cancelled ticket(s) with an approval`);
  if (facts.pendingApprovalOutsidePendingStatus > 0) problems.push(`${facts.pendingApprovalOutsidePendingStatus} pending approval(s) on a ticket not waiting for one`);
  if (facts.runningTimersDueWithin10Min > 0) problems.push(`${facts.runningTimersDueWithin10Min} running timer(s) due within ten minutes of T0`);
  if (facts.publishedFormsWithRequiredFileField > 0) problems.push(`${facts.publishedFormsWithRequiredFileField} published form(s) with a required file field`);
  return problems.length > 0 ? result('V8', 'fail', problems.join('; ')) : result('V8', 'pass', 'invariants hold');
}

export function checkQuiet(facts: Pick<VerifyFacts, 'publishedOutboxRows' | 'quietRefusals'>): CheckResult {
  const problems: string[] = [];
  if (facts.publishedOutboxRows > 0) problems.push(`${facts.publishedOutboxRows} outbox row(s) were published while seeding`);
  const refused = facts.quietRefusals.after - facts.quietRefusals.before;
  if (refused !== 0) problems.push(`${refused} enqueue(s) were refused for the quiet tenant`);
  return problems.length > 0 ? result('V9', 'fail', problems.join('; '), { refused }) : result('V9', 'pass', 'the tenant stayed quiet');
}

export function checkContent(facts: Pick<VerifyFacts, 'descriptionsWithBraces'>): CheckResult {
  const found = facts.descriptionsWithBraces;
  return found.length > 0
    ? result('V10', 'fail', `${found.length} description(s) contain a brace, e.g. ${found.slice(0, 3).join(', ')}`, { refs: found.slice(0, 20) })
    : result('V10', 'pass', 'no unfilled slot in any description');
}

/** Every check, in order. Fails stop the swap; V2 only ever warns. */
export function verifyGeneration(facts: VerifyFacts, plan: Pick<DemoPlan, 'tickets' | 'expectations'>, options: VerifyOptions): VerifyReport {
  const checks: CheckResult[] = [
    checkDrift(facts),
    checkReplay(facts, plan),
    checkAttainment(facts, options),
    checkCsat(facts, options),
    checkMix(facts, options),
    checkPersonas(facts),
    checkStory(facts, plan),
    checkInvariants(facts),
    checkQuiet(facts),
    checkContent(facts),
  ];
  const failed = checks.filter((check) => check.outcome === 'fail').map((check) => check.id);
  const warned = checks.filter((check) => check.outcome === 'warn').map((check) => check.id);
  return { ok: failed.length === 0, checks, failed, warned };
}

/* ------------------------------------------------------------------ The plan's own facts */

/**
 * The facts a perfect build of this plan would read back: what the planner
 * promises, in the checks' own terms. The planner's tests hold every plan to
 * V3–V5, V8 and V10 through this before anything is written
 * (`plan-bands.test.ts`), and an orchestrator can log it beside the real
 * facts when a check fails, to say whether the plan or the write went wrong.
 */
export function planFacts(plan: DemoPlan): VerifyFacts {
  const counts = <K extends string>(keys: (ticket: DemoPlan['tickets'][number]) => K): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const ticket of plan.tickets) out[keys(ticket)] = (out[keys(ticket)] ?? 0) + 1;
    return out;
  };
  const byRef = new Map(plan.tickets.map((ticket) => [ticket.ref, ticket]));
  const approvalsOn = (status: (ref: string) => string | undefined) =>
    plan.approvals.filter((approval) => approval.subject.kind === 'ticket').map((approval) => ({ approval, status: status((approval.subject as { ref: string }).ref) }));
  const ticketApprovals = approvalsOn((ref) => byRef.get(ref)?.status);
  const t0 = plan.anchor;
  const people = new Map(plan.people.map((person) => [person.key, person]));
  const live = plan.majorIncidents.filter((incident) => incident.state !== 'resolved' && incident.state !== 'closed');
  return {
    drift: { expected: plan.tickets.length, actual: plan.tickets.length, breached: false },
    replay: plan.tickets.flatMap((ticket) => TARGET_TYPES.map((target) => ({ ref: ticket.ref, target, verdict: ticket.sla.verdicts[target] }))),
    attainment: plan.expectations.attainment30d,
    csat: plan.expectations.csat30d,
    channels: counts((ticket) => ticket.channel),
    priorities: counts((ticket) => ticket.priority),
    personas: DEMO_PERSONAS.map((persona) => {
      const person = plan.people.find((candidate) => candidate.email === persona.email);
      return {
        key: persona.key,
        exists: person !== undefined,
        active: person !== undefined,
        roles: person?.roles ?? [],
        leads: plan.teams.filter((team) => person && team.lead === person.key).map((team) => team.key),
      };
    }),
    openMajorIncidents: live.map((incident) => ({ number: `MI-${String(incident.number).padStart(4, '0')}`, state: incident.state })),
    pendingApprovals: plan.approvals
      .filter((approval) => approval.outcome === 'pending')
      .map((approval) => ({
        subject: approval.subject.kind === 'ticket' ? approval.subject.ref : `CHG-${approval.subject.number}`,
        approver: people.get(approval.approver)?.key ?? approval.approver,
      })),
    heroes: plan.tickets.filter((ticket) => ticket.hero).map((ticket) => ({ ref: ticket.ref, status: ticket.status, team: ticket.team })),
    warrantiesWithin30Days: plan.assets.expiringWarranties.length,
    cancelledWithApproval: ticketApprovals.filter((entry) => entry.status === 'cancelled').length,
    pendingApprovalOutsidePendingStatus: ticketApprovals.filter((entry) => entry.approval.outcome === 'pending' && entry.status !== 'pending_approval').length,
    runningTimersDueWithin10Min: plan.tickets.filter((ticket) =>
      Object.values(ticket.sla.dueAt).some((due) => due !== undefined && due >= t0 && due <= t0 + 10 * 60_000),
    ).length,
    publishedFormsWithRequiredFileField: 0,
    publishedOutboxRows: 0,
    quietRefusals: { before: 0, after: 0 },
    descriptionsWithBraces: plan.tickets.filter((ticket) => /[{}]/.test(ticket.description)).map((ticket) => ticket.ref),
  };
}
