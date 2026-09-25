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

/** How often agents took a field's suggestion, when they have seen any. */
export function acceptanceText(question: DecisionQuestionScore): string {
  const { accepted, dismissed } = question.responses;
  const total = accepted + dismissed;
  if (total === 0) return '—';
  return `${accepted} of ${total} accepted`;
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
