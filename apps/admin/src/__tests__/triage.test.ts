import { describe, expect, it } from 'vitest';
import type { DecisionQuestionScore } from '@itsm/sdk';
import {
  acceptanceText,
  appliedText,
  asPercent,
  autoNotice,
  autoReadiness,
  brierText,
  calibrationRows,
  fieldLabel,
  gateText,
  lastStepDownText,
  modeNotice,
  skipLabel,
  skipRows,
  stepDownText,
  suggestReadiness,
} from '../triage.js';

/**
 * How the shadow triage page words its numbers. Each case is a way a number
 * could be shown as something it is not.
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

  it('names fields the way a desk does', () => {
    expect(fieldLabel('group')).toBe('Assignment group');
    expect(fieldLabel('somethingNew')).toBe('somethingNew');
  });
});

describe('the auto-apply gate', () => {
  it('says a field that is never auto-applied is never auto-applied', () => {
    expect(gateText(question({ question: 'priority', autoGate: null }))).toBe('Never applied without a person');
  });

  it('says why a field has not earned it yet', () => {
    expect(gateText(question())).toBe('Not yet — 4 scored answers at or above 0.9; 200 are needed');
  });

  it('says when it has', () => {
    expect(
      gateText(question({ autoGate: { eligible: true, considered: 240, agreement: 0.97, reason: '97.0% agreement over 240 answers' } })),
    ).toBe('Earned — 97.0% agreement over 240 answers');
  });
});

describe('fallbacks', () => {
  it('describes a skip in words, provider first', () => {
    expect(skipLabel('jev:not-registered')).toBe('jev — not set up in this deployment');
    expect(skipLabel('anthropic:residency')).toBe('anthropic — outside this desk’s allowed regions');
  });

  it('lists the most frequent first', () => {
    expect(skipRows({ 'jev:not-registered': 3, 'anthropic:timeout': 5 }).map((row) => row.key)).toEqual([
      'anthropic:timeout',
      'jev:not-registered',
    ]);
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
  });
});

describe('what the page says first', () => {
  it('tells a desk with triage off how to turn it on', () => {
    expect(modeNotice({ mode: 'off', decisions: 0 })).toMatch(/ai\.decision\.triage/);
  });

  it('tells a desk in shadow with nothing yet what it is waiting for', () => {
    expect(modeNotice({ mode: 'shadow', decisions: 0 })).toMatch(/shadow mode.*new email, chat, voice and portal tickets/);
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
    expect(text).toMatch(/Assignment group is suggested until it has earned it/);
    expect(text).toMatch(/type, priority, major incident — is always only suggested/);
  });

  it('says plainly when no field has earned it, so auto is only suggesting', () => {
    expect(autoNotice({ mode: 'auto', questions: [question(), group(false)] })).toMatch(/no field has earned it yet, so it only suggests/);
  });

  it('is silent outside auto', () => {
    expect(autoNotice({ mode: 'suggest', questions: [question({ autoGate: EARNED })] })).toBeNull();
  });

  it('puts the gate beside the switch while the desk is suggesting', () => {
    expect(autoReadiness({ mode: 'suggest', questions: [question({ autoGate: EARNED }), group(true)] })).toMatch(
      /Category and assignment group have earned it\./,
    );
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
});
