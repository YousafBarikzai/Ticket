import { describe, expect, it } from 'vitest';
import {
  MARKER_REFERENCE_WIDTH,
  areaPath,
  arcPath,
  axisFormatter,
  chartId,
  describeTrend,
  diamondAt,
  foldOther,
  fraction,
  isolatedPoints,
  linePath,
  markerLabelWidth,
  monotonePath,
  niceScale,
  parseTimes,
  placeMarkers,
  quantise,
  relaxLabels,
  slotAt,
  tickIndices,
  timeLabels,
  type MarkerLabelInput,
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

describe('monotone curves', () => {
  /** Every number in a path, split into x and y pairs. */
  const pairs = (d: string): { x: number; y: number }[] => {
    const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const out: { x: number; y: number }[] = [];
    for (let index = 0; index + 1 < numbers.length; index += 2) out.push({ x: numbers[index]!, y: numbers[index + 1]! });
    return out;
  };

  it('never overshoots: every control point lies within the range of the points', () => {
    const shapes = [
      [0, 0, 100, 100, 100, 0],
      [10, 80, 20, 90, 15, 100, 5],
      [0, 0, 0, 50, 0, 0],
      [40, 41, 39, 120, 0, 60],
    ];
    for (const ys of shapes) {
      const points = ys.map((y, index) => ({ x: index / (ys.length - 1), y }));
      const all = pairs(monotonePath(points));
      expect(Math.max(...all.map((pair) => pair.y))).toBeLessThanOrEqual(Math.max(...ys));
      expect(Math.min(...all.map((pair) => pair.y))).toBeGreaterThanOrEqual(Math.min(...ys));
    }
  });

  it('keeps each segment within its own two points, so a step from zero never dips below zero', () => {
    const ys = [0, 0, 0, 80, 80, 80];
    const d = monotonePath(ys.map((y, index) => ({ x: index / 5, y })));
    const segments = d.split('C').slice(1).map(pairs);
    segments.forEach((segment, index) => {
      const low = Math.min(ys[index]!, ys[index + 1]!);
      const high = Math.max(ys[index]!, ys[index + 1]!);
      for (const point of segment) {
        expect(point.y).toBeGreaterThanOrEqual(low);
        expect(point.y).toBeLessThanOrEqual(high);
      }
    });
  });

  it('passes through every point and breaks at gaps, like the straight line', () => {
    const d = monotonePath([
      { x: 0, y: 10 },
      { x: 0.25, y: 20 },
      { x: 0.5, y: null },
      { x: 0.75, y: 30 },
      { x: 1, y: 40 },
    ]);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).toMatch(/^M0 10C.* 250 20M750 30C.* 1000 40$/);
  });

  it('is flat at a peak: the curve turns at the point, not beyond it', () => {
    const d = monotonePath([
      { x: 0, y: 50 },
      { x: 0.5, y: 10 },
      { x: 1, y: 50 },
    ]);
    // The control points either side of the peak share its y.
    expect(d).toMatch(/C\d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)? 10 500 10C\d+(?:\.\d+)? 10 /);
  });

  it('maps x through the caller’s scale', () => {
    expect(monotonePath([{ x: 0, y: 1 }, { x: 1, y: 2 }], (x) => 5 + x * 10)).toMatch(/^M5 1C.* 15 2$/);
  });
});

describe('diamonds', () => {
  it('draws a square turned 45° about its centre', () => {
    expect(diamondAt(7, 7, 6)).toBe('M7 1L13 7L7 13L1 7Z');
  });
});

describe('steps of a sequential ramp', () => {
  it('puts the lowest value in step 1 and the highest in the top step', () => {
    expect(quantise(0, 0, 80)).toBe(1);
    expect(quantise(80, 0, 80)).toBe(8);
  });

  it('puts a value on a boundary in the band above it', () => {
    expect(quantise(10, 0, 80)).toBe(2);
    expect(quantise(9.99, 0, 80)).toBe(1);
    expect(quantise(70, 0, 80)).toBe(8);
  });

  it('clamps values beyond the range, and keeps "no data" apart from the lightest step', () => {
    expect(quantise(-5, 0, 80)).toBe(1);
    expect(quantise(500, 0, 80)).toBe(8);
    expect(quantise(null, 0, 80)).toBe(0);
    expect(quantise(Number.NaN, 0, 80)).toBe(0);
  });

  it('has one step when every value is equal, and honours the step count', () => {
    expect(quantise(4, 4, 4)).toBe(1);
    expect(quantise(50, 0, 100, 4)).toBe(3);
    expect(quantise(50, 0, 100, 0)).toBe(1);
  });
});

describe('relaxing labels', () => {
  it('pushes labels 6 px apart to 14 px, keeping their order', () => {
    expect(relaxLabels([100, 106])).toEqual([100, 114]);
    expect(relaxLabels([106, 100])).toEqual([114, 100]);
  });

  it('leaves labels that are already clear where they are', () => {
    expect(relaxLabels([20, 60, 100])).toEqual([20, 60, 100]);
  });

  it('pushes up from the bottom when the last label would overflow', () => {
    expect(relaxLabels([230, 236, 238], 14, 0, 240)).toEqual([212, 226, 240]);
  });

  it('starts at the top and runs past the bottom when they cannot all fit', () => {
    expect(relaxLabels([5, 6, 7], 14, 0, 20)).toEqual([0, 14, 28]);
  });

  it('is deterministic for equal positions, and empty for none', () => {
    expect(relaxLabels([50, 50, 50])).toEqual([50, 64, 78]);
    expect(relaxLabels([])).toEqual([]);
  });
});

describe('placing marker labels', () => {
  const at = (id: string, kind: MarkerLabelInput['kind'], x: number, label?: string): MarkerLabelInput => ({ id, kind, x, ...(label ? { label } : {}) });
  const tiers = (result: ReturnType<typeof placeMarkers>): Record<string, number | null> =>
    Object.fromEntries(result.placements.map((placement) => [placement.id, placement.tier]));

  it('estimates a label from its length: 5.6 px a character, plus the pill’s padding', () => {
    expect(markerLabelWidth('As at 2 Oct', true)).toBeCloseTo(77.6);
    expect(markerLabelWidth('SG4', false)).toBeCloseTo(20.8);
    expect(MARKER_REFERENCE_WIDTH).toBe(1040);
  });

  it('puts two pills 3 % apart on two tiers', () => {
    const result = placeMarkers([at('today', 'today', 0.5, 'As at 2 Oct'), at('freeze', 'deadline', 0.53, 'Freeze starts')]);
    // The deadline outranks "today", so it keeps the first tier.
    expect(tiers(result)).toEqual({ today: 2, freeze: 1 });
    expect(result.tiers).toBe(2);
  });

  it('keeps pills far apart on one tier', () => {
    const result = placeMarkers([at('a', 'today', 0.2, 'As at 2 Oct'), at('b', 'deadline', 0.7, 'Go-live')]);
    expect(tiers(result)).toEqual({ a: 1, b: 1 });
    expect(result.tiers).toBe(1);
  });

  it('places gate labels first, then moves a pill to the free tier rather than hiding them', () => {
    const result = placeMarkers([at('sg4', 'milestone', 0.5, 'SG4'), at('today', 'today', 0.51, 'As at 2 Oct')]);
    expect(tiers(result)).toEqual({ sg4: 1, today: 2 });
  });

  it('lets a pill hide the gate labels in its way when both tiers are taken; their lines and diamonds stay', () => {
    const result = placeMarkers([
      at('sg4', 'milestone', 0.5, 'SG4 · Design'),
      at('sg5', 'milestone', 0.53, 'SG5 · Build'),
      at('today', 'today', 0.515, 'As at 2 Oct'),
    ]);
    expect(tiers(result)).toEqual({ sg4: null, sg5: 2, today: 1 });
  });

  it('aligns a label within 8 % of an edge inwards', () => {
    const result = placeMarkers([at('end', 'today', 0.97, 'As at 2 Oct'), at('start', 'milestone', 0.02, 'SG1'), at('mid', 'event', 0.5, 'Release')]);
    expect(result.placements.map((placement) => placement.edge)).toEqual(['end', 'start', undefined]);
  });

  it('fits labels to the card: what fits a full-width card collides on a narrow one', () => {
    const items = [at('a', 'milestone', 0.4, 'Design review'), at('b', 'milestone', 0.5, 'Build complete')];
    expect(tiers(placeMarkers(items))).toEqual({ a: 1, b: 1 });
    expect(tiers(placeMarkers(items, { span: 4 }))).toEqual({ a: 1, b: 2 });
  });

  it('places nothing for a marker without words, and reserves no tier', () => {
    const result = placeMarkers([at('m', 'milestone', 0.5)]);
    expect(result.placements).toEqual([{ id: 'm', tier: null }]);
    expect(result.tiers).toBe(0);
  });

  it('gives the same answer whatever order the markers come in', () => {
    const items = [at('sg4', 'milestone', 0.5, 'SG4'), at('today', 'today', 0.51, 'As at 2 Oct'), at('go', 'deadline', 0.52, 'Go-live')];
    const forwards = tiers(placeMarkers(items));
    expect(tiers(placeMarkers([...items].reverse()))).toEqual(forwards);
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

  it('skips the gaps of a series with missing periods', () => {
    expect(describeTrend([null, 12, null, 18])).toBe('Rising, 12 → 18');
    expect(describeTrend([null, null])).toBe('No data');
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
