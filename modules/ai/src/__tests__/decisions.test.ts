import { describe, expect, it } from 'vitest';
import {
  AUTO_APPLY_FIELDS,
  DECISION_CATALOGUE,
  DEFAULT_THRESHOLDS,
  MAX_OPTIONS,
  SELECTABLE_MODES,
  autoGate,
  checkDecision,
  decisionModelFor,
  overrides,
  pendingSuggestions,
  planDecision,
  problemWithThresholds,
  scoreAnswers,
  shouldStepDown,
  standingApplied,
  timeoutFor,
  triageQuestions,
  triagesChannel,
  type PendingInput,
  type PlanInput,
  type ScoredAnswer,
} from '../domain/decisions.js';
import type { DecisionQuestion } from '../providers/types.js';

/**
 * The rules about what a decision may do (ADR-0051).
 *
 * Every one of these is a line somebody will one day want to move, and the
 * test is where the reason for the line is written down next to it.
 */

describe('the catalogue', () => {
  it('lets a tenant choose any mode, because choosing auto is not what lets an answer act', () => {
    expect([...SELECTABLE_MODES]).toEqual(['off', 'shadow', 'suggest', 'auto']);
  });

  it('applies category and team without a person, and nothing else', () => {
    expect([...AUTO_APPLY_FIELDS].sort()).toEqual(['categoryId', 'groupId']);
    // Type is fixed when a ticket is raised; the rest are a person's call.
    for (const field of ['type', 'priority', 'impact', 'urgency', 'status', 'assigneeId']) {
      expect(AUTO_APPLY_FIELDS as readonly string[]).not.toContain(field);
    }
  });

  it('triages what arrives untriaged, and nothing an agent or a migration raised', () => {
    for (const channel of ['email', 'portal', 'slack', 'teams', 'whatsapp', 'voice', 'mobile']) {
      expect(triagesChannel(channel)).toBe(true);
    }
    for (const channel of ['api', 'import', 'system', 'anything-else']) {
      expect(triagesChannel(channel)).toBe(false);
    }
  });

  it('asks Anthropic for triage with Sonnet 5, and anybody else with their default', () => {
    const triage = DECISION_CATALOGUE.triage;
    const anthropic = { provider: { models: ['claude-opus-5', 'claude-sonnet-5'] }, defaultModel: 'claude-opus-5' };
    expect(decisionModelFor(triage, 'anthropic', anthropic)).toBe('claude-sonnet-5');
    expect(decisionModelFor(triage, 'anthropic', { ...anthropic, provider: { models: ['claude-opus-5'] } })).toBe('claude-opus-5');
    expect(decisionModelFor(triage, 'stub', { provider: { models: ['stub-small'] }, defaultModel: 'stub-small' })).toBe('stub-small');
  });

  it('gives a decision engine two seconds and a general model longer', () => {
    const triage = DECISION_CATALOGUE.triage;
    expect(timeoutFor(triage, 'jev')).toBe(2_000);
    expect(timeoutFor(triage, 'anthropic')).toBe(triage.timeoutMs.default);
  });
});

describe('thresholds', () => {
  it('accepts the defaults', () => {
    expect(problemWithThresholds(DEFAULT_THRESHOLDS)).toBeNull();
  });

  it('refuses a suggest line above the auto line', () => {
    expect(problemWithThresholds({ auto: 0.7, suggest: 0.8 })).toMatch(/above the auto threshold/);
  });

  it('refuses a threshold outside 0 to 1', () => {
    expect(problemWithThresholds({ auto: 1.2, suggest: 0.6 })).toMatch(/at most 1/);
    expect(problemWithThresholds({ auto: 0.9, suggest: 0 })).toMatch(/above 0/);
    expect(problemWithThresholds({ auto: Number.NaN, suggest: 0.6 })).not.toBeNull();
  });
});

describe('the triage questions', () => {
  const categories = [
    { id: 'c1', path: 'Hardware / Laptop' },
    { id: 'c2', path: 'Access / VPN' },
  ];
  const groups = [
    { id: 'g1', name: 'Service Desk' },
    { id: 'g2', name: 'Service Desk' },
    { id: 'g3', name: 'Network' },
  ];

  it('asks for type, category, group, priority and major incident', () => {
    const set = triageQuestions({ categories, groups });
    expect(Object.keys(set.questions)).toEqual(['type', 'category', 'group', 'priority', 'majorIncident']);
    expect(set.omitted).toEqual([]);
  });

  it('decodes the label a provider picks back to the id the ticket stores', () => {
    const set = triageQuestions({ categories, groups });
    expect(set.decode.category!.get('Access / VPN')).toBe('c2');
  });

  it('keeps two teams with one name apart, so an answer cannot land on the wrong one', () => {
    const set = triageQuestions({ categories, groups });
    const question = set.questions.group as Extract<DecisionQuestion, { kind: 'choice' }>;
    expect(question.options).toEqual(['Service Desk', 'Service Desk (2)', 'Network']);
    expect(set.decode.group!.get('Service Desk (2)')).toBe('g2');
  });

  it('leaves out a question with nothing to choose from, and says so', () => {
    const set = triageQuestions({ categories: [], groups });
    expect(set.questions.category).toBeUndefined();
    expect(set.omitted).toEqual([{ question: 'category', reason: 'this tenant has none to choose from' }]);
  });

  it('leaves out a choice too long to be a choice', () => {
    const many = Array.from({ length: MAX_OPTIONS + 1 }, (_, index) => ({ id: `c${index}`, path: `Category ${index}` }));
    const set = triageQuestions({ categories: many, groups });
    expect(set.questions.category).toBeUndefined();
    expect(set.omitted[0]!.reason).toMatch(/more than/);
  });
});

describe('checking an answer', () => {
  const questions: Record<string, DecisionQuestion> = {
    type: { kind: 'choice', ask: 'Type?', options: ['incident', 'request'] },
    major: { kind: 'yesno', ask: 'Major?' },
    impact: { kind: 'score', ask: 'Impact?', min: 0, max: 10 },
  };

  it('keeps answers the questions allow', () => {
    const checked = checkDecision(questions, {
      answers: {
        type: { value: 'incident', confidence: 0.9 },
        major: { value: false, confidence: 0.7 },
        impact: { value: 4, confidence: 0.5 },
      },
    });
    expect(checked.problems).toEqual([]);
    expect(checked.empty).toBe(false);
    expect(checked.answers.type).toEqual({ value: 'incident', confidence: 0.9 });
  });

  it('drops an option that was not offered to no answer, rather than coercing it', () => {
    const checked = checkDecision(questions, { answers: { type: { value: 'outage', confidence: 0.99 } } });
    expect(checked.answers.type).toEqual({ value: null, confidence: 0 });
    expect(checked.problems[0]).toMatch(/type/);
  });

  it('drops a confidence outside 0 to 1', () => {
    const checked = checkDecision(questions, { answers: { type: { value: 'incident', confidence: 1.7 } } });
    expect(checked.answers.type!.value).toBeNull();
    const nan = checkDecision(questions, { answers: { type: { value: 'incident', confidence: Number.NaN } } });
    expect(nan.answers.type!.value).toBeNull();
  });

  it('drops a score out of range and a yes/no that is not a boolean', () => {
    const checked = checkDecision(questions, {
      answers: { impact: { value: 11, confidence: 0.5 }, major: { value: 'yes', confidence: 0.5 } },
    });
    expect(checked.answers.impact!.value).toBeNull();
    expect(checked.answers.major!.value).toBeNull();
  });

  it('ignores answers to questions nobody asked', () => {
    const checked = checkDecision(questions, { answers: { priority: { value: 'P1', confidence: 1 } } });
    expect(checked.answers.priority).toBeUndefined();
  });

  it('calls an answer with nothing usable empty, so the chain moves on', () => {
    expect(checkDecision(questions, { answers: {} }).empty).toBe(true);
  });
});

describe('what an answer is allowed to do', () => {
  function input(overrides: Partial<PlanInput> = {}): PlanInput {
    return {
      mode: 'auto',
      thresholds: DEFAULT_THRESHOLDS,
      bindings: DECISION_CATALOGUE.triage.bindings,
      answers: { category: { value: 'Access / VPN', confidence: 0.95 } },
      values: { category: 'c2' },
      current: { categoryId: null },
      humanSet: new Set(),
      earned: new Set(['categoryId', 'groupId']),
      ...overrides,
    };
  }
  const only = (overrides: Partial<PlanInput> = {}) => planDecision(input(overrides))[0]!;

  it('suggests a field this desk has not earned yet, however confident', () => {
    const plan = only({ earned: new Set(['groupId']) });
    expect(plan).toMatchObject({ field: 'categoryId', action: 'suggest' });
    expect(plan.reason).toMatch(/has not earned auto on this desk yet/);
    expect(only({ earned: undefined }).action).toBe('suggest');
  });

  it('never applies a type, now that a ticket’s type cannot change', () => {
    const plan = only({
      answers: { type: { value: 'request', confidence: 0.99 } },
      values: { type: 'request' },
      current: { type: 'incident' },
      earned: new Set(['type', 'categoryId', 'groupId']),
    });
    expect(plan).toMatchObject({ field: 'type', action: 'suggest' });
    expect(plan.reason).toMatch(/never applied without a person/);
  });

  it('never acts in shadow mode, however confident', () => {
    expect(only({ mode: 'shadow' })).toMatchObject({ action: 'record', reason: 'mode is shadow' });
  });

  it('applies a confident answer to an allow-listed field nobody has set', () => {
    expect(only()).toMatchObject({ field: 'categoryId', action: 'apply' });
  });

  it('only suggests in suggest mode', () => {
    expect(only({ mode: 'suggest' }).action).toBe('suggest');
  });

  it('suggests rather than applies below the auto line', () => {
    expect(only({ answers: { category: { value: 'Access / VPN', confidence: 0.8 } } }).action).toBe('suggest');
  });

  it('only records below the suggest line', () => {
    expect(only({ answers: { category: { value: 'Access / VPN', confidence: 0.4 } } }).action).toBe('record');
  });

  it('never changes a field a person or a rule set', () => {
    const plan = only({ humanSet: new Set(['categoryId']) });
    expect(plan.action).toBe('suggest');
    expect(plan.reason).toMatch(/set by a person or a rule/);
  });

  it('never applies priority, however confident', () => {
    const plan = only({
      answers: { priority: { value: 'P1', confidence: 0.99 } },
      values: { priority: 'P1' },
      current: { priority: 'P3' },
    });
    expect(plan).toMatchObject({ field: 'priority', action: 'suggest' });
    expect(plan.reason).toMatch(/never applied without a person/);
  });

  it('never applies a major-incident call, which sets no field', () => {
    const plan = only({ answers: { majorIncident: { value: true, confidence: 0.99 } }, values: { majorIncident: true } });
    expect(plan).toMatchObject({ field: null, action: 'suggest' });
  });

  it('does nothing when the ticket already has the answer', () => {
    expect(only({ current: { categoryId: 'c2' } })).toMatchObject({ action: 'record', reason: 'the ticket already has this value' });
  });

  it('records a question nobody answered', () => {
    expect(only({ answers: { category: { value: null, confidence: 0 } } }).action).toBe('record');
  });
});

describe('scoring', () => {
  const answer = (predicted: string | null, actual: string | null, confidence: number): ScoredAnswer => ({
    predicted,
    actual,
    confidence,
  });

  it('scores only answers with both a prediction and a known outcome', () => {
    const score = scoreAnswers([answer('a', 'a', 0.9), answer('a', 'b', 0.6), answer(null, 'a', 0), answer('a', null, 0.9)]);
    expect(score.scored).toBe(2);
    expect(score.accuracy).toBe(0.5);
    // (0.9 - 1)^2 + (0.6 - 0)^2, over 2
    expect(score.brier).toBeCloseTo((0.01 + 0.36) / 2, 10);
  });

  it('puts each answer in its confidence band, and 1.0 in the top one', () => {
    const score = scoreAnswers([answer('a', 'a', 1), answer('a', 'a', 0.95), answer('a', 'b', 0.65)]);
    const top = score.calibration.find((band) => band.from === 0.9)!;
    expect(top.count).toBe(2);
    expect(top.to).toBe(1);
    expect(score.calibration.find((band) => band.from === 0.6)!.accuracy).toBe(0);
  });

  it('reports nothing rather than a zero when there is nothing to score', () => {
    const score = scoreAnswers([]);
    expect(score.accuracy).toBeNull();
    expect(score.brier).toBeNull();
  });
});

describe('earning and losing auto', () => {
  const right = (confidence: number): ScoredAnswer => ({ predicted: 'a', actual: 'a', confidence });
  const wrong = (confidence: number): ScoredAnswer => ({ predicted: 'a', actual: 'b', confidence });

  it('is not earned on fewer than 200 confident answers, however good', () => {
    const gate = autoGate(Array.from({ length: 199 }, () => right(0.95)), DEFAULT_THRESHOLDS);
    expect(gate.eligible).toBe(false);
    expect(gate.reason).toMatch(/200 are needed/);
  });

  it('counts only answers at or above the auto line', () => {
    const answers = [...Array.from({ length: 150 }, () => right(0.95)), ...Array.from({ length: 100 }, () => right(0.7))];
    expect(autoGate(answers, DEFAULT_THRESHOLDS).considered).toBe(150);
  });

  it('is earned at 95% agreement and not below it', () => {
    const at = [...Array.from({ length: 190 }, () => right(0.95)), ...Array.from({ length: 10 }, () => wrong(0.95))];
    expect(autoGate(at, DEFAULT_THRESHOLDS).eligible).toBe(true);
    const below = [...Array.from({ length: 189 }, () => right(0.95)), ...Array.from({ length: 11 }, () => wrong(0.95))];
    expect(autoGate(below, DEFAULT_THRESHOLDS).eligible).toBe(false);
  });

  it('steps down when more than 5 of the last 100 applied answers were overridden', () => {
    const five = [...Array.from({ length: 5 }, () => true), ...Array.from({ length: 95 }, () => false)];
    expect(shouldStepDown(five)).toBe(false);
    const six = [...Array.from({ length: 6 }, () => true), ...Array.from({ length: 94 }, () => false)];
    expect(shouldStepDown(six)).toBe(true);
  });

  it('looks only at the most recent 100', () => {
    const history = [...Array.from({ length: 100 }, () => false), ...Array.from({ length: 50 }, () => true)];
    expect(shouldStepDown(history)).toBe(false);
  });

  it('does not step down on a short history', () => {
    expect(shouldStepDown([true, true, false])).toBe(false);
  });
});

describe('which suggestions an agent sees', () => {
  const base = {
    plan: [
      { question: 'category', field: 'categoryId', action: 'suggest' as const },
      { question: 'group', field: 'groupId', action: 'suggest' as const },
      { question: 'priority', field: 'priority', action: 'record' as const },
      { question: 'type', field: 'type', action: 'suggest' as const },
      { question: 'majorIncident', field: null, action: 'suggest' as const },
    ],
    answers: {
      category: { value: 'Access / VPN', confidence: 0.85 },
      group: { value: 'Network', confidence: 0.7 },
      priority: { value: 'P2', confidence: 0.4 },
      type: { value: 'request', confidence: 0.75 },
      majorIncident: { value: true, confidence: 0.8 },
    },
    proposed: { category: 'c2', group: 'g3', priority: 'P2', type: 'request', majorIncident: true },
    baseline: { categoryId: null, groupId: null, priority: 'P3', type: 'incident' } as Record<string, unknown>,
    current: { categoryId: null, groupId: null, priority: 'P3', type: 'incident' } as Record<string, unknown>,
    responded: new Set<string>(),
  };
  const questions = (input: PendingInput = base) => pendingSuggestions(input).map((entry) => entry.question);

  it('shows the answers planned as suggestions, with what each would do', () => {
    const pending = pendingSuggestions(base);
    expect(pending.map((entry) => [entry.question, entry.kind])).toEqual([
      ['category', 'apply'],
      ['group', 'apply'],
      ['type', 'info'],
      ['majorIncident', 'warning'],
    ]);
    // The id is what would be set; the label is what a person reads.
    expect(pending[0]).toMatchObject({ value: 'c2', display: 'Access / VPN' });
  });

  it('drops one somebody has already accepted or dismissed', () => {
    expect(questions({ ...base, responded: new Set(['category']) })).not.toContain('category');
  });

  it('drops one the ticket already has', () => {
    expect(questions({ ...base, current: { ...base.current, categoryId: 'c2' } })).not.toContain('category');
  });

  it('drops one a person has changed the field away from since the decision', () => {
    expect(questions({ ...base, current: { ...base.current, groupId: 'g1' } })).not.toContain('group');
  });

  it('shows a major-incident answer only when it says yes', () => {
    const no = { ...base, answers: { ...base.answers, majorIncident: { value: false, confidence: 0.9 } }, proposed: { ...base.proposed, majorIncident: false } };
    expect(questions(no)).not.toContain('majorIncident');
  });

  it('offers an answer planned to be applied that was not, and never one that was', () => {
    const planned = { ...base, plan: base.plan.map((entry) => (entry.question === 'group' ? { ...entry, action: 'apply' as const } : entry)) };
    expect(questions(planned)).toContain('group');
    expect(questions({ ...planned, applied: new Set(['group']) })).not.toContain('group');
  });
});

describe('what the AI set by itself', () => {
  const applied = {
    category: { field: 'categoryId', from: null, to: 'c2', confidence: 0.96, at: '2026-09-25T10:00:00.000Z' },
    group: { field: 'groupId', from: null, to: 'g3', confidence: 0.93, at: '2026-09-25T10:00:00.000Z' },
  };
  const answers = { category: { value: 'Access / VPN', confidence: 0.96 }, group: { value: 'Network', confidence: 0.93 } };
  const standing = (current: Record<string, unknown>, responded = new Set<string>()) =>
    standingApplied({ applied, answers, current, responded }).map((entry) => entry.question);

  it('offers Undo on each value still on the ticket, with the label a person reads', () => {
    expect(standing({ categoryId: 'c2', groupId: 'g3' })).toEqual(['category', 'group']);
    expect(standingApplied({ applied, answers, current: { categoryId: 'c2' }, responded: new Set() })[0]).toMatchObject({
      display: 'Access / VPN',
      value: 'c2',
    });
  });

  it('offers nothing once a person has changed it: it is theirs now', () => {
    expect(standing({ categoryId: 'c9', groupId: 'g3' })).toEqual(['group']);
  });

  it('offers nothing twice', () => {
    expect(standing({ categoryId: 'c2', groupId: 'g3' }, new Set(['group']))).toEqual(['category']);
  });

  it('counts a change to anything else as a correction, and the same value as none', () => {
    expect(overrides(applied.group, 'g1')).toBe(true);
    expect(overrides(applied.group, null)).toBe(true);
    expect(overrides(applied.group, 'g3')).toBe(false);
    expect(overrides(undefined, 'g1')).toBe(false);
  });
});
