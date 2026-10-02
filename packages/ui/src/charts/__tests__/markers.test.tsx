import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { chartFigureStyles } from '../ChartFigure.styles.js';
import type { ChartMarker } from '../common.js';
import {
  MARKER_TIER_HEIGHT,
  MarkerBackdrop,
  MarkerLayer,
  layoutMarkers,
  markerTableColumn,
  resolveBands,
  resolveMarkers,
  type MarkerAxis,
} from '../markers.js';
import { parseTimes } from '../scale.js';

/**
 * Markers over a time axis (A8 §3.1, §4.3.4): where "today" stands for the
 * reader, which labels share a tier and which give way, and the markup the
 * layer draws. Placement is decided without measuring anything, so each rule
 * can be read straight off the layout and the static HTML.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(element);

/** A day-bucketed axis from `first`, its points spread evenly across the plot, as the line chart places them. */
function dayAxis(first: string, count: number): MarkerAxis {
  const start = Date.parse(first);
  const xs = Array.from({ length: count }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
  return { xs, positions: xs.map((_, index) => (count === 1 ? 0.5 : index / (count - 1))), times: parseTimes(xs) };
}

const september = dayAxis('2026-09-02', 30); // 2 Sep … 1 Oct
const LONDON = { timeZone: 'Europe/London', locale: 'en-GB' } as const;

describe('placing "today"', () => {
  it('stands on the reader’s today, worded "As at 2 Oct", at the end of the line when UTC is still yesterday', () => {
    const [today] = resolveMarkers([{ kind: 'today' }], september, { ...LONDON, asAt: '2026-10-01T23:30:00Z' });
    expect(today).toEqual({ id: 'today-0', kind: 'today', x: 1, row: 29, label: 'As at 2 Oct' });
  });

  it('reads the same instant as 1 Oct in UTC', () => {
    const [today] = resolveMarkers([{ kind: 'today' }], september, { asAt: '2026-10-01T23:30:00Z' });
    expect(today?.label).toBe('As at 1 Oct');
  });

  it('stands mid-series on a date inside it, and takes the page’s own words', () => {
    const [today] = resolveMarkers([{ kind: 'today', label: 'Now' }], september, { ...LONDON, asAt: '2026-09-16T09:00:00Z' });
    expect(today).toMatchObject({ row: 14, label: 'Now' });
    expect(today!.x).toBeCloseTo(14 / 29);
  });

  it('is not drawn without asAt, outside the series, or on a category axis', () => {
    expect(resolveMarkers([{ kind: 'today' }], september, LONDON)).toEqual([]);
    expect(resolveMarkers([{ kind: 'today' }], september, { ...LONDON, asAt: '2026-10-10T12:00:00Z' })).toEqual([]);
    const categories: MarkerAxis = { xs: ['P1', 'P2'], positions: [0, 1] };
    expect(resolveMarkers([{ kind: 'today' }], categories, { ...LONDON, asAt: '2026-10-01T12:00:00Z' })).toEqual([]);
  });
});

describe('placing the other markers', () => {
  it('puts a marker on one of the chart’s own x values', () => {
    const [deadline] = resolveMarkers([{ kind: 'deadline', x: '2026-09-30', label: 'Go-live' }], september);
    expect(deadline).toMatchObject({ kind: 'deadline', row: 28, label: 'Go-live' });
    expect(deadline!.x).toBeCloseTo(28 / 29);
  });

  it('puts an instant between the points around it, on the row of the bucket it falls in', () => {
    const axis = dayAxis('2026-10-01', 3); // 1, 2, 3 Oct at 0, 0.5, 1
    const [breach] = resolveMarkers([{ kind: 'deadline', x: '2026-10-02T12:00:00Z', label: 'Breach 13:00' }], axis);
    expect(breach).toMatchObject({ row: 1, x: 0.75 });
  });

  it('leaves out a marker whose x is not on the axis, rather than pinning it to an edge', () => {
    expect(resolveMarkers([{ kind: 'event', x: '2026-11-15', label: 'Too late' }], september)).toEqual([]);
    expect(resolveMarkers([{ kind: 'event', x: 'whenever', label: 'Nonsense' }], september)).toEqual([]);
  });

  it('keeps a milestone’s state and drops an empty label', () => {
    const markers: ChartMarker[] = [
      { kind: 'milestone', x: '2026-09-10', label: 'SG1', reached: true },
      { kind: 'milestone', x: '2026-09-20', label: '  ' },
    ];
    expect(resolveMarkers(markers, september)).toEqual([
      expect.objectContaining({ id: 'milestone-0', label: 'SG1', reached: true }),
      expect.not.objectContaining({ label: expect.anything() }),
    ]);
  });

  it('clips a band to the axis and leaves out one wholly beyond it', () => {
    expect(resolveBands([{ from: '2026-08-20', to: '2026-09-02', label: 'Before' }], september)).toEqual([]);
    const [freeze] = resolveBands([{ from: '2026-09-25', to: '2026-10-20', label: 'Change freeze' }], september);
    expect(freeze).toMatchObject({ to: 1, label: 'Change freeze' });
    expect(freeze!.from).toBeCloseTo(23 / 29);
  });
});

describe('tiers', () => {
  const resolve = (markers: readonly ChartMarker[], asAt?: string) => resolveMarkers(markers, september, { ...LONDON, ...(asAt ? { asAt } : {}) });

  it('puts two pills a day apart on two tiers, the deadline on top, and reserves 18 px for each', () => {
    const layout = layoutMarkers(resolve([{ kind: 'today' }, { kind: 'deadline', x: '2026-09-17', label: 'Go-live' }], '2026-09-16T09:00:00Z'));
    expect(layout.items.map((item) => [item.kind, item.tier])).toEqual([
      ['today', 2],
      ['deadline', 1],
    ]);
    expect(layout.tiers).toBe(2);
    expect(layout.rowHeight).toBe(2 * MARKER_TIER_HEIGHT);
  });

  it('aligns "today" at the end of the series inwards', () => {
    const layout = layoutMarkers(resolve([{ kind: 'today' }], '2026-10-01T12:00:00Z'));
    expect(layout.items[0]).toMatchObject({ tier: 1, edge: 'end' });
  });

  it('keeps the gate labels and moves the pill when a tier is free; hides them only when none is', () => {
    const gates: ChartMarker[] = [
      { kind: 'milestone', x: '2026-09-16', label: 'SG4 · Design' },
      { kind: 'milestone', x: '2026-09-17', label: 'SG5 · Build' },
    ];
    const one = layoutMarkers(resolve([gates[0]!, { kind: 'today' }], '2026-09-16T09:00:00Z'));
    expect(one.items.map((item) => item.tier)).toEqual([1, 2]);
    const both = layoutMarkers(resolve([...gates, { kind: 'today' }], '2026-09-16T09:00:00Z'));
    expect(both.items.map((item) => item.tier)).toEqual([null, 2, 1]);
  });

  it('reserves nothing when there are no words to place', () => {
    expect(layoutMarkers(resolve([{ kind: 'milestone', x: '2026-09-10' }]))).toMatchObject({ tiers: 0, rowHeight: 0 });
  });
});

describe('the layer', () => {
  const resolved = resolveMarkers(
    [
      { kind: 'today' },
      { kind: 'deadline', x: '2026-09-25', label: 'Freeze starts' },
      { kind: 'milestone', x: '2026-09-03', label: 'SG1', reached: true },
      { kind: 'milestone', x: '2026-09-15', label: 'SG2' },
      { kind: 'event', x: '2026-09-20', label: 'Release' },
    ],
    september,
    { ...LONDON, asAt: '2026-10-01T23:30:00Z' },
  );
  const layout = layoutMarkers(resolved);
  const markup = html(<MarkerLayer layout={layout} bottom={240} target={{ y: 60, label: 'Target 90%' }} />);

  it('is decoration over the plot: hidden from assistive technology, which reads the table twin', () => {
    expect(markup).toMatch(/^<div class="itsm-Markers" aria-hidden="true" data-tiers="1">/);
  });

  it('draws a line per marker, starting under its own label and ending on the baseline', () => {
    expect(markup).toContain('<line class="itsm-Markers__line" data-kind="today" x1="100%" x2="100%" y1="18" y2="240">');
    expect(markup.match(/class="itsm-Markers__line"/g)).toHaveLength(5);
  });

  it('puts filled diamonds on reached milestones and deadlines, hollow ones on milestones ahead, none on events', () => {
    const diamonds = [...markup.matchAll(/<svg class="itsm-Markers__diamond" data-kind="(\w+)"( data-reached="")?/g)].map((match) => `${match[1]}${match[2] ? ' filled' : ''}`);
    expect(diamonds).toEqual(['deadline filled', 'milestone filled', 'milestone']);
    expect(markup).toMatch(/itsm-Markers__diamond[^>]*style="left:[\d.]+%;top:240px"/);
    expect(markup).toContain('<path d="M7.5 1.14L13.86 7.5L7.5 13.86L1.14 7.5Z">');
  });

  it('writes pills and gate labels as HTML on their tiers, aligned inwards at an edge', () => {
    expect(markup).toContain('<span class="itsm-Markers__label" data-kind="today" data-tier="1" data-edge="end" data-pill="" style="left:100%">As at 2 Oct</span>');
    expect(markup).toMatch(/<span class="itsm-Markers__label" data-kind="milestone" data-tier="1" data-gate="" style="left:[\d.]+%">SG2<\/span>/);
    expect(markup).toMatch(/data-kind="milestone" data-tier="1" data-edge="start" data-gate=""[^>]*>SG1</);
  });

  it('labels the target line at its start', () => {
    expect(markup).toContain('<span class="itsm-Markers__targetLabel" style="top:60px">Target 90%</span>');
  });

  it('renders nothing when there is nothing to show', () => {
    expect(html(<MarkerLayer layout={layoutMarkers([])} bottom={240} />)).toBe('');
  });

  it('renders the same markup every time', () => {
    expect(html(<MarkerLayer layout={layoutMarkers(resolved)} bottom={240} />)).toBe(html(<MarkerLayer layout={layoutMarkers(resolved)} bottom={240} />));
  });
});

describe('the backdrop', () => {
  it('shades bands and draws the target behind the data, in an unscaled SVG group', () => {
    const svg = html(
      <svg>
        <MarkerBackdrop bands={[{ from: 0.25, to: 0.5 }]} target={{ y: 60 }} top={18} bottom={240} />
      </svg>,
    );
    expect(svg).toContain('<g class="itsm-Markers__backdrop"><rect class="itsm-Markers__band" x="25%" width="25%" y="18" height="222"></rect>');
    expect(svg).toContain('<line class="itsm-Markers__target" x1="0" x2="100%" y1="60" y2="60"></line>');
  });

  it('renders nothing without bands or a target', () => {
    expect(html(<svg><MarkerBackdrop top={0} bottom={240} /></svg>)).toBe('<svg></svg>');
  });
});

describe('the table twin', () => {
  it('names each marker on the row of its x, and adds no column when there are none', () => {
    const resolved = resolveMarkers(
      [
        { kind: 'today' },
        { kind: 'deadline', x: '2026-10-01', label: 'Breach 16:01' },
        { kind: 'milestone', x: '2026-09-02', label: 'SG1', reached: true },
        { kind: 'event', x: '2026-09-10', label: 'Release' },
      ],
      september,
      { ...LONDON, asAt: '2026-10-01T09:00:00Z' },
    );
    const column = markerTableColumn(resolved, september.xs.length)!;
    expect(column.header).toBe('Marker');
    expect(column.cells[29]).toBe('As at 1 Oct; Deadline: Breach 16:01');
    expect(column.cells[0]).toBe('Milestone: SG1, reached');
    expect(column.cells[8]).toBe('Event: Release');
    expect(column.cells[5]).toBe('');
    expect(markerTableColumn([], 30)).toBeNull();
  });
});

describe('styles', () => {
  it('draws "today" dashed 4 3 in the secondary ink at 60 %, deadlines dashed 5 4, milestones dotted at 30 %', () => {
    expect(chartFigureStyles).toMatch(/\.itsm-Markers__line\[data-kind="today"\] \{[^}]*stroke: var\(--itsm-colour-text-secondary\);[^}]*stroke-opacity: 0\.6;[^}]*stroke-dasharray: 4 3;/);
    expect(chartFigureStyles).toMatch(/\.itsm-Markers__line\[data-kind="deadline"\] \{\s*stroke-dasharray: 5 4;/);
    expect(chartFigureStyles).toMatch(/\[data-kind="milestone"\],\s*\.itsm-Markers__line\[data-kind="event"\] \{[^}]*stroke-opacity: 0\.3;[^}]*stroke-dasharray: 2 3;/);
  });

  it('paints pills in the marker navy with the marker text, never violet', () => {
    expect(chartFigureStyles).toMatch(/\.itsm-Markers__label\[data-pill\] \{[^}]*background: var\(--itsm-colour-chart-marker\);[^}]*color: var\(--itsm-colour-chart-markerText\);/);
  });

  it('puts tier 2 one 18 px row below tier 1', () => {
    expect(chartFigureStyles).toMatch(/\.itsm-Markers__label\[data-tier="2"\] \{\s*inset-block-start: 1\.125rem;/);
  });

  it('hides tier-2 gate labels below 40rem and all gate labels below 32rem, never pills or diamonds', () => {
    expect(chartFigureStyles).toMatch(/@container itsm-chart \(max-width: 40rem\) \{\s*\.itsm-Markers__label\[data-gate\]\[data-tier="2"\] \{\s*display: none;/);
    expect(chartFigureStyles).toMatch(/@container itsm-chart \(max-width: 32rem\) \{\s*\.itsm-Markers__label\[data-gate\] \{\s*display: none;/);
    expect(chartFigureStyles).not.toMatch(/\.itsm-Markers__(diamond|label\[data-pill\])[^{]*\{\s*display: none/);
  });

  it('keeps every marker visible in forced colours, in Highlight', () => {
    expect(chartFigureStyles).toMatch(/@media \(forced-colors: active\) \{[\s\S]*\.itsm-Markers__line,\s*\.itsm-Markers__target \{\s*stroke: Highlight;/);
  });
});
