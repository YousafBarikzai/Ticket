import { describe, expect, it } from 'vitest';
import { materialBackdrops, materialContract, parseColourAlpha } from '../contrast.js';
import { themeVariables } from '../css.js';
import { colour, themeNames, type MaterialName, type ThemeName } from '../tokens.js';

/**
 * Glass, audited.
 *
 * A translucent bar has no background colour of its own: what its text sits on
 * is the bar mixed with whatever has scrolled beneath it. The contract
 * composites each material over the worst backdrops the product draws and
 * keeps the lowest ratio, so the numbers here are floors, not averages.
 *
 * The expected figures are the ones the redesign spec records (§1.3). They are
 * pinned exactly rather than only checked against the minimum: a change to a
 * material's tint or alpha that still passes is still a change to what people
 * read, and should be made on purpose, with this table updated beside it.
 */

const results = materialContract();

function ratio(theme: ThemeName, material: MaterialName, token: string): number {
  const found = results.find((r) => r.theme === theme && r.material === material && r.token === token);
  if (!found) throw new Error(`no ${theme} ${material} ${token} in the material contract`);
  return found.ratio;
}

describe('the material contract', () => {
  it('checks both materials in all four themes against every backdrop', () => {
    expect(materialBackdrops).toEqual(
      expect.arrayContaining(['#000000', '#ffffff', '#0071e3', '#d70015', '#ff9f0a', '#30d158', '#b25000']),
    );
    expect(new Set(results.map((r) => r.theme))).toEqual(new Set(themeNames));
    // Chrome carries only primary, secondary and the accent; a popover the full
    // range of a menu.
    expect(results.filter((r) => r.theme === 'apple' && r.material === 'chrome').map((r) => r.token)).toEqual([
      'text.primary',
      'text.secondary',
      'accent',
    ]);
    expect(results.filter((r) => r.theme === 'apple' && r.material === 'popover').map((r) => r.token)).toEqual([
      'text.primary',
      'text.secondary',
      'text.muted',
      'text.link',
      'intent.danger.subtleText',
      'border.interactive',
      'accent',
    ]);
  });

  it('passes everywhere', () => {
    const failures = results.filter((r) => !r.passes).map((r) => `${r.theme} ${r.material} ${r.token}: ${r.ratio} < ${r.minimum}`);
    expect(failures).toEqual([]);
  });

  it('holds the light materials to the recorded worst cases', () => {
    expect(ratio('apple', 'chrome', 'text.primary')).toBe(12.88);
    expect(ratio('apple', 'chrome', 'text.secondary')).toBe(7.66);
    expect(ratio('apple', 'chrome', 'accent')).toBe(3.07);
    expect(ratio('apple', 'popover', 'text.muted')).toBe(5.08);
    expect(ratio('apple', 'popover', 'text.link')).toBe(5.1);
    expect(ratio('apple', 'popover', 'intent.danger.subtleText')).toBe(6.32);
    expect(ratio('apple', 'popover', 'border.interactive')).toBe(3.32);
    expect(ratio('apple', 'popover', 'accent')).toBe(3.68);
  });

  it('holds the dark materials to the recorded worst cases', () => {
    expect(ratio('apple-dark', 'chrome', 'text.secondary')).toBe(8.9);
    expect(ratio('apple-dark', 'chrome', 'accent')).toBe(3.71);
    expect(ratio('apple-dark', 'popover', 'text.muted')).toBe(4.82);
    expect(ratio('apple-dark', 'popover', 'text.link')).toBe(4.73);
    expect(ratio('apple-dark', 'popover', 'intent.danger.subtleText')).toBe(4.89);
    expect(ratio('apple-dark', 'popover', 'border.interactive')).toBe(3.2);
    expect(ratio('apple-dark', 'popover', 'accent')).toBe(3.4);
  });

  it('keeps the standard themes translucent at the alphas the spec sets', () => {
    expect(parseColourAlpha(colour.apple.material.chrome.background).a).toBe(0.92);
    expect(parseColourAlpha(colour.apple.material.popover.background).a).toBe(0.96);
    expect(parseColourAlpha(colour['apple-dark'].material.chrome.background).a).toBe(0.92);
    expect(parseColourAlpha(colour['apple-dark'].material.popover.background).a).toBe(0.96);
  });

  it.each(['high-contrast', 'high-contrast-dark'] as const)('has no glass in %s: every material is opaque and unfiltered', (theme) => {
    for (const result of results.filter((r) => r.theme === theme)) expect(result.alpha, result.material).toBe(1);
    const vars = themeVariables(theme);
    expect(vars['--itsm-material-chrome-filter']).toBe('none');
    expect(vars['--itsm-material-popover-filter']).toBe('none');
    expect(vars['--itsm-scrim-filter']).toBe('none');
    // Solid chrome is the canvas it stands in for; a solid popover is the overlay.
    expect(colour[theme].material.chrome.background).toBe(colour[theme].surface.canvas);
    expect(colour[theme].material.popover.background).toBe(colour[theme].surface.overlay);
  });

  it('frosts glass in the standard themes, less saturated after dark', () => {
    expect(themeVariables('apple')['--itsm-material-chrome-filter']).toBe('blur(20px) saturate(180%)');
    expect(themeVariables('apple')['--itsm-material-popover-filter']).toBe('blur(24px) saturate(180%)');
    expect(themeVariables('apple-dark')['--itsm-material-chrome-filter']).toBe('blur(20px) saturate(150%)');
    expect(themeVariables('apple')['--itsm-scrim-filter']).toBe('blur(2px)');
  });
});
