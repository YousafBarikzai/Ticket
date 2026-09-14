import { describe, expect, it } from 'vitest';
import {
  auditAllThemes,
  auditTheme,
  contrastContract,
  contrastRatio,
  formatFailures,
  parseColour,
  relativeLuminance,
  themeMinimum,
} from '../contrast.js';
import { colour, themeNames } from '../tokens.js';

describe('contrast mathematics', () => {
  it('parses the hex forms the tokens use', () => {
    expect(parseColour('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColour('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColour('rgba(11, 18, 32, 0.55)')).toEqual({ r: 11, g: 18, b: 32 });
    expect(() => parseColour('rebeccapurple')).toThrow();
  });

  it('computes relative luminance per WCAG 2.2', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
    // The sRGB → linear curve is not a straight line: mid grey sits near 0.216.
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 3);
  });

  it('computes contrast ratios with the known anchors', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // Order must not matter: the ratio is defined on the lighter of the two.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#767676'), 10);
    // #767676 on white is the canonical 4.54:1 example from the WCAG techniques.
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });
});

describe('WCAG 2.2 AA contrast audit', () => {
  const results = auditAllThemes();

  it('covers every theme and a meaningful number of pairings', () => {
    expect(themeNames).toHaveLength(3);
    expect(contrastContract().length).toBeGreaterThan(50);
    expect(results).toHaveLength(contrastContract().length * themeNames.length);
  });

  it.each(themeNames)('%s theme meets its minimum for every token pair', (theme) => {
    const themeResults = auditTheme(theme);
    const failures = themeResults.filter((result) => !result.passes);
    // The message lists every failure with its ratio, so a token change that
    // breaks contrast tells the author exactly which value to fix.
    expect(formatFailures(themeResults)).toBe('');
    expect(failures).toHaveLength(0);
  });

  it('holds body text to 4.5:1 and interface borders to 3:1', () => {
    for (const result of results) {
      const expected = themeMinimum[result.theme][result.kind];
      expect(result.minimum).toBe(expected);
      expect(result.ratio).toBeGreaterThanOrEqual(expected);
    }
  });

  it('holds the high-contrast theme to AAA, not merely AA', () => {
    expect(themeMinimum['high-contrast'].body).toBe(7);
    const body = auditTheme('high-contrast').filter((result) => result.kind === 'body');
    expect(body.length).toBeGreaterThan(0);
    for (const result of body) expect(result.ratio).toBeGreaterThanOrEqual(7);
  });

  it('keeps primary text far above the floor on the two surfaces it is used on most', () => {
    for (const theme of themeNames) {
      const palette = colour[theme];
      expect(contrastRatio(palette.text.primary, palette.surface.canvas)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(palette.text.primary, palette.surface.raised)).toBeGreaterThanOrEqual(7);
    }
  });
});
