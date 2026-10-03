import { describe, expect, it } from 'vitest';
import { colour, fontSize, lineHeight, spacing, textRamp, textStyle, themeAliases, themeNames } from '../tokens.js';
import { renderTokenStylesheet, structuralVariables, themeVariables, boxShadow, themeAttribute } from '../css.js';
import { createNativeTheme, nativeThemes } from '../native.js';
import { spring, springCurve, springEasing, springOvershoot } from '../spring.js';

/**
 * The point of these tests is single-sourcing: they assert that the CSS and the
 * React Native theme are *derived* from the token objects, so a value cannot be
 * changed on one platform without changing it on the other.
 */
describe('CSS rendering', () => {
  it('emits a variable for every colour token in every theme', () => {
    for (const theme of themeNames) {
      const vars = themeVariables(theme);
      const palette = colour[theme];
      expect(vars['--itsm-colour-text-primary']).toBe(palette.text.primary);
      expect(vars['--itsm-colour-surface-canvas']).toBe(palette.surface.canvas);
      expect(vars['--itsm-colour-surface-accentHover']).toBe(palette.surface.accentHover);
      expect(vars['--itsm-colour-surface-selection']).toBe(palette.surface.selection);
      expect(vars['--itsm-colour-danger-solid']).toBe(palette.intent.danger.solid);
      expect(vars['--itsm-colour-accent']).toBe(palette.accent);
      expect(vars['--itsm-colour-focusGap']).toBe(palette.surface.raised);
      expect(vars['--itsm-colour-fill-secondary']).toBe(palette.fill.secondary);
      expect(vars['--itsm-colour-material-popover']).toBe(palette.material.popover.background);
      expect(vars['--itsm-colour-chart-1']).toBe(palette.chart.categorical[0]);
      expect(vars['--itsm-colour-chart-seq-800']).toBe(palette.chart.sequential[7]);
      // Both dark themes tell the browser to darken its own furniture — the
      // scrollbars, the caret, the controls we do not skin.
      expect(vars['color-scheme'], theme).toBe(palette.scheme);
    }
    expect(themeNames.filter((theme) => colour[theme].scheme === 'dark')).toEqual(['apple-dark', 'high-contrast-dark']);
  });

  it('emits the same variable names in every theme, so a nested theme replaces all of them', () => {
    const names = Object.keys(themeVariables('apple')).sort();
    for (const theme of themeNames) expect(Object.keys(themeVariables(theme)).sort(), theme).toEqual(names);
  });

  it('expresses spacing and type in rem so that browser zoom works', () => {
    const vars = structuralVariables();
    expect(vars['--itsm-space-md']).toBe(`${spacing.md / 16}rem`);
    expect(vars['--itsm-font-size-md']).toBe(`${fontSize.md / 16}rem`);
    // 15px body text is what every app's layout was drawn against.
    expect(vars['--itsm-font-size-md']).toBe('0.9375rem');
    expect(vars['--itsm-line-height-normal']).toBe(String(lineHeight.normal));
  });

  it('emits the type ramp as family, size, line, weight, tracking and word spacing per style', () => {
    const vars = structuralVariables();
    for (const [style, ramp] of Object.entries(textRamp)) {
      expect(vars[`--itsm-text-${style}-size`], style).toBe(`${ramp.size / 16}rem`);
      expect(vars[`--itsm-text-${style}-line`], style).toBe(`${Number((ramp.line / 16).toFixed(4))}rem`);
      expect(vars[`--itsm-text-${style}-weight`], style).toBe(String(ramp.weight));
      expect(vars[`--itsm-text-${style}-family`], style).toBe(`var(--itsm-font-family-${ramp.family})`);
      expect(vars[`--itsm-text-${style}-word-spacing`], style).toBe(ramp.wordSpacing === 0 ? '0' : `${ramp.wordSpacing}em`);
    }
    expect(vars['--itsm-text-title1-tracking']).toBe('-0.015em');
    expect(vars['--itsm-text-title1-word-spacing']).toBe('0.1em');
    expect(vars['--itsm-text-title1-family']).toBe('var(--itsm-font-family-display)');
    expect(vars['--itsm-text-footnote-tracking']).toBe('0');
    expect(vars['--itsm-text-footnote-word-spacing']).toBe('0');
    expect(vars['--itsm-text-prose-measure']).toBe('68ch');
    // Inputs are 14px, and 16px under a coarse pointer so iOS does not zoom.
    expect(vars['--itsm-input-font-size']).toBe('0.875rem');
    const css = renderTokenStylesheet();
    expect(css.slice(css.indexOf('@media (pointer: coarse) {'))).toMatch(/--itsm-input-font-size: 1rem;/);
  });

  it('puts Inter first, with a fallback if next/font is absent', () => {
    const sans = structuralVariables()['--itsm-font-family-sans']!;
    expect(sans.startsWith('var(--font-inter-ext, "Inter"), var(--font-inter, "Inter"), -apple-system, BlinkMacSystemFont,')).toBe(
      true,
    );
    // Family names with spaces are quoted; `var()` entries are not.
    expect(sans).toContain('"Segoe UI Variable Text", "Segoe UI"');
    expect(sans).not.toContain('"var(');
  });

  it('sets display type in Plus Jakarta Sans, falling back to Inter', () => {
    const display = structuralVariables()['--itsm-font-family-display']!;
    expect(display).toBe(
      'var(--font-jakarta-ext, "Plus Jakarta Sans"), var(--font-jakarta, "Plus Jakarta Sans"), var(--font-inter, "Inter"), -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
    );
  });

  it('builds shadows from the shared geometry and the theme shadow colour', () => {
    expect(boxShadow('none', '#000000')).toBe('none');
    expect(boxShadow('sm', '#0b1220')).toBe('0 1px 2px 0px rgba(11, 18, 32, 0.08)');
  });

  it('strengthens shadows by the theme factor, capped, and draws outlines where a theme has none', () => {
    // Dark doubles-and-more: 0.28 × 2.2 hits the 0.6 cap, and 0.08 × 2.2.
    expect(boxShadow('lg', '#000000', 2.2)).toBe('0 16px 40px -18px rgba(0, 0, 0, 0.6), 0 2px 8px -2px rgba(0, 0, 0, 0.176)');
    expect(boxShadow('xl', '#000000', 10)).toContain('rgba(0, 0, 0, 0.6)');
    expect(boxShadow('md', '#000000', 0)).toBe('none');
    expect(themeVariables('apple-dark')['--itsm-elevation-lg']).toBe(boxShadow('lg', '#000000', 2.2));
    expect(themeVariables('high-contrast')['--itsm-elevation-xs']).toBe('0 0 0 1px #000000');
    expect(themeVariables('high-contrast-dark')['--itsm-elevation-xl']).toBe('0 0 0 2px #ffffff');
    expect(themeVariables('high-contrast')['--itsm-focus-width']).toBe('3px');
    expect(themeVariables('apple')['--itsm-focus-width']).toBe('2px');
  });

  it('rests cards on a border, not a shadow, and keeps shadows for hover and for what floats', () => {
    const light = themeVariables('apple');
    expect(light['--itsm-elevation-none']).toBe('none');
    expect(light['--itsm-elevation-xs']).toBe('0 1px 2px 0px rgba(15, 23, 42, 0.05)');
    expect(light['--itsm-elevation-md']).toBe('0 8px 24px -12px rgba(15, 23, 42, 0.22), 0 2px 6px -2px rgba(15, 23, 42, 0.08)');
    expect(light['--itsm-elevation-xl']).toBe('0 32px 80px -24px rgba(15, 23, 42, 0.42), 0 4px 12px -4px rgba(15, 23, 42, 0.1)');
    expect(light['--itsm-elevation-hero']).toBe('0 18px 40px -28px rgba(15, 23, 42, 0.55)');
    expect(themeVariables('apple-dark')['--itsm-elevation-hero']).toBe('0 18px 40px -28px rgba(0, 0, 0, 0.6)');
    // Navy is its own edge on white; on black it needs one drawn.
    expect(themeVariables('high-contrast')['--itsm-elevation-hero']).toBe('none');
    expect(themeVariables('high-contrast-dark')['--itsm-elevation-hero']).toBe('0 0 0 2px #ffffff');
  });

  it('emits every v3 colour token in every theme', () => {
    for (const theme of themeNames) {
      const vars = themeVariables(theme);
      const palette = colour[theme];
      expect(vars['--itsm-colour-surface-raisedAlt'], theme).toBe(palette.surface.raisedAlt);
      expect(vars['--itsm-colour-text-faint'], theme).toBe(palette.text.faint);
      for (const border of ['divider', 'soft', 'softHover'] as const) {
        expect(vars[`--itsm-colour-border-${border}`], theme).toBe(palette.border[border]);
      }
      for (const intent of ['hold', 'high'] as const) {
        for (const slot of ['solid', 'solidHover', 'solidText', 'subtle', 'subtleText', 'border'] as const) {
          expect(vars[`--itsm-colour-${intent}-${slot}`], `${theme} ${intent} ${slot}`).toBe(palette.intent[intent][slot]);
        }
      }
      expect(vars['--itsm-colour-focusHalo'], theme).toBe(palette.focusHalo);
      for (let index = 1; index <= 8; index++) {
        expect(vars[`--itsm-colour-avatar-${index}`], theme).toBe(palette.avatar.fills[index - 1]);
        expect(vars[`--itsm-colour-chart-seq-${index}-ink`], theme).toBe(palette.chart.sequentialInk[index - 1]);
      }
      expect(vars['--itsm-colour-avatar-text'], theme).toBe('#ffffff');
      for (const slot of ['comparison', 'neutralSoft', 'marker', 'markerText'] as const) {
        expect(vars[`--itsm-colour-chart-${slot}`], theme).toBe(palette.chart[slot]);
      }
      const heroSlots = Object.keys(palette.hero);
      expect(heroSlots, theme).toHaveLength(24);
      for (const slot of heroSlots) {
        expect(vars[`--itsm-colour-hero-${slot}`], theme).toBe(palette.hero[slot as keyof typeof palette.hero]);
      }
      for (const surface of ['card', 'bar', 'panel', 'band', 'light']) {
        expect(vars[`--itsm-hero-${surface}-background`], `${theme} ${surface}`).toMatch(/^(radial|linear)-gradient\(/);
      }
      expect(vars['--itsm-gradient-brand'], theme).toBe(
        `linear-gradient(120deg, ${palette.gradient.brand[0]}, ${palette.gradient.brand[1]})`,
      );
      expect(vars['--itsm-gradient-brand-hover'], theme).toBe(
        `linear-gradient(120deg, ${palette.gradient.brandHover[0]}, ${palette.gradient.brandHover[1]})`,
      );
    }
    expect(themeVariables('apple')['--itsm-gradient-brand']).toBe('linear-gradient(120deg, #0071e3, #0260c0)');
    expect(themeVariables('apple')['--itsm-gradient-brand-hover']).toBe('linear-gradient(120deg, #0062c4, #0058b0)');
    expect(themeVariables('apple')['--itsm-highlight-inset']).toBe('inset 0 1px 0 0 rgba(255, 255, 255, 0.14)');
    expect(themeVariables('high-contrast')['--itsm-highlight-inset']).toBe('inset 0 0 0 0 transparent');
  });

  it('builds the navy backgrounds from the hero slots only', () => {
    const vars = themeVariables('apple');
    expect(vars['--itsm-hero-card-background']).toBe(
      'radial-gradient(90% 160% at 0% 0%, var(--itsm-colour-hero-glow) 0%, transparent 58%), linear-gradient(125deg, var(--itsm-colour-hero-surface) 0%, var(--itsm-colour-hero-surface) 45%, var(--itsm-colour-hero-surfaceRaised) 100%)',
    );
    expect(vars['--itsm-hero-band-background']).toBe(
      'radial-gradient(1200px 820px at 50% 0%, var(--itsm-colour-hero-glowBand), transparent 70%), var(--itsm-colour-hero-surfaceDeep)',
    );
    expect(vars['--itsm-hero-light-background']).toBe(
      'linear-gradient(125deg, var(--itsm-colour-surface-accentHover) 0%, var(--itsm-colour-surface-raised) 72%)',
    );
    for (const name of ['card', 'bar', 'panel', 'band', 'light']) {
      // No literal colour: every stop is a token, so a theme change reaches it.
      expect(vars[`--itsm-hero-${name}-background`]!).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
  });

  it('renders a stylesheet with a selector for each theme and an OS fallback', () => {
    const css = renderTokenStylesheet();
    // `apple` is the default, so it is the one that also answers at `:root` —
    // a document that pins no theme and expresses no OS preference still gets
    // a complete palette rather than half of one.
    expect(css).toContain(':root, [data-itsm-theme="apple"]');
    for (const theme of themeNames) expect(css).toContain(`[${themeAttribute}="${theme}"]`);
    // The retired names still select the themes that replaced them.
    expect(Object.keys(themeAliases)).toEqual(['light', 'dark']);
    expect(css).toContain(':root, [data-itsm-theme="apple"], [data-itsm-theme="light"] {');
    expect(css).toContain('[data-itsm-theme="apple-dark"], [data-itsm-theme="dark"] {');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('@media (prefers-contrast: more)');
    // Reduced motion is answered once, at the token layer.
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('--itsm-duration-normal: 1ms');
  });

  it('answers a dark device that asks for more contrast with high contrast dark', () => {
    const css = renderTokenStylesheet();
    const dark = css.indexOf('@media (prefers-color-scheme: dark) {');
    const more = css.indexOf('@media (prefers-contrast: more) {');
    const both = css.indexOf('@media (prefers-contrast: more) and (prefers-color-scheme: dark) {');
    // All three match that device; the last in source order wins, and it has
    // to be the combined one.
    expect(dark).toBeGreaterThan(-1);
    expect(more).toBeGreaterThan(dark);
    expect(both).toBeGreaterThan(more);
    const block = css.slice(both, css.indexOf('\n}', both));
    expect(block).toContain(':root:not([data-itsm-theme])');
    expect(block).toContain(`--itsm-colour-surface-canvas: ${colour['high-contrast-dark'].surface.canvas};`);
    expect(block).toContain(`--itsm-colour-text-primary: ${colour['high-contrast-dark'].text.primary};`);
  });

  it('switches density on <html> or any subtree, and lets a coarse pointer win', () => {
    const css = renderTokenStylesheet();
    expect(structuralVariables()['--itsm-control-height-md']).toBe('2.25rem');
    expect(css).toContain('[data-itsm-density="compact"] {\n  --itsm-control-height-sm: 1.5rem;');
    expect(css).toContain('[data-itsm-density="comfortable"] {');
    const coarse = css.indexOf('@media (pointer: coarse) {');
    expect(coarse).toBeGreaterThan(css.indexOf('[data-itsm-density="compact"]'));
    expect(css.slice(coarse)).toMatch(/--itsm-control-height-md: 2.5rem;[\s\S]*--itsm-control-height-lg: 3rem;/);
  });

  it('turns glass solid for reduced transparency, a person’s choice, and browsers that cannot blur', () => {
    const css = renderTokenStylesheet();
    for (const condition of [
      '@media (prefers-reduced-transparency: reduce) {',
      ':root[data-itsm-transparency="reduced"], [data-itsm-transparency="reduced"] [data-itsm-theme] {',
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {',
    ]) {
      const at = css.indexOf(condition);
      expect(at, condition).toBeGreaterThan(-1);
      const rules = css.slice(at, css.indexOf('}', at));
      expect(rules).toContain('--itsm-colour-material-chrome: var(--itsm-colour-surface-canvas);');
      expect(rules).toContain('--itsm-colour-material-popover: var(--itsm-colour-surface-overlay);');
      expect(rules).toContain('--itsm-material-chrome-filter: none;');
    }
  });

  it('applies reduced motion from the product setting as well as the OS, and stops lifts and presses', () => {
    const css = renderTokenStylesheet();
    const attribute = css.indexOf(':root[data-itsm-motion="reduced"] {');
    expect(attribute).toBeGreaterThan(-1);
    const rules = css.slice(attribute, css.indexOf('}', attribute));
    expect(rules).toContain('--itsm-duration-normal: 1ms;');
    expect(rules).toContain('--itsm-lift-md: 0px;');
    expect(rules).toContain('--itsm-press-scale: 1;');
  });

  it('hands glass and focus to the system colours in forced-colours mode', () => {
    const css = renderTokenStylesheet();
    const at = css.indexOf('@media (forced-colors: active) {');
    expect(at).toBeGreaterThan(-1);
    const rules = css.slice(at, css.indexOf('\n}', at));
    expect(rules).toContain('--itsm-colour-material-chrome: Canvas;');
    expect(rules).toContain('--itsm-colour-accent: Highlight;');
  });

  it('emits the spring as a linear() easing that overshoots by 1.1 % and settles on 1', () => {
    expect(structuralVariables()['--itsm-easing-spring']).toBe(springEasing);
    expect(springEasing.startsWith('linear(0, ')).toBe(true);
    expect(springEasing.endsWith(', 1)')).toBe(true);
    const points = springEasing.slice('linear('.length, -1).split(', ').map(Number);
    expect(Math.max(...points)).toBeCloseTo(1 + springOvershoot(spring.damping), 2);
    expect(springOvershoot(spring.damping)).toBeCloseTo(0.011, 3);
    // Rising until the peak: a spring does not hesitate on the way out.
    const peak = points.indexOf(Math.max(...points));
    for (let index = 1; index <= peak; index++) expect(points[index]!).toBeGreaterThan(points[index - 1]!);
    expect(() => springCurve({ damping: 1 })).toThrow();
  });

  it('emits the frame and layout sizes the shell reads', () => {
    const vars = structuralVariables();
    expect(vars['--itsm-topbar-height']).toBe('3.5rem');
    expect(vars['--itsm-sidebar-width']).toBe('16rem');
    expect(vars['--itsm-sidebar-rail']).toBe('4.5rem');
    expect(vars['--itsm-tabbar-height']).toBe('calc(3.75rem + env(safe-area-inset-bottom, 0px))');
    expect(vars['--itsm-page-gutter']).toBe('clamp(1rem, 2vw + 0.5rem, 1.5rem)');
    expect(vars['--itsm-bottom-dock-height']).toBe('0px');
    expect(vars['--itsm-radius-2xl']).toBe('0.75rem');
    expect(vars['--itsm-radius-lg']).toBe('0.5rem');
    expect(vars['--itsm-radius-item']).toBe('0.625rem');
    expect(vars['--itsm-radius-3xl']).toBe('1rem');
    expect(vars['--itsm-radius-4xl']).toBe('1.25rem');
    expect(vars['--itsm-content-max']).toBe('100rem');
    expect(vars['--itsm-card-padding']).toBe('1.25rem');
    expect(vars['--itsm-row-height']).toBe('2.5rem');
    expect(vars['--itsm-row-height-2line']).toBe('4rem');
    expect(vars['--itsm-nav-item-height']).toBe('2.25rem');
    expect(vars['--itsm-duration-reveal']).toBe('400ms');
    expect(vars['--itsm-z-dropdown']).toBe('500');
    expect(Number(vars['--itsm-z-dropdown'])).toBeGreaterThan(Number(vars['--itsm-z-dialog']));
    // The system bar sits above the frame's bars and below every overlay.
    expect(vars['--itsm-z-systemBar']).toBe('160');
    expect(Number(vars['--itsm-z-systemBar'])).toBeGreaterThan(Number(vars['--itsm-z-header']));
    expect(Number(vars['--itsm-z-systemBar'])).toBeLessThan(Number(vars['--itsm-z-overlay']));
  });

  it('reserves room for the system bar only where a bar sets it', () => {
    const vars = structuralVariables();
    expect(vars['--itsm-system-bar-height']).toBe('2.5rem');
    // 0px until `SystemBar.styles.ts` sets it: a page without the bar reserves nothing.
    expect(vars['--itsm-system-bar-h']).toBe('0px');
    expect(vars['--itsm-frame-top']).toBe('calc(var(--itsm-system-bar-h) + var(--itsm-topbar-height))');
    const css = renderTokenStylesheet();
    const phone = css.indexOf('@media (max-width: 47.999rem) {');
    expect(phone).toBeGreaterThan(-1);
    expect(css.slice(phone, css.indexOf('\n}', phone))).toContain('--itsm-system-bar-height: 4rem;');
    // The token layer never sets the offset to the height itself.
    expect(css).not.toMatch(/--itsm-system-bar-h: var\(/);
  });

  it('packs rows and nav items by density, and gives a coarse pointer its larger targets', () => {
    const css = renderTokenStylesheet();
    const compact = css.slice(css.indexOf('[data-itsm-density="compact"] {'));
    expect(compact.slice(0, compact.indexOf('}'))).toMatch(
      /--itsm-row-height: 2rem;[\s\S]*--itsm-row-height-2line: 3.25rem;[\s\S]*--itsm-nav-item-height: 2rem;/,
    );
    const coarse = css.slice(css.indexOf('@media (pointer: coarse) {'));
    expect(coarse.slice(0, coarse.indexOf('}'))).toMatch(
      /--itsm-row-height: 3rem;[\s\S]*--itsm-row-height-2line: 4.5rem;[\s\S]*--itsm-nav-item-height: 2.75rem;/,
    );
  });
});

describe('React Native rendering', () => {
  it('uses the same colours as the web theme', () => {
    for (const theme of themeNames) {
      expect(nativeThemes[theme].colour).toEqual(colour[theme]);
      // Both dark themes darken the status bar; `apple-dark` used to come out light.
      expect(nativeThemes[theme].scheme, theme).toBe(colour[theme].scheme);
    }
    expect(nativeThemes['apple-dark'].scheme).toBe('dark');
  });

  it('converts unitless line heights to absolute points', () => {
    const theme = createNativeTheme('apple');
    const body = theme.text.body;
    expect(body.fontSize).toBe(fontSize[textStyle.body.size]);
    expect(body.lineHeight).toBe(Math.round(fontSize.md * lineHeight.normal));
    expect(body.fontWeight).toBe('400');
    expect(body.fontFamily).toBe('-apple-system');
  });

  it('projects shadow geometry onto the iOS and Android props', () => {
    const shadow = createNativeTheme('apple').shadow.lg;
    // The deepest web layer (16px down, 40px blur) becomes the single native shadow.
    expect(shadow.shadowOffset.height).toBe(16);
    expect(shadow.shadowRadius).toBe(20);
    expect(shadow.elevation).toBeGreaterThan(0);
    expect(createNativeTheme('apple').shadow.none.shadowOpacity).toBe(0);
    // Stronger after dark, and none in high contrast, as on the web.
    expect(createNativeTheme('apple-dark').shadow.lg.shadowOpacity).toBeGreaterThan(shadow.shadowOpacity);
    expect(createNativeTheme('high-contrast').shadow.lg.shadowOpacity).toBe(0);
  });
});

describe('the component stylesheet and the token pipeline agree', () => {
  it('references no variable the pipeline does not emit', async () => {
    // A `var(--itsm-thing-that-does-not-exist)` is silent: the declaration is
    // dropped and the element renders with the browser default, which usually
    // looks *almost* right. Every colour, space and radius in the stylesheet
    // is checked against what the pipeline actually produces, so a renamed
    // token fails here rather than in somebody's screenshot.
    const { componentStylesheet } = await import('../../web/stylesheet.js');
    const defined = new Set([...Object.keys(structuralVariables()), ...Object.keys(themeVariables('apple'))]);
    const used = [...new Set([...componentStylesheet.matchAll(/var\((--itsm-[a-zA-Z0-9-]+)/g)].map((match) => match[1]!))];

    expect(used.length).toBeGreaterThan(50);
    expect(used.filter((variable) => !defined.has(variable))).toEqual([]);
  });
});
