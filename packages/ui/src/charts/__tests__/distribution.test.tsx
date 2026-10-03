// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { chartFigureStyles } from '../ChartFigure.styles.js';
import { DistributionBar, type DistributionSegment } from '../DistributionBar.js';
import { distributionBarStyles } from '../DistributionBar.styles.js';

/**
 * `DistributionBar` (A8 §4.4): one strip of what a whole is made of, named by
 * its sentence, its legend the data — every segment with its value, its
 * share and, where the page gives one, a link to the tickets it counts.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const count = (markup: string, pattern: RegExp): number => markup.match(pattern)?.length ?? 0;

const sla: DistributionSegment[] = [
  { id: 'ok', label: 'On track', value: 41, tone: 'success', href: '/inbox/all?sla=on_track' },
  { id: 'risk', label: 'At risk', value: 7, tone: 'warning', href: '/inbox/all?sla=due_soon' },
  { id: 'late', label: 'Breached', value: 3, tone: 'danger', href: '/inbox/all?sla=breached' },
];

afterEach(() => cleanupDocument());

describe('the figure', () => {
  it('is named by a sentence of every segment, the strip decoration', () => {
    const markup = html(<DistributionBar label="Open tickets by SLA state" segments={sla} />);
    expect(markup).toMatch(/^<figure class="itsm-Chart itsm-DistributionBar" data-legend="below"><figcaption class="itsm-DistributionBar__head itsm-visually-hidden">/);
    expect(markup).toContain('<span class="itsm-visually-hidden">. Open tickets by SLA state: On track 41, At risk 7 and Breached 3</span>');
    expect(markup).toContain('<div class="itsm-DistributionBar__strip" aria-hidden="true">');
    expect(markup).not.toContain('<table');
  });

  it('keys each segment by its tone, strip and legend alike, and grows it with its value', () => {
    const markup = html(<DistributionBar label="x" segments={sla} />);
    expect(markup).toContain('<span class="itsm-DistributionBar__segment" data-tone="danger" style="flex-grow:3"></span>');
    expect(markup).toContain('data-mark="chip" data-tone="warning" aria-hidden="true"');
    // The tones paint through the kit's shared rules, scoped to `.itsm-Chart`.
    expect(chartFigureStyles).toContain('.itsm-Chart [data-tone="danger"], .itsm-ChartLegend [data-tone="danger"] { --_itsm-series: var(--itsm-colour-danger-border); }');
  });

  it('lists every segment with its value and share, each a link to what it counts', () => {
    const markup = html(<DistributionBar label="x" segments={sla} />);
    expect(markup).toContain('<ul class="itsm-ChartLegend itsm-DistributionBar__legend" aria-label="Legend">');
    expect(markup).toMatch(
      /<a href="\/inbox\/all\?sla=breached" class="itsm-ChartLegend__label itsm-DistributionBar__link">Breached<\/a><span class="itsm-ChartLegend__value">3<\/span><span class="itsm-ChartLegend__detail">6%<\/span>/,
    );
    expect(html(<DistributionBar label="x" segments={sla} showShare={false} />)).not.toContain('itsm-ChartLegend__detail');
  });

  it('draws no strip segment for a zero, but keeps it in the legend; any other value is at least 3 px', () => {
    const markup = html(<DistributionBar label="x" segments={[...sla, { id: 'none', label: 'Paused', value: 0, tone: 'hold' }]} />);
    expect(count(markup, /class="itsm-DistributionBar__segment"/g)).toBe(3);
    expect(markup).toMatch(/Paused<\/span><span class="itsm-ChartLegend__value">0<\/span>/);
    expect(distributionBarStyles).toMatch(/\.itsm-DistributionBar__segment \{\s*flex: 1 1 0;\s*min-inline-size: 3px;/);
    expect(distributionBarStyles).toMatch(/\.itsm-DistributionBar__segments \{\s*display: flex;\s*gap: 2px;/);
  });

  it('colours segments without a tone by their slot, in order', () => {
    const markup = html(<DistributionBar label="By channel" segments={[{ id: 'e', label: 'Email', value: 5 }, { id: 'p', label: 'Portal', value: 3, slot: 4 }]} />);
    expect(markup).toContain('class="itsm-DistributionBar__segment" data-slot="1"');
    expect(markup).toContain('class="itsm-DistributionBar__segment" data-slot="4"');
  });
});

describe('against a whole', () => {
  it('leaves the room under `max` as track', () => {
    const markup = html(<DistributionBar label="Budget" segments={[{ id: 's', label: 'Spent', value: 60 }]} max={100} />);
    expect(markup).toContain('<span class="itsm-DistributionBar__room" style="flex-grow:40"></span>');
    expect(markup).not.toContain('itsm-DistributionBar__over');
  });

  it('hatches an overrun past `max` and says it', () => {
    const markup = html(<DistributionBar label="Budget" segments={[{ id: 's', label: 'Spent', value: 120 }]} max={100} />);
    expect(markup).toMatch(/<span class="itsm-DistributionBar__over" style="inset-inline-start:83\.333%;inline-size:16\.667%"><\/span>/);
    expect(markup).toContain('<li class="itsm-ChartLegend__item itsm-DistributionBar__overText">Over by 20</li>');
    expect(markup).toContain('Budget: Spent 120, over by 20');
    expect(distributionBarStyles).toMatch(/\.itsm-DistributionBar__over \{[^}]*var\(--itsm-colour-danger-subtle\);/);
    expect(distributionBarStyles).toMatch(/\.itsm-DistributionBar__overText \{[^}]*color: var\(--itsm-colour-danger-subtleText\);/);
  });

  it('stands a marker over the strip with its label, aligned inwards at the edges', () => {
    const markup = html(<DistributionBar label="Budget" segments={[{ id: 's', label: 'Spent', value: 80 }]} max={100} marker={{ value: 100, label: 'Approved' }} />);
    expect(markup).toContain('data-marker=""');
    expect(markup).toContain('<span class="itsm-DistributionBar__marker" data-edge="end" style="inset-inline-start:100%"><span class="itsm-DistributionBar__markerLabel">Approved</span></span>');
    expect(markup).toContain('; Approved 100');
  });
});

describe('labels, totals, layouts and nothing', () => {
  it('shows the label row with a total, and keeps it for assistive technology otherwise', () => {
    const markup = html(<DistributionBar label="Open work" segments={sla} total={{ label: 'Total' }} />);
    expect(markup).toContain('<figcaption class="itsm-DistributionBar__head"><span class="itsm-DistributionBar__label">Open work</span><span class="itsm-DistributionBar__total">Total <span class="itsm-DistributionBar__totalValue">51</span></span>');
    expect(html(<DistributionBar label="Open work" segments={sla} showLabel />)).toContain('<figcaption class="itsm-DistributionBar__head">');
  });

  it('puts the legend beside the label, or leaves it out (the sentence then carries the data)', () => {
    const inline = html(<DistributionBar label="x" segments={sla} legend="inline" />);
    expect(inline.indexOf('itsm-DistributionBar__legend')).toBeLessThan(inline.indexOf('itsm-DistributionBar__strip'));
    const none = html(<DistributionBar label="x" segments={sla} legend="none" />);
    expect(none).not.toContain('itsm-ChartLegend');
    expect(none).toContain('On track 41, At risk 7 and Breached 3');
  });

  it('is the quiet strip and "Nothing open" when every segment is zero', () => {
    const markup = html(<DistributionBar label="My work" segments={sla.map((segment) => ({ ...segment, value: 0 }))} />);
    expect(markup).toContain('data-empty=""');
    expect(markup).toContain('<li class="itsm-ChartLegend__item itsm-DistributionBar__nothing">Nothing open</li>');
    expect(markup).toContain('My work: nothing open');
    expect(distributionBarStyles).toMatch(/\[data-empty\] \{\s*background: var\(--itsm-colour-chart-neutralSoft\);\s*box-shadow: inset 0 0 0 1px var\(--itsm-colour-neutral-border\);/);
  });

  it('draws the strip at the height asked, 10 px by default', () => {
    expect(html(<DistributionBar label="x" segments={sla} />)).toContain('style="block-size:0.625rem"');
    expect(html(<DistributionBar label="x" segments={sla} height={6} />)).toContain('style="block-size:0.375rem"');
    expect(html(<DistributionBar label="x" segments={sla} height={28} />)).toContain('style="block-size:1.75rem"');
  });

  it('hatches a segment marked as such in every theme', () => {
    expect(html(<DistributionBar label="x" segments={[{ id: 'u', label: 'Unassigned', value: 4, pattern: 'hatch' }]} />)).toContain('data-pattern="hatch"');
    expect(distributionBarStyles).toContain('.itsm-DistributionBar :is(.itsm-DistributionBar__segment, .itsm-ChartLegend__key)[data-pattern="hatch"]');
  });
});

describe('increase contrast and forced colours', () => {
  it('textures every slot and tone with more contrast, and outlines segments in forced colours', () => {
    // Each key's texture is written once, as a variable drawn in `--_itsm-ink`; a theme only says when to paint it.
    expect(distributionBarStyles).toContain('.itsm-DistributionBar__segment[data-tone="danger"] { --_itsm-texture: ');
    expect(distributionBarStyles).toContain('.itsm-DistributionBar__segment[data-slot="2"] { --_itsm-texture: repeating-linear-gradient(45deg, transparent 0 3px, var(--_itsm-ink) 3px 4.5px); }');
    expect(distributionBarStyles).not.toContain('[data-slot="1"] { --_itsm-texture');
    expect(distributionBarStyles).toContain(':root[data-itsm-theme="high-contrast"] .itsm-DistributionBar__segment { --_itsm-ink: var(--_itsm-chart-surface); background: var(--_itsm-texture, none), var(--_itsm-series); }');
    const forced = distributionBarStyles.slice(distributionBarStyles.indexOf('@media (forced-colors: active)'));
    expect(forced).toMatch(/\.itsm-DistributionBar__segment \{\s*--_itsm-ink: CanvasText;\s*background: var\(--_itsm-texture, none\), Canvas;\s*box-shadow: inset 0 0 0 1px CanvasText;/);
    expect(forced).toMatch(/\.itsm-DistributionBar__marker \{\s*background: Highlight;/);
  });
});

describe('accessibility', () => {
  it.each(['apple', 'apple-dark'])('passes axe in %s: links, a total, an overrun with a marker, nothing open', async (theme) => {
    const { container } = render(
      <TestProvider>
        <div data-itsm-theme={theme}>
          <DistributionBar label="Open tickets by SLA state" segments={sla} total={{ label: 'Total' }} />
          <DistributionBar label="Budget" segments={[{ id: 's', label: 'Spent', value: 120, slot: 1 }]} max={100} marker={{ value: 100, label: 'Approved' }} height={28} />
          <DistributionBar label="My work" segments={sla.map((segment) => ({ ...segment, value: 0 }))} legend="inline" />
          <DistributionBar label="In a tile" segments={sla} height={6} legend="none" />
        </div>
      </TestProvider>,
    );
    await expectNoViolations(container);
  });
});
