import { describe, expect, it } from 'vitest';
import {
  costOf,
  crossings,
  formatMicros,
  formatPence,
  penceToMicros,
  periodFor,
  problemWithLines,
  refusalMessage,
  stateFor,
} from '../domain/budget.js';

/**
 * The arithmetic a monthly AI budget depends on.
 *
 * Worth its own suite because every one of these has a plausible wrong answer:
 * rounding a fraction of a penny down, warning after the refusal, announcing
 * the same line twice, or formatting 4 pence as "£0.4".
 */
describe('what a call costs', () => {
  it('charges for input and output at different rates, because providers do', () => {
    // 1000 in + 1000 out on the small model: 60,000 + 300,000 micro-pence.
    expect(costOf('stub-small', 1000, 1000)).toBe(360_000n);
  });

  it('rounds up rather than to nearest, so the platform never under-counts its own bill', () => {
    // One token is a thousandth of the per-thousand price, and fractions of a
    // micro-penny have to land somewhere. Down is the direction that loses
    // money quietly.
    expect(costOf('stub-small', 1, 0)).toBe(60n);
    expect(costOf('stub-small', 0, 1)).toBe(300n);
  });

  it('charges nothing for a model it has no price for, rather than guessing', () => {
    expect(costOf('some-model-nobody-priced', 1000, 1000)).toBe(0n);
  });

  it('never charges for a negative token count', () => {
    expect(costOf('stub-small', -500, -500)).toBe(0n);
  });
});

describe('where a figure sits against the lines', () => {
  const lines = { warnPence: 800, limitPence: 1000 };

  it('is ok below the warning', () => {
    expect(stateFor(penceToMicros(799), lines)).toBe('ok');
  });

  it('warns at the line, not past it', () => {
    expect(stateFor(penceToMicros(800), lines)).toBe('warned');
  });

  it('blocks at the cap, not past it', () => {
    expect(stateFor(penceToMicros(1000), lines)).toBe('blocked');
  });

  it('never blocks when there is no cap, however much has been spent', () => {
    expect(stateFor(penceToMicros(1_000_000), { warnPence: 800, limitPence: null })).toBe('warned');
  });
});

describe('announcing a line', () => {
  const lines = { warnPence: 800, limitPence: 1000 };

  it('announces the warning once', () => {
    expect(crossings(penceToMicros(850), lines, { warned: false, blocked: false })).toEqual(['warned']);
    expect(crossings(penceToMicros(900), lines, { warned: true, blocked: false })).toEqual([]);
  });

  it('announces both when a single call jumps the warning and the cap together', () => {
    expect(crossings(penceToMicros(1200), lines, { warned: false, blocked: false })).toEqual(['warned', 'blocked']);
  });

  it('depends only on the figure and on what was already said, so a recomputation is silent', () => {
    const already = { warned: true, blocked: true };
    expect(crossings(penceToMicros(5000), lines, already)).toEqual([]);
  });
});

describe('reading a budget back', () => {
  it('formats money at the scale it is being talked about', () => {
    expect(formatMicros(0n)).toBe('£0.00');
    expect(formatMicros(1_240_000_000n)).toBe('£12.40');
    expect(formatMicros(100_000_000n)).toBe('£1.00');
  });

  it('never renders the cost of one call as nothing', () => {
    // A completion costs a fraction of a penny. Shown as "£0.00" it reads as
    // free, which is the one thing it is not, and is how a budget quietly
    // stops meaning anything.
    expect(formatMicros(54_000n)).toBe('0.054p');
    expect(formatMicros(4_000_000n)).toBe('4p');
    expect(formatMicros(99_000_000n)).toBe('99p');
    expect(formatMicros(1n)).toBe('0.001p');
  });

  it('names the figure, the cap and the month, and says what still works', () => {
    const message = refusalMessage(penceToMicros(2100), 2000, '2026-09');
    expect(message).toContain('£21.00');
    expect(message).toContain('£20.00');
    expect(message).toContain('2026-09');
    // The thing a desk needs to know at that moment is not that AI stopped.
    expect(message).toContain('tickets');
  });

  it('counts a cost against the calendar month it was incurred in', () => {
    expect(periodFor(new Date('2026-09-30T23:59:59Z'))).toBe('2026-09');
    expect(periodFor(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10');
  });

  it('refuses a warning above the cap, which could never be reached', () => {
    expect(problemWithLines({ warnPence: 2000, limitPence: 1000 })).toContain('never be reached');
    expect(problemWithLines({ warnPence: 1000, limitPence: 1000 })).toBeNull();
    expect(problemWithLines({ warnPence: null, limitPence: 1000 })).toBeNull();
    expect(problemWithLines({ warnPence: 2000, limitPence: null })).toBeNull();
  });

  it('shows whole pence as pounds', () => {
    expect(formatPence(2000)).toBe('£20.00');
  });
});
