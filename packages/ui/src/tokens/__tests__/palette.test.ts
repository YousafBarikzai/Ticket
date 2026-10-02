import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColour, roundRatio } from '../contrast.js';
import { themeVariables } from '../css.js';
import { colour, themeNames, type IntentColours, type IntentName } from '../tokens.js';

/**
 * The v3 palette, as data (SPEC-v3 §2.1–§2.6).
 *
 * The contrast contracts prove that the values *read*; this file pins that
 * they are the values the spec chose, and checks the properties of the
 * palette that no single pair can: that a sequential ramp runs one way, in
 * even steps, away from the card it is drawn on; that the navy is the same
 * object in every theme; and that the dark theme kept v2's audited values.
 */

/** OKLab lightness (Björn Ottosson's matrices), 0 for black to 1 for white. */
function oklabLightness(hex: string): number {
  const { r, g, b } = parseColour(hex);
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720958 * s;
}

function intent(solid: string, solidHover: string, solidText: string, subtle: string, subtleText: string, border: string): IntentColours {
  return { solid, solidHover, solidText, subtle, subtleText, border };
}

describe('the light theme (PMO slate)', () => {
  const light = colour.apple;

  it('has the surfaces, text and borders the spec gives', () => {
    expect(light.surface).toEqual({
      canvas: '#f5f7fb',
      raised: '#ffffff',
      raisedAlt: '#f8fafc',
      sunken: '#eef1f6',
      overlay: '#ffffff',
      hover: '#f1f5f9',
      accentHover: '#f2f8ff',
      selected: '#ebf4ff',
      selection: '#b3d7ff',
      bubble: '#eef1f6',
      inverse: '#0f172a',
    });
    expect(light.text).toEqual({
      primary: '#0f172a',
      secondary: '#334155',
      muted: '#475569',
      faint: '#5b6475',
      disabled: '#7c8aa0',
      link: '#0066cc',
      inverse: '#ffffff',
    });
    expect(light.border).toEqual({
      subtle: '#e3e8f0',
      divider: '#edf0f5',
      soft: '#cfd6e3',
      softHover: '#a9b4c6',
      interactive: '#7a869a',
      strong: '#64748b',
      focus: '#007aff',
    });
    expect(light.fill).toEqual({
      hover: 'rgba(15, 23, 42, 0.04)',
      pressed: 'rgba(15, 23, 42, 0.08)',
      secondary: 'rgba(100, 116, 139, 0.12)',
      track: '#e6eaf1',
    });
    expect(light.trackBorder).toEqual({ colour: '#7a869a', width: 1 });
    expect(light.material.chrome.background).toBe('rgba(245, 247, 251, 0.92)');
    expect(light.focusHalo).toBe('rgba(0, 122, 255, 0.18)');
    expect(light.highlightInset).toBe('rgba(255, 255, 255, 0.14)');
    expect(light.shadow).toBe('#0f172a');
    expect(light.scrim).toBe('rgba(15, 23, 42, 0.4)');
  });

  it('has the eight intents the spec gives, hold and high among them', () => {
    const expected: Record<IntentName, IntentColours> = {
      brand: intent('#0071e3', '#0062c4', '#ffffff', '#e6f2ff', '#0058b0', '#007aff'),
      neutral: intent('#64748b', '#475569', '#ffffff', '#eef1f6', '#334155', '#7a869a'),
      success: intent('#15803d', '#166534', '#ffffff', '#dcfce7', '#147638', '#159e47'),
      warning: intent('#b45309', '#92400e', '#ffffff', '#fef3c7', '#a34b07', '#d07006'),
      danger: intent('#dc2626', '#b91c1c', '#ffffff', '#fee5e5', '#b91c1c', '#dc2626'),
      info: intent('#4f46e5', '#4338ca', '#ffffff', '#e6eaff', '#4338ca', '#4f46e5'),
      hold: intent('#c026d3', '#a21caf', '#ffffff', '#fae8ff', '#a21caf', '#c026d3'),
      high: intent('#c2410c', '#9a3412', '#ffffff', '#ffedd5', '#9a3412', '#ea580c'),
    };
    expect(light.intent).toEqual(expected);
  });

  it('keeps the accent blue off every status: info is indigo, not the accent', () => {
    for (const theme of themeNames) {
      const palette = colour[theme];
      for (const name of ['info', 'hold', 'high', 'warning', 'success', 'danger'] as const) {
        expect(palette.intent[name].border, `${theme} ${name}`).not.toBe(palette.accent);
        expect(palette.intent[name].solid, `${theme} ${name}`).not.toBe(palette.accent);
      }
    }
  });
});

describe('the other three themes keep v2 and add to it', () => {
  it('keeps v2’s audited dark surfaces, text, accent and six intents exactly (D3)', () => {
    const dark = colour['apple-dark'];
    expect(dark.surface.canvas).toBe('#000000');
    expect(dark.surface.raised).toBe('#1c1c1e');
    expect(dark.surface.sunken).toBe('#121214');
    expect(dark.surface.overlay).toBe('#2c2c2e');
    expect([dark.text.primary, dark.text.secondary, dark.text.muted]).toEqual(['#f5f5f7', '#d1d1d6', '#a1a1a6']);
    expect(dark.accent).toBe('#0a84ff');
    expect(dark.intent.brand.subtleText).toBe('#70b5ff');
    expect(dark.intent.warning.solidText).toBe('#1d1d1f');
  });

  it('adds the v3 tokens with the spec’s values', () => {
    expect(colour['apple-dark'].surface.raisedAlt).toBe('#242426');
    expect(colour['apple-dark'].text.faint).toBe('#98989d');
    expect(colour['high-contrast'].text.faint).toBe('#333333');
    expect(colour['high-contrast-dark'].text.faint).toBe('#d1d1d6');
    expect(colour['apple-dark'].intent.hold).toEqual(intent('#c026d3', '#a21caf', '#ffffff', '#3d2b41', '#f0abfc', '#e879f9'));
    // Dark text on the orange fill, as v2 does for dark amber.
    expect(colour['apple-dark'].intent.high).toEqual(intent('#f97316', '#fb923c', '#1d1d1f', '#403023', '#fdba74', '#fb923c'));
    expect(colour['high-contrast'].intent.hold).toEqual(intent('#86198f', '#701a75', '#ffffff', '#fae8ff', '#701a75', '#86198f'));
    expect(colour['high-contrast-dark'].intent.high).toEqual(intent('#fdba74', '#fed7aa', '#000000', '#331a05', '#fed7aa', '#fdba74'));
    expect(
      themeNames.map((theme) => [colour[theme].border.divider, colour[theme].border.soft, colour[theme].border.softHover]),
    ).toEqual([
      ['#edf0f5', '#cfd6e3', '#a9b4c6'],
      ['#2e2e30', '#545458', '#636366'],
      ['#595959', '#333333', '#000000'],
      ['#a1a1a6', '#d1d1d6', '#ffffff'],
    ]);
  });

  it('uses one accent per theme for focus, selection and series 1', () => {
    expect(themeNames.map((theme) => colour[theme].accent)).toEqual(['#007aff', '#0a84ff', '#0040dd', '#6cb6ff']);
  });

  it('has no focus halo and no lit button edge in high contrast, which widens the outline instead', () => {
    for (const theme of ['high-contrast', 'high-contrast-dark'] as const) {
      expect(colour[theme].focusHalo).toMatch(/, 0\)$/);
      expect(colour[theme].highlightInset).toBeNull();
    }
  });
});

describe('the filled button gradient', () => {
  it('is the same in light and dark, and flat in high contrast', () => {
    expect(colour.apple.gradient).toEqual({ brand: ['#0071e3', '#0260c0'], brandHover: ['#0062c4', '#0058b0'] });
    expect(colour['apple-dark'].gradient).toEqual(colour.apple.gradient);
    for (const theme of ['high-contrast', 'high-contrast-dark'] as const) {
      const { brand, brandHover } = colour[theme].gradient;
      expect(brand[0], theme).toBe(brand[1]);
      expect(brandHover[0], theme).toBe(brandHover[1]);
      expect(brand[0], theme).toBe(colour[theme].intent.brand.solid);
    }
  });

  it('darkens on hover in the light theme, at every stop', () => {
    const { brand, brandHover } = colour.apple.gradient;
    for (const index of [0, 1] as const) {
      expect(contrastRatio('#ffffff', brandHover[index]), `stop ${index}`).toBeGreaterThan(contrastRatio('#ffffff', brand[index]));
    }
  });

  it('carries the button’s text at AA or better at every stop, hover included', () => {
    for (const theme of themeNames) {
      const palette = colour[theme];
      const minimum = palette.contrast === 'more' ? 7 : 4.5;
      for (const stop of [...palette.gradient.brand, ...palette.gradient.brandHover]) {
        expect(roundRatio(contrastRatio(palette.intent.brand.solidText, stop)), `${theme} ${stop}`).toBeGreaterThanOrEqual(minimum);
      }
    }
  });
});

describe('the sequential ramps', () => {
  it.each(themeNames)('%s: runs away from the card in even OKLab steps', (theme) => {
    const palette = colour[theme];
    const card = oklabLightness(palette.surface.raised);
    const steps = palette.chart.sequential.map(oklabLightness);
    // Light cards: each step darker than the last. Dark cards: each lighter.
    const direction = palette.scheme === 'light' ? -1 : 1;
    let previous = card;
    for (const [index, lightness] of steps.entries()) {
      expect(Math.sign(lightness - previous), `${theme} step ${index + 1}`).toBe(direction);
      if (index > 0) expect(Math.abs(lightness - previous), `${theme} step ${index + 1}`).toBeGreaterThanOrEqual(0.05);
      previous = lightness;
    }
  });

  it('is not the light ramp after dark (the v2 bug)', () => {
    expect(colour['apple-dark'].chart.sequential).not.toEqual(colour.apple.chart.sequential);
    expect(colour['high-contrast-dark'].chart.sequential).not.toEqual(colour['high-contrast'].chart.sequential);
    expect(colour['apple-dark'].chart.sequential).toEqual([
      '#16263f',
      '#123a6b',
      '#0b4f9c',
      '#0866d5',
      '#2081fe',
      '#61a2fe',
      '#90bdfe',
      '#bbd6fe',
    ]);
  });

  it('labels each step with the ink the spec pairs with it', () => {
    const slate = '#0f172a';
    const white = '#ffffff';
    expect(colour.apple.chart.sequentialInk).toEqual([slate, slate, slate, slate, slate, white, white, white]);
    const near = '#f5f5f7';
    const black = '#000000';
    expect(colour['apple-dark'].chart.sequentialInk).toEqual([near, near, near, near, black, black, black, black]);
    expect(colour['high-contrast'].chart.sequentialInk).toEqual([black, black, black, black, black, white, white, white]);
    expect(colour['high-contrast-dark'].chart.sequentialInk).toEqual([white, white, white, white, black, black, black, black]);
  });
});

describe('chart tokens', () => {
  it('has the comparison, quiet fill and marker the spec gives', () => {
    expect(
      themeNames.map((theme) => {
        const { comparison, neutralSoft, marker, markerText } = colour[theme].chart;
        return [comparison, neutralSoft, marker, markerText];
      }),
    ).toEqual([
      ['#7a869a', '#cbd5e1', '#0f172a', '#ffffff'],
      ['#8e8e93', '#48484a', '#f5f5f7', '#1d1d1f'],
      ['#000000', '#e6e6e6', '#000000', '#ffffff'],
      ['#ffffff', '#1f1f1f', '#ffffff', '#000000'],
    ]);
    expect([colour.apple.chart.grid, colour.apple.chart.axis]).toEqual(['#edf0f5', '#cfd6e3']);
    // The grid is the row divider and the axis the chip edge: one family of hairlines.
    expect(colour.apple.chart.grid).toBe(colour.apple.border.divider);
    expect(colour.apple.chart.axis).toBe(colour.apple.border.soft);
  });

  it('emits every colour a chart tone maps to (danger, high, warning, success, info, hold, neutral, neutralSoft)', () => {
    for (const theme of themeNames) {
      const vars = themeVariables(theme);
      for (const name of ['danger', 'high', 'warning', 'success', 'info', 'hold', 'neutral']) {
        expect(vars[`--itsm-colour-${name}-border`], `${theme} ${name}`).toBeDefined();
      }
      expect(vars['--itsm-colour-chart-neutralSoft'], theme).toBeDefined();
    }
  });
});

describe('the avatar palette', () => {
  it('uses deep discs with white initials, a step lighter after dark', () => {
    const deep = ['#1e3a8a', '#3730a3', '#5b21b6', '#86198f', '#155e75', '#115e59', '#334155', '#3f6212'];
    expect(colour.apple.avatar).toEqual({ fills: deep, text: '#ffffff' });
    expect(colour['high-contrast'].avatar.fills).toEqual(deep);
    expect(colour['high-contrast-dark'].avatar.fills).toEqual(deep);
    expect(colour['apple-dark'].avatar.fills).toEqual([
      '#1d4ed8',
      '#4338ca',
      '#6d28d9',
      '#a21caf',
      '#0e7490',
      '#0f766e',
      '#475569',
      '#4d7c0f',
    ]);
    for (const theme of themeNames) expect(colour[theme].avatar.text).toBe('#ffffff');
  });
});

describe('the navy hero tokens', () => {
  it('is the same navy in every theme', () => {
    for (const theme of themeNames) {
      const { surface, surfaceRaised, surfaceDeep, surfaceEnd } = colour[theme].hero;
      expect([surface, surfaceRaised, surfaceDeep, surfaceEnd], theme).toEqual(['#0f172a', '#1e293b', '#0b1120', '#1e2a45']);
    }
  });

  it('differs between light and dark only in its edge, which steps up so the card separates from black', () => {
    const { line: lightLine, ...light } = colour.apple.hero;
    const { line: darkLine, ...dark } = colour['apple-dark'].hero;
    expect(dark).toEqual(light);
    expect([lightLine, darkLine]).toEqual(['rgba(255, 255, 255, 0.09)', 'rgba(255, 255, 255, 0.1)']);
    expect(light.textMuted).toBe('#a3b1c6');
  });

  it('has no glow and real white edges in high contrast', () => {
    for (const theme of ['high-contrast', 'high-contrast-dark'] as const) {
      const hero = colour[theme].hero;
      for (const glow of [hero.glow, hero.glowBar, hero.glowPanel, hero.glowBand]) expect(glow, theme).toMatch(/, 0\)$/);
      expect([hero.line, hero.lineStrong, hero.textMuted, hero.accent], theme).toEqual(['#ffffff', '#ffffff', '#cbd5e1', '#6cb6ff']);
    }
  });
});
