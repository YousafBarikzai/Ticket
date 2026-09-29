import { describe, expect, it } from 'vitest';
import {
  auditAllThemes,
  auditTheme,
  composite,
  contrastContract,
  contrastRatio,
  formatFailures,
  parseColour,
  parseColourAlpha,
  relativeLuminance,
  roundRatio,
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

  it('reports ratios rounded down, so 4.499 never reads as a pass', () => {
    expect(roundRatio(4.499)).toBe(4.49);
    expect(roundRatio(4.5)).toBe(4.5);
  });
});

describe('alpha and compositing', () => {
  it('keeps the alpha channel that parseColour drops', () => {
    expect(parseColourAlpha('rgba(11, 18, 32, 0.55)')).toEqual({ r: 11, g: 18, b: 32, a: 0.55 });
    expect(parseColourAlpha('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    // A hex, or an rgb() without a fourth argument, is opaque.
    expect(parseColourAlpha('#1d1d1f')).toEqual({ r: 29, g: 29, b: 31, a: 1 });
    expect(parseColourAlpha('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(() => parseColourAlpha('rgba(0, 0, 0, 1.5)')).toThrow();
  });

  it('composites a translucent colour over an opaque one, as the browser does', () => {
    // Half black over white is mid grey; an opaque colour hides what is behind it.
    expect(composite('rgba(0, 0, 0, 0.5)', '#ffffff')).toBe('#808080');
    expect(composite('#123456', '#ffffff')).toBe('#123456');
    expect(composite('rgba(255, 0, 0, 0)', '#00ff00')).toBe('#00ff00');
    // The light chrome material over black: 0.92 of #f5f5f7.
    expect(composite('rgba(245, 245, 247, 0.92)', '#000000')).toBe('#e1e1e3');
  });
});

describe('WCAG 2.2 contrast audit', () => {
  const results = auditAllThemes();

  it('covers the four themes and every pairing the components produce', () => {
    expect(themeNames).toEqual(['apple', 'apple-dark', 'high-contrast', 'high-contrast-dark']);
    expect(contrastContract()).toHaveLength(128);
    expect(results).toHaveLength(128 * 4);
    // Names are how a failure is reported, so two pairs must never share one.
    const names = contrastContract().map((pair) => pair.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('includes the pairs the redesign added: ordinary text on every tint and every row state', () => {
    const names = new Set(contrastContract().map((pair) => pair.name));
    for (const intent of ['brand', 'neutral', 'success', 'warning', 'danger', 'info']) {
      for (const text of ['primary', 'muted', 'link']) {
        expect(names, `${text} on ${intent}`).toContain(`text.${text} on intent.${intent}.subtle`);
      }
      for (const surface of ['canvas', 'raised', 'sunken', 'overlay']) {
        expect(names).toContain(`intent.${intent}.subtleText on surface.${surface}`);
      }
    }
    for (const surface of ['hover', 'selected', 'accentHover']) {
      expect(names).toContain(`text.muted on surface.${surface}`);
      expect(names).toContain(`text.link on surface.${surface}`);
    }
    for (const surface of ['canvas', 'raised', 'overlay', 'sunken', 'hover', 'selected']) {
      expect(names).toContain(`accent on surface.${surface}`);
    }
    for (const surface of ['canvas', 'raised', 'overlay', 'sunken']) {
      expect(names).toContain(`border.interactive on surface.${surface}`);
    }
    expect(names).toContain('text.primary on surface.selection');
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

  it.each(['high-contrast', 'high-contrast-dark'] as const)('holds %s to AAA, not merely AA', (theme) => {
    expect(themeMinimum[theme]).toEqual({ body: 7, large: 4.5, ui: 3 });
    const body = auditTheme(theme).filter((result) => result.kind === 'body');
    expect(body.length).toBeGreaterThan(0);
    for (const result of body) expect(result.ratio, result.pair).toBeGreaterThanOrEqual(7);
  });

  it('keeps primary text far above the floor on the two surfaces it is used on most', () => {
    for (const theme of themeNames) {
      const palette = colour[theme];
      expect(contrastRatio(palette.text.primary, palette.surface.canvas)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(palette.text.primary, palette.surface.raised)).toBeGreaterThanOrEqual(7);
    }
  });

  it('uses the accent as the focus colour in every theme, so the accent pairs audit the ring', () => {
    for (const theme of themeNames) expect(colour[theme].border.focus, theme).toBe(colour[theme].accent);
  });

  it('keeps the message bubble readable: it carries primary, secondary and muted text', () => {
    for (const theme of themeNames) {
      const palette = colour[theme];
      const minimum = themeMinimum[theme].body;
      for (const text of ['primary', 'secondary', 'muted'] as const) {
        expect(roundRatio(contrastRatio(palette.text[text], palette.surface.bubble)), `${theme} ${text}`).toBeGreaterThanOrEqual(
          minimum,
        );
      }
    }
    // The figures the spec records for the two standard themes.
    expect(roundRatio(contrastRatio(colour.apple.text.muted, colour.apple.surface.bubble))).toBe(4.82);
    expect(roundRatio(contrastRatio(colour['apple-dark'].text.muted, colour['apple-dark'].surface.bubble))).toBe(5.41);
  });

  it('separates the dark surfaces far enough that a card reads without a border', () => {
    const dark = colour['apple-dark'].surface;
    expect(roundRatio(contrastRatio(dark.canvas, dark.raised))).toBeGreaterThanOrEqual(1.2);
    expect(roundRatio(contrastRatio(dark.raised, dark.overlay))).toBeGreaterThanOrEqual(1.2);
    expect(roundRatio(contrastRatio(dark.raised, dark.selected))).toBeGreaterThanOrEqual(1.3);
  });

  it('draws every chart series at 3:1 or more against the card it sits on', () => {
    for (const theme of themeNames) {
      const palette = colour[theme];
      expect(palette.chart.categorical).toHaveLength(8);
      expect(palette.chart.sequential).toHaveLength(8);
      for (const series of palette.chart.categorical) {
        expect(roundRatio(contrastRatio(series, palette.surface.raised)), `${theme} ${series}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
