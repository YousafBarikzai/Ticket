import { describe, expect, it } from 'vitest';
import { colour, fontSize, lineHeight, spacing, textStyle, themeNames } from '../tokens.js';
import { renderTokenStylesheet, structuralVariables, themeVariables, boxShadow, themeAttribute } from '../css.js';
import { createNativeTheme, nativeThemes } from '../native.js';

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
      expect(vars['--itsm-colour-danger-solid']).toBe(palette.intent.danger.solid);
      expect(vars['color-scheme']).toBe(theme === 'dark' ? 'dark' : 'light');
    }
  });

  it('expresses spacing and type in rem so that browser zoom works', () => {
    const vars = structuralVariables();
    expect(vars['--itsm-space-md']).toBe(`${spacing.md / 16}rem`);
    expect(vars['--itsm-font-size-md']).toBe(`${fontSize.md / 16}rem`);
    expect(vars['--itsm-line-height-normal']).toBe(String(lineHeight.normal));
  });

  it('builds shadows from the shared geometry and the theme shadow colour', () => {
    expect(boxShadow('none', '#000000')).toBe('none');
    expect(boxShadow('sm', '#0b1220')).toBe('0 1px 2px 0px rgba(11, 18, 32, 0.08)');
  });

  it('renders a stylesheet with a selector for each theme and an OS fallback', () => {
    const css = renderTokenStylesheet();
    expect(css).toContain(':root, [data-itsm-theme="light"]');
    for (const theme of themeNames) expect(css).toContain(`[${themeAttribute}="${theme}"]`);
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('@media (prefers-contrast: more)');
    // Reduced motion is answered once, at the token layer.
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('--itsm-duration-normal: 1ms');
  });
});

describe('React Native rendering', () => {
  it('uses the same colours as the web theme', () => {
    for (const theme of themeNames) {
      expect(nativeThemes[theme].colour).toEqual(colour[theme]);
      expect(nativeThemes[theme].scheme).toBe(theme === 'dark' ? 'dark' : 'light');
    }
  });

  it('converts unitless line heights to absolute points', () => {
    const theme = createNativeTheme('light');
    const body = theme.text.body;
    expect(body.fontSize).toBe(fontSize[textStyle.body.size]);
    expect(body.lineHeight).toBe(Math.round(fontSize.md * lineHeight.normal));
    expect(body.fontWeight).toBe('400');
  });

  it('projects shadow geometry onto the iOS and Android props', () => {
    const shadow = createNativeTheme('light').shadow.lg;
    // The deepest web layer (8px down, 20px blur) becomes the single native shadow.
    expect(shadow.shadowOffset.height).toBe(8);
    expect(shadow.shadowRadius).toBe(10);
    expect(shadow.elevation).toBeGreaterThan(0);
    expect(createNativeTheme('light').shadow.none.shadowOpacity).toBe(0);
  });
});
