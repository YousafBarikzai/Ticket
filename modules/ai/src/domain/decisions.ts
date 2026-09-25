import type { Decision, DecisionAnswer, DecisionQuestion, DecisionValue } from '../providers/types.js';

/**
 * Structured decisions (ADR-0051): the second kind of AI call.
 *
 * A generation writes prose for a person to read. A decision answers typed
 * questions — one of a closed list, a number in a range, yes or no — with a
 * confidence for each, and every answer can later be scored against the value
 * a person settled on. That second property is the whole reason a decision may
 * ever act without a person, and why everything here is pure: the rules about
 * when it may are thresholds and arithmetic, and they are worth testing
 * without a provider, a database or a clock.
 */

/** A closed catalogue, like capabilities. A new purpose is a code change and a review. */
export const DECISION_PURPOSES = ['triage'] as const;
export type DecisionPurpose = (typeof DECISION_PURPOSES)[number];

export function isDecisionPurpose(value: string): value is DecisionPurpose {
  return (DECISION_PURPOSES as readonly string[]).includes(value);
}

/**
 * What a tenant has asked a purpose to do.
 *
 * - `off`     — nothing is sent anywhere.
 * - `shadow`  — decide and record; change nothing, show nothing.
 * - `suggest` — confident answers become advisory suggestions (ADR-0006).
 * - `auto`    — the most confident answers to allow-listed fields are applied.
 */
export const DECISION_MODES = ['off', 'shadow', 'suggest', 'auto'] as const;
export type DecisionMode = (typeof DECISION_MODES)[number];

/**
 * The modes a tenant can select in this release.
 *
 * `auto` exists in the vocabulary, the policy and the record so that nothing
 * about it is a schema change later — but nothing applies an answer without a
 * person yet, so offering it would be offering a setting that does nothing.
 * `suggest` shows answers to agents, who accept or dismiss each one; it may be
 * chosen at any time, because a suggestion changes nothing until a person
 * acts on it, and the AI triage page shows the accuracy beside the choice.
 */
export const SELECTABLE_MODES = ['off', 'shadow', 'suggest'] as const satisfies readonly DecisionMode[];

/**
 * What an agent may do with each triage answer in `suggest` mode.
 *
 * - `apply`   — Accept sets the field, as the agent's own change.
 * - `info`    — shown, and dismissable, but there is nothing to apply: a
 *               ticket's type is fixed when it is raised.
 * - `warning` — shown as a warning with a way to the right screen, never
 *               applied: declaring a major incident pages people, and that is
 *               not a one-click decision (ADR-0051).
 */
export type SuggestionKind = 'apply' | 'info' | 'warning';

export const SUGGESTION_KINDS: Readonly<Record<string, SuggestionKind>> = {
  category: 'apply',
  group: 'apply',
  priority: 'apply',
  type: 'info',
  majorIncident: 'warning',
};

export interface PendingSuggestion {
  question: string;
  field: string | null;
  kind: SuggestionKind;
  /** What would be set: an id for category and group, the value otherwise. */
  value: string | number | boolean;
  /** What the provider picked, for a person to read. */
  display: string;
  confidence: number;
}

export interface PendingInput {
  plan: readonly { question: string; field: string | null; action: PlannedAction }[];
  answers: Readonly<Record<string, { value: unknown; confidence: number }>>;
  proposed: Readonly<Record<string, string | number | boolean | null>>;
  /** The ticket's fields when the decision was made. */
  baseline: Readonly<Record<string, unknown>>;
  /** The ticket's fields now. */
  current: Readonly<Record<string, unknown>>;
  /** Questions a person has already accepted or dismissed. */
  responded: ReadonlySet<string>;
}

/**
 * The suggestions still worth showing on a ticket.
 *
 * A suggestion disappears once somebody has accepted or dismissed it, once the
 * ticket already has that value, and once a person has changed the field
 * since the decision was made — at that point the desk has decided, and an
 * answer arguing with it is noise. A major-incident answer is shown only when
 * it says yes: "this is not a major incident" is not something to act on.
 */
export function pendingSuggestions(input: PendingInput): PendingSuggestion[] {
  const out: PendingSuggestion[] = [];
  for (const entry of input.plan) {
    if (entry.action !== 'suggest') continue;
    if (input.responded.has(entry.question)) continue;
    const kind = SUGGESTION_KINDS[entry.question];
    if (!kind) continue;
    const answer = input.answers[entry.question];
    const value = input.proposed[entry.question];
    if (!answer || value === null || value === undefined) continue;
    if (kind === 'warning' && value !== true) continue;
    if (entry.field !== null) {
      if (input.current[entry.field] === value) continue;
      if (input.current[entry.field] !== input.baseline[entry.field]) continue;
    }
    out.push({
      question: entry.question,
      field: entry.field,
      kind,
      value,
      display: typeof answer.value === 'string' ? answer.value : String(answer.value),
      confidence: answer.confidence,
    });
  }
  return out;
}

/**
 * The ticket fields a decision may ever change without a person (ADR-0051).
 *
 * Routing facts only: a wrong one costs a re-route, and the people working the
 * queue correct them routinely. `categoryId` covers category and subcategory,
 * which are one tree. Priority, impact, urgency, major incident, escalation and
 * status are not here and are not a threshold away from being here: adding one
 * is an ADR with its own shadow evidence.
 */
export const AUTO_APPLY_FIELDS = ['type', 'categoryId', 'groupId'] as const;
export type AutoApplyField = (typeof AUTO_APPLY_FIELDS)[number];

export function isAutoApplyField(field: string): field is AutoApplyField {
  return (AUTO_APPLY_FIELDS as readonly string[]).includes(field);
}

export interface Thresholds {
  /** At or above: an allow-listed field may be applied, in `auto` mode. */
  auto: number;
  /** At or above: an answer is worth showing a person, in `suggest` or `auto` mode. */
  suggest: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { auto: 0.9, suggest: 0.6 };

/**
 * Checked before thresholds are saved.
 *
 * A suggest line above the auto line would mean an answer confident enough to
 * apply was not confident enough to show, which is a setting nobody meant.
 */
export function problemWithThresholds(thresholds: Thresholds): string | null {
  for (const [name, value] of Object.entries(thresholds)) {
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      return `the ${name} threshold must be above 0 and at most 1; it is ${value}`;
    }
  }
  if (thresholds.suggest > thresholds.auto) {
    return `the suggest threshold (${thresholds.suggest}) is above the auto threshold (${thresholds.auto}), so an answer could be applied without ever being confident enough to show`;
  }
  return null;
}

/** Where an answer lands on the ticket, if anywhere. */
export interface QuestionBinding {
  /** The ticket field it answers, or null when it informs a person and sets nothing. */
  readonly field: string | null;
}

export interface DecisionPurposeDefinition {
  readonly key: DecisionPurpose;
  readonly name: string;
  readonly description: string;
  /** The per-tenant kill switch. */
  readonly flagKey: string;
  /** The per-tenant mode. */
  readonly modeSetting: string;
  /**
   * Recorded on every decision, so a change to the questions is visible in
   * the record and scoring never mixes two sets of questions.
   */
  readonly questionSetVersion: number;
  /**
   * Who is asked, in order. A provider that is not registered in this
   * deployment is skipped and the skip recorded. `rules` is always the last
   * link and is never listed: it is what happens when nobody answers.
   */
  readonly chain: readonly string[];
  /**
   * How long each provider gets, in milliseconds. A decision engine answers in
   * a fraction of a second or not at all; a general model needs longer, and a
   * decision is only worth having while the ticket is still new.
   */
  readonly timeoutMs: Readonly<Record<string, number>> & { readonly default: number };
  /**
   * The model each provider is asked with, where it is not the provider's
   * default. A product choice rather than an operator's: triage is
   * classification, and the model that suits it is not the one a deployment
   * picked for drafting replies. Used only when the provider offers it; the
   * provider's default otherwise, so a deployment that narrowed its model
   * list still decides rather than failing.
   */
  readonly models: Readonly<Record<string, string>>;
  readonly bindings: Readonly<Record<string, QuestionBinding>>;
}

export const DECISION_CATALOGUE: Readonly<Record<DecisionPurpose, DecisionPurposeDefinition>> = {
  triage: {
    key: 'triage',
    name: 'Triage',
    description: 'Type, category, group and priority for a new ticket, with a confidence for each.',
    flagKey: 'ai.decision.triage',
    modeSetting: 'ai.decision.triage.mode',
    questionSetVersion: 1,
    // The decision engine first when one exists (its adapter waits on its
    // documentation), then the general model, then the stub outside production.
    chain: ['jev', 'anthropic', 'stub'],
    timeoutMs: { default: 20_000, jev: 2_000 },
    // Chosen by the product owner for shadow triage: a strong classifier at
    // about a third of the cost of the drafting model.
    models: { anthropic: 'claude-sonnet-5' },
    bindings: {
      type: { field: 'type' },
      category: { field: 'categoryId' },
      group: { field: 'groupId' },
      priority: { field: 'priority' },
      majorIncident: { field: null },
    },
  },
};

export function decisionDefinitionFor(purpose: DecisionPurpose): DecisionPurposeDefinition {
  return DECISION_CATALOGUE[purpose];
}

/**
 * The model a provider is asked a purpose's questions with: the purpose's
 * choice when the provider offers it, otherwise the provider's default.
 */
export function decisionModelFor(
  definition: DecisionPurposeDefinition,
  provider: string,
  entry: { provider: { models: readonly string[] }; defaultModel: string },
): string {
  const preferred = definition.models[provider];
  return preferred && entry.provider.models.includes(preferred) ? preferred : entry.defaultModel;
}

/** Which link of the chain a provider gets, in milliseconds. */
export function timeoutFor(definition: DecisionPurposeDefinition, provider: string): number {
  return definition.timeoutMs[provider] ?? definition.timeoutMs.default;
}

// ---------------------------------------------------------------------------
// Triage questions
// ---------------------------------------------------------------------------

/**
 * More options than this and a choice stops being a choice: the question is
 * left out, and the record says so, rather than sending a list nobody could
 * pick from reliably and paying for every token of it.
 */
export const MAX_OPTIONS = 200;

/**
 * The channels whose tickets are triaged.
 *
 * The ones a ticket arrives by untriaged: a requester's email, chat message,
 * call or portal form. `api` is left out because it is how agents and
 * integrations raise tickets with the fields already chosen — asking a model
 * to second-guess a person who just picked them costs money and teaches
 * nothing. `import` and `system` are not intake at all.
 */
export const TRIAGE_CHANNELS = ['email', 'portal', 'slack', 'teams', 'whatsapp', 'voice', 'mobile'] as const;

export function triagesChannel(channel: string): boolean {
  return (TRIAGE_CHANNELS as readonly string[]).includes(channel);
}

/** The types a ticket can arrive as. Problem, change and task are made, not reported. */
export const TRIAGE_TYPES = ['incident', 'request', 'question'] as const;
export const TRIAGE_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;

export interface TriageOptions {
  categories: readonly { id: string; path: string }[];
  groups: readonly { id: string; name: string }[];
}

export interface QuestionSet {
  questions: Record<string, DecisionQuestion>;
  /** Label → stored value, per question. A provider picks labels; a ticket stores ids. */
  decode: Record<string, ReadonlyMap<string, string>>;
  /** Questions left out, and why. Recorded, never silent. */
  omitted: { question: string; reason: string }[];
}

/**
 * Labels a provider can pick from, unique even when names are not.
 *
 * Two groups called "Service Desk" in different organisations would otherwise
 * be one option that decodes to whichever came first — an answer that was
 * right and applied to the wrong group.
 */
function labelled(items: readonly { id: string; label: string }[]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const item of items) {
    const base = item.label.trim() || item.id;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    out.set(count === 1 ? base : `${base} (${count})`, item.id);
  }
  return out;
}

export function triageQuestions(options: TriageOptions): QuestionSet {
  const questions: Record<string, DecisionQuestion> = {
    type: {
      kind: 'choice',
      ask: 'Is this something that is broken or degraded (incident), a request for something new or changed (request), or a question?',
      options: [...TRIAGE_TYPES],
    },
  };
  const decode: Record<string, ReadonlyMap<string, string>> = {
    type: new Map(TRIAGE_TYPES.map((type) => [type, type])),
  };
  const omitted: QuestionSet['omitted'] = [];

  const lists: [string, string, Map<string, string>][] = [
    [
      'category',
      'Which category, including subcategory, fits this ticket best?',
      labelled(options.categories.map((category) => ({ id: category.id, label: category.path }))),
    ],
    ['group', 'Which team should own this ticket?', labelled(options.groups.map((group) => ({ id: group.id, label: group.name })))],
  ];
  for (const [key, ask, map] of lists) {
    if (map.size === 0) {
      omitted.push({ question: key, reason: 'this tenant has none to choose from' });
    } else if (map.size > MAX_OPTIONS) {
      omitted.push({ question: key, reason: `${map.size} options is more than ${MAX_OPTIONS}` });
    } else {
      questions[key] = { kind: 'choice', ask, options: [...map.keys()] };
      decode[key] = map;
    }
  }

  questions.priority = {
    kind: 'choice',
    ask: 'How urgent is this, from P1 (critical, many people or a key service down) to P4 (low, no real impact yet)?',
    options: [...TRIAGE_PRIORITIES],
  };
  decode.priority = new Map(TRIAGE_PRIORITIES.map((priority) => [priority, priority]));
  questions.majorIncident = {
    kind: 'yesno',
    ask: 'Does this look like a major incident: a critical service down, or many people affected at once?',
  };

  return { questions, decode, omitted };
}

// ---------------------------------------------------------------------------
// Checking an answer
// ---------------------------------------------------------------------------

export interface CheckedDecision {
  answers: Record<string, DecisionAnswer>;
  /** What was wrong with the provider's answer. Recorded; never shown to a requester. */
  problems: string[];
  /** True when not one question got a usable answer — the chain moves on. */
  empty: boolean;
}

function fits(question: DecisionQuestion, value: DecisionValue): boolean {
  switch (question.kind) {
    case 'choice':
      return typeof value === 'string' && question.options.includes(value);
    case 'score':
      return typeof value === 'number' && Number.isFinite(value) && value >= question.min && value <= question.max;
    case 'yesno':
      return typeof value === 'boolean';
  }
}

/**
 * Holds an answer to the questions that were asked.
 *
 * A provider's answer is untrusted input. A choice outside the list, a score
 * out of range, a confidence of 1.7 — each is dropped to "no answer" for that
 * question, not coerced, because a coerced answer is one nobody gave. Answers
 * to questions that were not asked are ignored.
 */
export function checkDecision(questions: Readonly<Record<string, DecisionQuestion>>, decision: Pick<Decision, 'answers'>): CheckedDecision {
  const answers: Record<string, DecisionAnswer> = {};
  const problems: string[] = [];
  let usable = 0;

  for (const [key, question] of Object.entries(questions)) {
    const answer = decision.answers[key];
    if (!answer || answer.value === null || answer.value === undefined) {
      answers[key] = { value: null, confidence: 0 };
      continue;
    }
    const confidence = answer.confidence;
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      problems.push(`${key}: a confidence of ${String(confidence)} is not between 0 and 1`);
      answers[key] = { value: null, confidence: 0 };
      continue;
    }
    if (!fits(question, answer.value)) {
      problems.push(`${key}: ${JSON.stringify(answer.value)} is not an answer this question allows`);
      answers[key] = { value: null, confidence: 0 };
      continue;
    }
    answers[key] = { value: answer.value, confidence };
    usable += 1;
  }

  return { answers, problems, empty: usable === 0 };
}

// ---------------------------------------------------------------------------
// What an answer is allowed to do
// ---------------------------------------------------------------------------

export type PlannedAction = 'record' | 'suggest' | 'apply';

export interface PlannedAnswer {
  question: string;
  field: string | null;
  action: PlannedAction;
  /** Why this and not the next action up. Recorded, so a step-down is explainable. */
  reason: string;
}

export interface PlanInput {
  mode: DecisionMode;
  thresholds: Thresholds;
  bindings: Readonly<Record<string, QuestionBinding>>;
  answers: Readonly<Record<string, DecisionAnswer>>;
  /** Decoded values: what each answer would set the field to. */
  values: Readonly<Record<string, string | boolean | number | null>>;
  /** The ticket as it is now, by field. */
  current: Readonly<Record<string, unknown>>;
  /** Fields a person or a rule set. Never changed by a decision. */
  humanSet: ReadonlySet<string>;
}

/**
 * What each answer may do, and why not more.
 *
 * The order of the checks is the design: mode first (shadow never acts), then
 * whether there is an answer, then whether it would change anything, then
 * confidence, then whether the field is one a decision may ever touch, then
 * whether a person got there first. Every refusal to act says which check
 * refused.
 */
export function planDecision(input: PlanInput): PlannedAnswer[] {
  const out: PlannedAnswer[] = [];
  for (const [question, answer] of Object.entries(input.answers)) {
    const field = input.bindings[question]?.field ?? null;
    const plan = (action: PlannedAction, reason: string) => out.push({ question, field, action, reason });

    if (input.mode === 'off' || input.mode === 'shadow') {
      plan('record', `mode is ${input.mode}`);
      continue;
    }
    if (answer.value === null) {
      plan('record', 'no usable answer');
      continue;
    }
    const value = input.values[question] ?? null;
    if (field !== null && value !== null && input.current[field] === value) {
      plan('record', 'the ticket already has this value');
      continue;
    }
    if (answer.confidence < input.thresholds.suggest) {
      plan('record', `confidence ${answer.confidence} is below the suggest threshold ${input.thresholds.suggest}`);
      continue;
    }
    if (input.mode === 'suggest') {
      plan('suggest', 'mode is suggest');
      continue;
    }
    if (answer.confidence < input.thresholds.auto) {
      plan('suggest', `confidence ${answer.confidence} is below the auto threshold ${input.thresholds.auto}`);
      continue;
    }
    if (field === null || !isAutoApplyField(field)) {
      plan('suggest', `${field ?? question} is never applied without a person`);
      continue;
    }
    if (input.humanSet.has(field)) {
      plan('suggest', `${field} was set by a person or a rule`);
      continue;
    }
    plan('apply', `confidence ${answer.confidence} is at or above ${input.thresholds.auto}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring, and the gates that read the score
// ---------------------------------------------------------------------------

export interface ScoredAnswer {
  predicted: DecisionValue | null;
  confidence: number;
  /** The value people settled on. Null when it is not known yet. */
  actual: DecisionValue | null;
}

export interface CalibrationBand {
  from: number;
  to: number;
  count: number;
  /** Fraction right, within the band. Null when the band is empty. */
  accuracy: number | null;
  meanConfidence: number | null;
}

export interface Score {
  /** Answers with both a prediction and a known outcome. */
  scored: number;
  accuracy: number | null;
  /**
   * Mean squared gap between confidence and being right. 0 is perfect; 0.25
   * is what always saying 0.5 earns. Lower is better.
   */
  brier: number | null;
  calibration: CalibrationBand[];
}

const BANDS: readonly [number, number][] = [
  [0, 0.5],
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0001],
];

export function scoreAnswers(answers: readonly ScoredAnswer[]): Score {
  const usable = answers.filter((answer) => answer.predicted !== null && answer.actual !== null);
  if (usable.length === 0) {
    return {
      scored: 0,
      accuracy: null,
      brier: null,
      calibration: BANDS.map(([from, to]) => ({ from, to: Math.min(to, 1), count: 0, accuracy: null, meanConfidence: null })),
    };
  }
  const right = (answer: ScoredAnswer) => (answer.predicted === answer.actual ? 1 : 0);
  const accuracy = usable.reduce((sum, answer) => sum + right(answer), 0) / usable.length;
  const brier = usable.reduce((sum, answer) => sum + (answer.confidence - right(answer)) ** 2, 0) / usable.length;
  const calibration = BANDS.map(([from, to]) => {
    const inBand = usable.filter((answer) => answer.confidence >= from && answer.confidence < to);
    return {
      from,
      to: Math.min(to, 1),
      count: inBand.length,
      accuracy: inBand.length > 0 ? inBand.reduce((sum, answer) => sum + right(answer), 0) / inBand.length : null,
      meanConfidence: inBand.length > 0 ? inBand.reduce((sum, answer) => sum + answer.confidence, 0) / inBand.length : null,
    };
  });
  return { scored: usable.length, accuracy, brier, calibration };
}

export interface AutoGate {
  eligible: boolean;
  /** Scored answers at or above the auto threshold. */
  considered: number;
  agreement: number | null;
  reason: string;
}

export const AUTO_GATE = { minimum: 200, agreement: 0.95 } as const;

/**
 * Whether a tenant has earned `auto` for a purpose (ADR-0051).
 *
 * Read from that tenant's own shadow record, not from the provider's claim: a
 * provider's 0.9 is worth whatever it turned out to be worth on this tenant's
 * tickets, and nothing else.
 */
export function autoGate(answers: readonly ScoredAnswer[], thresholds: Thresholds, gate = AUTO_GATE): AutoGate {
  const considered = answers.filter(
    (answer) => answer.predicted !== null && answer.actual !== null && answer.confidence >= thresholds.auto,
  );
  if (considered.length < gate.minimum) {
    return {
      eligible: false,
      considered: considered.length,
      agreement: null,
      reason: `${considered.length} scored answers at or above ${thresholds.auto}; ${gate.minimum} are needed`,
    };
  }
  const agreement = considered.filter((answer) => answer.predicted === answer.actual).length / considered.length;
  return {
    eligible: agreement >= gate.agreement,
    considered: considered.length,
    agreement,
    reason:
      agreement >= gate.agreement
        ? `${(agreement * 100).toFixed(1)}% agreement over ${considered.length} answers`
        : `${(agreement * 100).toFixed(1)}% agreement is below ${(gate.agreement * 100).toFixed(0)}%`,
  };
}

export const STEP_DOWN = { window: 100, maxOverrideRate: 0.05 } as const;

/**
 * Whether `auto` should withdraw itself.
 *
 * Takes the most recent applied answers, newest first, each marked with
 * whether a person changed it back. More than 5% of the last 100 overridden
 * and the purpose steps down to `suggest`. A short history never steps down:
 * two overrides out of the first ten is a small sample, not a trend.
 */
export function shouldStepDown(overriddenNewestFirst: readonly boolean[], rule = STEP_DOWN): boolean {
  if (overriddenNewestFirst.length < rule.window) return false;
  const window = overriddenNewestFirst.slice(0, rule.window);
  return window.filter(Boolean).length / rule.window > rule.maxOverrideRate;
}
