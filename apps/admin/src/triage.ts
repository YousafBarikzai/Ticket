import type { AiBudget, DecisionQuestionScore, DecisionScore } from '@itsm/sdk';

/**
 * How the AI triage pages word their numbers, and what the mode control may
 * do (ADR-0051; SPEC §6.1 `/ai-triage/**`, X-31).
 *
 * Pure and separate from the pages, like `matrix.ts`, because each of these is
 * a place a number could be shown as something it is not: an accuracy over no
 * answers shown as 0%, a Brier score read the wrong way round, an `auto` gate
 * that has not been earned described as if it nearly had — and, since the
 * mode became a real control here, a switch that says it turned something on
 * when the tenant-wide AI switch is off.
 *
 * The backend owns the rules. `auto` may be chosen at any time, because
 * choosing it is not what lets an answer act: each allow-listed field is
 * applied only once this desk's own record has earned it, checked on every
 * decision, and `auto` steps itself back to `suggest` when people correct too
 * much of what it set. The words here describe those rules; they never add one.
 */

/* =========================================================================
 * Fields, numbers, gates
 * ====================================================================== */

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  type: 'Type',
  category: 'Category',
  group: 'Team',
  priority: 'Priority',
  majorIncident: 'Major incident',
};

export function fieldLabel(question: string): string {
  return FIELD_LABELS[question] ?? question;
}

/** The fields an agent is shown an answer for in `suggest` (major incident is a warning, not an answer to accept). */
export const SUGGESTED_FIELDS: readonly string[] = ['type', 'category', 'group', 'priority'];

/** The order a desk reads a ticket's fields in; anything new goes after them, by name. */
export const FIELD_ORDER: readonly string[] = ['type', 'category', 'group', 'priority', 'majorIncident'];

export function byFieldOrder(a: string, b: string): number {
  const ia = FIELD_ORDER.indexOf(a);
  const ib = FIELD_ORDER.indexOf(b);
  return (ia < 0 ? FIELD_ORDER.length : ia) - (ib < 0 ? FIELD_ORDER.length : ib) || a.localeCompare(b);
}

/** One decimal place, and a dash rather than 0% when there is nothing to measure. */
export function asPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

/** Whole percent, for sentences: "right 92% of the time". */
function wholePercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * The Brier score, with which way is good said out loud. Lower is better, and
 * 0.25 is what always answering "50% sure" earns — so a figure above it is
 * worse than a coin that knows it is a coin.
 */
export function brierText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const figure = value.toFixed(3);
  return value > 0.25 ? `${figure} (worse than guessing)` : figure;
}

/** What the `auto` gate says about one field, in words an administrator acts on. */
export function gateText(question: DecisionQuestionScore): string {
  const gate = question.autoGate;
  if (!gate) return 'Never applied without a person';
  if (gate.eligible) return `Earned — ${gate.reason}`;
  return `Not yet — ${gate.reason}`;
}

/**
 * How many more confident, scored answers a field needs before its gate is
 * even considered — read from the gate's own reason ("4 scored answers at or
 * above 0.9; 200 are needed"), so the number is the backend's and never a
 * copy of it. Null once the minimum is met (agreement decides then) or when
 * the reason says nothing about it.
 */
export function gateNeeds(gate: NonNullable<DecisionQuestionScore['autoGate']>): number | null {
  if (gate.eligible) return null;
  const needed = /(\d+) are needed/.exec(gate.reason);
  if (!needed) return null;
  const missing = Number(needed[1]) - gate.considered;
  return missing > 0 ? missing : null;
}

/** The gate in a few words, for a chart row or a readiness line. */
export function gateShort(question: DecisionQuestionScore): string {
  const gate = question.autoGate;
  if (!gate) return 'Never without a person';
  if (gate.eligible) return 'Earned';
  const needs = gateNeeds(gate);
  if (needs !== null) return `Not yet (needs ${needs} more)`;
  if (gate.agreement !== null) return `Not yet (${asPercent(gate.agreement)} agreement)`;
  return 'Not yet';
}

/* =========================================================================
 * Providers and why they were passed over
 * ====================================================================== */

/**
 * Providers by the names people know them by. Provider names, never model
 * names: which version answered is on the decision record, and it is not
 * something an administrator chooses here.
 */
export const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  jev: 'JEV',
  anthropic: 'Claude',
  stub: 'Test provider',
  rules: 'Rules',
};

export function providerLabel(key: string): string {
  return PROVIDER_LABELS[key] ?? key;
}

/** Who answers first, in a sentence (the chain's first provider this deployment can ask). */
export function leadText(gateProvider: string | null): string {
  if (gateProvider === null) {
    return 'No provider can answer in this deployment, so every new ticket keeps what intake gave it.';
  }
  return `${providerLabel(gateProvider)} answers first. When it can’t, the ticket keeps what intake gave it.`;
}

const REASONS: Readonly<Record<string, string>> = {
  'not-registered': 'not set up in this deployment',
  'no-decide': 'cannot answer typed questions',
  residency: 'outside this workspace’s allowed regions',
  unpriced: 'has no price set, so its spend couldn’t be counted',
  budget: 'the AI budget was spent',
  'circuit-open': 'paused after repeated failures',
  timeout: 'did not answer in time',
  unavailable: 'unavailable',
  refused: 'refused the request',
  'invalid-answer': 'answered with nothing usable',
};

export function reasonLabel(reason: string | null): string {
  if (!reason) return '';
  return REASONS[reason] ?? reason.replace(/-/g, ' ');
}

/** `jev:not-registered` → `JEV — not set up in this deployment`. */
export function skipLabel(key: string): string {
  const [provider = key, reason = ''] = key.split(':');
  return `${providerLabel(provider)} — ${reasonLabel(reason)}`;
}

/** The skips, most frequent first, for a table. */
export function skipRows(skips: DecisionScore['skips']): { key: string; label: string; count: number }[] {
  return Object.entries(skips)
    .map(([key, count]) => ({ key, label: skipLabel(key), count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Whether the record shows a provider passed over for residency — the one skip a tenant's contract causes. */
export function residencySkips(skips: DecisionScore['skips']): number {
  return Object.entries(skips)
    .filter(([key]) => key.endsWith(':residency'))
    .reduce((sum, [, count]) => sum + count, 0);
}

/* =========================================================================
 * Calibration
 * ====================================================================== */

export interface CalibrationRow {
  band: string;
  cells: Record<string, string>;
}

/** "90–100%": a confidence band's name. */
export function bandLabel(band: { from: number; to: number }): string {
  return `${Math.round(band.from * 100)}–${Math.round(band.to * 100)}%`;
}

/**
 * One row per confidence band, one column per field: "how often was it right
 * when it said it was this sure". A band with no answers says so rather than
 * showing a percentage of nothing.
 */
export function calibrationRows(questions: readonly DecisionQuestionScore[]): CalibrationRow[] {
  const first = questions[0];
  if (!first) return [];
  return first.calibration.map((band, index) => ({
    band: bandLabel(band),
    cells: Object.fromEntries(
      questions.map((question) => {
        const cell = question.calibration[index];
        return [question.question, cell && cell.count > 0 ? `${asPercent(cell.accuracy)} of ${cell.count}` : '—'];
      }),
    ),
  }));
}

/**
 * The reliability chart's lines: for each field with anything scored, how
 * often it was right in each band (a gap where the band is empty), and the
 * diagonal a perfectly calibrated answer would follow — each band's midpoint.
 */
export function calibrationSeries(
  questions: readonly DecisionQuestionScore[],
): { readonly bands: readonly string[]; readonly series: readonly { id: string; label: string; reference?: boolean; points: { x: string; y: number | null }[] }[] } {
  // The fields agents are shown, in the desk's order: four lines and the diagonal stay readable, and a
  // yes-or-no warning answered at one confidence says little about calibration.
  const scored = questions
    .filter((question) => SUGGESTED_FIELDS.includes(question.question) && question.scored > 0 && question.calibration.length > 0)
    .sort((a, b) => byFieldOrder(a.question, b.question));
  const first = scored[0];
  if (!first) return { bands: [], series: [] };
  const bands = first.calibration.map(bandLabel);
  const ideal = {
    id: 'ideal',
    label: 'Perfectly calibrated',
    reference: true,
    points: first.calibration.map((band) => ({ x: bandLabel(band), y: Math.round(((band.from + band.to) / 2) * 1000) / 1000 })),
  };
  const lines = scored.map((question) => ({
    id: question.question,
    label: fieldLabel(question.question),
    points: question.calibration.map((band) => ({ x: bandLabel(band), y: band.count > 0 ? band.accuracy : null })),
  }));
  return { bands, series: [ideal, ...lines] };
}

/* =========================================================================
 * Modes
 * ====================================================================== */

export type TriageMode = 'off' | 'shadow' | 'suggest' | 'auto';

export const TRIAGE_MODES: readonly TriageMode[] = ['off', 'shadow', 'suggest', 'auto'];

export const MODE_LABELS: Readonly<Record<TriageMode, string>> = {
  off: 'Off',
  shadow: 'Shadow',
  suggest: 'Suggest',
  auto: 'Auto',
};

/** What each mode does, in one sentence each (the backend's own description, in the desk's words). */
export const MODE_SENTENCES: Readonly<Record<TriageMode, string>> = {
  off: 'Nothing is sent anywhere. New tickets keep what intake gives them.',
  shadow: 'The AI decides each new ticket’s triage and records it. Agents see nothing and nothing on the ticket changes; each answer is scored when the ticket is resolved.',
  suggest: 'Agents see confident answers on the ticket and accept or dismiss each one. Nothing changes until they do.',
  auto: 'The AI also sets category and team on new tickets where they’re empty — each field only once it has earned it here — and switches itself back to Suggest if agents correct too many.',
};

export function asMode(value: unknown): TriageMode {
  return typeof value === 'string' && (TRIAGE_MODES as readonly string[]).includes(value) ? (value as TriageMode) : 'off';
}

/** Whether the desk has anything to look at yet, and if not, why. */
export function modeNotice(score: Pick<DecisionScore, 'mode' | 'decisions'>): string | null {
  if (score.mode === 'off') {
    return 'AI triage is off. Start in Shadow — it suggests nothing to agents and scores itself against their choices.';
  }
  if (score.decisions === 0) {
    return `AI triage is in ${MODE_LABELS[asMode(score.mode)]}. Nothing has been decided yet: it runs on new tickets that arrive by email, the portal, chat and phone.`;
  }
  return null;
}

/** What `auto` is doing field by field, in words: which fields it sets and which it only suggests. */
export function autoNotice(score: Pick<DecisionScore, 'mode' | 'questions'>): string | null {
  if (score.mode !== 'auto') return null;
  const gated = score.questions.filter((question) => question.autoGate !== null);
  const earned = gated.filter((question) => question.autoGate!.eligible).map((question) => fieldLabel(question.question).toLowerCase());
  const waiting = gated.filter((question) => !question.autoGate!.eligible).map((question) => fieldLabel(question.question).toLowerCase());
  const sets =
    earned.length > 0
      ? `AI triage is in Auto and sets ${earned.join(' and ')} on new tickets where it is empty.`
      : 'AI triage is in Auto, but no field has earned it yet, so it only suggests.';
  const suggests = waiting.length > 0 ? ` ${capitalise(waiting.join(' and '))} is suggested until it has earned it.` : '';
  return `${sets}${suggests} Everything else — type, priority, major incident — is always only suggested.`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The step-down meter: how close `auto` is to switching itself back to
 * `suggest`. Shown whenever the AI has set anything, in any mode, because
 * a desk that stepped down will want to see the number go down again.
 */
export function stepDownText(stepDown: DecisionScore['stepDown']): string | null {
  if (stepDown.considered === 0) return null;
  const limit = `${Math.round(stepDown.limit * 100)}%`;
  const rate = asPercent(stepDown.rate);
  const sample =
    stepDown.considered < stepDown.window
      ? ` It only acts on a full ${stepDown.window}, so this is not yet enough to step down on.`
      : '';
  return (
    `Agents corrected ${stepDown.overridden} of the last ${stepDown.considered} tickets the AI changed by itself (${rate}). ` +
    `Above ${limit} of the last ${stepDown.window}, auto switches itself back to suggest.${sample}`
  );
}

/**
 * The last time `auto` withdrew itself, said once, at the top of the page.
 * The date is the ISO day unless the page passes the reader's locale and zone.
 */
export function lastStepDownText(
  notice: DecisionScore['lastStepDown'],
  format?: { readonly locale: string; readonly timeZone: string },
): string | null {
  if (!notice) return null;
  const when = format ? formatDay(notice.at, format) : new Date(notice.at).toISOString().slice(0, 10);
  return `On ${when} auto switched itself back to suggest: agents corrected ${notice.overridden} of the last ${notice.window} tickets it had changed. Administrators were told by email.`;
}

function formatDay(at: string, { locale, timeZone }: { readonly locale: string; readonly timeZone: string }): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/** What the AI set by itself for a field, and how much of it people changed. */
export function appliedText(question: DecisionQuestionScore): string {
  const { applied, overridden } = question.applied;
  if (applied === 0) return '—';
  return overridden === 0 ? `${applied} set` : `${applied} set, ${overridden} corrected`;
}

/** How often agents took a field's suggestion, when they have seen any. */
export function acceptanceText(question: DecisionQuestionScore): string {
  const { accepted, dismissed } = question.responses;
  const total = accepted + dismissed;
  if (total === 0) return '—';
  return `${accepted} of ${total} accepted`;
}

/** Accepted suggestions over every field agents answered, or null before they have answered any. */
export function acceptedShare(questions: readonly Pick<DecisionQuestionScore, 'responses'>[]): { accepted: number; total: number; rate: number | null } {
  let accepted = 0;
  let total = 0;
  for (const question of questions) {
    accepted += question.responses.accepted;
    total += question.responses.accepted + question.responses.dismissed;
  }
  return { accepted, total, rate: total > 0 ? accepted / total : null };
}

/**
 * What switching to `auto` would do, with the gate beside it. Any time is
 * allowed: a field is set only once it has earned it, so switching early
 * suggests exactly as `suggest` does until then.
 */
export function autoReadiness(score: Pick<DecisionScore, 'mode' | 'questions'>): string | null {
  if (score.mode !== 'suggest') return null;
  const gated = score.questions.filter((question) => question.autoGate !== null);
  const earned = gated.filter((question) => question.autoGate!.eligible).map((question) => fieldLabel(question.question).toLowerCase());
  const evidence =
    earned.length > 0
      ? `${capitalise(earned.join(' and '))} ${earned.length === 1 ? 'has' : 'have'} earned it.`
      : 'No field has earned it yet, so switching now would change nothing until one does.';
  return (
    'Auto lets the AI set category and team by itself on new tickets where they are empty, ' +
    `each only once it has been right 95% of the time over 200 resolved tickets. ${evidence}`
  );
}

/**
 * What switching to `suggest` would put in front of agents, with the evidence
 * beside it. Any time is allowed — a suggestion changes nothing until an
 * agent accepts it — but the choice should be made looking at the numbers.
 */
export function suggestReadiness(score: Pick<DecisionScore, 'mode' | 'questions' | 'thresholds'>): string | null {
  if (score.mode !== 'shadow') return null;
  const shown = score.questions.filter((question) => SUGGESTED_FIELDS.includes(question.question));
  const figures = shown
    .filter((question) => question.scored > 0)
    .map((question) => `${fieldLabel(question.question).toLowerCase()} ${asPercent(question.accuracy)}`);
  const evidence =
    figures.length > 0
      ? `Right so far on resolved tickets: ${figures.join(', ')}.`
      : 'Nothing has been scored yet, so there is no accuracy to judge by.';
  return (
    `Suggest shows agents every answer at or above ${Math.round(score.thresholds.suggest * 100)}% ` +
    `confidence, to accept or dismiss. ${evidence}`
  );
}

/* =========================================================================
 * Readiness: Shadow → Suggest → Auto, as structure
 * ====================================================================== */

export type ReadinessStatus = 'complete' | 'current' | 'upcoming';

export interface ReadinessStep {
  readonly id: 'shadow' | 'suggest' | 'auto';
  readonly label: string;
  readonly status: ReadinessStatus;
  readonly description: string;
}

export interface FieldGate {
  readonly question: string;
  readonly label: string;
  readonly eligible: boolean;
  /** "Earned", "Not yet (needs 150 more)". */
  readonly text: string;
}

export interface Readiness {
  readonly mode: TriageMode;
  /** The evidence behind Suggest: how often the answers agents would see were right. */
  readonly suggest: {
    readonly scored: number;
    readonly accuracy: number | null;
    /** "Right 92% of the time on 140 scored tickets", or why there is nothing to judge by. */
    readonly text: string;
  };
  /** Which fields have earned auto-apply here, one by one. */
  readonly auto: {
    readonly earned: number;
    readonly gated: number;
    readonly fields: readonly FieldGate[];
    /** "1 of 2 fields have earned auto-apply". */
    readonly text: string;
  };
  readonly steps: readonly ReadinessStep[];
}

/**
 * Where the desk is on Shadow → Suggest → Auto and what the record says
 * about the next step — the structured form of `suggestReadiness` and
 * `autoReadiness`, for the Stepper and the mode confirmation.
 *
 * Suggest has no gate in the backend (a suggestion changes nothing until an
 * agent takes it), so its line is evidence, never "ready". Auto's line counts
 * the fields whose gate is earned, from the same gates the next decision
 * checks.
 */
export function readiness(score: Pick<DecisionScore, 'mode' | 'questions' | 'settled'>): Readiness {
  const mode = asMode(score.mode);
  const shown = score.questions.filter((question) => SUGGESTED_FIELDS.includes(question.question) && question.scored > 0 && question.accuracy !== null);
  const answers = shown.reduce((sum, question) => sum + question.scored, 0);
  const right = shown.reduce((sum, question) => sum + (question.accuracy ?? 0) * question.scored, 0);
  const accuracy = answers > 0 ? right / answers : null;
  const suggestText =
    accuracy === null || score.settled === 0
      ? 'Nothing scored yet — answers are scored as their tickets are resolved.'
      : `Right ${wholePercent(accuracy)} of the time on ${score.settled} scored ${score.settled === 1 ? 'ticket' : 'tickets'}`;

  const gated = score.questions.filter((question) => question.autoGate !== null);
  const fields: FieldGate[] = gated.map((question) => ({
    question: question.question,
    label: fieldLabel(question.question),
    eligible: question.autoGate!.eligible,
    text: gateShort(question),
  }));
  const earned = fields.filter((field) => field.eligible).length;
  const autoText =
    fields.length === 0
      ? 'No field has a record here yet'
      : `${earned} of ${fields.length} ${fields.length === 1 ? 'field has' : 'fields have'} earned auto-apply`;

  const order = ['shadow', 'suggest', 'auto'] as const;
  const at = mode === 'off' ? -1 : order.indexOf(mode);
  const status = (index: number): ReadinessStatus => (at < 0 ? 'upcoming' : index < at ? 'complete' : index === at ? 'current' : 'upcoming');
  const steps: ReadinessStep[] = [
    { id: 'shadow', label: 'Shadow', status: status(0), description: 'Records and scores; changes nothing' },
    { id: 'suggest', label: 'Suggest', status: status(1), description: suggestText },
    { id: 'auto', label: 'Auto', status: status(2), description: autoText },
  ];

  return {
    mode,
    suggest: { scored: score.settled, accuracy, text: suggestText },
    auto: { earned, gated: fields.length, fields, text: autoText },
    steps,
  };
}

/* =========================================================================
 * The mode control: what Apply writes, in which order
 * ====================================================================== */

/**
 * What the page knows about the three switches behind the mode. The
 * effective mode is the API's (`score.mode`); the parts are null when this
 * person cannot read settings, in which case the plan writes both.
 */
export interface ModeState {
  /** The tenant-wide AI kill switch (`ai.enabled`). */
  readonly aiEnabled: boolean | null;
  /** The triage switch (`ai.decision.triage`). */
  readonly flag: boolean | null;
  /** The stored mode setting (`ai.decision.triage.mode`). */
  readonly stored: TriageMode | null;
  /** What decisions actually do now: off if any of the three says so. */
  readonly effective: TriageMode;
}

export type ModeStep = { readonly kind: 'setting'; readonly value: TriageMode } | { readonly kind: 'flag'; readonly value: true };

export interface ModePlan {
  readonly steps: readonly ModeStep[];
  /** Why Apply cannot get there from this page, when it cannot. */
  readonly blocked?: string;
}

export const AI_OFF_REASON = 'AI is switched off for this whole workspace. Turn it on in Settings › AI first — that switch covers every AI feature, not just triage.';

/**
 * The writes that take the desk from where it is to `target`.
 *
 * - **Off** writes the mode setting only. The triage switch is left alone:
 *   it is the kill switch, and turning triage off here should not also
 *   change it.
 * - **Shadow, Suggest, Auto** write the mode *first*, then turn the triage
 *   switch on if it is off — in that order, so a desk whose stored mode was
 *   Auto never runs in Auto for a moment on its way to Shadow.
 * - The tenant-wide AI switch is never turned on from here: it covers every
 *   AI feature, so the plan says where to change it instead.
 */
export function modePlan(state: ModeState, target: TriageMode): ModePlan {
  if (target === 'off') return { steps: state.stored === 'off' ? [] : [{ kind: 'setting', value: 'off' }] };
  if (state.aiEnabled === false) return { steps: [], blocked: AI_OFF_REASON };
  const steps: ModeStep[] = [];
  if (state.stored !== target) steps.push({ kind: 'setting', value: target });
  if (state.flag !== true) steps.push({ kind: 'flag', value: true });
  // Both parts already say `target` and still the desk is not in it: only the
  // tenant-wide switch is left, and that one is not this page's to turn.
  if (steps.length === 0 && state.effective !== target) return { steps: [], blocked: AI_OFF_REASON };
  return { steps };
}

/* =========================================================================
 * The AI budget
 * ====================================================================== */

const MICROS_PER_POUND = 100_000_000;

/** This month's spend and lines in pounds, for a `Meter`. */
export function budgetFigures(budget: Pick<AiBudget, 'spentMicros' | 'limitPence' | 'warnPence'>): {
  readonly spent: number;
  readonly limit: number | null;
  readonly warn: number | null;
} {
  const micros = Number(budget.spentMicros);
  return {
    spent: Number.isFinite(micros) ? micros / MICROS_PER_POUND : 0,
    limit: budget.limitPence === null ? null : budget.limitPence / 100,
    warn: budget.warnPence === null ? null : budget.warnPence / 100,
  };
}

/**
 * A pounds figure typed into the budget dialog, as whole pence: empty is "no
 * line" (null), anything that is not a non-negative amount is `invalid`.
 */
export function penceFrom(text: string): number | null | 'invalid' {
  const value = text.trim().replace(/^£/, '').replace(/,/g, '');
  if (value === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return 'invalid';
  const pence = Math.round(Number(value) * 100);
  return pence > 10_000_000 ? 'invalid' : pence;
}

/** The API's own rule, said before the request: a warning above the cap would never be reached. */
export function budgetProblem(limitPence: number | null, warnPence: number | null): { field: 'limit' | 'warn'; message: string } | null {
  if (warnPence !== null && limitPence !== null && warnPence > limitPence) {
    return { field: 'warn', message: 'Warn at an amount no higher than the monthly cap — a warning above it would never be reached.' };
  }
  return null;
}
