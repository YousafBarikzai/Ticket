import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Meter, meterLevel } from '../Meter.js';
import { ProgressBar } from '../ProgressBar.js';
import { Spinner } from '../Spinner.js';

/*
 * Spinner, ProgressBar and Meter (SPEC §4.5): server-safe indicators whose
 * roles, names and values are right before any JavaScript runs.
 */

const html = renderToStaticMarkup;
const attribute = (markup: string, name: string): string | null => new RegExp(`${name}="([^"]*)"`).exec(markup)?.[1] ?? null;

describe('Spinner', () => {
  it('is a named status with a label, and decoration without one', () => {
    const labelled = html(<Spinner label="Saving" />);
    expect(labelled).toContain('role="status"');
    expect(labelled).toContain('>Saving<');
    const decorative = html(<Spinner size="sm" />);
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain('role=');
    expect(decorative).toContain('data-size="sm"');
  });

  it('draws eight spokes fading behind the leading one', () => {
    const markup = html(<Spinner />);
    const opacities = [...markup.matchAll(/stroke-opacity="([\d.]+)"/g)].map((match) => Number(match[1]));
    expect(opacities).toHaveLength(8);
    expect(opacities[0]).toBe(1);
    // Clockwise from the head the spokes are the dimmest; anticlockwise the tail fades in order.
    expect(opacities[7]).toBeGreaterThan(opacities[6]!);
    expect(opacities[1]).toBe(Math.min(...opacities));
  });
});

describe('ProgressBar', () => {
  it('reports a known value in percent', () => {
    const markup = html(<ProgressBar value={0.45} label="Uploading attachments" showValue />);
    expect(markup).toContain('role="progressbar"');
    expect(attribute(markup, 'aria-label')).toBe('Uploading attachments');
    expect(attribute(markup, 'aria-valuenow')).toBe('45');
    expect(attribute(markup, 'aria-valuemin')).toBe('0');
    expect(attribute(markup, 'aria-valuemax')).toBe('100');
    expect(markup).toContain('>45%<');
    expect(markup).toContain('--_itsm-progress:0.45');
  });

  it('clamps what it is given, and treats NaN as nothing done', () => {
    expect(attribute(html(<ProgressBar value={1.4} label="x" />), 'aria-valuenow')).toBe('100');
    expect(attribute(html(<ProgressBar value={-2} label="x" />), 'aria-valuenow')).toBe('0');
    expect(attribute(html(<ProgressBar value={Number.NaN} label="x" />), 'aria-valuenow')).toBe('0');
  });

  it('has no value at all when indeterminate, which is how a screen reader knows to say busy', () => {
    const markup = html(<ProgressBar label="Refreshing" size="sm" labelHidden />);
    expect(markup).not.toContain('aria-valuenow');
    expect(markup).toContain('data-state="indeterminate"');
    expect(markup).toContain('data-size="sm"');
    // The 2 px refetch line has no caption to show.
    expect(markup).not.toContain('itsm-ProgressBar__caption');
    expect(attribute(markup, 'aria-label')).toBe('Refreshing');
  });

  it('keeps the visible caption out of the accessible text, so the name is read once', () => {
    const markup = html(<ProgressBar value={0.2} label="Step 1 of 5" />);
    expect(markup).toContain('itsm-ProgressBar__caption" aria-hidden="true"');
  });
});

describe('Meter', () => {
  it('is a meter with the value in words as well as a bar', () => {
    const markup = html(<Meter value={3200} max={5000} label="Tickets this month" />);
    expect(markup).toContain('role="meter"');
    expect(attribute(markup, 'aria-valuenow')).toBe('3200');
    expect(attribute(markup, 'aria-valuemax')).toBe('5000');
    expect(attribute(markup, 'aria-valuetext')).toBe('3,200 of 5,000');
    expect(markup).toContain('>3,200 of 5,000<');
    expect(markup).toContain('data-level="normal"');
  });

  it('turns warning, then danger, at the thresholds — and says so in words with an icon', () => {
    const warning = html(<Meter value={82} max={100} label="AI budget" thresholds={{ warning: 80, danger: 95 }} />);
    expect(warning).toContain('data-level="warning"');
    expect(warning).toContain('Getting close to the limit');
    expect(warning).toContain('data-icon="triangle-alert"');
    expect(attribute(warning, 'aria-valuetext')).toBe('82 of 100, getting close to the limit');

    const danger = html(<Meter value={97} max={100} label="AI budget" thresholds={{ warning: 80, danger: 95 }} />);
    expect(danger).toContain('data-level="danger"');
    expect(danger).toContain('Almost at the limit');

    const reached = html(<Meter value={100} max={100} label="AI budget" thresholds={{ warning: 80, danger: 95 }} />);
    expect(reached).toContain('Limit reached');
  });

  it('draws and explains soft and hard lines, and takes its level from them without thresholds', () => {
    const markup = html(<Meter value={4200} max={5000} label="Agents" softLine={4000} hardLine={5000} />);
    expect(markup).toContain('data-level="warning"');
    expect(markup).toContain('data-kind="soft"');
    expect(markup).toContain('inset-inline-start:80.00%');
    expect(markup).toContain('Warn at 4,000');
    expect(markup).toContain('Limit 5,000');
    expect(attribute(markup, 'aria-valuetext')).toBe('4,200 of 5,000, getting close to the limit, warn at 4,000, limit 5,000');
  });

  it('keeps aria-valuenow in range when over the limit, and says how far over in words', () => {
    const markup = html(<Meter value={6200} max={5000} label="Agents" />);
    expect(attribute(markup, 'aria-valuenow')).toBe('5000');
    expect(attribute(markup, 'aria-valuetext')).toBe('6,200 of 5,000, over the limit');
    expect(markup).toContain('--_itsm-meter:1');
  });

  it('formats with the locale and options given, and survives bad ones', () => {
    expect(html(<Meter value={3200} max={5000} label="x" locale="de-DE" />)).toContain('3.200 of 5.000');
    expect(html(<Meter value={12.5} max={50} label="Spend" format={{ style: 'currency', currency: 'GBP' }} />)).toContain('£12.50 of £50.00');
    expect(() => html(<Meter value={1} max={2} label="x" locale="not a locale" />)).not.toThrow();
  });

  it('decides the level the same way outside the component', () => {
    expect(meterLevel({ value: 10, max: 5 })).toBe('danger');
    expect(meterLevel({ value: 3, max: 5 })).toBe('normal');
    expect(meterLevel({ value: 4, max: 10, softLine: 4 })).toBe('warning');
    expect(meterLevel({ value: 9, max: 10, hardLine: 9 })).toBe('danger');
  });
});
