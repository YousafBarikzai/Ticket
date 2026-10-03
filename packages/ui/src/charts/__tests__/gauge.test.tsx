// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { Gauge, gaugeArc, gaugeTone, gaugeZones } from '../Gauge.js';
import { gaugeStyles } from '../Gauge.styles.js';

/**
 * `Gauge` (A8 §4.5): a 220° dial whose zones and target are fractions of 1,
 * named by a sentence so the arc is never the only way to the number.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(element);

afterEach(() => cleanupDocument());

describe('the dial', () => {
  it('sweeps 220°, from 110° left of twelve o’clock to 110° right, inside its 200 × 128 box', () => {
    expect(gaugeArc(0, 0.5)).toBe('M21.07 120.73A84 84 0 0 1 100 8');
    expect(gaugeArc(0.5, 1)).toBe('M100 8A84 84 0 0 1 178.93 120.73');
    // More than half the dial is more than 180°: the large arc.
    expect(gaugeArc(0, 1)).toBe('M21.07 120.73A84 84 0 1 1 178.93 120.73');
    // The ends with their round caps (6 either side of the line) stay inside the box.
    expect(120.73 + 6).toBeLessThan(128);
  });

  it('clamps an arc to the dial', () => {
    expect(gaugeArc(-1, 2)).toBe(gaugeArc(0, 1));
  });
});

describe('zones, in fractions of 1', () => {
  it('defaults to 5 points of amber under the target, success at or above it', () => {
    const zones = gaugeZones(0.9, undefined);
    expect(zones.map((zone) => zone.tone)).toEqual(['danger', 'warning', 'success']);
    expect(zones[0]!.to).toBeCloseTo(0.85);
    expect(gaugeTone(0.88, zones)).toBe('warning');
    expect(gaugeTone(0.85, zones)).toBe('warning');
    expect(gaugeTone(0.849, zones)).toBe('danger');
    expect(gaugeTone(0.9, zones)).toBe('success');
    expect(gaugeTone(1, zones)).toBe('success');
  });

  it('reads relative bands as distances below the reference: A7’s ten points are 0.10', () => {
    const zones = gaugeZones(0.9, { relativeTo: 0.9, warning: 0.1, danger: 0.1 });
    expect(zones[0]!.to).toBeCloseTo(0.8);
    expect(gaugeTone(0.81, zones)).toBe('warning');
    expect(gaugeTone(0.79, zones)).toBe('danger');
  });

  it('never lets the amber run deeper than `danger`', () => {
    expect(gaugeZones(undefined, { relativeTo: 0.9, warning: 0.2, danger: 0.05 })[0]!.to).toBeCloseTo(0.85);
  });

  it('mirrors the zones when less is better: spend against budget', () => {
    const zones = gaugeZones(0.8, undefined, 'down');
    expect(zones.map((zone) => zone.tone)).toEqual(['success', 'warning', 'danger']);
    expect(gaugeTone(0.8, zones, 'down')).toBe('success');
    expect(gaugeTone(0.83, zones, 'down')).toBe('warning');
    expect(gaugeTone(0.9, zones, 'down')).toBe('danger');
  });

  it('reads a value past the end of the dial in the zone at that end', () => {
    // A budget of 100 %: the warning and danger zones have no width on the dial, but 105 % is over.
    const zones = gaugeZones(1, undefined, 'down');
    expect(gaugeTone(1, zones, 'down')).toBe('success');
    expect(gaugeTone(1.05, zones, 'down')).toBe('danger');
    expect(gaugeTone(-0.2, gaugeZones(0.9, undefined))).toBe('danger');
  });

  it('takes absolute bands in any order, the last one running to the end', () => {
    const zones = gaugeZones(undefined, [
      { to: 0.7, tone: 'warning' },
      { to: 0.5, tone: 'danger' },
      { to: 0.95, tone: 'success' },
    ]);
    expect(zones).toEqual([
      { to: 0.5, tone: 'danger' },
      { to: 0.7, tone: 'warning' },
      { to: 1, tone: 'success' },
    ]);
  });

  it('has no zones without a target or bands', () => {
    expect(gaugeZones(undefined, undefined)).toEqual([]);
  });
});

describe('the gauge', () => {
  it('is an image named by its sentence: the value, the target and how far off it is', () => {
    const markup = html(<Gauge label="SLA met · last 30 days" value={0.934} target={0.9} />);
    expect(markup).toMatch(/^<div role="img" aria-label="SLA met · last 30 days: 93.4%, target 90%, 3.4 points above target" class="itsm-Gauge" data-size="md" data-tone="success">/);
    expect(html(<Gauge label="SLA met" value={0.89} target={0.9} />)).toContain('aria-label="SLA met: 89%, target 90%, 1 point below target"');
    expect(html(<Gauge label="SLA met" value={0.9} target={0.9} caption="1,284 targets" />)).toContain('aria-label="SLA met: 90%, target 90%, on target. 1,284 targets"');
  });

  it('tints the track by zone, draws the reading in its zone’s tone and the target as a tick', () => {
    const markup = html(<Gauge label="SLA met" value={0.88} target={0.9} />);
    expect(markup.match(/class="itsm-Gauge__zone" data-tone="(\w+)"/g)?.map((zone) => zone.split('"')[3])).toEqual(['danger', 'warning', 'success']);
    expect(markup).toContain('class="itsm-Gauge__reading" data-tone="warning"');
    expect(markup).toMatch(/<line class="itsm-Gauge__tick"/);
    expect(markup).toMatch(/<span class="itsm-Gauge__centre" aria-hidden="true"><span class="itsm-Gauge__value">88%<\/span><span class="itsm-Gauge__target">Target 90%<\/span><\/span>/);
  });

  it('draws a plain track and an accent reading with no target', () => {
    const markup = html(<Gauge label="CSAT" value={0.72} />);
    expect(markup).toContain('class="itsm-Gauge__track"');
    expect(markup).not.toContain('itsm-Gauge__zone');
    expect(markup).not.toContain('itsm-Gauge__tick');
    expect(markup).toMatch(/class="itsm-Gauge__reading" d=/);
    expect(gaugeStyles).toContain('stroke: var(--_itsm-zone, var(--itsm-colour-accent));');
  });

  it('draws a reading past the end at the end, and says it as it is', () => {
    const markup = html(<Gauge label="Spend" value={1.05} target={1} goodDirection="down" />);
    expect(markup).toContain(`d="${gaugeArc(0, 1)}" pathLength="100"`);
    expect(markup).toContain('aria-label="Spend: 105%, target 100%, 5 points above target"');
    expect(markup).toContain('data-tone="danger"');
  });

  it('shows a bare dial, "—" and "No data yet" with nothing to measure', () => {
    const markup = html(<Gauge label="SLA met" value={null} target={0.9} />);
    expect(markup).toContain('aria-label="SLA met: no data yet"');
    expect(markup).not.toContain('itsm-Gauge__reading');
    expect(markup).toContain('<span class="itsm-Gauge__value">—</span>');
    expect(markup).toContain('>No data yet</span>');
  });

  it('takes a written sentence, a size and a number format', () => {
    expect(html(<Gauge label="x" value={0.5} description="Half signed off" />)).toContain('aria-label="Half signed off"');
    expect(html(<Gauge label="x" value={0.5} size="lg" />)).toContain('data-size="lg"');
    expect(html(<Gauge label="Spend" value={0.5} target={0.6} format={{ style: 'percent', maximumFractionDigits: 0 }} />)).toContain('Spend: 50%, target 60%, 10 points below target');
  });

  it('keeps a loading card the gauge’s height', () => {
    expect((Gauge as { plotHeight?: number }).plotHeight).toBe(200);
  });
});

describe('styles', () => {
  it('mixes each zone 22 % into the surface it sits on, more with more contrast', () => {
    expect(gaugeStyles).toContain('color-mix(in srgb, var(--_itsm-zone) var(--_itsm-zone-mix), var(--_itsm-chart-surface, var(--itsm-colour-surface-raised)))');
    expect(gaugeStyles).toMatch(/\.itsm-Gauge \{\s*--_itsm-zone-mix: 22%;/);
    expect(gaugeStyles).toContain(':root[data-itsm-theme="high-contrast"] .itsm-Gauge { --_itsm-zone-mix: 44%; }');
  });

  it('sweeps the reading in once, never under reduced motion', () => {
    expect(gaugeStyles).toMatch(/\.itsm-Gauge__reading \{[^}]*animation: itsm-gauge-reveal var\(--itsm-duration-reveal\)/);
    expect(gaugeStyles).toMatch(/:root\[data-itsm-motion="reduced"\] \.itsm-Gauge__reading \{\s*animation: none;/);
  });

  it('draws the track in GrayText and the reading in Highlight in forced colours', () => {
    const forced = gaugeStyles.slice(gaugeStyles.indexOf('@media (forced-colors: active)'));
    expect(forced).toMatch(/\.itsm-Gauge__cap \{\s*stroke: GrayText;/);
    expect(forced).toMatch(/\.itsm-Gauge__reading \{\s*stroke: Highlight;/);
  });
});

describe('accessibility', () => {
  it.each(['apple', 'apple-dark'])('passes axe in %s: zones, no target, no data and the large size', async (theme) => {
    const { container } = render(
      <div data-itsm-theme={theme}>
        <Gauge label="SLA met · last 30 days" value={0.934} target={0.9} caption="Response 92% · Update 80%" />
        <Gauge label="CSAT" value={0.72} size="lg" />
        <Gauge label="Spend" value={null} target={0.8} goodDirection="down" />
      </div>,
    );
    await expectNoViolations(container);
  });
});
