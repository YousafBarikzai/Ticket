// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, press, render } from '../../web/__tests__/support/render.js';
import { BarChart, type BarDatum, type BarSeriesDef } from '../BarChart.js';
import { barChartStyles } from '../BarChart.styles.js';
import { ChartCard } from '../ChartCard.js';

/**
 * `BarChart` v3 (SPEC-v3 §8.2, A8 §4.8): rows, lists and columns; stacked,
 * grouped and normalised parts; tones that make priority stacks honest; a
 * comparison series in grey; labels inside parts by container query; totals,
 * a target and "As at" on time columns; "Other · n" hatched; the table twin;
 * the reveal; and the card contract — a headline read once and seen once.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const count = (markup: string, pattern: RegExp): number => markup.match(pattern)?.length ?? 0;
/** The text of every match of a capturing pattern, in order. */
const all = (markup: string, pattern: RegExp): string[] => [...markup.matchAll(pattern)].map((match) => match[1]!);

afterEach(() => cleanupDocument());

const channels: BarDatum[] = [
  { id: 'email', label: 'Email', value: 412, icon: 'mail', href: '/tickets?channel=email' },
  { id: 'slack', label: 'Slack', value: 142 },
  { id: 'portal', label: 'Portal', value: 318, secondary: 'self-service' },
];

const priorities: BarSeriesDef[] = [
  { id: 'p1', label: 'P1', tone: 'danger' },
  { id: 'p2', label: 'P2', tone: 'high' },
  { id: 'p3', label: 'P3', tone: 'neutral' },
  { id: 'p4', label: 'P4', tone: 'neutralSoft' },
];
const backlog: BarDatum[] = [
  { id: 'day', label: '< 1 d', value: 0, series: { p1: 1, p2: 3, p3: 8, p4: 2 } },
  { id: 'week', label: '1–7 d', value: 0, series: { p1: 0, p2: 2, p3: 5, p4: 4 } },
];

/** Weekly buckets keyed by their Monday, as the analytics API returns them. */
const weeks = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'];
const volume: BarDatum[] = weeks.map((id, index) => ({ id, label: `w/c ${index + 1}`, value: 0, series: { raised: [12, 30, 18, 20][index]!, resolved: [10, 22, 20, 15][index]! } }));
const raisedResolved: BarSeriesDef[] = [
  { id: 'raised', label: 'Raised', style: 'comparison' },
  { id: 'resolved', label: 'Resolved' },
];

describe('rows and lists (v2 cases kept)', () => {
  it('lists label · bar · value rows, largest first, as a ranked list', () => {
    const markup = html(<BarChart title="By channel" variant="list" data={channels} />);
    expect(markup).toMatch(/<ol class="itsm-BarChart__rows">/);
    expect(all(markup, /itsm-BarChart__name[^"]*">([^<]+)</g)).toEqual(['Email', 'Portal', 'Slack']);
    // Each row reads as "Email 412": the label, then the value; the bar is decoration.
    expect(markup).toMatch(/<span class="itsm-BarChart__value">412<\/span><span class="itsm-BarChart__track" aria-hidden="true">/);
    expect(markup).toContain('data-layout="list"');
  });

  it('keeps the given order when asked, as an unordered list', () => {
    const markup = html(<BarChart title="By channel" variant="list" sort="none" data={channels} />);
    expect(markup).toMatch(/<ul class="itsm-BarChart__rows">/);
    expect(all(markup, /itsm-BarChart__name[^"]*">([^<]+)</g)).toEqual(['Email', 'Slack', 'Portal']);
  });

  it('links a row and carries its icon and qualifier', () => {
    const markup = html(<BarChart title="By channel" variant="list" data={channels} />);
    expect(markup).toContain('<a href="/tickets?channel=email" class="itsm-BarChart__name itsm-BarChart__link">Email</a>');
    expect(markup).toMatch(/<svg[^>]*itsm-BarChart__icon/);
    expect(markup).toContain('<span class="itsm-BarChart__secondary">self-service</span>');
  });

  it('sizes each bar against the largest, and draws nothing for a zero', () => {
    const markup = html(<BarChart title="By channel" variant="list" data={[...channels, { id: 'fax', label: 'Fax', value: 0 }]} />);
    expect(markup).toContain('--_itsm-bar:1');
    expect(markup).toMatch(/--_itsm-bar:0\.3446/);
    const fax = markup.slice(markup.indexOf('>Fax<'));
    expect(fax.slice(0, fax.indexOf('</li>'))).not.toContain('itsm-BarChart__segment');
  });

  it('puts the value at the tip of a horizontal bar, measured in the widest value', () => {
    const markup = html(<BarChart title="By team" data={channels} />);
    expect(markup).toContain('data-layout="rows"');
    expect(markup).toContain('--_itsm-value-ch:3');
  });

  it('leaves the table out of rows, which already say every value, unless asked', () => {
    expect(html(<BarChart title="By channel" variant="list" data={channels} />)).not.toContain('<table');
    expect(html(<BarChart title="By channel" variant="list" data={channels} table="toggle" />)).toContain('<table');
  });

  it('formats values, empty and loading states', () => {
    expect(html(<BarChart title="Accuracy" variant="list" valueFormat={{ style: 'percent' }} data={[{ id: 'p', label: 'Priority', value: 0.92 }]} />)).toContain('>92%<');
    expect(html(<BarChart title="By team" data={[]} />)).toContain('No data for this period');
    expect(html(<BarChart title="By team" data={channels} loading />)).toContain('aria-busy="true"');
  });

  it('reads rows with the arrow keys down the list when interactive', () => {
    const markup = html(<BarChart title="By team" data={channels} interactive />);
    expect(markup).toContain('Use ↑ ↓ to read values');
    expect(count(markup, /data-point="\d"/g)).toBe(3);
  });
});

describe('colour: one series, tones, the emphasis form and "Other · n"', () => {
  it('paints one series in the accent, and folds the tail into "Other · n", neutral and hatched', () => {
    const markup = html(<BarChart title="By channel" variant="list" maxBars={2} data={channels} />);
    expect(count(markup, /data-slot="1"/g)).toBe(1);
    expect(markup).toMatch(/itsm-BarChart__name">Other · 2<\/span><\/span><span class="itsm-BarChart__value">460</);
    expect(markup).toContain('<span class="itsm-BarChart__segment" data-tone="neutral" data-pattern="hatch" style="flex-grow:1"></span>');
  });

  it('colours a bar by its own tone or slot on a chart of one series', () => {
    const markup = html(
      <BarChart
        title="Open by priority"
        sort="none"
        data={[
          { id: 'p1', label: 'P1', value: 3, tone: 'danger' },
          { id: 'p2', label: 'P2', value: 7, tone: 'high', slot: 4 },
          { id: 'x', label: 'Team', value: 2, slot: 4 },
          { id: 'u', label: 'Unassigned', value: 5, pattern: 'hatch' },
        ]}
      />,
    );
    expect(markup).toContain('class="itsm-BarChart__segment" data-tone="danger"');
    // A tone wins over a slot: the P2 bar is the P2 colour whatever slot it would have had.
    expect(markup).toContain('class="itsm-BarChart__segment" data-tone="high" style');
    expect(markup).toContain('class="itsm-BarChart__segment" data-slot="4" style');
    expect(markup).toContain('class="itsm-BarChart__segment" data-slot="1" data-pattern="hatch"');
  });

  it('puts one bar in the accent and the rest in grey for the emphasis form', () => {
    const markup = html(<BarChart title="Resolved per agent" highlight="alex" data={[{ id: 'alex', label: 'Alex', value: 12, tone: 'danger' }, { id: 'sam', label: 'Sam', value: 9 }, { id: 'kim', label: 'Kim', value: 4 }]} />);
    expect(count(markup, /data-slot="1"/g)).toBe(1);
    expect(count(markup, /data-tone="neutral"/g)).toBe(2);
    expect(markup).not.toContain('data-tone="danger"');
  });

  it('stacks priority tones honestly: P1 danger, P2 high, P3 neutral, P4 the soft fill with its outline', () => {
    const markup = html(<BarChart title="Backlog age" layout="stacked" seriesDefs={priorities} data={backlog} sort="none" />);
    expect(all(markup, /class="itsm-BarChart__segment" data-tone="([a-zA-Z]+)"/g).slice(0, 4)).toEqual(['danger', 'high', 'neutral', 'neutralSoft']);
    // The tone legend keys the same way, as square chips.
    expect(all(markup, /class="itsm-ChartLegend__key" data-mark="chip" data-tone="([a-zA-Z]+)"/g)).toEqual(['danger', 'high', 'neutral', 'neutralSoft']);
    // `neutralSoft` sets `--_itsm-series-edge`; every part draws it, so the soft fill keeps a 3:1 edge.
    expect(barChartStyles).toMatch(/\.itsm-BarChart__segment \{[^}]*box-shadow: inset 0 0 0 1px var\(--_itsm-series-edge, transparent\);/);
  });

  it('stacks parts with their series colours, says the breakdown in words, and keys them', () => {
    const markup = html(
      <BarChart
        title="By team"
        variant="list"
        seriesDefs={[
          { id: 'p1', label: 'P1', slot: 6 },
          { id: 'p2', label: 'P2', slot: 2 },
        ]}
        data={[{ id: 'desk', label: 'Desk', value: 0, series: { p1: 3, p2: 9 } }]}
      />,
    );
    expect(markup).toMatch(/itsm-BarChart__value">12<span class="itsm-visually-hidden"> \(P1 3, P2 9\)<\/span>/);
    expect(markup).toContain('data-slot="6" style="flex-grow:3"');
    expect(markup).toContain('data-slot="2" style="flex-grow:9"');
    expect(count(markup, /itsm-ChartLegend__item/g)).toBe(2);
  });

  it('draws a comparison series in grey, giving the measured series the accent', () => {
    const markup = html(<BarChart title="Volume" layout="grouped" seriesDefs={raisedResolved} data={volume} />);
    expect(markup).toContain('class="itsm-BarChart__segment" data-style="comparison"');
    expect(markup).toContain('class="itsm-BarChart__segment" data-slot="1"');
    expect(markup).toContain('<span class="itsm-ChartLegend__key" data-mark="chip" data-style="comparison" aria-hidden="true"></span><span class="itsm-ChartLegend__label">Raised</span>');
  });

  it('hatches a part marked as such, a forecast, and the parts of a stacked "Other · n", in every theme', () => {
    const markup = html(
      <BarChart
        title="Open work by team"
        maxBars={2}
        seriesDefs={[
          { id: 'assigned', label: 'Assigned' },
          { id: 'unassigned', label: 'Unassigned', tone: 'neutral', pattern: 'hatch' },
          { id: 'next', label: 'Next week', style: 'forecast' },
        ]}
        data={[
          { id: 'net', label: 'Network', value: 0, series: { assigned: 16, unassigned: 11, next: 4 } },
          { id: 'desk', label: 'Desk', value: 0, series: { assigned: 9, unassigned: 2, next: 1 } },
          { id: 'apps', label: 'Apps', value: 0, series: { assigned: 5, unassigned: 1, next: 1 } },
        ]}
        table="visible"
      />,
    );
    expect(markup).toContain('class="itsm-BarChart__segment" data-tone="neutral" data-pattern="hatch"');
    // The forecast is hatched in its own colour; the toned series before it took slot 2's place.
    expect(markup).toContain('class="itsm-BarChart__segment" data-slot="3" data-pattern="hatch"');
    expect(markup).toContain('<th scope="col" data-numeric="true">Next week (forecast)</th>');
    // The folded bar keeps its parts' colours, hatched, so it never reads as a team of its own.
    const other = markup.slice(markup.indexOf('>Other · 2<'));
    expect(other.slice(0, other.indexOf('</li>'))).toContain('class="itsm-BarChart__segment" data-slot="1" data-pattern="hatch" style="flex-grow:14"');
    // Hatched in every theme: the rule comes after the contrast rules, so they cannot take the hatch away.
    const hatch = barChartStyles.indexOf('.itsm-BarChart :is(.itsm-BarChart__segment, .itsm-ChartLegend__key)[data-pattern="hatch"]');
    expect(hatch).toBeGreaterThan(barChartStyles.indexOf('[data-itsm-theme="high-contrast"] .itsm-BarChart__segment'));
    expect(markup).toContain('<span class="itsm-ChartLegend__key" data-mark="chip" data-tone="neutral" data-pattern="hatch" aria-hidden="true"></span>');
  });
});

describe('layouts', () => {
  it('stacks by default with seriesDefs, and draws one series without', () => {
    expect(html(<BarChart title="x" seriesDefs={priorities} data={backlog} />)).toContain('(P1 1, P2 3, P3 8, P4 2)');
    expect(html(<BarChart title="x" layout="stacked" data={channels} />)).not.toContain('itsm-ChartLegend');
  });

  it('groups up to three bars side by side in each column, each at most 24 px wide, 2 px apart', () => {
    const three: BarSeriesDef[] = [...raisedResolved, { id: 'breached', label: 'Breached', tone: 'danger' }];
    const markup = html(
      <BarChart title="Volume by week" layout="grouped" seriesDefs={three} data={volume.map((datum) => ({ ...datum, series: { ...datum.series, breached: 2 } }))} />,
    );
    // Grouped bars stand on one baseline, so the chart is columns whatever orientation was asked.
    expect(markup).toContain('data-layout="columns"');
    expect(count(markup, /class="itsm-BarChart__group"/g)).toBe(4);
    expect(count(markup, /class="itsm-BarChart__bar"/g)).toBe(12);
    // Each bar is its own length on the shared axis (0–30): 12 → 0.4, 10 → 0.333.
    expect(markup).toMatch(/class="itsm-BarChart__group"><span class="itsm-BarChart__bar" style="--_itsm-bar:0\.4">/);
    expect(barChartStyles).toMatch(/\.itsm-BarChart__group \{[^}]*gap: var\(--itsm-border-thick\);[^}]*inline-size: 70%;/);
    expect(barChartStyles).toMatch(/\.itsm-BarChart__group > \.itsm-BarChart__bar \{\s*flex: 0 1 1\.5rem;/);
    expect(barChartStyles).toMatch(/\.itsm-BarChart__column \.itsm-BarChart__bar \{[^}]*inline-size: min\(1\.5rem, 64%\);/);
    // The table lists each series as a column; a group's bars have no total to add up to.
    const table = markup.slice(markup.indexOf('<thead>'));
    expect(all(table, /<th scope="col"[^>]*>([^<]+)</g)).toEqual(['Category', 'Raised', 'Resolved', 'Breached']);
    expect(markup).toMatch(/Raised highest in w\/c 2 \(30\), Resolved highest in w\/c 2 \(22\) and Breached highest in w\/c 1 \(2\)\./);
  });

  it('normalises every bar to 100 %, reading its parts as shares on a 0–100 % axis', () => {
    const markup = html(<BarChart title="Priority mix" layout="normalised" orientation="vertical" seriesDefs={priorities} data={backlog} table="visible" />);
    expect(all(markup, /class="itsm-BarChart__bar" style="--_itsm-bar:([\d.]+)"/g)).toEqual(['1', '1']);
    expect(all(markup, /itsm-BarChart__yTick"[^>]*>([^<]+)</g)).toEqual(['0%', '25%', '50%', '75%', '100%']);
    const body = markup.slice(markup.indexOf('<tbody>'));
    const firstRow = all(body.slice(0, body.indexOf('</tr>')), /<td[^>]*>([^<]+)</g);
    expect(firstRow).toEqual(['7%', '21%', '57%', '14%', '14']);
    expect(firstRow.slice(0, 4).reduce((sum, cell) => sum + Number.parseInt(cell, 10), 0)).toBeCloseTo(100, -1);
    expect(markup).toContain('Overall: P1 4%, P2 20%, P3 52% and P4 24%, of 25 in all.');
  });

  it('keeps the count of a normalised row as its value and says the shares in words', () => {
    const markup = html(<BarChart title="Priority mix" layout="normalised" seriesDefs={priorities} data={backlog} />);
    expect(markup).toMatch(/itsm-BarChart__value">14<span class="itsm-visually-hidden"> \(P1 7%, P2 21%, P3 57%, P4 14%\)<\/span>/);
  });
});

describe('labels', () => {
  it('writes each part inside its part only where it is at least 28 px long, by container query', () => {
    const markup = html(<BarChart title="Backlog age" seriesDefs={priorities} data={backlog} labels="segments" />);
    expect(markup).toContain('data-labels="segments"');
    expect(markup).toContain('<span class="itsm-BarChart__segment" data-tone="neutral" style="flex-grow:8"><span class="itsm-BarChart__segmentLabel">8</span></span>');
    expect(barChartStyles).toMatch(/\.itsm-BarChart\[data-labels="segments"\] \.itsm-BarChart__segment \{\s*container: itsm-bar \/ inline-size;/);
    expect(barChartStyles).toMatch(/\.itsm-BarChart\[data-labels="segments"\] \.itsm-BarChart__column \.itsm-BarChart__segment \{\s*container-type: size;/);
    expect(barChartStyles).toMatch(/@container itsm-bar \(min-width: 28px\) \{\s*\.itsm-BarChart\[data-layout="rows"\] \.itsm-BarChart__segmentLabel \{ display: block; \}/);
    expect(barChartStyles).toMatch(/@container itsm-bar \(min-height: 28px\) \{\s*\.itsm-BarChart__column \.itsm-BarChart__segmentLabel \{ display: block; \}/);
    // On a chip of the card's colour, so the words keep their contrast on any part.
    expect(barChartStyles).toMatch(/\.itsm-BarChart__segmentLabel \{\s*display: none;[^}]*background: var\(--_itsm-chart-surface\);\s*color: var\(--itsm-colour-text-primary\);/);
    expect(html(<BarChart title="x" seriesDefs={priorities} data={backlog} />)).not.toContain('itsm-BarChart__segmentLabel');
  });

  it('puts each column’s total at its end, with room kept above the tallest', () => {
    const markup = html(<BarChart title="Per day" orientation="vertical" labels="total" data={[{ id: 'mon', label: 'Mon', value: 5 }, { id: 'tue', label: 'Tue', value: 12 }]} />);
    expect(all(markup, /class="itsm-BarChart__total">([^<]+)</g)).toEqual(['5', '12']);
    // The total goes first, so the top part stays the bar's last child and keeps its rounded end.
    expect(markup).toContain('<span class="itsm-BarChart__bar" style="--_itsm-bar:0.3333333333333333"><span class="itsm-BarChart__total">5</span><span class="itsm-BarChart__segment"');
    expect(markup).toContain('--_itsm-plot-top:24px');
    expect(html(<BarChart title="Per day" orientation="vertical" data={[{ id: 'mon', label: 'Mon', value: 5 }]} />)).not.toContain('itsm-BarChart__total');
  });
});

describe('target and markers', () => {
  it('draws a dashed target across columns, with its label, on an axis stretched to include it', () => {
    const markup = html(<BarChart title="Responses per week" orientation="vertical" target={{ value: 25 }} data={[{ id: 'a', label: 'A', value: 10 }, { id: 'b', label: 'B', value: 18 }, { id: 'c', label: 'C', value: 30 }]} />);
    expect(all(markup, /itsm-BarChart__yTick"[^>]*>([^<]+)</g)).toEqual(['0', '10', '20', '30']);
    expect(markup).toMatch(/<svg class="itsm-BarChart__overlay" width="100%" height="220" aria-hidden="true" focusable="false"><g class="itsm-Markers__backdrop"><line class="itsm-Markers__target" x1="0" x2="100%" y1="\d+" y2="\d+"><\/line><\/g><\/svg>/);
    expect(markup).toContain('class="itsm-Markers__targetLabel"');
    expect(markup).toContain('>Target 25<');
    expect(markup).toContain('Target 25: 1 of 3 at or above it.');
    const stretched = html(<BarChart title="x" orientation="vertical" target={{ value: 50, label: 'Plan 50' }} data={[{ id: 'a', label: 'A', value: 10 }]} />);
    expect(all(stretched, /itsm-BarChart__yTick"[^>]*>([^<]+)</g).at(-1)).toBe('50');
    // A page's own words are said as a target too.
    expect(stretched).toContain('A (10). Target 50 (Plan 50): 0 of 1 at or above it.');
  });

  it('ticks the target in every row at one place, and keys it, where a row has no room for its label', () => {
    const markup = html(<BarChart title="Met by team" variant="list" valueFormat={{ style: 'percent' }} target={{ value: 0.9, label: 'Target 90%' }} data={[{ id: 'a', label: 'Desk', value: 0.92 }, { id: 'b', label: 'Network', value: 0.81 }]} />);
    expect(markup).toMatch(/--_itsm-target:0\.97826/);
    expect(count(markup, /<span class="itsm-BarChart__target"><\/span>/g)).toBe(2);
    expect(markup).toContain('<span class="itsm-ChartLegend__key" data-mark="chip" data-style="baseline" aria-hidden="true"></span><span class="itsm-ChartLegend__label">Target 90%</span>');
    expect(markup).toContain('Target 90%: 1 of 2 at or above it.');
    expect(barChartStyles).toMatch(/\.itsm-BarChart__target \{[^}]*inset-inline-start: calc\(var\(--_itsm-target\) \* \(100% - var\(--_itsm-track-pad, 0px\)\)\);[^}]*border-inline-start: 1px dashed var\(--itsm-colour-text-secondary\);/);
  });

  it('marks "As at" on the week that holds the reader’s today, and names it in the table', () => {
    const markup = html(
      <BarChart title="Volume by week" layout="grouped" seriesDefs={raisedResolved} data={volume} asAt="2026-10-02T10:00:00Z" timeZone="Europe/London" markers={[{ kind: 'today' }]} table="visible" />,
    );
    expect(markup).toContain('<line class="itsm-Markers__line" data-kind="today" x1="87.5%" x2="87.5%"');
    expect(markup).toContain('data-pill="" style="left:87.5%">As at 2 Oct</span>');
    // Its label claims a tier above the data: 8 + 18 px.
    expect(markup).toContain('--_itsm-plot-top:26px');
    const rows = markup.slice(markup.indexOf('<tbody>')).split('</tr>');
    expect(rows[3]).toContain('<td>As at 2 Oct</td>');
    expect(markup).toContain('<th scope="col" data-numeric="true">Marker</th>');
  });

  it('draws no "today" without asAt, on a category axis, or for a past range; deadlines go on their bar', () => {
    expect(html(<BarChart title="x" layout="grouped" seriesDefs={raisedResolved} data={volume} markers={[{ kind: 'today' }]} />)).not.toContain('itsm-Markers__line');
    expect(html(<BarChart title="x" orientation="vertical" data={channels} asAt="2026-10-02T10:00:00Z" markers={[{ kind: 'today' }]} />)).not.toContain('itsm-Markers__line');
    expect(html(<BarChart title="x" layout="grouped" seriesDefs={raisedResolved} data={volume} asAt="2027-01-10T10:00:00Z" markers={[{ kind: 'today' }]} />)).not.toContain('itsm-Markers__line');
    const deadline = html(<BarChart title="x" layout="grouped" seriesDefs={raisedResolved} data={volume} markers={[{ kind: 'deadline', x: '2026-09-21', label: 'Freeze' }]} />);
    expect(deadline).toContain('data-kind="deadline" x1="62.5%"');
    // Rows have no time axis, so they take no markers.
    expect(html(<BarChart title="x" data={channels} asAt="2026-10-02T10:00:00Z" markers={[{ kind: 'today' }]} />)).not.toContain('itsm-Markers');
  });
});

describe('the figure, the table twin and the card', () => {
  it('draws vertical bars on a value axis, keeps their order, and puts the data behind "View as table"', () => {
    const markup = html(
      <BarChart title="Per day" orientation="vertical" data={['Mon', 'Tue', 'Wed'].map((label, index) => ({ id: label, label, value: [5, 12, 7][index]! }))} />,
    );
    expect(markup).toContain('data-layout="columns"');
    expect(all(markup, /itsm-BarChart__xTick"[^>]*>([^<]+)</g)).toEqual(['Mon', 'Tue', 'Wed']);
    expect(all(markup, /itsm-BarChart__yTick"[^>]*>([^<]+)</g)).toEqual(['0', '5', '10', '15']);
    expect(markup).toContain('View as table');
    expect(markup).toMatch(/itsm-ChartFigure__summary itsm-visually-hidden">(<span[^>]*>\. <\/span>)?Highest: Tue \(12\); lowest: Mon \(5\)\./);
  });

  it('lists stacked parts as columns with a total, in the table twin', () => {
    const markup = html(<BarChart title="Backlog age" seriesDefs={priorities} data={backlog} table="visible" />);
    const head = markup.slice(markup.indexOf('<thead>'), markup.indexOf('</thead>'));
    expect(all(head, /<th scope="col"[^>]*>([^<]+)</g)).toEqual(['Category', 'P1', 'P2', 'P3', 'P4', 'Total']);
    expect(markup).toContain('<th scope="row">&lt; 1 d</th><td data-numeric="true">1</td><td data-numeric="true">3</td><td data-numeric="true">8</td><td data-numeric="true">2</td><td data-numeric="true">14</td>');
  });

  it('shows a given description, or keeps it for assistive technology when the card shows it', () => {
    expect(html(<BarChart title="x" data={channels} description="Email leads." />)).toContain('<span class="itsm-ChartFigure__summary">Email leads.</span>');
    expect(html(<BarChart title="x" data={channels} description="Email leads." descriptionHidden />)).toContain('<span class="itsm-ChartFigure__summary itsm-visually-hidden"><span class="itsm-visually-hidden">. </span>Email leads.</span>');
  });

  it('inside a headlined ChartCard, shows the headline once — the card’s — and reads it once with the figure', () => {
    const headline = 'Network holds 27 open, 11 of them unassigned';
    const markup = html(
      <ChartCard title="Open work by team" headline={headline}>
        <BarChart title="Open work by team" seriesDefs={priorities} data={backlog} />
      </ChartCard>,
    );
    expect(count(markup, new RegExp(headline, 'g'))).toBe(2);
    expect(markup).toContain(`<p class="itsm-ChartCard__headline">${headline}</p>`);
    expect(markup).toContain(`<span class="itsm-ChartFigure__summary itsm-visually-hidden"><span class="itsm-visually-hidden">. </span>${headline}</span>`);
    expect(markup).toMatch(/<span class="itsm-ChartFigure__title itsm-visually-hidden">Open work by team<\/span>/);
  });

  it('carries every value to the reader, part by part, with a total, and each bar’s link', () => {
    const markup = html(<BarChart title="Volume" layout="grouped" seriesDefs={raisedResolved} data={volume.map((datum) => ({ ...datum, href: `/tickets?week=${datum.id}` }))} interactive />);
    expect(markup).toMatch(/role="group" aria-roledescription="chart" aria-label="Volume"/);
    expect(count(markup, /<li class="itsm-BarChart__column" data-point="\d"/g)).toBe(4);
  });
});

describe('reveal, determinism and contrast', () => {
  it('grows the bars from their baseline once, never under reduced motion or with animate={false}', () => {
    expect(html(<BarChart title="x" data={channels} />)).toContain('data-reveal=""');
    expect(html(<BarChart title="x" data={channels} animate={false} />)).not.toContain('data-reveal');
    expect(barChartStyles).toMatch(/@keyframes itsm-column-grow \{\s*from \{ transform: scaleY\(0\); \}/);
    expect(barChartStyles).toMatch(/\.itsm-BarChart\[data-reveal\] \.itsm-BarChart__column \.itsm-BarChart__bar \{\s*transform-origin: 50% 100%;\s*animation: itsm-column-grow var\(--itsm-duration-reveal\) var\(--itsm-easing-entrance\);/);
    expect(barChartStyles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.itsm-BarChart__bar \{\s*transition: none;\s*animation: none;/);
    expect(barChartStyles).toMatch(/:root\[data-itsm-motion="reduced"\] \.itsm-BarChart__bar \{\s*transition: none;\s*animation: none;/);
  });

  it('renders the same props to the same markup, and reconciles new values into the same bars, so a refetch never replays the reveal', () => {
    const props = { title: 'Volume', layout: 'grouped' as const, seriesDefs: raisedResolved, data: volume };
    expect(html(<BarChart {...props} />)).toBe(html(<BarChart {...props} />));
    const { container, rerender } = render(<BarChart {...props} />);
    const before = [...container.querySelectorAll('.itsm-BarChart__bar')];
    rerender(<BarChart {...props} data={volume.map((datum) => ({ ...datum, series: { raised: 9, resolved: 11 } }))} />);
    const after = [...container.querySelectorAll('.itsm-BarChart__bar')];
    expect(after).toHaveLength(before.length);
    after.forEach((bar, index) => expect(bar).toBe(before[index]));
  });

  it('textures every slot and tone with more contrast, and outlines parts in forced colours', () => {
    expect(barChartStyles).toContain('.itsm-BarChart__segment[data-tone="danger"] { --_itsm-texture: ');
    expect(barChartStyles).toContain('.itsm-BarChart__segment[data-slot="2"] { --_itsm-texture: repeating-linear-gradient(45deg, transparent 0 3px, var(--_itsm-ink) 3px 4.5px); }');
    expect(barChartStyles).not.toContain('[data-slot="1"] { --_itsm-texture');
    expect(barChartStyles).toContain(':root[data-itsm-theme="high-contrast"] .itsm-BarChart__segment { --_itsm-ink: var(--_itsm-chart-surface); background: var(--_itsm-texture, none), var(--_itsm-series); }');
    expect(barChartStyles).toContain(':root[data-itsm-theme="high-contrast-dark"] .itsm-BarChart__segment {');
    const forced = barChartStyles.slice(barChartStyles.indexOf('@media (forced-colors: active)'));
    expect(forced).toMatch(/\.itsm-BarChart \.itsm-BarChart__segment \{\s*forced-color-adjust: none;\s*--_itsm-ink: CanvasText;\s*background: var\(--_itsm-texture, none\), Canvas;\s*box-shadow: inset 0 0 0 1px CanvasText;/);
    expect(forced).toMatch(/\.itsm-BarChart :is\(\.itsm-BarChart__segment, \.itsm-ChartLegend__key\)\[data-pattern\] \{\s*background: repeating-linear-gradient\(45deg, transparent 0 3px, CanvasText 3px 4\.5px\), Canvas;/);
    expect(forced).toMatch(/\.itsm-BarChart__overlay \{\s*forced-color-adjust: none;/);
  });
});

describe('accessibility', () => {
  async function audit(element: ReactElement, keys: readonly string[] = []): Promise<void> {
    const { container } = render(<TestProvider>{element}</TestProvider>);
    for (const group of container.querySelectorAll<HTMLElement>('[aria-roledescription="chart"]')) {
      for (const key of keys) press(group, key);
    }
    if (keys.length > 0) {
      // The reading core arrives on the first key and replays it: wait, so the reading is audited too.
      await act(async () => {
        await vi.dynamicImportSettled();
        await Promise.resolve();
      });
    }
    for (const details of container.querySelectorAll('details')) details.open = true;
    await expectNoViolations(container);
  }

  it.each(['apple', 'apple-dark'])('passes axe in %s: every layout, labels, a target, markers and a reading', async (theme) => {
    await audit(
      <div data-itsm-theme={theme}>
        <BarChart title="Volume by week" layout="grouped" seriesDefs={raisedResolved} data={volume} labels="total" asAt="2026-10-02T10:00:00Z" timeZone="Europe/London" markers={[{ kind: 'today' }]} target={{ value: 25 }} interactive table="visible" />
        <BarChart title="Backlog age" seriesDefs={priorities} data={backlog} labels="segments" interactive />
        <BarChart title="Priority mix" layout="normalised" orientation="vertical" seriesDefs={priorities} data={backlog} />
        <BarChart title="Met by team" variant="list" valueFormat={{ style: 'percent' }} target={{ value: 0.9 }} data={[{ id: 'a', label: 'Desk', value: 0.92, href: '/team/desk' }, { id: 'b', label: 'Network', value: 0.81 }]} />
        <BarChart title="By channel" variant="list" maxBars={2} data={channels} highlight="email" />
        <ChartCard title="Open work by team" headline="Network holds most open work">
          <BarChart title="Open work by team" seriesDefs={priorities} data={backlog} />
        </ChartCard>
      </div>,
      ['ArrowRight'],
    );
  });
});
