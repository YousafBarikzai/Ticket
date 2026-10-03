// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { TestProvider } from '../../provider/__tests__/support/provider.js';
import { expectNoViolations } from '../../web/__tests__/support/audit.js';
import { cleanupDocument, render } from '../../web/__tests__/support/render.js';
import { BulletBar, BulletList, measureBullet, type BulletRow } from '../Bullet.js';
import { bulletStyles } from '../Bullet.styles.js';

/**
 * `BulletBar` and `BulletList` (A8 §4.6): a value against a target on one
 * track, the shortfall tinted by how far short, a limit's fill turning as it
 * is approached, and every row said in full.
 */

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const percent = { style: 'percent' } as const;

afterEach(() => cleanupDocument());

describe('measureBullet', () => {
  it('tints the shortfall amber under a tenth of the track, pink from there', () => {
    expect(measureBullet({ label: 'x', value: 0.81, target: 0.9 }).gap).toEqual({ from: 0.81, to: 0.9, tone: 'warning' });
    expect(measureBullet({ label: 'x', value: 0.8, target: 0.9 }).gap?.tone).toBe('danger');
    expect(measureBullet({ label: 'x', value: 0.79, target: 0.9 }).gap?.tone).toBe('danger');
    expect(measureBullet({ label: 'x', value: 0.81, target: 0.9, dangerGap: 0.05 }).gap?.tone).toBe('danger');
    expect(measureBullet({ label: 'x', value: 0.95, target: 0.9 }).gap).toBeNull();
  });

  it('measures the shortfall against the track, so a count reads like a share', () => {
    expect(measureBullet({ label: 'x', value: 46, target: 50 }).gap?.tone).toBe('warning');
    expect(measureBullet({ label: 'x', value: 40, target: 50 }).gap?.tone).toBe('danger');
  });

  it('turns a limit’s fill amber from 80 % of it and red once it is reached (cap)', () => {
    const tone = (value: number): string => measureBullet({ label: 'x', value, target: 1, cap: true }).fillTone;
    expect([0.79, 0.8, 1, 1.2].map(tone)).toEqual(['accent', 'warning', 'danger', 'danger']);
    expect(measureBullet({ label: 'x', value: 0.7, target: 1, cap: true, capWarn: 0.6 }).fillTone).toBe('warning');
    expect(measureBullet({ label: 'x', value: 0.5, target: 1, cap: true }).gap).toBeNull();
  });

  it('fills in the accent, or in the zone’s tone when asked', () => {
    expect(measureBullet({ label: 'x', value: 0.81, target: 0.9 }).fillTone).toBe('accent');
    expect(measureBullet({ label: 'x', value: 0.81, target: 0.9, tone: 'auto' }).fillTone).toBe('warning');
    expect(measureBullet({ label: 'x', value: 0.92, target: 0.9, tone: 'auto' }).fillTone).toBe('success');
  });

  it('stretches the track past `max` and hatches the overrun', () => {
    const measure = measureBullet({ label: 'x', value: 1.2, target: 1, max: 1, cap: true });
    expect(measure.over?.from).toBeCloseTo(1 / 1.2);
    expect(measure.over?.to).toBe(1);
    expect(measure.fill).toBeCloseTo(1 / 1.2);
    expect(measure.tick).toBeCloseTo(1 / 1.2);
  });

  it('writes the distance to target in points for shares and in units otherwise', () => {
    expect(measureBullet({ label: 'x', value: 0.81, target: 0.9, format: percent }).rest).toBe(', target 90%, 9 points below');
    expect(measureBullet({ label: 'x', value: 0.91, target: 0.9, format: percent }).rest).toBe(', target 90%, 1 point above');
    expect(measureBullet({ label: 'x', value: 45, target: 50 }).rest).toBe(', target 50, 5 below');
    expect(measureBullet({ label: 'x', value: 50, target: 50 }).rest).toBe(', target 50, on target');
    expect(measureBullet({ label: 'x', value: 70, target: 60, cap: true }).rest).toBe(', limit 60, 10 over');
  });
});

describe('BulletBar', () => {
  it('is an image named by its sentence, its track decoration', () => {
    const markup = html(<BulletBar label="Network team" value={0.81} target={0.9} format={percent} detail="9 open" />);
    expect(markup).toMatch(/^<div class="itsm-Bullet" role="img" aria-label="Network team: 81%, target 90%, 9 points below, 9 open">/);
    expect(markup).toContain('<span class="itsm-Bullet__track" aria-hidden="true">');
    expect(markup).toContain('<span class="itsm-Bullet__gap" data-tone="warning" style="inset-inline-start:81%;inline-size:9%"></span>');
    expect(markup).toContain('<span class="itsm-Bullet__fill" data-tone="accent" style="inline-size:81%"></span>');
    expect(markup).toContain('<span class="itsm-Bullet__tick" style="inset-inline-start:90%"></span>');
    expect(markup).toContain('<span class="itsm-Bullet__detail">9 open</span>');
  });

  it('is a link carrying the whole sentence when it leads somewhere', () => {
    const markup = html(<BulletBar label="Network team" value={0.81} target={0.9} format={percent} href="/team/network" />);
    expect(markup).not.toContain('role="img"');
    expect(markup).toContain('<a href="/team/network" class="itsm-Bullet__link">Network team<span class="itsm-visually-hidden">: 81%, target 90%, 9 points below</span></a>');
    expect(markup).toContain('<span class="itsm-Bullet__value" aria-hidden="true">81%</span>');
    expect(markup).toContain('data-link=""');
  });

  it('has a compact form for tiles and inspector cards', () => {
    expect(html(<BulletBar label="x" value={1} compact />)).toContain('data-compact="true"');
    expect(bulletStyles).toMatch(/\.itsm-Bullet\[data-compact\] \{\s*--_itsm-track: 0\.375rem;\s*min-block-size: 1\.5rem;/);
  });
});

describe('BulletList', () => {
  const rows: BulletRow[] = [
    { id: 'desk', label: 'Service desk', value: 0.92, target: 0.9, format: percent },
    { id: 'net', label: 'Network', value: 0.81, target: 0.9, format: percent, href: '/team/network' },
    { id: 'apps', label: 'Applications', value: 0.75, target: 0.9, format: percent },
  ];

  it('is a figure with a list that says every row in full', () => {
    const markup = html(<BulletList title="SLA met by team" rows={rows} />);
    expect(markup).toMatch(/^<figure class="itsm-ChartFigure">/);
    expect(markup).toContain('<ul class="itsm-BulletList__rows"><li class="itsm-Bullet">');
    expect(markup).toContain('Service desk</span>');
    expect(markup).toContain('<span class="itsm-visually-hidden">, target 90%, 2 points above</span>');
    expect(markup).toContain('2 of 3 below target.');
    expect(markup).not.toContain('<table');
  });

  it('sorts by value or by the furthest behind, and keeps the given order by default', () => {
    const order = (markup: string): string[] => [...markup.matchAll(/<li class="itsm-Bullet"[^>]*><span class="itsm-Bullet__label">(?:<a[^>]*>)?([^<]+)/g)].map((match) => match[1]!);
    expect(order(html(<BulletList title="t" rows={rows} />))).toEqual(['Service desk', 'Network', 'Applications']);
    expect(order(html(<BulletList title="t" rows={rows} sort="value" />))).toEqual(['Service desk', 'Network', 'Applications']);
    expect(order(html(<BulletList title="t" rows={rows} sort="gap" />))).toEqual(['Applications', 'Network', 'Service desk']);
  });

  it('keeps rows past `max` behind "Show all n"', () => {
    const markup = html(<BulletList title="t" rows={rows} max={2} />);
    expect(markup).toContain('<details class="itsm-BulletList__more"><summary class="itsm-BulletList__toggle">Show all 3</summary><ul class="itsm-BulletList__rows">');
    expect(markup.indexOf('Applications')).toBeGreaterThan(markup.indexOf('Show all 3'));
  });

  it('offers a table when asked, and says why it is empty', () => {
    expect(html(<BulletList title="t" rows={rows} table="toggle" />)).toContain('<th scope="col">Name</th><th scope="col" data-numeric="true">Value</th><th scope="col" data-numeric="true">Target</th>');
    expect(html(<BulletList title="t" rows={[]} />)).toContain('No data for this period');
  });

  it('marks its rows for the reader when interactive', () => {
    const markup = html(<BulletList title="t" rows={rows} interactive />);
    expect(markup).toContain('Use ↑ ↓ to read values');
    expect(markup.match(/data-point="\d"/g)).toHaveLength(3);
  });
});

describe('styles', () => {
  it('draws an 8 px track, a 2 × 14 navy tick and the shortfall in the subtle tints', () => {
    expect(bulletStyles).toMatch(/\.itsm-Bullet \{[^}]*--_itsm-track: 0\.5rem;/);
    expect(bulletStyles).toMatch(/\.itsm-Bullet__tick \{[^}]*inline-size: 2px;[^}]*background: var\(--itsm-colour-chart-marker\);/);
    expect(bulletStyles).toContain('.itsm-Bullet__gap[data-tone="warning"] { background: var(--itsm-colour-warning-subtle); }');
    expect(bulletStyles).toContain('.itsm-Bullet__gap[data-tone="danger"] { background: var(--itsm-colour-danger-subtle); }');
  });

  it('textures the fills with more contrast, and outlines them in forced colours', () => {
    expect(bulletStyles).toContain(':root[data-itsm-theme="high-contrast"] .itsm-Bullet__fill[data-tone="danger"] { background: ');
    const forced = bulletStyles.slice(bulletStyles.indexOf('@media (forced-colors: active)'));
    expect(forced).toMatch(/\.itsm-Bullet__fill \{\s*background: Highlight;/);
    expect(forced).toMatch(/\.itsm-Bullet__gap \{\s*background: Canvas;\s*box-shadow: inset 0 0 0 1px CanvasText;/);
  });
});

describe('accessibility', () => {
  it.each(['apple', 'apple-dark'])('passes axe in %s: a list with a link, a limit, an overrun and a lone bar', async (theme) => {
    const { container } = render(
      <TestProvider>
        <div data-itsm-theme={theme}>
          <BulletList
            title="SLA met by team"
            rows={[
              { id: 'desk', label: 'Service desk', value: 0.92, target: 0.9, format: percent },
              { id: 'net', label: 'Network', value: 0.81, target: 0.9, format: percent, href: '/team/network', detail: '9 open' },
              { id: 'time', label: 'Time used', value: 72, target: 60, max: 60, cap: true, detail: 'Breached 12 min' },
            ]}
            max={2}
          />
          <BulletBar label="Response" value={0.84} target={0.9} format={percent} compact tone="auto" />
        </div>
      </TestProvider>,
    );
    for (const details of container.querySelectorAll('details')) details.open = true;
    await expectNoViolations(container);
  });
});
