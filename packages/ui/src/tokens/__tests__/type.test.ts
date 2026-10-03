import { describe, expect, it } from 'vitest';
import { structuralVariables } from '../css.js';
import { fontFamily, textRamp, type RampStyle, type TextRampToken } from '../tokens.js';

/**
 * The type ramp (SPEC-v3 §2.7).
 *
 * Two families: Inter for everything people read, Plus Jakarta Sans for
 * titles, KPI numerals and headlines. Jakarta's space is narrow (0.170em
 * against Inter's 0.281em), so with the negative tracking titles want its
 * words run together — the benchmark's "Progressover time". The fix is a
 * token, not a habit: every display style carries word spacing, and these
 * tests are what keep the next style added from forgetting it.
 */

const ramp = Object.entries(textRamp) as [TextRampToken, RampStyle][];

describe('the ramp', () => {
  it('has every style the spec lists, with its values', () => {
    const table: Record<TextRampToken, [RampStyle['family'], number, number, number, number, number]> = {
      display: ['display', 56, 60, 800, -0.035, 0.06],
      hero: ['display', 40, 44, 700, -0.025, 0.06],
      largeTitle: ['display', 30, 36, 700, -0.02, 0.07],
      verdict: ['display', 32, 36, 700, -0.02, 0.07],
      title1: ['display', 20, 28, 700, -0.015, 0.1],
      recordTitle: ['display', 22, 28, 600, -0.015, 0.1],
      title2: ['display', 18, 26, 600, -0.012, 0.1],
      title3: ['display', 16, 24, 600, -0.01, 0.1],
      statValue: ['display', 28, 32, 600, -0.02, 0.07],
      headline: ['sans', 15, 22, 600, -0.006, 0],
      body: ['sans', 14, 22, 400, 0, 0],
      callout: ['sans', 13, 20, 400, 0, 0],
      subheadline: ['sans', 13, 18, 500, 0, 0],
      footnote: ['sans', 12, 16, 400, 0, 0],
      caption: ['sans', 11, 16, 500, 0.01, 0],
      kicker: ['sans', 11, 16, 600, 0.07, 0],
      eyebrow: ['sans', 14, 20, 600, 0, 0],
      lockup: ['sans', 15, 20, 700, -0.01, 0],
      id: ['mono', 12, 16, 500, 0, 0],
      prose: ['sans', 16, 26, 400, 0, 0],
    };
    expect(Object.keys(textRamp).sort()).toEqual(Object.keys(table).sort());
    for (const [style, values] of ramp) {
      expect([values.family, values.size, values.line, values.weight, values.tracking, values.wordSpacing], style).toEqual(table[style]);
    }
  });

  it('keeps every v2 style name, so the components and pages that use them change with no edit', () => {
    for (const style of ['largeTitle', 'title1', 'title2', 'title3', 'headline', 'body', 'callout', 'subheadline', 'footnote', 'caption', 'statValue', 'hero']) {
      expect(textRamp, style).toHaveProperty(style);
    }
  });
});

describe('the Jakarta word-space fix (D4)', () => {
  it('gives every display style at least 0.06em of word spacing', () => {
    const display = ramp.filter(([, style]) => style.family === 'display');
    expect(display.length).toBeGreaterThan(0);
    for (const [name, style] of display) expect(style.wordSpacing, name).toBeGreaterThanOrEqual(0.06);
  });

  it('gives no Inter or mono style any word spacing: their own space is wide enough', () => {
    for (const [name, style] of ramp.filter(([, s]) => s.family !== 'display')) expect(style.wordSpacing, name).toBe(0);
  });

  it('sets Jakarta only at 16px and above', () => {
    for (const [name, style] of ramp.filter(([, s]) => s.family === 'display')) expect(style.size, name).toBeGreaterThanOrEqual(16);
  });

  it('sets the sidebar lockup in Inter: in Jakarta the product name would not fit the brand block', () => {
    expect(textRamp.lockup.family).toBe('sans');
  });
});

describe('ramp rules', () => {
  it('uses no weight below 400', () => {
    for (const [name, style] of ramp) expect(style.weight, name).toBeGreaterThanOrEqual(400);
  });

  it('never sets a line shorter than its text, and sits every line on the 2px half-grid', () => {
    for (const [name, style] of ramp) {
      expect(style.line, name).toBeGreaterThanOrEqual(style.size);
      expect(style.line % 2, name).toBe(0);
    }
  });

  it('uppercases only the kicker (D6)', () => {
    for (const [name, style] of ramp) expect(style.transform, name).toBe(name === 'kicker' ? 'uppercase' : undefined);
  });

  it('sets ticket numbers in mono with a slashed zero and tabular figures', () => {
    expect(textRamp.id.family).toBe('mono');
    expect(textRamp.id.numeric).toBe('slashed-zero tabular-nums');
  });

  it('caps running text at 68 characters', () => {
    expect(textRamp.prose.measure).toBe(68);
  });
});

describe('the families', () => {
  it('puts Inter first in the sans stack and Jakarta first in the display stack', () => {
    expect(fontFamily.sans.slice(0, 2)).toEqual(['var(--font-inter-ext, "Inter")', 'var(--font-inter, "Inter")']);
    expect(fontFamily.display.slice(0, 3)).toEqual([
      'var(--font-jakarta-ext, "Plus Jakarta Sans")',
      'var(--font-jakarta, "Plus Jakarta Sans")',
      'var(--font-inter, "Inter")',
    ]);
  });

  it('emits each style’s family as a reference to its stack', () => {
    const vars = structuralVariables();
    for (const family of Object.keys(fontFamily)) expect(vars[`--itsm-font-family-${family}`], family).toBeDefined();
    for (const [name, style] of ramp) {
      expect(vars[`--itsm-text-${name}-family`], name).toBe(`var(--itsm-font-family-${style.family})`);
    }
  });
});
