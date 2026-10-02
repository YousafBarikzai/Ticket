/**
 * The web rendering of the tokens: CSS custom properties.
 *
 * Nothing here invents a value. Every declaration is derived from `tokens.ts`,
 * which is what lets a designer change one hex and see it land in the portal,
 * the workbench and the admin console at once.
 *
 * Themes are selected by a `data-itsm-theme` attribute on any ancestor (not
 * just `:root`), so an admin preview pane can render the dark theme inside a
 * light page. When the attribute is absent we follow the operating system:
 * `prefers-color-scheme` and `prefers-contrast`. The pre-paint script
 * (`theme/theme-script.ts`) sets the attribute only when the person has chosen
 * something other than "follow my device" on at least one axis.
 *
 * Density, reduced motion and reduced transparency work the same way: a media
 * query answers for the operating system, and a `data-itsm-*` attribute on
 * `<html>` answers for a choice made in the product.
 */
import {
  breakpoint,
  borderWidth,
  colour,
  contentWidth,
  controlHeight,
  density,
  duration,
  easing,
  elevation,
  focusRing,
  fontFamily,
  fontSize,
  fontWeight,
  iconSize,
  layout,
  letterSpacing,
  lift,
  lineHeight,
  materialBlur,
  pageGutter,
  pressScale,
  radius,
  shadowAlphaCap,
  sheetWidth,
  spacing,
  textRamp,
  themeAliases,
  themeNames,
  zIndex,
  type BorderToken,
  type DurationToken,
  type EasingToken,
  type ElevationToken,
  type FontSizeToken,
  type FontWeightToken,
  type HeroSlot,
  type IntentColours,
  type IntentName,
  type LineHeightToken,
  type MaterialName,
  type RadiusToken,
  type SpacingToken,
  type SurfaceToken,
  type RampStyle,
  type TextToken,
  type ThemeName,
} from './tokens.js';
import { parseColour, parseColourAlpha } from './contrast.js';
import { springEasing } from './spring.js';

export const variablePrefix = '--itsm';

/** The attribute that pins a subtree to one theme, overriding the OS preference. */
export const themeAttribute = 'data-itsm-theme';

/** The other attributes the pre-paint script and `ThemeProvider` write on `<html>`. */
export const densityAttribute = 'data-itsm-density';
export const motionAttribute = 'data-itsm-motion';
export const transparencyAttribute = 'data-itsm-transparency';

/** Font sizes and spacing are emitted in rem so that browser zoom and the user's own font size work. */
function rem(px: number): string {
  return px === 0 ? '0' : `${Number((px / 16).toFixed(4))}rem`;
}

/** An alpha, without floating-point noise: 0.14 × 2.2 is 0.308, not 0.30800000000000005. */
function alphaValue(value: number): number {
  return Number(value.toFixed(3));
}

export function rgba(colourValue: string, alpha: number): string {
  const { r, g, b } = parseColour(colourValue);
  return `rgba(${r}, ${g}, ${b}, ${alphaValue(alpha)})`;
}

/**
 * Renders one elevation level as a `box-shadow` value against a theme's shadow
 * colour. `strength` multiplies every layer's alpha (capped at 0.6) — the dark
 * theme's shadows are stronger because a dark canvas swallows a light one. A
 * strength of 0 is no shadow at all.
 */
export function boxShadow(level: ElevationToken, shadowColour: string, strength = 1): string {
  const layers = elevation[level];
  if (layers.length === 0 || strength === 0) return 'none';
  return layers
    .map(
      (l) =>
        `0 ${l.offsetY}px ${l.blur}px ${l.spread}px ${rgba(shadowColour, Math.min(shadowAlphaCap, l.opacity * strength))}`,
    )
    .join(', ');
}

/**
 * A theme's elevation. Where the theme has shadows, the shadow; where it has
 * none (the high-contrast themes), an outline in `border.strong` drawn with
 * the same property — 1px for the resting levels, 2px for the floating ones —
 * so every component that lifts itself with an elevation token gets its edge
 * in high contrast without a rule of its own.
 *
 * The navy hero card is the exception. On the white high-contrast canvas the
 * navy is its own edge (about 17:1), so it gets none; on the black one navy
 * all but disappears (1.2:1), so it gets the 2px white outline.
 */
function themeElevation(level: ElevationToken, theme: ThemeName): string {
  const palette = colour[theme];
  if (level === 'none') return 'none';
  if (palette.shadowStrength > 0) return boxShadow(level, palette.shadow, palette.shadowStrength);
  if (level === 'hero') return palette.scheme === 'dark' ? `0 0 0 2px ${palette.border.strong}` : 'none';
  const width = level === 'lg' || level === 'xl' ? 2 : 1;
  return `0 0 0 ${width}px ${palette.border.strong}`;
}

/** A family name needs quotes when it has a space in it; keywords and `var()` entries must not have them. */
function fontStack(stack: readonly string[]): string {
  return stack.map((family) => (family.includes(' ') && !family.startsWith('var(') ? `"${family}"` : family)).join(', ');
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
  hero: (slot: HeroSlot): string => ref(`colour-hero-${slot}`),
  accent: (): string => ref('colour-accent'),
  scrim: (): string => ref('colour-scrim'),
  space: (token: SpacingToken): string => ref(`space-${token}`),
  radius: (token: RadiusToken): string => ref(`radius-${token}`),
  lift: (token: 'sm' | 'md'): string => ref(`lift-${token}`),
  fontSize: (token: FontSizeToken): string => ref(`font-size-${token}`),
  fontWeight: (token: FontWeightToken): string => ref(`font-weight-${token}`),
  lineHeight: (token: LineHeightToken): string => ref(`line-height-${token}`),
  fontFamily: (token: keyof typeof fontFamily): string => ref(`font-family-${token}`),
  duration: (token: DurationToken): string => ref(`duration-${token}`),
  easing: (token: EasingToken | 'spring'): string => ref(`easing-${token}`),
  elevation: (token: ElevationToken): string => ref(`elevation-${token}`),
  zIndex: (token: keyof typeof zIndex): string => ref(`z-${token}`),
  controlHeight: (token: keyof typeof controlHeight): string => ref(`control-height-${token}`),
} as const;

/* -------------------------------------------------------------------------
 * Variable maps
 * ---------------------------------------------------------------------- */

/** The density-dependent sizes, for one density. */
function densityVariables(sizes: {
  readonly controlHeight: Partial<Record<keyof typeof controlHeight, number>>;
  readonly rowHeight: number;
  readonly rowHeight2line: number;
  readonly navItemHeight: number;
}): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [token, value] of Object.entries(sizes.controlHeight)) {
    vars[`${variablePrefix}-control-height-${token}`] = rem(value);
  }
  vars[`${variablePrefix}-row-height`] = rem(sizes.rowHeight);
  vars[`${variablePrefix}-row-height-2line`] = rem(sizes.rowHeight2line);
  vars[`${variablePrefix}-nav-item-height`] = rem(sizes.navItemHeight);
  return vars;
}

/** An em length, or a bare `0`, without floating-point noise. */
function em(value: number): string {
  return value === 0 ? '0' : `${Number(value.toFixed(4))}em`;
}

/**
 * The input text size: 14px, and 16px under a coarse pointer, because iOS
 * zooms the page into any field set smaller than 16px and does not zoom back.
 */
const inputFontSize = { fine: 14, coarse: 16 } as const;

/**
 * Below this width the system bar is two lines (SPEC-v3 §2.8). Written as
 * the spec gives it, a hair under 48rem, so the bar's own `min-width: 48rem`
 * rules and this one never both apply.
 */
export const systemBarPhoneQuery = '@media (max-width: 47.999rem)';

/** The variables that do not change between themes. */
export function structuralVariables(): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const [token, value] of Object.entries(spacing)) vars[`${variablePrefix}-space-${token}`] = rem(value);
  for (const [token, value] of Object.entries(radius)) {
    vars[`${variablePrefix}-radius-${token}`] = token === 'pill' ? `${value}px` : rem(value);
  }
  for (const [token, value] of Object.entries(borderWidth)) vars[`${variablePrefix}-border-${token}`] = `${value}px`;
  // A decorative separator: one device pixel on a high-density screen, so it
  // stays crisp at the fractional scales Windows uses (125 %, 150 %).
  vars[`${variablePrefix}-hairline`] = `${borderWidth.hair}px`;
  for (const [token, value] of Object.entries(lift)) vars[`${variablePrefix}-lift-${token}`] = `${value}px`;
  vars[`${variablePrefix}-press-scale`] = String(pressScale);
  Object.assign(vars, densityVariables(density.comfortable));
  vars[`${variablePrefix}-focus-width`] = `${focusRing.width}px`;
  vars[`${variablePrefix}-focus-offset`] = `${focusRing.offset}px`;

  for (const [token, stack] of Object.entries(fontFamily)) vars[`${variablePrefix}-font-family-${token}`] = fontStack(stack);
  for (const [token, value] of Object.entries(fontSize)) vars[`${variablePrefix}-font-size-${token}`] = rem(value);
  for (const [token, value] of Object.entries(lineHeight)) vars[`${variablePrefix}-line-height-${token}`] = String(value);
  for (const [token, value] of Object.entries(fontWeight)) vars[`${variablePrefix}-font-weight-${token}`] = String(value);
  for (const [token, value] of Object.entries(letterSpacing)) {
    vars[`${variablePrefix}-letter-spacing-${token}`] = value === 0 ? '0' : `${value}em`;
  }
  for (const [style, ramp] of Object.entries(textRamp) as [string, RampStyle][]) {
    vars[`${variablePrefix}-text-${style}-size`] = rem(ramp.size);
    vars[`${variablePrefix}-text-${style}-line`] = rem(ramp.line);
    vars[`${variablePrefix}-text-${style}-weight`] = String(ramp.weight);
    vars[`${variablePrefix}-text-${style}-tracking`] = em(ramp.tracking);
    // The stack by reference, so a style and the family it names cannot drift.
    vars[`${variablePrefix}-text-${style}-family`] = `var(${variablePrefix}-font-family-${ramp.family})`;
    vars[`${variablePrefix}-text-${style}-word-spacing`] = em(ramp.wordSpacing);
    if (ramp.measure !== undefined) vars[`${variablePrefix}-text-${style}-measure`] = `${ramp.measure}ch`;
  }
  vars[`${variablePrefix}-input-font-size`] = rem(inputFontSize.fine);
  for (const [token, value] of Object.entries(iconSize)) vars[`${variablePrefix}-icon-${token}`] = rem(value);

  vars[`${variablePrefix}-topbar-height`] = rem(layout.topbarHeight);
  vars[`${variablePrefix}-sidebar-width`] = rem(layout.sidebarWidth);
  vars[`${variablePrefix}-sidebar-rail`] = rem(layout.sidebarRail);
  vars[`${variablePrefix}-inspector-width`] = rem(layout.inspectorWidth);
  vars[`${variablePrefix}-listpane-width`] = rem(layout.listpaneWidth);
  vars[`${variablePrefix}-tabbar-height`] = `calc(${rem(layout.tabbarHeight)} + env(safe-area-inset-bottom, 0px))`;
  vars[`${variablePrefix}-panel-inset`] = rem(layout.panelInset);
  vars[`${variablePrefix}-card-padding`] = rem(layout.cardPadding);
  // The system bar's own height, and the offset the frame makes for it. The
  // offset is 0px here and is set to the height by one rule only, in
  // `SystemBar.styles.ts`, when a bar is on the page at a desktop width
  // (`:root:has(.itsm-SystemBar)`): a page without the bar, or a phone where
  // the bar scrolls away in the flow, reserves nothing. `frame-top` is where
  // sticky content sits: under the system bar and the top bar together.
  vars[`${variablePrefix}-system-bar-height`] = rem(layout.systemBarHeight.desktop);
  vars[`${variablePrefix}-system-bar-h`] = '0px';
  vars[`${variablePrefix}-frame-top`] = `calc(var(${variablePrefix}-system-bar-h) + var(${variablePrefix}-topbar-height))`;
  for (const [token, value] of Object.entries(contentWidth)) vars[`${variablePrefix}-content-${token}`] = rem(value);
  for (const [token, value] of Object.entries(sheetWidth)) vars[`${variablePrefix}-sheet-${token}`] = rem(value);
  vars[`${variablePrefix}-page-gutter`] =
    `clamp(${rem(pageGutter.min)}, ${pageGutter.fluidVw}vw + ${rem(pageGutter.fluidPx)}, ${rem(pageGutter.max)})`;
  // Published at run time by the phone's bottom dock (tab bar, contextual
  // bar); zero until it does, so `scroll-padding-bottom` and anything else
  // that makes room for it reads a real length everywhere else.
  vars[`${variablePrefix}-bottom-dock-height`] = '0px';
  // The safe-area insets, once, so a component reads a token rather than
  // repeating `env()` with its own fallback.
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    vars[`${variablePrefix}-safe-area-${side}`] = `env(safe-area-inset-${side}, 0px)`;
  }
  for (const [token, value] of Object.entries(materialBlur)) vars[`${variablePrefix}-blur-${token}`] = `${value}px`;

  for (const [token, value] of Object.entries(duration)) vars[`${variablePrefix}-duration-${token}`] = `${value}ms`;
  for (const [token, curve] of Object.entries(easing)) {
    vars[`${variablePrefix}-easing-${token}`] = `cubic-bezier(${curve.join(', ')})`;
  }
  vars[`${variablePrefix}-easing-spring`] = springEasing;
  for (const [token, value] of Object.entries(zIndex)) vars[`${variablePrefix}-z-${token}`] = String(value);

  return vars;
}

/** The `backdrop-filter` of a material in a theme: `none` where the theme has no glass. */
function materialFilter(theme: ThemeName, material: MaterialName): string {
  const { background, saturate } = colour[theme].material[material];
  if (saturate === null || parseColourAlpha(background).a === 1) return 'none';
  return `blur(${materialBlur[material]}px) saturate(${saturate}%)`;
}

/** The variables that a theme replaces. Every theme emits the same names, so a nested theme replaces all of them. */
export function themeVariables(theme: ThemeName): Record<string, string> {
  const palette = colour[theme];
  const vars: Record<string, string> = {};
  const highContrast = palette.contrast === 'more';

  for (const [token, value] of Object.entries(palette.surface)) vars[`${variablePrefix}-colour-surface-${token}`] = value;
  for (const [token, value] of Object.entries(palette.text)) vars[`${variablePrefix}-colour-text-${token}`] = value;
  for (const [token, value] of Object.entries(palette.border)) vars[`${variablePrefix}-colour-border-${token}`] = value;
  for (const [intent, slots] of Object.entries(palette.intent)) {
    for (const [slot, value] of Object.entries(slots)) vars[`${variablePrefix}-colour-${intent}-${slot}`] = value;
  }
  vars[`${variablePrefix}-colour-accent`] = palette.accent;
  // The inner half of the two-tone focus ring: the gap between an element and
  // its outline, filled with the colour of a card, so the ring reads on glass
  // and on a saturated fill as well as on a plain surface.
  vars[`${variablePrefix}-colour-focusGap`] = palette.surface.raised;
  vars[`${variablePrefix}-colour-focusHalo`] = palette.focusHalo;
  // A whole `box-shadow` layer, so a filled button lists it beside its
  // elevation. A zero-size transparent layer where the theme has none, which
  // keeps that list valid.
  vars[`${variablePrefix}-highlight-inset`] =
    palette.highlightInset === null ? 'inset 0 0 0 0 transparent' : `inset 0 1px 0 0 ${palette.highlightInset}`;
  // Built here from the stored hex stops, so every stop is a value the
  // contrast audit has checked against the button's text.
  vars[`${variablePrefix}-gradient-brand`] = `linear-gradient(120deg, ${palette.gradient.brand[0]}, ${palette.gradient.brand[1]})`;
  vars[`${variablePrefix}-gradient-brand-hover`] =
    `linear-gradient(120deg, ${palette.gradient.brandHover[0]}, ${palette.gradient.brandHover[1]})`;
  for (const [token, value] of Object.entries(palette.fill)) vars[`${variablePrefix}-colour-fill-${token}`] = value;
  vars[`${variablePrefix}-track-ring`] = `inset 0 0 0 ${palette.trackBorder.width}px ${palette.trackBorder.colour}`;
  // Transparent rather than `none` where the theme has no lit edge, so it can
  // be listed alongside an elevation in one `box-shadow` without breaking it.
  vars[`${variablePrefix}-edge-highlight`] = `inset 0 1px 0 0 ${palette.edgeHighlight ?? 'transparent'}`;

  for (const material of Object.keys(palette.material) as MaterialName[]) {
    vars[`${variablePrefix}-colour-material-${material}`] = palette.material[material].background;
    vars[`${variablePrefix}-material-${material}-filter`] = materialFilter(theme, material);
  }
  vars[`${variablePrefix}-colour-scrim`] = palette.scrim;
  vars[`${variablePrefix}-scrim-filter`] = highContrast ? 'none' : `blur(${materialBlur.scrim}px)`;

  palette.chart.categorical.forEach((value, index) => {
    vars[`${variablePrefix}-colour-chart-${index + 1}`] = value;
  });
  palette.chart.sequential.forEach((value, index) => {
    vars[`${variablePrefix}-colour-chart-seq-${(index + 1) * 100}`] = value;
  });
  // The label colour of each step, numbered 1–8 (the step itself is 100–800).
  palette.chart.sequentialInk.forEach((value, index) => {
    vars[`${variablePrefix}-colour-chart-seq-${index + 1}-ink`] = value;
  });
  vars[`${variablePrefix}-colour-chart-grid`] = palette.chart.grid;
  vars[`${variablePrefix}-colour-chart-axis`] = palette.chart.axis;
  vars[`${variablePrefix}-colour-chart-comparison`] = palette.chart.comparison;
  vars[`${variablePrefix}-colour-chart-neutralSoft`] = palette.chart.neutralSoft;
  vars[`${variablePrefix}-colour-chart-marker`] = palette.chart.marker;
  vars[`${variablePrefix}-colour-chart-markerText`] = palette.chart.markerText;

  palette.avatar.fills.forEach((value, index) => {
    vars[`${variablePrefix}-colour-avatar-${index + 1}`] = value;
  });
  vars[`${variablePrefix}-colour-avatar-text`] = palette.avatar.text;

  for (const [slot, value] of Object.entries(palette.hero)) vars[`${variablePrefix}-colour-hero-${slot}`] = value;
  Object.assign(vars, heroBackgrounds);

  vars[`${variablePrefix}-colour-shadow`] = palette.shadow;
  // Shadows are baked per theme because their alpha is applied to that theme's
  // shadow colour and strength; a single variable could not express both.
  for (const level of Object.keys(elevation) as ElevationToken[]) {
    vars[`${variablePrefix}-elevation-${level}`] = themeElevation(level, theme);
  }
  vars[`${variablePrefix}-focus-width`] = `${highContrast ? focusRing.highContrastWidth : focusRing.width}px`;

  // The colour scheme keyword makes the browser's own UI — scrollbars, form
  // controls we do not skin, the caret — follow the theme.
  vars['color-scheme'] = palette.scheme;

  return vars;
}

/**
 * The navy surfaces' backgrounds, built only from the hero slots and two page
 * surfaces (SPEC-v3 §2.5), so the demo bar, the sign-in panel and the landing
 * page copy no colour of their own. Emitted with every theme rather than once
 * at the root: a custom property that reads `var()` is resolved where it is
 * declared, so a subtree pinned to another theme has to declare it again to
 * get that theme's slots.
 */
const hero = (slot: HeroSlot): string => `var(${variablePrefix}-colour-hero-${slot})`;
const heroBackgrounds: Readonly<Record<string, string>> = {
  [`${variablePrefix}-hero-card-background`]: `radial-gradient(90% 160% at 0% 0%, ${hero('glow')} 0%, transparent 58%), linear-gradient(125deg, ${hero('surface')} 0%, ${hero('surface')} 45%, ${hero('surfaceRaised')} 100%)`,
  [`${variablePrefix}-hero-bar-background`]: `radial-gradient(560px 120px at 0 0, ${hero('glowBar')}, transparent), radial-gradient(420px 90px at 100% 100%, color-mix(in srgb, ${hero('glowBar')} 44%, transparent), transparent), linear-gradient(90deg, ${hero('surfaceDeep')} 0%, ${hero('surface')} 55%, ${hero('surfaceRaised')} 100%)`,
  [`${variablePrefix}-hero-panel-background`]: `radial-gradient(640px circle at 100% 100%, ${hero('glowPanel')}, transparent 68%), linear-gradient(160deg, ${hero('surface')} 0%, ${hero('surface')} 38%, ${hero('surfaceEnd')} 100%)`,
  [`${variablePrefix}-hero-band-background`]: `radial-gradient(1200px 820px at 50% 0%, ${hero('glowBand')}, transparent 70%), ${hero('surfaceDeep')}`,
  [`${variablePrefix}-hero-light-background`]: `linear-gradient(125deg, var(${variablePrefix}-colour-surface-accentHover) 0%, var(${variablePrefix}-colour-surface-raised) 72%)`,
};

function block(selector: string, vars: Record<string, string>, indent = ''): string {
  const body = Object.entries(vars)
    .map(([name, value]) => `${indent}  ${name}: ${value};`)
    .join('\n');
  return `${indent}${selector} {\n${body}\n${indent}}`;
}

function media(query: string, content: string): string {
  return `${query} {\n${content}\n}`;
}

/** The `[data-itsm-theme="x"]` selector for a theme. */
export function themeSelector(theme: ThemeName | keyof typeof themeAliases): string {
  return `[${themeAttribute}="${theme}"]`;
}

/**
 * Every selector a theme answers to: its own, and any retired name that now
 * means it (`light` → `apple`, `dark` → `apple-dark`).
 */
function themeSelectors(theme: ThemeName): string {
  const aliases = (Object.entries(themeAliases) as [keyof typeof themeAliases, ThemeName][])
    .filter(([, target]) => target === theme)
    .map(([alias]) => themeSelector(alias));
  return [themeSelector(theme), ...aliases].join(', ');
}

/**
 * The elements the operating-system fallbacks apply to: the document root when
 * nothing has pinned a theme.
 */
const unpinnedRoot = `:root:not([${themeAttribute}])`;

/**
 * The elements a user-level override (transparency, forced colours) has to
 * reach: the root however it is themed, and any subtree pinned to a theme of
 * its own. Two parts because the OS theme fallbacks above use the more
 * specific `:root:not([…])`, and an override emitted after them has to match
 * that specificity to beat them.
 */
const everyThemedElement = `${unpinnedRoot}, [${themeAttribute}]`;

/** Glass off: each material becomes the opaque surface it stands in for, and nothing is blurred. */
const solidMaterials: Record<string, string> = {
  [`${variablePrefix}-colour-material-chrome`]: `var(${variablePrefix}-colour-surface-canvas)`,
  [`${variablePrefix}-colour-material-popover`]: `var(${variablePrefix}-colour-surface-overlay)`,
  [`${variablePrefix}-material-chrome-filter`]: 'none',
  [`${variablePrefix}-material-popover-filter`]: 'none',
  [`${variablePrefix}-scrim-filter`]: 'none',
};

/** Reduced motion at the token layer: durations collapse, and the movements that are pure feedback stop. */
const reducedMotionVariables: Record<string, string> = {
  ...Object.fromEntries(Object.keys(duration).map((token) => [`${variablePrefix}-duration-${token}`, '1ms'])),
  ...Object.fromEntries(Object.keys(lift).map((token) => [`${variablePrefix}-lift-${token}`, '0px'])),
  [`${variablePrefix}-press-scale`]: '1',
};

/**
 * The complete token stylesheet. `styles/index.ts` wraps it in the
 * `itsm.tokens` layer; this function stays a plain rendering of the tokens.
 */
export function renderTokenStylesheet(): string {
  const sections: string[] = [];

  sections.push(block(':root', structuralVariables()));
  // The phone system bar is two lines in the flow.
  sections.push(
    media(
      systemBarPhoneQuery,
      block(':root', { [`${variablePrefix}-system-bar-height`]: rem(layout.systemBarHeight.phone) }, '  '),
    ),
  );

  // `apple` is the default so that a document with no attribute and no OS
  // preference still renders a complete theme.
  sections.push(block(`:root, ${themeSelectors('apple')}`, themeVariables('apple')));
  for (const theme of themeNames) {
    if (theme === 'apple') continue;
    sections.push(block(themeSelectors(theme), themeVariables(theme)));
  }

  // OS preferences apply only where the app has not pinned a theme, so an
  // explicit choice always wins. The combined query comes last: a dark device
  // asking for more contrast matches all three, and the last one — high
  // contrast *dark* — is the one it wants. In the other order it got the light
  // high-contrast theme at night.
  sections.push(media('@media (prefers-color-scheme: dark)', block(unpinnedRoot, themeVariables('apple-dark'), '  ')));
  sections.push(media('@media (prefers-contrast: more)', block(unpinnedRoot, themeVariables('high-contrast'), '  ')));
  sections.push(
    media(
      '@media (prefers-contrast: more) and (prefers-color-scheme: dark)',
      block(unpinnedRoot, themeVariables('high-contrast-dark'), '  '),
    ),
  );

  sections.push(
    media('@media (min-resolution: 2dppx)', block(':root', { [`${variablePrefix}-hairline`]: '0.5px' }, '  ')),
  );

  // Density on `<html>` or on any subtree, both ways round, so a comfortable
  // panel can sit inside a compact page. A coarse pointer comes after and
  // wins: a finger needs the larger target whatever density was chosen.
  sections.push(block(`[${densityAttribute}="comfortable"]`, densityVariables(density.comfortable)));
  sections.push(block(`[${densityAttribute}="compact"]`, densityVariables(density.compact)));
  sections.push(
    media(
      '@media (pointer: coarse)',
      block(
        `:root, [${densityAttribute}]`,
        { ...densityVariables(density.coarse), [`${variablePrefix}-input-font-size`]: rem(inputFontSize.coarse) },
        '  ',
      ),
    ),
  );

  // Reduced transparency: from the OS, from the person's choice, and from a
  // browser that cannot blur, in which case a translucent bar would be
  // translucent without being frosted — text over whatever scrolled beneath.
  sections.push(media('@media (prefers-reduced-transparency: reduce)', block(everyThemedElement, solidMaterials, '  ')));
  sections.push(
    block(
      `:root[${transparencyAttribute}="reduced"], [${transparencyAttribute}="reduced"] [${themeAttribute}]`,
      solidMaterials,
    ),
  );
  sections.push(
    media(
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))',
      block(everyThemedElement, solidMaterials, '  '),
    ),
  );

  // Reduced motion is handled at the token layer: every component animates
  // with a duration variable, so collapsing the variables removes motion from
  // components that have not thought about it, not just the ones that have.
  // The person's own choice in the product does the same as the OS setting.
  sections.push(
    [
      '@media (prefers-reduced-motion: reduce) {',
      block(':root', reducedMotionVariables, '  '),
      '  .itsm-motion-safe {',
      '    animation: none !important;',
      '    transition: none !important;',
      '  }',
      '}',
    ].join('\n'),
  );
  sections.push(block(`:root[${motionAttribute}="reduced"]`, reducedMotionVariables));
  sections.push(
    [
      `:root[${motionAttribute}="reduced"] .itsm-motion-safe {`,
      '  animation: none !important;',
      '  transition: none !important;',
      '}',
    ].join('\n'),
  );

  // Forced colours (Windows contrast themes): the browser replaces colours
  // itself, but not a translucent background under a blur or a shadow used as
  // an outline, so those are handed to the system colours explicitly.
  sections.push(
    media(
      '@media (forced-colors: active)',
      block(
        everyThemedElement,
        {
          [`${variablePrefix}-colour-material-chrome`]: 'Canvas',
          [`${variablePrefix}-colour-material-popover`]: 'Canvas',
          [`${variablePrefix}-material-chrome-filter`]: 'none',
          [`${variablePrefix}-material-popover-filter`]: 'none',
          [`${variablePrefix}-scrim-filter`]: 'none',
          [`${variablePrefix}-colour-accent`]: 'Highlight',
          [`${variablePrefix}-colour-border-focus`]: 'Highlight',
          [`${variablePrefix}-colour-focusGap`]: 'Canvas',
        },
        '  ',
      ),
    ),
  );

  for (const [token, min] of Object.entries(breakpoint)) {
    sections.push(`/* breakpoint ${token}: min-width ${rem(min)} */`);
  }

  return `${sections.join('\n\n')}\n`;
}
