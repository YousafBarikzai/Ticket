import { describe, expect, it } from 'vitest';
import type { DecisionQuestionScore, DecisionRow } from '@itsm/sdk';
import {
  AI_OFF_REASON,
  acceptanceText,
  acceptedShare,
  appliedText,
  asMode,
  asPercent,
  autoNotice,
  autoReadiness,
  brierText,
  budgetFigures,
  budgetProblem,
  calibrationRows,
  calibrationSeries,
  fieldLabel,
  gateNeeds,
  gateShort,
  gateText,
  lastStepDownText,
  leadText,
  modeNotice,
  modePlan,
  penceFrom,
  providerLabel,
  readiness,
  residencySkips,
  skipLabel,
  skipRows,
  stepDownText,
  suggestReadiness,
  type ModeState,
} from '../triage.js';
import {
  csvCell,
  decisionView,
  decisionsCsv,
  decisionsCsvFileName,
  decisionsWithin,
  outcomeLook,
  rangeFrom,
  whyText,
} from '../components/ai-triage/decisions.js';

/**
 * How the AI triage pages word their numbers, and what the mode control may
 * write. Each case is a way a number could be shown as something it is not,
 * or a switch could claim to have done something it did not.
 */

function question(overrides: Partial<DecisionQuestionScore> = {}): DecisionQuestionScore {
  return {
    question: 'category',
    scored: 10,
    accuracy: 0.8,
    brier: 0.12,
    calibration: [
      { from: 0, to: 0.5, count: 0, accuracy: null, meanConfidence: null },
      { from: 0.9, to: 1, count: 4, accuracy: 0.75, meanConfidence: 0.93 },
    ],
    autoGate: { eligible: false, considered: 4, agreement: null, reason: '4 scored answers at or above 0.9; 200 are needed' },
    responses: { accepted: 0, dismissed: 0 },
    applied: { applied: 0, overridden: 0 },
    ...overrides,
  };
}

const EARNED = { eligible: true, considered: 240, agreement: 0.97, reason: '97.0% agreement over 240 answers' };

describe('the numbers', () => {
  it('shows a dash, not 0%, when there is nothing to measure', () => {
    expect(asPercent(null)).toBe('—');
    expect(asPercent(0.934)).toBe('93.4%');
    expect(asPercent(0)).toBe('0.0%');
  });

  it('says so when a Brier score is worse than guessing', () => {
    expect(brierText(0.12)).toBe('0.120');
    expect(brierText(0.31)).toBe('0.310 (worse than guessing)');
    expect(brierText(null)).toBe('—');
  });

  it('names fields the way the desk does elsewhere (a group is a team)', () => {
    expect(fieldLabel('group')).toBe('Team');
    expect(fieldLabel('majorIncident')).toBe('Major incident');
    expect(fieldLabel('somethingNew')).toBe('somethingNew');
  });

  it('counts accepted suggestions across fields, and says nothing before agents answered any', () => {
    expect(acceptedShare([question(), question()])).toEqual({ accepted: 0, total: 0, rate: null });
    expect(acceptedShare([question({ responses: { accepted: 6, dismissed: 2 } }), question({ responses: { accepted: 1, dismissed: 1 } })])).toEqual({
      accepted: 7,
      total: 10,
      rate: 0.7,
    });
  });
});

describe('the auto-apply gate', () => {
  it('says a field that is never auto-applied is never auto-applied', () => {
    expect(gateText(question({ question: 'priority', autoGate: null }))).toBe('Never applied without a person');
    expect(gateShort(question({ question: 'priority', autoGate: null }))).toBe('Never without a person');
  });

  it('says why a field has not earned it yet', () => {
    expect(gateText(question())).toBe('Not yet — 4 scored answers at or above 0.9; 200 are needed');
  });

  it('says when it has', () => {
    expect(gateText(question({ autoGate: EARNED }))).toBe('Earned — 97.0% agreement over 240 answers');
    expect(gateShort(question({ autoGate: EARNED }))).toBe('Earned');
  });

  it('reads how many more answers are needed from the gate’s own reason, never a copy of the rule', () => {
    expect(gateNeeds(question().autoGate!)).toBe(196);
    expect(gateShort(question())).toBe('Not yet (needs 196 more)');
    const reason = '91.2% agreement is below 95%';
    const short = question({ autoGate: { eligible: false, considered: 240, agreement: 0.912, reason } });
    expect(gateNeeds(short.autoGate!)).toBeNull();
    expect(gateShort(short)).toBe('Not yet (91.2% agreement)');
    expect(gateNeeds({ eligible: false, considered: 3, agreement: null, reason: 'something new' })).toBeNull();
  });
});

describe('providers and fallbacks', () => {
  it('names providers as people know them, never by model', () => {
    expect(providerLabel('jev')).toBe('JEV');
    expect(providerLabel('anthropic')).toBe('Claude');
    expect(providerLabel('rules')).toBe('Rules');
    expect(providerLabel('someone-new')).toBe('someone-new');
  });

  it('says who leads, and what happens when nobody can answer', () => {
    expect(leadText('jev')).toBe('JEV answers first. When it can’t, the ticket keeps what intake gave it.');
    expect(leadText(null)).toMatch(/No provider can answer/);
  });

  it('describes a skip in words, provider first', () => {
    expect(skipLabel('jev:not-registered')).toBe('JEV — not set up in this deployment');
    expect(skipLabel('anthropic:residency')).toBe('Claude — outside this workspace’s allowed regions');
  });

  it('lists the most frequent first', () => {
    expect(skipRows({ 'jev:not-registered': 3, 'anthropic:timeout': 5 }).map((row) => row.key)).toEqual(['anthropic:timeout', 'jev:not-registered']);
  });

  it('counts the skips a workspace’s regions caused', () => {
    expect(residencySkips({ 'jev:residency': 3, 'anthropic:residency': 2, 'jev:timeout': 9 })).toBe(5);
    expect(residencySkips({})).toBe(0);
  });
});

describe('calibration', () => {
  it('puts each field in a column and never shows a percentage of nothing', () => {
    const rows = calibrationRows([question(), question({ question: 'type' })]);
    expect(rows[0]).toEqual({ band: '0–50%', cells: { category: '—', type: '—' } });
    expect(rows[1]!.cells.category).toBe('75.0% of 4');
  });

  it('is empty with nothing scored', () => {
    expect(calibrationRows([])).toEqual([]);
    expect(calibrationSeries([question({ scored: 0 })]).series).toEqual([]);
  });

  it('draws the diagonal first, as a reference, and a gap where a band is empty', () => {
    const { bands, series } = calibrationSeries([question(), question({ question: 'group' })]);
    expect(bands).toEqual(['0–50%', '90–100%']);
    expect(series[0]).toMatchObject({ id: 'ideal', label: 'Perfectly calibrated', reference: true });
    expect(series[0]!.points.map((point) => point.y)).toEqual([0.25, 0.95]);
    expect(series.slice(1).map((entry) => entry.label)).toEqual(['Category', 'Team']);
    expect(series[1]!.points).toEqual([
      { x: '0–50%', y: null },
      { x: '90–100%', y: 0.75 },
    ]);
  });
});

describe('what the page says first', () => {
  it('tells a desk with triage off where to start, without a technical key', () => {
    const text = modeNotice({ mode: 'off', decisions: 0 })!;
    expect(text).toMatch(/Start in Shadow/);
    expect(text).not.toMatch(/ai\.decision/);
  });

  it('tells a desk in shadow with nothing yet what it is waiting for', () => {
    expect(modeNotice({ mode: 'shadow', decisions: 0 })).toMatch(/in Shadow\. Nothing has been decided yet: it runs on new tickets that arrive by email, the portal, chat and phone/);
  });

  it('says nothing once there is something to show', () => {
    expect(modeNotice({ mode: 'shadow', decisions: 3 })).toBeNull();
  });
});

describe('suggest mode', () => {
  const thresholds = { auto: 0.9, suggest: 0.6 };

  it('puts the accuracy beside the switch while the desk is in shadow', () => {
    const text = suggestReadiness({ mode: 'shadow', thresholds, questions: [question(), question({ question: 'type', accuracy: 0.95 })] });
    expect(text).toMatch(/at or above 60% confidence/);
    expect(text).toMatch(/category 80\.0%, type 95\.0%/);
    expect(text).not.toMatch(/ai\.decision/);
  });

  it('says there is nothing to judge by yet, rather than showing 0%', () => {
    const text = suggestReadiness({ mode: 'shadow', thresholds, questions: [question({ scored: 0, accuracy: null })] });
    expect(text).toMatch(/no accuracy to judge by/);
  });

  it('says nothing about switching once the desk is already suggesting', () => {
    expect(suggestReadiness({ mode: 'suggest', thresholds, questions: [question()] })).toBeNull();
  });

  it('shows how often agents took a field’s suggestion, and a dash before any', () => {
    expect(acceptanceText(question())).toBe('—');
    expect(acceptanceText(question({ responses: { accepted: 7, dismissed: 3 } }))).toBe('7 of 10 accepted');
  });
});

describe('auto mode', () => {
  const group = (earned: boolean) =>
    question({ question: 'group', autoGate: earned ? EARNED : { eligible: false, considered: 12, agreement: null, reason: 'too few' } });

  it('says which fields it sets and which it still only suggests', () => {
    const text = autoNotice({ mode: 'auto', questions: [question({ autoGate: EARNED }), group(false), question({ question: 'type', autoGate: null })] });
    expect(text).toMatch(/sets category on new tickets where it is empty/);
    expect(text).toMatch(/Team is suggested until it has earned it/);
    expect(text).toMatch(/type, priority, major incident — is always only suggested/);
  });

  it('says plainly when no field has earned it, so auto is only suggesting', () => {
    expect(autoNotice({ mode: 'auto', questions: [question(), group(false)] })).toMatch(/no field has earned it yet, so it only suggests/);
  });

  it('is silent outside auto', () => {
    expect(autoNotice({ mode: 'suggest', questions: [question({ autoGate: EARNED })] })).toBeNull();
  });

  it('puts the gate beside the switch while the desk is suggesting', () => {
    expect(autoReadiness({ mode: 'suggest', questions: [question({ autoGate: EARNED }), group(true)] })).toMatch(/Category and team have earned it\./);
    expect(autoReadiness({ mode: 'suggest', questions: [question()] })).toMatch(/would change nothing until one does/);
    expect(autoReadiness({ mode: 'shadow', questions: [question()] })).toBeNull();
  });

  it('shows what the AI set for a field, and a dash before anything', () => {
    expect(appliedText(question())).toBe('—');
    expect(appliedText(question({ applied: { applied: 40, overridden: 0 } }))).toBe('40 set');
    expect(appliedText(question({ applied: { applied: 40, overridden: 3 } }))).toBe('40 set, 3 corrected');
  });
});

describe('the step-down meter', () => {
  const meter = { window: 100, considered: 100, overridden: 4, rate: 0.04, limit: 0.05, wouldStepDown: false };

  it('says how close auto is to switching itself back', () => {
    expect(stepDownText(meter)).toBe(
      'Agents corrected 4 of the last 100 tickets the AI changed by itself (4.0%). Above 5% of the last 100, auto switches itself back to suggest.',
    );
  });

  it('says a short history is not enough to act on, rather than alarming anyone', () => {
    expect(stepDownText({ ...meter, considered: 20, overridden: 2, rate: 0.1 })).toMatch(/not yet enough to step down on/);
  });

  it('is silent before the AI has set anything', () => {
    expect(stepDownText({ ...meter, considered: 0, overridden: 0, rate: null })).toBeNull();
  });

  it('says when auto last withdrew itself, and that administrators were told', () => {
    expect(lastStepDownText({ at: '2026-09-30T08:00:00.000Z', overridden: 7, window: 100 })).toBe(
      'On 2026-09-30 auto switched itself back to suggest: agents corrected 7 of the last 100 tickets it had changed. Administrators were told by email.',
    );
    expect(lastStepDownText(null)).toBeNull();
  });

  it('writes the day in the reader’s locale and zone when the page gives them', () => {
    // 23:30 UTC on the 29th is already the 30th in Auckland.
    expect(lastStepDownText({ at: '2026-09-29T23:30:00.000Z', overridden: 7, window: 100 }, { locale: 'en-GB', timeZone: 'Pacific/Auckland' })).toMatch(/^On 30 Sept? 2026 auto/);
  });
});

/* ======================================================================= */

describe('readiness: Shadow → Suggest → Auto', () => {
  const scored = [
    question({ question: 'type', scored: 100, accuracy: 0.9, autoGate: null }),
    question({ question: 'category', scored: 100, accuracy: 1, autoGate: EARNED }),
    question({ question: 'group', scored: 100, accuracy: 0.86 }),
    // Never shown to an agent to accept, so never counted in Suggest's evidence.
    question({ question: 'majorIncident', scored: 100, accuracy: 0.1, autoGate: null }),
  ];

  it('puts evidence beside Suggest — the answers agents would see, weighted by how many were scored', () => {
    const ready = readiness({ mode: 'shadow', questions: scored, settled: 140 });
    expect(ready.suggest.accuracy).toBeCloseTo((0.9 + 1 + 0.86) / 3);
    expect(ready.suggest.text).toBe('Right 92% of the time on 140 scored tickets');
  });

  it('never claims evidence before anything is scored', () => {
    const ready = readiness({ mode: 'shadow', questions: [], settled: 0 });
    expect(ready.suggest.accuracy).toBeNull();
    expect(ready.suggest.text).toMatch(/Nothing scored yet/);
    expect(ready.auto.text).toBe('No field has a record here yet');
  });

  it('counts the fields that have earned auto-apply, one by one', () => {
    const ready = readiness({ mode: 'suggest', questions: scored, settled: 140 });
    expect(ready.auto.text).toBe('1 of 2 fields have earned auto-apply');
    expect(ready.auto.fields).toEqual([
      { question: 'category', label: 'Category', eligible: true, text: 'Earned' },
      { question: 'group', label: 'Team', eligible: false, text: 'Not yet (needs 196 more)' },
    ]);
  });

  it('marks where the desk is on the way', () => {
    const statuses = (mode: string) => readiness({ mode, questions: scored, settled: 1 }).steps.map((step) => step.status);
    expect(statuses('off')).toEqual(['upcoming', 'upcoming', 'upcoming']);
    expect(statuses('shadow')).toEqual(['current', 'upcoming', 'upcoming']);
    expect(statuses('suggest')).toEqual(['complete', 'current', 'upcoming']);
    expect(statuses('auto')).toEqual(['complete', 'complete', 'current']);
    expect(statuses('something-else')).toEqual(['upcoming', 'upcoming', 'upcoming']);
  });
});

describe('the mode control: what Apply writes, and in which order', () => {
  const state = (overrides: Partial<ModeState> = {}): ModeState => ({ aiEnabled: true, flag: true, stored: 'shadow', effective: 'shadow', ...overrides });

  it('reads an unknown mode as off', () => {
    expect(asMode('auto')).toBe('auto');
    expect(asMode('turbo')).toBe('off');
    expect(asMode(null)).toBe('off');
  });

  it('changes only the mode when the switch is already on', () => {
    expect(modePlan(state(), 'suggest')).toEqual({ steps: [{ kind: 'setting', value: 'suggest' }] });
  });

  it('writes the mode before turning the switch on, so a desk never runs for a moment in the mode it is leaving', () => {
    expect(modePlan(state({ flag: false, stored: 'auto', effective: 'off' }), 'shadow')).toEqual({
      steps: [
        { kind: 'setting', value: 'shadow' },
        { kind: 'flag', value: true },
      ],
    });
  });

  it('turns only the switch on when the stored mode is already the one chosen', () => {
    expect(modePlan(state({ flag: false, stored: 'shadow', effective: 'off' }), 'shadow')).toEqual({ steps: [{ kind: 'flag', value: true }] });
  });

  it('turns triage off by the mode alone, leaving the kill switch as it is', () => {
    expect(modePlan(state({ stored: 'auto', effective: 'auto' }), 'off')).toEqual({ steps: [{ kind: 'setting', value: 'off' }] });
    expect(modePlan(state({ stored: 'off', effective: 'off' }), 'off')).toEqual({ steps: [] });
  });

  it('never turns the workspace’s AI switch on from here, and says where it is', () => {
    expect(modePlan(state({ aiEnabled: false, effective: 'off' }), 'suggest')).toEqual({ steps: [], blocked: AI_OFF_REASON });
    // Unknown switch, but the stored mode and the triage switch already say Suggest and the desk is still off.
    expect(modePlan(state({ aiEnabled: null, stored: 'suggest', effective: 'off' }), 'suggest')).toEqual({ steps: [], blocked: AI_OFF_REASON });
    // Turning off is always possible.
    expect(modePlan(state({ aiEnabled: false, stored: 'suggest', effective: 'off' }), 'off')).toEqual({ steps: [{ kind: 'setting', value: 'off' }] });
  });

  it('writes both when it cannot read the parts', () => {
    expect(modePlan({ aiEnabled: null, flag: null, stored: null, effective: 'off' }, 'shadow')).toEqual({
      steps: [
        { kind: 'setting', value: 'shadow' },
        { kind: 'flag', value: true },
      ],
    });
  });

  it('has nothing to write for the mode the desk is already in', () => {
    expect(modePlan(state({ stored: 'auto', effective: 'auto' }), 'auto')).toEqual({ steps: [] });
  });
});

describe('the AI budget', () => {
  it('turns micro-pence and pence into pounds for the meter', () => {
    expect(budgetFigures({ spentMicros: '123450000', limitPence: 25_000, warnPence: 20_000 })).toEqual({ spent: 1.2345, limit: 250, warn: 200 });
    expect(budgetFigures({ spentMicros: '0', limitPence: null, warnPence: null })).toEqual({ spent: 0, limit: null, warn: null });
  });

  it('reads a typed amount as whole pence, empty as no line, and refuses anything else', () => {
    expect(penceFrom('250')).toBe(25_000);
    expect(penceFrom('£1,250.5')).toBe(125_050);
    expect(penceFrom(' ')).toBeNull();
    expect(penceFrom('12.345')).toBe('invalid');
    expect(penceFrom('-5')).toBe('invalid');
    expect(penceFrom('lots')).toBe('invalid');
    expect(penceFrom('200000')).toBe('invalid');
  });

  it('says before the request what the API would refuse: a warning above the cap', () => {
    expect(budgetProblem(10_000, 20_000)).toMatchObject({ field: 'warn' });
    expect(budgetProblem(10_000, 10_000)).toBeNull();
    expect(budgetProblem(null, 20_000)).toBeNull();
  });
});

/* ======================================================================= */

function decision(overrides: Partial<DecisionRow> & { plan?: unknown } = {}): DecisionRow {
  return {
    id: 'd1',
    purpose: 'triage',
    subjectType: 'ticket',
    subjectId: 't-1',
    mode: 'auto',
    outcome: 'applied',
    provider: 'jev',
    model: 'jev-latest',
    latencyMs: 320,
    costMicros: '1000',
    costDisplay: '0.001p',
    answers: {
      priority: { value: 'P2', confidence: 0.71 },
      category: { value: 'Hardware', confidence: 0.96 },
      majorIncident: { value: false, confidence: 0.99 },
    },
    attempts: [
      { provider: 'anthropic', outcome: 'skipped', reason: 'residency', model: null, ms: 0 },
      { provider: 'jev', outcome: 'answered', reason: null, model: 'jev-latest', ms: 320 },
    ],
    createdAt: '2026-09-30T08:00:00.000Z',
    ...overrides,
  } as DecisionRow;
}

describe('a decision as a row', () => {
  const plan = [
    { question: 'category', field: 'categoryId', action: 'apply', reason: 'confidence 0.96 is at or above 0.9' },
    { question: 'priority', field: 'priority', action: 'suggest', reason: 'confidence 0.71 is below the auto threshold 0.9' },
    { question: 'majorIncident', field: null, action: 'suggest', reason: 'majorIncident is never applied without a person' },
  ];

  it('names the ticket by its number, the provider by name, and never the model', () => {
    const view = decisionView(decision({ plan } as never), new Map([['t-1', { number: 'INC-1042', title: 'Laptop won’t boot' }]]));
    expect(view).toMatchObject({ ticketLabel: 'INC-1042', ticketTitle: 'Laptop won’t boot', providerLabel: 'JEV', outcomeLabel: 'Set by AI', timeLabel: '320 ms', modeLabel: 'Auto' });
    expect(JSON.stringify(view)).not.toContain('jev-latest');
  });

  it('says "A ticket" when the number is not known, and "Nobody (rules)" when nobody answered', () => {
    const view = decisionView(decision({ provider: 'rules', outcome: 'none', answers: {}, attempts: [] }));
    expect(view).toMatchObject({ ticketLabel: 'A ticket', ticketNumber: null, providerLabel: 'Nobody (rules)', outcomeLabel: 'Nobody answered', timeLabel: '—' });
  });

  it('lists the answers in the desk’s order, with what each was allowed to do and why not more', () => {
    const view = decisionView(decision({ plan } as never));
    expect(view.answers.map((answer) => [answer.label, answer.value, answer.actionLabel])).toEqual([
      ['Category', 'Hardware', 'Set by AI'],
      ['Priority', 'P2', 'Suggested'],
      ['Major incident', 'No', 'Suggested'],
    ]);
    expect(view.answers[1]!.why).toBe('confidence 71% is below the auto threshold 90%');
    expect(view.answers[2]!.why).toBe('major incident is never applied without a person');
  });

  it('counts who was passed over and says why, in words', () => {
    const view = decisionView(decision());
    expect(view.passedOver).toBe(1);
    expect(view.passedOverReasons).toEqual(['Claude — outside this workspace’s allowed regions']);
    expect(view.attempts.map((attempt) => attempt.outcomeLabel)).toEqual(['Passed over', 'Answered']);
  });

  it('words a plan’s reasons for a person', () => {
    expect(whyText('mode is shadow')).toBe('the desk was in Shadow');
    expect(whyText('groupId was set by a person or a rule')).toBe('team was set by a person or a rule');
    expect(outcomeLook('shadowed').label).toBe('Recorded');
    expect(outcomeLook('mystery').label).toBe('Mystery');
  });

  it('keeps the decisions inside the range', () => {
    const now = Date.parse('2026-09-30T12:00:00.000Z');
    const rows = [{ createdAt: '2026-09-29T12:00:00.000Z' }, { createdAt: '2026-08-01T12:00:00.000Z' }];
    expect(decisionsWithin(rows, 30, now)).toHaveLength(1);
    expect(decisionsWithin(rows, 90, now)).toHaveLength(2);
  });

  it('reads the range from the URL as 30, 90 or 180 days', () => {
    expect(rangeFrom('90')).toBe(90);
    expect(rangeFrom(['180'])).toBe(180);
    expect(rangeFrom('7')).toBe(30);
    expect(rangeFrom(undefined)).toBe(30);
  });
});

describe('the decisions CSV', () => {
  it('quotes what must be quoted and defuses what a spreadsheet would run', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+44')).toBe("'+44");
    expect(csvCell(null)).toBe('');
    expect(csvCell(12)).toBe('12');
  });

  it('is UTF-8 with a byte-order mark, CRLF lines, one decision a line and each field in its own columns', () => {
    const view = decisionView(decision(), new Map([['t-1', { number: 'INC-1042', title: 'Printer, 3rd floor' }]]));
    const csv = decisionsCsv([view]);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('');
    expect(lines[0]).toBe(
      'When (UTC),Ticket,Ticket title,Mode,Outcome,Answered by,Time (ms),Cost,Passed over,Why passed over,Type,Type confidence,Category,Category confidence,Team,Team confidence,Priority,Priority confidence,Major incident,Major incident confidence',
    );
    expect(lines[1]).toBe(
      '2026-09-30T08:00:00.000Z,INC-1042,"Printer, 3rd floor",Auto,Set by AI,JEV,320,0.001p,1,Claude — outside this workspace’s allowed regions,,,Hardware,0.96,,,P2,0.71,No,0.99',
    );
  });

  it('is named for the workspace, the range and the reader’s day', () => {
    const now = Date.parse('2026-09-30T23:30:00.000Z');
    expect(decisionsCsvFileName({ workspace: 'acme', days: 30, now, timeZone: 'Europe/London' })).toBe('ai-triage-decisions-acme-last-30-days-2026-10-01.csv');
    expect(decisionsCsvFileName({ workspace: 'acme', days: 90, now, timeZone: 'America/New_York' })).toBe('ai-triage-decisions-acme-last-90-days-2026-09-30.csv');
    expect(decisionsCsvFileName({ workspace: 'Café Ünïon / HQ', days: 180, now, timeZone: 'UTC' })).toBe('ai-triage-decisions-cafe-union-hq-last-180-days-2026-09-30.csv');
    expect(decisionsCsvFileName({ workspace: null, days: 30, now, timeZone: 'Not/A_Zone' })).toBe('ai-triage-decisions-last-30-days-2026-09-30.csv');
  });
});
