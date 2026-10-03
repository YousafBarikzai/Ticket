// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { ProgressRing } from '../ProgressRing.js';
import { progressRingStyles } from '../ProgressRing.styles.js';

/**
 * `ProgressRing` (A8 §4.7): the target tick (the war room's "15 % · target
 * 17 %") and the 140 size with the stat numeral in the middle.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const tick = (markup: string): number[] => {
  const match = markup.match(/<line class="itsm-ProgressRing__target" x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/);
  return match ? match.slice(1).map(Number) : [];
};

afterEach(() => cleanupDocument());

describe('the target tick', () => {
  it('names the target with the value', () => {
    expect(html(<ProgressRing value={0.15} target={0.17} label="Updates on time" />)).toContain('aria-label="Updates on time: 15%, target 17%"');
    expect(html(<ProgressRing value={0.15} label="Updates on time" />)).toContain('aria-label="Updates on time: 15%"');
  });

  it('crosses the ring at the target’s angle from twelve o’clock, 2 px past the stroke each side', () => {
    // 48 px ring, 4 px stroke: radius 22, so the tick runs from 18 to 26 out from the centre (24, 24).
    expect(tick(html(<ProgressRing value={0.5} target={0} label="x" />))).toEqual([24, 6, 24, -2]);
    expect(tick(html(<ProgressRing value={0.5} target={0.25} label="x" />))).toEqual([42, 24, 50, 24]);
    expect(tick(html(<ProgressRing value={0.5} target={0.5} label="x" />))).toEqual([24, 42, 24, 50]);
    expect(html(<ProgressRing value={0.5} label="x" />)).not.toContain('itsm-ProgressRing__target');
  });

  it('clamps a target outside the ring', () => {
    expect(tick(html(<ProgressRing value={0.5} target={2} label="x" />))).toEqual(tick(html(<ProgressRing value={0.5} target={1} label="x" />)));
    expect(html(<ProgressRing value={0.5} target={2} label="x" />)).toContain('target 100%');
  });

  it('draws the tick in the marker navy, and lets it reach past the box', () => {
    expect(progressRingStyles).toMatch(/\.itsm-ProgressRing__target \{\s*stroke: var\(--itsm-colour-chart-marker\);\s*stroke-width: 2;/);
    expect(progressRingStyles).toMatch(/\.itsm-ProgressRing__svg \{[^}]*overflow: visible;/);
    expect(progressRingStyles.slice(progressRingStyles.indexOf('@media (forced-colors: active)'))).toMatch(/\.itsm-ProgressRing__target \{\s*stroke: Highlight;/);
  });
});

describe('sizes', () => {
  it('draws the 140 ring with a 12 px stroke and the stat numeral', () => {
    const markup = html(<ProgressRing value={0.15} size={140} target={0.17} label="Updates on time" centerText="15%" />);
    expect(markup).toContain('data-size="140"');
    expect(markup).toContain('width="140" height="140" viewBox="0 0 140 140"');
    expect(markup).toMatch(/class="itsm-ProgressRing__track" cx="70" cy="70" r="64" stroke-width="12"/);
    expect(progressRingStyles).toMatch(/\[data-size="140"\] \.itsm-ProgressRing__text \{\s*font-family: var\(--itsm-text-statValue-family\);\s*font-size: var\(--itsm-text-statValue-size\);/);
  });
});

describe('accessibility', () => {
  it.each(['apple', 'apple-dark'])('passes axe in %s with a target and at every size', async (theme) => {
    const { container } = render(
      <div data-itsm-theme={theme}>
        {([32, 48, 64, 96, 140] as const).map((size) => (
          <ProgressRing key={size} value={0.62} target={0.75} size={size} label="SLA time used" centerText="62%" />
        ))}
      </div>,
    );
    await expectNoViolations(container);
  });
});
