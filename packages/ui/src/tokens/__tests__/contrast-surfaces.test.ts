import { describe, expect, it } from 'vitest';
import {
  auditContract,
  auditEveryContract,
  avatarContract,
  chartContract,
  composite,
  contractNames,
  contrastContract,
  formatFailures,
  heroContract,
  materialContract,
  pairMinimum,
  themeMinimum,
  wcagMinimum,
} from '../contrast.js';
import { colour, themeNames } from '../tokens.js';

/**
 * The surface contracts v3 adds beside the core one (SPEC-v3 §2.11): the navy
 * hero surfaces, the avatar discs and the chart marks.
 *
 * Each is data in `contrast.ts`, walked in all four themes. The totals are
 * pinned because a pair that silently drops out of a contract is a pair
 * nobody checks any more: 182 core, 96 hero, 8 avatar, 33 chart and 10
 * material checks per theme, 329, and 1,316 across the four themes.
 */

describe('the navy hero contract', () => {
  it('checks every navy foreground on every navy surface and glow: 96 per theme', () => {
    const pairs = heroContract();
    expect(pairs).toHaveLength(96);
    const names = new Set(pairs.map((pair) => pair.name));
    expect(names.size).toBe(96);
    // Text is body text; the accent and the status hues are marks.
    expect(pairs.filter((pair) => pair.kind === 'body')).toHaveLength(4 * 8);
    expect(pairs.filter((pair) => pair.kind === 'ui')).toHaveLength(8 * 8);
    expect(names).toContain('hero.textMuted on hero.glowBand over hero.surfaceDeep');
    expect(names).toContain('hero.accent on hero.surfaceEnd');
  });

  it.each(themeNames)('%s: every navy pair passes', (theme) => {
    const results = auditContract('hero', theme);
    expect(formatFailures(results)).toBe('');
  });

  it('measures text at the strongest glow, composited over the surface it lights', () => {
    const hero = colour.apple.hero;
    // The four composites the spec records.
    expect(composite(hero.glow, hero.surface)).toBe('#0b3161');
    expect(composite(hero.glowBar, hero.surfaceDeep)).toBe('#073367');
    expect(composite(hero.glowPanel, hero.surface)).toBe('#093d7b');
    expect(composite(hero.glowBand, hero.surfaceDeep)).toBe('#063d7e');
    // The PMO's muted text was 4.14 there; v3's raised value is 4.88.
    const muted = auditContract('hero', 'apple').find(
      (result) => result.pair === 'hero.textMuted on hero.glowBand over hero.surfaceDeep',
    );
    expect(muted?.ratio).toBe(4.88);
  });

  it.each(['high-contrast', 'high-contrast-dark'] as const)('holds navy text to AAA in %s, with no glow', (theme) => {
    const hero = colour[theme].hero;
    for (const glow of [hero.glow, hero.glowBar, hero.glowPanel, hero.glowBand]) expect(composite(glow, hero.surface)).toBe(hero.surface);
    for (const result of auditContract('hero', theme).filter((r) => r.kind === 'body')) {
      expect(result.minimum, result.pair).toBe(7);
      expect(result.ratio, result.pair).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('the avatar contract', () => {
  it('checks the initials on each of the eight discs', () => {
    expect(avatarContract()).toHaveLength(8);
    for (const pair of avatarContract()) expect(pair.kind).toBe('body');
  });

  it.each(themeNames)('%s: the initials clear the theme floor on every disc', (theme) => {
    expect(formatFailures(auditContract('avatar', theme))).toBe('');
  });

  it('reaches AAA on the deep discs and AA on the dark theme’s lighter ones', () => {
    for (const theme of ['apple', 'high-contrast', 'high-contrast-dark'] as const) {
      for (const result of auditContract('avatar', theme)) expect(result.ratio, `${theme} ${result.pair}`).toBeGreaterThanOrEqual(7.07);
    }
    for (const result of auditContract('avatar', 'apple-dark')) expect(result.ratio, result.pair).toBeGreaterThanOrEqual(4.99);
  });
});

describe('the chart contract', () => {
  it('checks series, tone marks, comparison lines, the marker pill and the heat-map labels: 33 per theme', () => {
    const pairs = chartContract();
    expect(pairs).toHaveLength(33);
    const names = pairs.map((pair) => pair.name);
    expect(new Set(names).size).toBe(33);
    expect(names.filter((name) => name.startsWith('chart.categorical.'))).toHaveLength(8);
    expect(names.filter((name) => name.startsWith('chart.tone.'))).toHaveLength(14);
    expect(names.filter((name) => name.startsWith('chart.comparison '))).toHaveLength(2);
    expect(names).toContain('chart.markerText on chart.marker');
    expect(names.filter((name) => name.startsWith('chart.sequentialInk.'))).toHaveLength(8);
    // Series sit on cards only, never on the canvas (SPEC-v3 §2.6).
    for (const name of names.filter((n) => n.startsWith('chart.categorical.'))) expect(name).toMatch(/ on surface\.raised$/);
  });

  it.each(themeNames)('%s: every chart pair passes', (theme) => {
    expect(formatFailures(auditContract('chart', theme))).toBe('');
  });

  it('draws every chart series at 3:1 or more against the card it sits on', () => {
    for (const theme of themeNames) {
      const palette = colour[theme];
      expect(palette.chart.categorical).toHaveLength(8);
      expect(palette.chart.sequential).toHaveLength(8);
      expect(palette.chart.sequentialInk).toHaveLength(8);
      for (const result of auditContract('chart', theme).filter((r) => r.pair.startsWith('chart.categorical.'))) {
        expect(result.ratio, `${theme} ${result.pair}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('holds only the heat-map labels to AA in the high-contrast themes, and says so', () => {
    // A ramp's middle steps cannot carry either ink at 7:1; everything else in
    // the chart contract is held to the theme's own floor.
    for (const pair of chartContract()) {
      expect(pair.floor === 'aa', pair.name).toBe(pair.name.startsWith('chart.sequentialInk.'));
    }
    const ink = chartContract().find((pair) => pair.floor === 'aa')!;
    expect(pairMinimum('high-contrast', ink)).toBe(wcagMinimum.body);
    expect(pairMinimum('high-contrast', { kind: 'body' })).toBe(themeMinimum['high-contrast'].body);
  });
});

describe('the whole audit', () => {
  it('is 329 pairs per theme and 1,316 in all, with no failures', () => {
    const pairs = auditEveryContract();
    const materials = materialContract();
    expect(contractNames).toEqual(['core', 'hero', 'avatar', 'chart']);
    expect(contrastContract()).toHaveLength(182);
    for (const theme of themeNames) {
      const perTheme = pairs.filter((r) => r.theme === theme).length + materials.filter((r) => r.theme === theme).length;
      expect(perTheme, theme).toBe(329);
    }
    expect(pairs.length + materials.length).toBe(1316);
    expect(formatFailures(pairs)).toBe('');
    expect(materials.filter((result) => !result.passes)).toEqual([]);
  });

  it('names every pair uniquely within its contract and theme, so a failure says which one', () => {
    for (const theme of themeNames) {
      for (const contract of contractNames) {
        const names = auditContract(contract, theme).map((result) => result.pair);
        expect(new Set(names).size, `${theme} ${contract}`).toBe(names.length);
      }
    }
  });
});
