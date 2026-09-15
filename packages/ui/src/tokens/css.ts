/**
 * The web rendering of the tokens: CSS custom properties.
 *
 * Nothing here invents a value. Every declaration is derived from `tokens.ts`,
 * which is what lets a designer change one hex and see it land in the portal,
 * the workbench, the admin console and the e-mail previews at once.
 *
 * Themes are selected by a `data-itsm-theme` attribute on any ancestor (not
 * just `:root`), so an admin preview pane can render the dark theme inside a
 * light page. When the attribute is absent we follow the operating system:
 * `prefers-color-scheme` and `prefers-contrast`.
 */
import {
  breakpoint,
  borderWidth,
  colour,
  controlHeight,
  duration,
  easing,
  elevation,
  focusRing,
  fontFamily,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
  radius,
  spacing,
  themeNames,
  zIndex,
  type BorderToken,
  type ElevationToken,
  type DurationToken,
  type EasingToken,
  type FontSizeToken,
  type FontWeightToken,
  type IntentColours,
  type IntentName,
  type LineHeightToken,
  type RadiusToken,
  type SpacingToken,
  type SurfaceToken,
  type TextToken,
  type ThemeName,
} from './tokens.js';
import { parseColour } from './contrast.js';

export const variablePrefix = '--itsm';

/** The attribute that pins a subtree to one theme, overriding the OS preference. */
export const themeAttribute = 'data-itsm-theme';

/** Font sizes and spacing are emitted in rem so that browser zoom and the user's own font size work. */
function rem(px: number): string {
  return px === 0 ? '0' : `${Number((px / 16).toFixed(4))}rem`;
}

export function rgba(colourValue: string, alpha: number): string {
  const { r, g, b } = parseColour(colourValue);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Renders one elevation level as a `box-shadow` value against a theme's shadow colour. */
export function boxShadow(level: ElevationToken, shadowColour: string): string {
  const layers = elevation[level];
  if (layers.length === 0) return 'none';
  return layers
    .map((l) => `0 ${l.offsetY}px ${l.blur}px ${l.spread}px ${rgba(shadowColour, l.opacity)}`)
    .join(', ');
}

/* -------------------------------------------------------------------------
 * Typed accessors — what components use instead of writing var() by hand
 * ---------------------------------------------------------------------- */

const ref = (name: string): string => `var(${variablePrefix}-${name})`;

export const cssVar = {
  surface: (token: SurfaceToken): string => ref(`colour-surface-${token}`),
  text: (token: TextToken): string => ref(`colour-text-${token}`),
  border: (token: BorderToken): string => ref(`colour-border-${token}`),
  intent: (intent: IntentName, slot: keyof IntentColours): string => ref(`colour-${intent}-${slot}`),
  scrim: (): string => ref('colour-scrim'),
  space: (token: SpacingToken): string => ref(`space-${token}`),
  radius: (token: RadiusToken): string => ref(`radius-${token}`),
  fontSize: (token: FontSizeToken): string => ref(`font-size-${token}`),
  fontWeight: (token: FontWeightToken): string => ref(`font-weight-${token}`),
  lineHeight: (token: LineHeightToken): string => ref(`line-height-${token}`),
  fontFamily: (token: keyof typeof fontFamily): string => ref(`font-family-${token}`),
  duration: (token: DurationToken): string => ref(`duration-${token}`),
  easing: (token: EasingToken): string => ref(`easing-${token}`),
  elevation: (token: ElevationToken): string => ref(`elevation-${token}`),
  zIndex: (token: keyof typeof zIndex): string => ref(`z-${token}`),
  controlHeight: (token: keyof typeof controlHeight): string => ref(`control-height-${token}`),
} as const;

/* -------------------------------------------------------------------------
 * Variable maps
 * ---------------------------------------------------------------------- */

/** The variables that do not change between themes. */
export function structuralVariables(): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const [token, value] of Object.entries(spacing)) vars[`${variablePrefix}-space-${token}`] = rem(value);
  for (const [token, value] of Object.entries(radius)) {
    vars[`${variablePrefix}-radius-${token}`] = token === 'pill' ? `${value}px` : rem(value);
  }
  for (const [token, value] of Object.entries(borderWidth)) vars[`${variablePrefix}-border-${token}`] = `${value}px`;
  for (const [token, value] of Object.entries(controlHeight)) {
    vars[`${variablePrefix}-control-height-${token}`] = rem(value);
  }
  vars[`${variablePrefix}-focus-width`] = `${focusRing.width}px`;
  vars[`${variablePrefix}-focus-offset`] = `${focusRing.offset}px`;

  for (const [token, stack] of Object.entries(fontFamily)) {
    vars[`${variablePrefix}-font-family-${token}`] = stack.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(', ');
  }
  for (const [token, value] of Object.entries(fontSize)) vars[`${variablePrefix}-font-size-${token}`] = rem(value);
  for (const [token, value] of Object.entries(lineHeight)) vars[`${variablePrefix}-line-height-${token}`] = String(value);
  for (const [token, value] of Object.entries(fontWeight)) vars[`${variablePrefix}-font-weight-${token}`] = String(value);
  for (const [token, value] of Object.entries(letterSpacing)) {
    vars[`${variablePrefix}-letter-spacing-${token}`] = value === 0 ? '0' : `${value}em`;
  }

  for (const [token, value] of Object.entries(duration)) vars[`${variablePrefix}-duration-${token}`] = `${value}ms`;
  for (const [token, curve] of Object.entries(easing)) {
    vars[`${variablePrefix}-easing-${token}`] = `cubic-bezier(${curve.join(', ')})`;
  }
  for (const [token, value] of Object.entries(zIndex)) vars[`${variablePrefix}-z-${token}`] = String(value);

  return vars;
}

/** The variables that a theme replaces. */
export function themeVariables(theme: ThemeName): Record<string, string> {
  const palette = colour[theme];
  const vars: Record<string, string> = {};

  for (const [token, value] of Object.entries(palette.surface)) vars[`${variablePrefix}-colour-surface-${token}`] = value;
  for (const [token, value] of Object.entries(palette.text)) vars[`${variablePrefix}-colour-text-${token}`] = value;
  for (const [token, value] of Object.entries(palette.border)) vars[`${variablePrefix}-colour-border-${token}`] = value;
  for (const [intent, slots] of Object.entries(palette.intent)) {
    for (const [slot, value] of Object.entries(slots)) vars[`${variablePrefix}-colour-${intent}-${slot}`] = value;
  }
  vars[`${variablePrefix}-colour-scrim`] = palette.scrim;
  vars[`${variablePrefix}-colour-shadow`] = palette.shadow;

  // Shadows are baked per theme because their alpha is applied to that theme's
  // shadow colour; a single variable could not express both.
  for (const level of Object.keys(elevation) as ElevationToken[]) {
    vars[`${variablePrefix}-elevation-${level}`] = boxShadow(level, palette.shadow);
  }

  // The colour scheme keyword makes the browser's own UI — scrollbars, form
  // controls we do not skin, the caret — follow the theme.
  vars['color-scheme'] = theme === 'dark' ? 'dark' : 'light';

  return vars;
}

function block(selector: string, vars: Record<string, string>, indent = ''): string {
  const body = Object.entries(vars)
    .map(([name, value]) => `${indent}  ${name}: ${value};`)
    .join('\n');
  return `${indent}${selector} {\n${body}\n${indent}}`;
}

/** The `[data-itsm-theme="x"]` selector for a theme, including `:root` for the default. */
export function themeSelector(theme: ThemeName): string {
  return `[${themeAttribute}="${theme}"]`;
}

/**
 * The complete token stylesheet. Injected once per document by `ThemeProvider`;
 * apps that prefer a build step can write it to a `.css` file instead.
 */
export function renderTokenStylesheet(): string {
  const sections: string[] = [];

  sections.push(`:root {\n${Object.entries(structuralVariables()).map(([n, v]) => `  ${n}: ${v};`).join('\n')}\n}`);

  // Light is the default so that a document with no attribute and no OS
  // preference still renders a complete theme.
  sections.push(block(`:root, ${themeSelector('light')}`, themeVariables('light')));

  for (const theme of themeNames) {
    if (theme === 'light') continue;
    sections.push(block(themeSelector(theme), themeVariables(theme)));
  }

  // OS preferences apply only where the app has not pinned a theme, so an
  // explicit choice in the user's profile always wins.
  sections.push(
    `@media (prefers-color-scheme: dark) {\n${block(`:root:not([${themeAttribute}])`, themeVariables('dark'), '  ')}\n}`,
  );
  sections.push(
    `@media (prefers-contrast: more) {\n${block(
      `:root:not([${themeAttribute}])`,
      themeVariables('high-contrast'),
      '  ',
    )}\n}`,
  );

  // Reduced motion is handled at the token layer: every component animates
  // with a duration variable, so collapsing the variables removes motion from
  // components that have not thought about it, not just the ones that have.
  sections.push(
    [
      '@media (prefers-reduced-motion: reduce) {',
      '  :root {',
      ...Object.keys(duration).map((token) => `    ${variablePrefix}-duration-${token}: 1ms;`),
      '  }',
      '  .itsm-motion-safe {',
      '    animation: none !important;',
      '    transition: none !important;',
      '  }',
      '}',
    ].join('\n'),
  );

  for (const [token, min] of Object.entries(breakpoint)) {
    sections.push(`/* breakpoint ${token}: min-width ${rem(min)} */`);
  }

  return `${sections.join('\n\n')}\n`;
}
