import type { DecisionQuestionScore, DecisionScore } from '@itsm/sdk';

/**
 * How the shadow triage page words its numbers (ADR-0051).
 *
 * Pure and separate from the page, like `matrix.ts`, because each of these is
 * a place a number could be shown as something it is not: an accuracy over no
 * answers shown as 0%, a Brier score read the wrong way round, an `auto` gate
 * that has not been earned described as if it nearly had.
 */

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  type: 'Type',
  category: 'Category',
  group: 'Assignment group',
  priority: 'Priority',
  majorIncident: 'Major incident',
};

export function fieldLabel(question: string): string {
  return FIELD_LABELS[question] ?? question;
}

/** One decimal place, and a dash rather than 0% when there is nothing to measure. */
export function asPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
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

const REASONS: Readonly<Record<string, string>> = {
  'not-registered': 'not set up in this deployment',
  'no-decide': 'cannot answer typed questions',
  residency: 'outside this desk’s allowed regions',
  unpriced: 'its model has no price',
  budget: 'the AI budget was spent',
  'circuit-open': 'paused after repeated failures',
  timeout: 'did not answer in time',
  unavailable: 'unavailable',
  refused: 'refused the request',
  'invalid-answer': 'answered with nothing usable',
};

/** `jev:not-registered` → `jev — not set up in this deployment`. */
export function skipLabel(key: string): string {
  const [provider = key, reason = ''] = key.split(':');
  return `${provider} — ${REASONS[reason] ?? reason}`;
}

/** The skips, most frequent first, for a table. */
export function skipRows(skips: DecisionScore['skips']): { key: string; label: string; count: number }[] {
  return Object.entries(skips)
    .map(([key, count]) => ({ key, label: skipLabel(key), count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export interface CalibrationRow {
  band: string;
  cells: Record<string, string>;
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
    band: `${Math.round(band.from * 100)}–${Math.round(band.to * 100)}%`,
    cells: Object.fromEntries(
      questions.map((question) => {
        const cell = question.calibration[index];
        return [question.question, cell && cell.count > 0 ? `${asPercent(cell.accuracy)} of ${cell.count}` : '—'];
      }),
    ),
  }));
}

/** Whether the desk has anything to look at yet, and if not, why. */
export function modeNotice(score: Pick<DecisionScore, 'mode' | 'decisions'>): string | null {
  if (score.mode === 'off') {
    return 'AI triage is off for this desk. Turn on the ai.decision.triage flag and set ai.decision.triage.mode to shadow under Configuration.';
  }
  if (score.decisions === 0) {
    return `AI triage is in ${score.mode} mode. Nothing has been decided yet: it runs on new email, chat, voice and portal tickets.`;
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
      ? `AI triage is in auto mode and sets ${earned.join(' and ')} on new tickets where it is empty.`
      : 'AI triage is in auto mode, but no field has earned it yet, so it only suggests.';
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

/** The last time `auto` withdrew itself, said once, at the top of the page. */
export function lastStepDownText(notice: DecisionScore['lastStepDown']): string | null {
  if (!notice) return null;
  const when = new Date(notice.at).toISOString().slice(0, 10);
  return `On ${when} auto switched itself back to suggest: agents corrected ${notice.overridden} of the last ${notice.window} tickets it had changed. Administrators were told by email.`;
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
    'Switching ai.decision.triage.mode to auto lets the AI set category and team by itself on new tickets where they are empty, ' +
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
  const shown = score.questions.filter((question) => ['type', 'category', 'group', 'priority'].includes(question.question));
  const figures = shown
    .filter((question) => question.scored > 0)
    .map((question) => `${fieldLabel(question.question).toLowerCase()} ${asPercent(question.accuracy)}`);
  const evidence =
    figures.length > 0
      ? `Right so far on resolved tickets: ${figures.join(', ')}.`
      : 'Nothing has been scored yet, so there is no accuracy to judge by.';
  return (
    `Switching ai.decision.triage.mode to suggest shows agents every answer at or above ${Math.round(score.thresholds.suggest * 100)}% ` +
    `confidence, to accept or dismiss. ${evidence}`
  );
}
