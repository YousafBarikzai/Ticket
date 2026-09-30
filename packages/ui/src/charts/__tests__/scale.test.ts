import { describe, expect, it } from 'vitest';
import {
  areaPath,
  arcPath,
  axisFormatter,
  chartId,
  describeTrend,
  foldOther,
  fraction,
  isolatedPoints,
  linePath,
  niceScale,
  parseTimes,
  slotAt,
  tickIndices,
  timeLabels,
} from '../scale.js';

/**
 * The arithmetic every chart stands on. Each case names the way a chart goes
 * wrong when the arithmetic does: an axis nobody can read, a gap drawn as a
 * zero, a ninth colour, a label that says a trend fell when it rose.
 */

describe('nice scales', () => {
  it('rounds the bounds and ticks to numbers a person counts in', () => {
    expect(niceScale([3, 37, 41])).toEqual({ min: 0, max: 50, step: 10, ticks: [0, 10, 20, 30, 40, 50] });
    expect(niceScale([0.12, 0.93]).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it('keeps the baseline at zero unless asked not to, because bars and areas are read against it', () => {
    expect(niceScale([80, 95]).min).toBe(0);
    const fitted = niceScale([80, 95], { baseline: 'auto' });
    expect(fitted.min).toBeGreaterThan(0);
    expect(fitted.max).toBeGreaterThanOrEqual(95);
  });

  it('never gives a count axis a fractional tick', () => {
    const scale = niceScale([0, 1, 2]);
    expect(scale.ticks.every((tick) => Number.isInteger(tick))).toBe(true);
    expect(scale.max).toBeGreaterThanOrEqual(2);
  });

  it('gives a flat or empty series room rather than dividing by zero', () => {
    expect(niceScale([]).max).toBeGreaterThan(0);
    expect(niceScale([0, 0]).max).toBeGreaterThan(0);
    expect(niceScale([7, 7]).max).toBeGreaterThanOrEqual(7);
    expect(niceScale([-4, -4]).min).toBeLessThanOrEqual(-4);
  });

  it('writes no floating-point noise into a tick', () => {
    for (const tick of niceScale([0.1, 0.7], { count: 7 }).ticks) expect(String(tick)).not.toMatch(/0000|9999/);
  });

  it('places values between the bounds, clamped', () => {
    const scale = { min: 0, max: 50 };
    expect(fraction(25, scale)).toBe(0.5);
    expect(fraction(80, scale)).toBe(1);
    expect(fraction(-5, scale)).toBe(0);
  });

  it('shortens large axis values but not small ones', () => {
    expect(axisFormatter('en-GB', undefined, 40_000)(20_000)).toBe('20k');
    expect(axisFormatter('en-GB', undefined, 400)(200)).toBe('200');
    expect(axisFormatter('en-GB', { style: 'percent' }, 1)(0.5)).toBe('50%');
  });
});

describe('ticks along the x axis', () => {
  it('labels at an even step, always the first and the last', () => {
    expect(tickIndices(30).map((tick) => tick.index)).toEqual([0, 6, 12, 18, 24, 29]);
    expect(tickIndices(3).map((tick) => tick.index)).toEqual([0, 1, 2]);
  });

  it('lets the last label replace one that would crowd it', () => {
    expect(tickIndices(10).map((tick) => tick.index)).toEqual([0, 2, 4, 6, 9]);
  });

  it('keeps the first, middle and last for a narrow card', () => {
    const narrow = tickIndices(30).filter((tick) => !tick.wide).map((tick) => tick.index);
    expect(narrow).toEqual([0, 12, 29]);
  });

  it('handles nothing and one', () => {
    expect(tickIndices(0)).toEqual([]);
    expect(tickIndices(1)).toEqual([{ index: 0, wide: false }]);
  });
});

describe('the long tail', () => {
  const items = [
    { id: 'a', value: 10 },
    { id: 'b', value: 50 },
    { id: 'c', value: 5 },
    { id: 'd', value: 30 },
  ];
  const other = (value: number) => ({ id: 'other', value });

  it('keeps the largest and folds the rest into one "Other", keeping the order of the survivors', () => {
    expect(foldOther(items, 3, other)).toEqual([
      { id: 'b', value: 50 },
      { id: 'd', value: 30 },
      { id: 'other', value: 15 },
    ]);
  });

  it('folds nothing when everything fits', () => {
    expect(foldOther(items, 4, other)).toBe(items);
    expect(foldOther(items, undefined, other)).toBe(items);
  });

  it('never invents a ninth colour', () => {
    expect(slotAt(0)).toBe(1);
    expect(slotAt(7)).toBe(8);
    expect(slotAt(8)).toBe('other');
  });
});

describe('time', () => {
  it('reads whole dates as dates, not as midnight somewhere', () => {
    const xs = ['2026-09-01', '2026-09-02'];
    const labels = timeLabels(xs, parseTimes(xs)!, 'en-GB', 'America/Los_Angeles');
    // In Los Angeles, midnight UTC on the 1st is still the 31st.
    expect(labels.tick(0)).toMatch(/^1 Sept?$/);
    expect(labels.full(1)).toMatch(/Wed.* 2 Sept? 2026/);
  });

  it('labels hours within a day in the reader zone', () => {
    const xs = ['2026-09-01T08:00:00Z', '2026-09-01T12:00:00Z'];
    const labels = timeLabels(xs, parseTimes(xs)!, 'en-GB', 'Europe/London');
    expect(labels.tick(0)).toBe('09:00');
  });

  it('refuses a time axis whose values are not dates', () => {
    expect(parseTimes(['2026-09-01', 'P1'])).toBeNull();
  });
});

describe('paths', () => {
  const points = [
    { x: 0, y: 10 },
    { x: 0.25, y: 20 },
    { x: 0.5, y: null },
    { x: 0.75, y: 30 },
    { x: 1, y: 40 },
  ];

  it('breaks a line at a missing value instead of drawing it as zero', () => {
    expect(linePath(points)).toBe('M0 10L250 20M750 30L1000 40');
  });

  it('breaks the area the same way', () => {
    const floor = points.map((point) => ({ x: point.x, y: 100 }));
    expect(areaPath(points, floor).match(/Z/g)).toHaveLength(2);
  });

  it('draws a point alone between gaps as a dot, or it would vanish', () => {
    expect(isolatedPoints([{ x: 0, y: null }, { x: 0.5, y: 5 }, { x: 1, y: null }])).toEqual([{ x: 0.5, y: 5 }]);
  });

  it('draws a full ring in two halves, since one arc cannot end where it starts', () => {
    expect(arcPath(0, 1, 50, 30).match(/M/g)).toHaveLength(2);
    expect(arcPath(0, 0.25, 50, 30)).toMatch(/^M50 0A50 50 0 0 1 100 50L80 50A30 30 0 0 0 50 20Z$/);
  });
});

describe('words', () => {
  it('names a trend by its ends', () => {
    expect(describeTrend([12, 14, 18])).toBe('Rising, 12 → 18');
    expect(describeTrend([18, 15, 12])).toBe('Falling, 18 → 12');
    expect(describeTrend([100, 140, 101])).toBe('Steady, 100 → 101');
    expect(describeTrend([])).toBe('No data');
    expect(describeTrend([Number.NaN, 3])).toBe('Steady, 3 → 3');
  });

  it('formats with the caller’s formatter', () => {
    expect(describeTrend([0.1, 0.2], (value) => `${value * 100}%`)).toBe('Rising, 10% → 20%');
  });
});

describe('ids', () => {
  it('is the same wherever it is computed, and different for a different chart', () => {
    expect(chartId('donut', ['By channel', 'email'])).toBe(chartId('donut', ['By channel', 'email']));
    expect(chartId('donut', ['By channel', 'email'])).not.toBe(chartId('donut', ['By team', 'email']));
    expect(chartId('donut', ['x'])).toMatch(/^itsm-donut-[a-z0-9]+$/);
  });
});
