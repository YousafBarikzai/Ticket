import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Sparkline } from '../Sparkline.js';
import { sparklineStyles } from '../Sparkline.styles.js';

/**
 * `Sparkline` v3 (A8 §4.2) as a server renders it. The tile it sits in has
 * no provider and no browser, and the same values must give the same markup
 * on every render, so each case reads the static HTML.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const count = (markup: string, pattern: RegExp): number => markup.match(pattern)?.length ?? 0;
const attribute = (markup: string, className: string, name: string): string =>
  markup.match(new RegExp(`class="${className}"[^>]* ${name}="([^"]*)"`))?.[1] ?? '';

/** Every y in a path's coordinates (the second of each pair). */
function ys(d: string): number[] {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  return numbers.filter((_, index) => index % 2 === 1);
}

describe('filling its parent', () => {
  const markup = html(<Sparkline values={[12, 14, 18]} label="Rising, 12 → 18" width="fill" tone="accent" />);

  it('is an image named by its trend, as wide as its parent and 40 px tall', () => {
    expect(markup).toMatch(/^<span role="img" aria-label="Rising, 12 → 18" class="itsm-Sparkline" data-tone="accent" data-width="fill" style="block-size:40px">/);
    expect(markup).toMatch(/<svg class="itsm-Sparkline__svg" width="100%" height="40" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true"/);
  });

  it('keeps the line its own width at any stretch', () => {
    expect(markup).toMatch(/class="itsm-Sparkline__line" d="[^"]+" vector-effect="non-scaling-stroke"/);
  });

  it('draws the latest point as an HTML dot, so it stays round however far the plot stretches', () => {
    expect(markup).toContain('<span class="itsm-Sparkline__dot" style="left:100%;top:5px"></span>');
    expect(markup).not.toContain('<circle');
  });

  it('drops the dot when asked', () => {
    expect(html(<Sparkline values={[1, 2]} label="x" width="fill" highlightLast={false} />)).not.toContain('itsm-Sparkline__dot');
  });
});

describe('at a fixed size', () => {
  it('is an SVG at its own pixels, 80 × 40 by default', () => {
    const markup = html(<Sparkline values={[12, 14, 18]} label="Rising, 12 → 18" />);
    expect(markup).toMatch(/^<svg role="img" aria-label="Rising, 12 → 18" class="itsm-Sparkline" data-tone="muted" width="80" height="40" viewBox="0 0 80 40"/);
    expect(markup).toMatch(/<circle class="itsm-Sparkline__dot" cx="75" cy="5" r="3">/);
  });

  it('takes the size a caller gives it', () => {
    expect(html(<Sparkline values={[1, 2]} label="x" width={72} height={24} />)).toMatch(/width="72" height="24" viewBox="0 0 72 24"/);
  });
});

describe('gaps', () => {
  it('breaks the line at a missing value instead of drawing it as zero', () => {
    const markup = html(<Sparkline values={[4, 6, null, 5, 9]} label="x" width="fill" />);
    expect(count(attribute(markup, 'itsm-Sparkline__line', 'd'), /M/g)).toBe(2);
  });

  it('washes each run on its own: no wash across a gap, none under a point alone', () => {
    const markup = html(<Sparkline values={[4, 6, null, 5, 9]} label="x" />);
    expect(count(attribute(markup, 'itsm-Sparkline__wash', 'd'), /Z/g)).toBe(2);
    const lonely = html(<Sparkline values={[1, null, 3, 4]} label="x" />);
    expect(count(attribute(lonely, 'itsm-Sparkline__wash', 'd'), /Z/g)).toBe(1);
  });

  it('still reads v2’s NaN gaps', () => {
    const markup = html(<Sparkline values={[4, Number.NaN, 5, 9]} label="x" />);
    expect(count(attribute(markup, 'itsm-Sparkline__line', 'd'), /M/g)).toBe(1);
  });

  it('marks the last known value, not the last slot', () => {
    const markup = html(<Sparkline values={[4, 9, null]} label="x" width="fill" />);
    expect(markup).toMatch(/itsm-Sparkline__dot" style="left:50%;top:5px"/);
  });
});

describe('no trend', () => {
  it.each([
    ['no values', []],
    ['one value', [7]],
    ['one value among gaps', [null, 7, null]],
  ] as const)('is a dashed rule named "No trend yet" with %s, never a dot that reads as data', (_case, values) => {
    const markup = html(<Sparkline values={values} label="Rising, 1 → 2" width="fill" />);
    expect(markup).toMatch(/^<span role="img" aria-label="No trend yet" class="itsm-Sparkline" data-tone="muted" data-width="fill" data-empty="" style="block-size:40px"><\/span>$/);
  });

  it('keeps its fixed size when it has no trend, so a row of tiles stays aligned', () => {
    expect(html(<Sparkline values={[]} label="x" width={96} />)).toContain('style="inline-size:96px;block-size:40px"');
  });

  it('draws a flat line at mid-height when every value is equal', () => {
    const d = attribute(html(<Sparkline values={[5, 5, 5]} label="Steady" />), 'itsm-Sparkline__line', 'd');
    expect(new Set(ys(d))).toEqual(new Set([20]));
  });
});

describe('shape', () => {
  it('fits its own range by default and can keep zero at the bottom', () => {
    const auto = ys(attribute(html(<Sparkline values={[80, 90]} label="x" area={false} />), 'itsm-Sparkline__line', 'd'));
    expect(auto).toEqual([35, 5]);
    const zero = ys(attribute(html(<Sparkline values={[80, 90]} label="x" area={false} baseline="zero" />), 'itsm-Sparkline__line', 'd'));
    expect(zero[1]).toBe(5);
    expect(zero[0]).toBeCloseTo(8.33, 1);
  });

  it('draws a smooth curve that never overshoots its highest point', () => {
    const values = [10, 40, 38, 90, 20];
    const d = attribute(html(<Sparkline values={values} label="x" curve="monotone" />), 'itsm-Sparkline__line', 'd');
    expect(d).toContain('C');
    // y grows downwards: the highest value is drawn at the inset, 5 px, and nothing goes above it.
    expect(Math.min(...ys(d))).toBeGreaterThanOrEqual(5);
    expect(Math.max(...ys(d))).toBeLessThanOrEqual(35);
  });

  it('draws a reference hairline and keeps it inside the drawing', () => {
    const markup = html(<Sparkline values={[80, 85, 88]} label="x" reference={90} width="fill" />);
    expect(markup).toMatch(/<line class="itsm-Sparkline__reference" x1="0" x2="1000" y1="5" y2="5" vector-effect="non-scaling-stroke"><\/line>/);
  });

  it('leaves the wash out when asked', () => {
    expect(html(<Sparkline values={[1, 2, 3]} label="x" area={false} />)).not.toContain('itsm-Sparkline__wash');
  });

  it('takes a state tone for a trend that is a state’s', () => {
    expect(html(<Sparkline values={[1, 2]} label="x" tone="danger" />)).toContain('data-tone="danger"');
  });
});

describe('determinism', () => {
  it('renders the same markup for the same values, every time', () => {
    const element = <Sparkline values={[3, null, 5, 8, 7]} label="Rising, 3 → 7" width="fill" curve="monotone" reference={6} />;
    expect(html(element)).toBe(html(element));
  });
});

describe('styles', () => {
  it('fills its parent, padded by the dot’s radius and ring so the end dot is never cut', () => {
    expect(sparklineStyles).toMatch(/\.itsm-Sparkline\[data-width="fill"\] \{[^}]*inline-size: 100%;[^}]*padding-inline: 0\.3125rem;/);
    expect(sparklineStyles).toMatch(/\[data-width="fill"\] \.itsm-Sparkline__line \{\s*stroke-width: 1\.75;/);
  });

  it('draws "No trend yet" as a 2 px dashed divider rule at mid-height', () => {
    expect(sparklineStyles).toMatch(/\.itsm-Sparkline\[data-empty\]::after \{[^}]*border-block-start: 2px dashed var\(--itsm-colour-border-divider\);/);
  });

  it('washes at a tenth, and more in a dark theme, where a tenth does not read', () => {
    expect(sparklineStyles).toContain('color-mix(in srgb, currentColor 10%, transparent)');
    expect(sparklineStyles).toContain('light-dark(color-mix(in srgb, currentColor 10%, transparent), color-mix(in srgb, currentColor 14%, transparent))');
  });

  it('paints each state tone in its audited chart colour, and the soft one in its outline', () => {
    expect(sparklineStyles).toContain('.itsm-Sparkline[data-tone="danger"] { color: var(--itsm-colour-danger-border); }');
    expect(sparklineStyles).toContain('.itsm-Sparkline[data-tone="neutralSoft"] { color: var(--itsm-colour-neutral-border); }');
  });

  it('keeps a mark in forced colours: the line in CanvasText, the dot in Highlight', () => {
    expect(sparklineStyles).toMatch(/@media \(forced-colors: active\) \{[\s\S]*color: CanvasText;[\s\S]*background: Highlight;/);
  });
});
