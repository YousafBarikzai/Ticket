/**
 * Design tokens — the single source of truth for every surface (ADR-0005).
 *
 * Everything the product's visual language is made of is declared here, once,
 * as plain TypeScript data. `css.ts` renders these values as CSS custom
 * properties for the web apps and `native.ts` renders the same values as a
 * React Native theme object, so the two targets cannot drift: there is no
 * second copy to forget to update.
 *
 * Dimensions are stored as numbers in CSS pixels rather than as strings,
 * because React Native has no notion of `rem` and CSS wants `rem` for zoom
 * support. Keeping the raw number here lets each renderer express it in the
 * unit its platform understands.
 *
 * The values are the redesign's (spec §1): Apple's system palette, audited in
 * four themes, with the geometry, type ramp and motion that go with it.
 */

/**
 * The four audited themes.
 *
 * `apple` is the default and answers at `:root`; the labels a person sees are
 * *Light* and *Dark*, with *Increase contrast* as a separate switch that picks
 * one of the two high-contrast themes. The keys keep the names they shipped
 * with, because they are stored in people's browsers and pinned by tests; a
 * rename would buy nothing but churn.
 */
export type ThemeName = 'apple' | 'apple-dark' | 'high-contrast' | 'high-contrast-dark';

export const themeNames: readonly ThemeName[] = ['apple', 'apple-dark', 'high-contrast', 'high-contrast-dark'];

/**
 * Retired theme names that markup and storage may still carry.
 *
 * `light` and `dark` were palettes of their own before the Apple ones replaced
 * them. A page, a stored preference or an admin preview that still says
 * `data-itsm-theme="light"` gets the theme that replaced it rather than no
 * theme at all. They are selectors only: nothing audits them separately,
 * because there is nothing separate to audit.
 */
export const themeAliases = {
  light: 'apple',
  dark: 'apple-dark',
} as const satisfies Record<string, ThemeName>;
export type ThemeAlias = keyof typeof themeAliases;

/* -------------------------------------------------------------------------
 * Spacing
 * ---------------------------------------------------------------------- */

/**
 * A 4px rhythm. Named rather than numbered so that a change of density can
 * rescale the whole system by editing this one map. `ml` and `4xl` fill the
 * two gaps the redesign's layouts kept reaching across (20 and 80).
 */
export const spacing = {
  none: 0,
  '3xs': 2,
  '2xs': 4,
  xs: 8,
  sm: 12,
  md: 16,
  ml: 20,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
  '4xl': 80,
} as const;
export type SpacingToken = keyof typeof spacing;

/* -------------------------------------------------------------------------
 * Radius, borders and control sizing
 * ---------------------------------------------------------------------- */

/**
 * Corner radii, by what they are for rather than by size: `lg` is a control,
 * `2xl` a card, `3xl` a dialog. Nested corners stay concentric — a child's
 * radius is its parent's less the padding between them, never below 4.
 */
export const radius = {
  none: 0,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  '2xl': 18,
  '3xl': 24,
  pill: 999,
} as const;
export type RadiusToken = keyof typeof radius;

/**
 * How far an interactive surface rises when it is hovered or focused.
 *
 * A token rather than a number in a rule because the same small movement is
 * asked for on several different things, and several hand-written
 * `translateY` values are several chances to drift apart. The token layer
 * sets both to zero under reduced motion, so a component that lifts through
 * these stops lifting without a rule of its own.
 *
 * `sm` is for something in a list, where a larger movement would push its
 * neighbours around; `md` is for a tile with space around it.
 */
export const lift = {
  sm: 2,
  md: 4,
} as const;
export type LiftToken = keyof typeof lift;

/** The scale a filled or tinted button shrinks to while pressed; 1 (none) under reduced motion. */
export const pressScale = 0.98;

export const borderWidth = {
  hair: 1,
  thick: 2,
} as const;
export type BorderWidthToken = keyof typeof borderWidth;

/**
 * Control heights at the default, comfortable density.
 *
 * WCAG 2.2 SC 2.5.8 asks for 24×24 CSS pixels; the densest control here is
 * 24 (compact `sm`) and nothing goes below it. A coarse pointer raises the
 * two larger sizes to 40 and 48, which is where a thumb stops missing.
 */
export const controlHeight = {
  sm: 28,
  md: 36,
  lg: 44,
} as const;
export type ControlSizeToken = keyof typeof controlHeight;

/**
 * Density: how tightly controls, table rows and navigation items are packed.
 *
 * Set by `data-itsm-density` on `<html>` (the person's preference) or on any
 * subtree (a table that offers its own toggle). Every app defaults to
 * comfortable; compact is a choice. A coarse pointer overrides both for the
 * sizes a finger has to hit.
 */
export const density = {
  comfortable: { controlHeight, rowHeight: 44, navItemHeight: 32 },
  compact: { controlHeight: { sm: 24, md: 32, lg: 40 }, rowHeight: 36, navItemHeight: 28 },
  coarse: { controlHeight: { md: 40, lg: 48 }, rowHeight: 48, navItemHeight: 44 },
} as const;
export type DensityName = 'comfortable' | 'compact';

/**
 * The focus ring. Two-tone: an accent outline `offset` away from the element
 * with the gap between them filled by `focusGap`, so the ring reaches 3:1
 * against whatever is behind it — a white card, a black canvas or glass. The
 * high-contrast themes widen the outline to `highContrastWidth`.
 */
export const focusRing = {
  width: 2,
  offset: 2,
  highContrastWidth: 3,
} as const;

/* -------------------------------------------------------------------------
 * Layout
 * ---------------------------------------------------------------------- */

/**
 * The frame's fixed dimensions, in px. The shell reads these rather than
 * writing its own, so a sidebar and the content that makes room for it agree
 * on how wide the sidebar is.
 */
export const layout = {
  topbarHeight: 52,
  sidebarWidth: 248,
  sidebarRail: 64,
  inspectorWidth: 320,
  /** The workbench list pane's starting width; the person can drag it between 300 and 520. */
  listpaneWidth: 360,
  /** Before the bottom safe-area inset is added. */
  tabbarHeight: 56,
  panelInset: 8,
  rowHeight2line: 60,
} as const;

/** Maximum content widths, by how much a page has to say. */
export const contentWidth = {
  narrow: 720,
  medium: 960,
  default: 1200,
  wide: 1440,
} as const;
export type ContentWidthToken = keyof typeof contentWidth;

/** Side sheets, by how much they hold. */
export const sheetWidth = {
  sm: 400,
  md: 560,
  lg: 760,
} as const;
export type SheetWidthToken = keyof typeof sheetWidth;

/** The page's side gutter: 16px on a phone, growing with the viewport to 32px. */
export const pageGutter = { min: 16, fluidVw: 3, max: 32 } as const;

/* -------------------------------------------------------------------------
 * Typography
 * ---------------------------------------------------------------------- */

/**
 * Font stacks as arrays: CSS joins them, React Native takes the first entry.
 *
 * `-apple-system` leads because the theme's typography is the platform's own:
 * on a Mac or an iPhone it resolves to San Francisco, with the optical sizing
 * that comes with it, and nothing is downloaded. Everywhere else the next real
 * family is Inter Variable, self-hosted from `packages/ui/fonts` through
 * `next/font/local` — the nearest open match to SF, so the product looks the
 * same on a Windows laptop as it does on a Mac.
 *
 * The two Inter entries are custom properties that `next/font` defines on
 * `<html>`, each with a plain `"Inter"` fallback. Without the fallback a page
 * rendered outside that `<html>` would make the whole declaration invalid at
 * computed-value time and drop to the browser's serif. The latin-ext face is
 * listed first; its `unicode-range` means a latin glyph skips it and costs no
 * download.
 *
 * Entries are unquoted here; `css.ts` quotes any family name with a space in
 * it and leaves the `var()` entries alone.
 */
export const fontFamily = {
  sans: [
    '-apple-system',
    'BlinkMacSystemFont',
    'var(--font-inter-ext, "Inter")',
    'var(--font-inter, "Inter")',
    'Segoe UI Variable Text',
    'Segoe UI',
    'Roboto',
    'Helvetica Neue',
    'Arial',
    'sans-serif',
  ],
  mono: ['ui-monospace', 'SF Mono', 'SFMono-Regular', 'Cascadia Mono', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
} as const;
export type FontFamilyToken = keyof typeof fontFamily;

/** Raw sizes. `md` is 15px and pinned: it is the body size every app's layout was drawn against. */
export const fontSize = {
  '2xs': 11,
  xs: 12,
  sm: 13,
  base: 14,
  md: 15,
  lg: 17,
  xl: 20,
  '2xl': 22,
  '3xl': 28,
  '4xl': 34,
  '5xl': 40,
  '6xl': 56,
} as const;
export type FontSizeToken = keyof typeof fontSize;

export const lineHeight = {
  tight: 1.2,
  snug: 1.35,
  normal: 1.5,
  relaxed: 1.65,
} as const;
export type LineHeightToken = keyof typeof lineHeight;

/** No weight below 400: thin strokes are the first thing ClearType loses. */
export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;
export type FontWeightToken = keyof typeof fontWeight;

/** In em, so it scales with the font size on both platforms. */
export const letterSpacing = {
  tight: -0.015,
  normal: 0,
  wide: 0.04,
} as const;
export type LetterSpacingToken = keyof typeof letterSpacing;

export interface TextStyle {
  readonly family: FontFamilyToken;
  readonly size: FontSizeToken;
  readonly weight: FontWeightToken;
  readonly lineHeight: LineHeightToken;
  readonly letterSpacing: LetterSpacingToken;
  /** True where the style is 18.66px+ bold or 24px+, i.e. "large text" for WCAG 1.4.3. */
  readonly large: boolean;
}

/**
 * Composite styles, as references to the raw tokens. `native.ts` builds the
 * React Native text styles from these; the web uses `textRamp` below. Kept as
 * they were so that the native projection does not change shape.
 */
export const textStyle = {
  display: { family: 'sans', size: '4xl', weight: 'bold', lineHeight: 'tight', letterSpacing: 'tight', large: true },
  h1: { family: 'sans', size: '3xl', weight: 'semibold', lineHeight: 'tight', letterSpacing: 'tight', large: true },
  h2: { family: 'sans', size: '2xl', weight: 'semibold', lineHeight: 'snug', letterSpacing: 'tight', large: true },
  h3: { family: 'sans', size: 'xl', weight: 'semibold', lineHeight: 'snug', letterSpacing: 'normal', large: true },
  h4: { family: 'sans', size: 'lg', weight: 'semibold', lineHeight: 'snug', letterSpacing: 'normal', large: false },
  bodyLarge: { family: 'sans', size: 'lg', weight: 'regular', lineHeight: 'relaxed', letterSpacing: 'normal', large: false },
  body: { family: 'sans', size: 'md', weight: 'regular', lineHeight: 'normal', letterSpacing: 'normal', large: false },
  bodyStrong: { family: 'sans', size: 'md', weight: 'semibold', lineHeight: 'normal', letterSpacing: 'normal', large: false },
  label: { family: 'sans', size: 'sm', weight: 'medium', lineHeight: 'snug', letterSpacing: 'normal', large: false },
  caption: { family: 'sans', size: 'xs', weight: 'regular', lineHeight: 'snug', letterSpacing: 'normal', large: false },
  overline: { family: 'sans', size: '2xs', weight: 'semibold', lineHeight: 'snug', letterSpacing: 'wide', large: false },
  code: { family: 'mono', size: 'sm', weight: 'regular', lineHeight: 'normal', letterSpacing: 'normal', large: false },
} as const satisfies Record<string, TextStyle>;
export type TextStyleToken = keyof typeof textStyle;

export interface RampStyle {
  /** px */
  readonly size: number;
  /** px, absolute rather than a ratio: the ramp's line heights sit on the 4pt grid only as absolute values. */
  readonly line: number;
  readonly weight: 400 | 500 | 600 | 700;
  /** em */
  readonly tracking: number;
}

/**
 * The type ramp, Apple's text styles with Inter's tracking (which agrees with
 * SF's at these sizes). Emitted as `--itsm-text-<style>-{size,line,weight,
 * tracking}` and as `.itsm-text-<style>` utilities.
 *
 * Headings and sections are sentence case in `subheadline` and never an
 * uppercase overline. `caption` is for chart axes only; badges and status
 * pills use `footnote` (at 500).
 */
export const textRamp = {
  largeTitle: { size: 34, line: 40, weight: 700, tracking: -0.022 },
  title1: { size: 28, line: 34, weight: 700, tracking: -0.021 },
  title2: { size: 22, line: 28, weight: 600, tracking: -0.019 },
  title3: { size: 20, line: 25, weight: 600, tracking: -0.017 },
  headline: { size: 17, line: 22, weight: 600, tracking: -0.013 },
  body: { size: 15, line: 22, weight: 400, tracking: -0.009 },
  callout: { size: 14, line: 20, weight: 400, tracking: -0.006 },
  subheadline: { size: 13, line: 18, weight: 500, tracking: -0.003 },
  footnote: { size: 12, line: 16, weight: 400, tracking: 0 },
  caption: { size: 11, line: 14, weight: 500, tracking: 0.005 },
  statValue: { size: 32, line: 36, weight: 600, tracking: -0.022 },
  hero: { size: 56, line: 60, weight: 600, tracking: -0.024 },
} as const satisfies Record<string, RampStyle>;
export type TextRampToken = keyof typeof textRamp;

/* -------------------------------------------------------------------------
 * Icons
 * ---------------------------------------------------------------------- */

/** Icon sizes, px. `md` (18) is the default; the stroke stays 1.75 at every size. */
export const iconSize = {
  xs: 14,
  sm: 16,
  md: 18,
  lg: 20,
  xl: 24,
  '2xl': 32,
} as const;
export type IconSizeToken = keyof typeof iconSize;

/* -------------------------------------------------------------------------
 * Elevation
 * ---------------------------------------------------------------------- */

export interface ShadowLayer {
  readonly offsetY: number;
  readonly blur: number;
  readonly spread: number;
  /** Alpha applied to the theme's shadow colour, 0–1, before the theme's strength. */
  readonly opacity: number;
}

/**
 * Shadows are stored as geometry plus an alpha, not as finished `box-shadow`
 * strings, because React Native takes the same numbers through different props
 * and each theme applies its own colour and strength to the same geometry.
 *
 * `sm` and the deepest layer of `lg` are pinned by the pipeline tests; the
 * rest are the redesign's. `xs` — a ring and a whisper — is what a resting
 * card has instead of a border.
 */
export const elevation = {
  none: [],
  xs: [
    { offsetY: 0, blur: 0, spread: 1, opacity: 0.05 },
    { offsetY: 1, blur: 2, spread: 0, opacity: 0.04 },
  ],
  sm: [{ offsetY: 1, blur: 2, spread: 0, opacity: 0.08 }],
  md: [
    { offsetY: 4, blur: 12, spread: -2, opacity: 0.08 },
    { offsetY: 1, blur: 3, spread: 0, opacity: 0.06 },
  ],
  lg: [
    { offsetY: 8, blur: 20, spread: -4, opacity: 0.14 },
    { offsetY: 2, blur: 6, spread: -2, opacity: 0.08 },
  ],
  xl: [
    { offsetY: 24, blur: 48, spread: -12, opacity: 0.2 },
    { offsetY: 8, blur: 16, spread: -8, opacity: 0.1 },
  ],
} as const satisfies Record<string, readonly ShadowLayer[]>;
export type ElevationToken = keyof typeof elevation;

/** A shadow layer's alpha never goes above this, however strong the theme makes it. */
export const shadowAlphaCap = 0.6;

/* -------------------------------------------------------------------------
 * Materials
 * ---------------------------------------------------------------------- */

/**
 * Backdrop blur, px. Glass is scarce by rule: the chrome material on the
 * portal's bars and the compact top bar, the popover material on text-bearing
 * popovers, and the scrim. Everything else is opaque.
 */
export const materialBlur = {
  chrome: 20,
  popover: 24,
  scrim: 2,
} as const;
export type MaterialName = 'chrome' | 'popover';

/* -------------------------------------------------------------------------
 * Motion
 * ---------------------------------------------------------------------- */

/**
 * Milliseconds. Motion is feedback, so it is short: 150–250 for almost
 * everything, `deliberate` only for a full-height sheet on a phone.
 */
export const duration = {
  instant: 0,
  fast: 150,
  normal: 200,
  slow: 250,
  deliberate: 300,
} as const;
export type DurationToken = keyof typeof duration;

export type CubicBezier = readonly [number, number, number, number];

/**
 * `standard` for colour and opacity, `entrance` for things appearing, `exit`
 * for things leaving (always at `fast`), `emphasised` for sheets. The spring
 * lives in `spring.ts` because it is computed, not written down.
 */
export const easing = {
  standard: [0.25, 0.1, 0.25, 1],
  entrance: [0.16, 1, 0.3, 1],
  exit: [0.4, 0, 1, 1],
  emphasised: [0.32, 0.72, 0, 1],
} as const satisfies Record<string, CubicBezier>;
export type EasingToken = keyof typeof easing;

/* -------------------------------------------------------------------------
 * Layering and breakpoints
 * ---------------------------------------------------------------------- */

/**
 * Ordered so that a menu or a listbox opened inside a dialog renders above the
 * dialog, and a toast above both. `header` is the sticky frame bar, which
 * scrolled content passes under and a scrim covers.
 */
export const zIndex = {
  base: 0,
  sticky: 100,
  header: 150,
  overlay: 300,
  dialog: 400,
  dropdown: 500,
  toast: 600,
  tooltip: 700,
} as const;
export type ZIndexToken = keyof typeof zIndex;

/**
 * Minimum widths, in px; emitted as `min-width` queries in rem. 320 is the
 * floor implied by the 400px/200% zoom rule. `2xl` is where the workbench
 * gains its inspector column.
 */
export const breakpoint = {
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1440,
} as const;
export type BreakpointToken = keyof typeof breakpoint;

/* -------------------------------------------------------------------------
 * Colour
 * ---------------------------------------------------------------------- */

export type SurfaceToken =
  | 'canvas'
  | 'raised'
  | 'sunken'
  | 'overlay'
  | 'hover'
  | 'accentHover'
  | 'selected'
  | 'selection'
  | 'bubble'
  | 'inverse';
export type TextToken = 'primary' | 'secondary' | 'muted' | 'disabled' | 'link' | 'inverse';
export type BorderToken = 'subtle' | 'interactive' | 'strong' | 'focus';
export type IntentName = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';
export type FillToken = 'hover' | 'pressed' | 'secondary' | 'track';

export interface IntentColours {
  /** Filled backgrounds: primary buttons, solid badges. */
  readonly solid: string;
  readonly solidHover: string;
  /** The only colour allowed on `solid`. */
  readonly solidText: string;
  /** Tinted backgrounds: soft badges, callouts, inline validation summaries. */
  readonly subtle: string;
  /** The colour for text on `subtle`, and for this intent's text on any surface. */
  readonly subtleText: string;
  /** Outline of a tinted component; must read against the canvas (SC 1.4.11). */
  readonly border: string;
}

export interface Material {
  /** The tint behind the blur, as `rgba()`; an opaque hex where the theme has no glass. */
  readonly background: string;
  /** Backdrop saturation in percent, or `null` where the theme has no glass and so no backdrop filter. */
  readonly saturate: number | null;
}

export interface ChartColours {
  /** Categorical series, in order. All-pairs forms (scatter, small multiples) use the first three only. */
  readonly categorical: readonly string[];
  /** A blue ramp, 100 → 800, for ordered and sequential data. */
  readonly sequential: readonly string[];
  readonly grid: string;
  readonly axis: string;
}

export interface ColourTheme {
  /** Light or dark: drives `color-scheme` on the web and the status bar natively. */
  readonly scheme: 'light' | 'dark';
  /**
   * `more` for the two high-contrast themes: text held to AAA, outlines
   * instead of shadows, no glass, a wider focus ring.
   */
  readonly contrast: 'standard' | 'more';
  readonly surface: Readonly<Record<SurfaceToken, string>>;
  readonly text: Readonly<Record<TextToken, string>>;
  readonly border: Readonly<Record<BorderToken, string>>;
  readonly intent: Readonly<Record<IntentName, IntentColours>>;
  /**
   * The interactive blue: focus rings, selection bars, switches that are on,
   * checkbox fills, progress, interactive icons. Held to 3:1, not 4.5:1 — it
   * marks things, it does not spell them. Text-coloured links use `text.link`.
   */
  readonly accent: string;
  /**
   * State fills that sit over any surface. Translucent in the standard
   * themes, so they are never under audited text; solid in high contrast.
   */
  readonly fill: Readonly<Record<FillToken, string>>;
  /** The inset edge of a switch or progress track, which is what gives it its 3:1 boundary. */
  readonly trackBorder: { readonly colour: string; readonly width: number };
  /** Apple's lit top edge on raised surfaces in the dark theme; `null` where the theme has none. */
  readonly edgeHighlight: string | null;
  readonly material: Readonly<Record<MaterialName, Material>>;
  readonly chart: ChartColours;
  /** Base colour of every shadow layer in this theme. */
  readonly shadow: string;
  /**
   * Multiplies every shadow layer's alpha. A dark canvas swallows a light
   * shadow, so the dark theme's are stronger; the high-contrast themes draw an
   * outline in `border.strong` instead, so theirs are zero.
   */
  readonly shadowStrength: number;
  /** Backdrop behind modal surfaces. */
  readonly scrim: string;
}

const chartLight = {
  categorical: ['#007aff', '#cc780c', '#12a0b7', '#ae8b0c', '#b154e0', '#fc3457', '#5856d6', '#0aac43'],
  sequential: ['#e0ecff', '#bbd6fe', '#90bdfe', '#61a2fe', '#2081fe', '#0866d5', '#0351ac', '#003c84'],
} as const;

const chartDark = {
  categorical: ['#0a84ff', '#ce7f00', '#00a6ba', '#ae9210', '#c25df5', '#ff4063', '#7d83ff', '#08b242'],
  sequential: chartLight.sequential,
} as const;

/**
 * Light: white surfaces on a light grey canvas, near-black text, one blue.
 *
 * Every value was audited in `contrast.ts` rather than chosen by eye (spec
 * §1.2 records the tightest margins). Three choices look like mistakes next to
 * Apple's own palette and are not:
 *
 *   The filled-button blue, `#0071e3`, is a *fill*: it carries white text at
 *   4.69:1. It is too light to be read as text on the canvas, so links use the
 *   darker `text.link`, and focus rings and selection bars use `accent` —
 *   Apple's `#007aff`, which only has to reach 3:1.
 *
 *   Info is indigo, never blue: blue means "you can act on this", and a status
 *   that looked clickable would be a lie.
 *
 *   `border.interactive` is darker than a hairline, because the outline of a
 *   control has to reach 3:1 to be seen at all by somebody who cannot rely on
 *   the subtle one.
 */
const apple: ColourTheme = {
  scheme: 'light',
  contrast: 'standard',
  surface: {
    canvas: '#f5f5f7',
    raised: '#ffffff',
    sunken: '#f2f2f7',
    overlay: '#ffffff',
    hover: '#f1f4f9',
    accentHover: '#eef5ff',
    selected: '#e5f0ff',
    selection: '#b3d7ff',
    bubble: '#efeff0',
    inverse: '#1d1d1f',
  },
  text: {
    primary: '#1d1d1f',
    secondary: '#424245',
    muted: '#68686d',
    disabled: '#8a8a8e',
    link: '#0066cc',
    inverse: '#ffffff',
  },
  border: {
    subtle: '#e5e5ea',
    interactive: '#86868b',
    strong: '#6e6e73',
    focus: '#007aff',
  },
  intent: {
    brand: {
      solid: '#0071e3',
      solidHover: '#0062c4',
      solidText: '#ffffff',
      subtle: '#e5f0ff',
      subtleText: '#0058b0',
      border: '#007aff',
    },
    neutral: {
      solid: '#6e6e73',
      solidHover: '#5b5b60',
      solidText: '#ffffff',
      subtle: '#ebebf0',
      subtleText: '#424245',
      border: '#86868b',
    },
    success: {
      solid: '#1e7f34',
      solidHover: '#196c2c',
      solidText: '#ffffff',
      subtle: '#e3f5e8',
      subtleText: '#1a6e2e',
      border: '#248a3d',
    },
    warning: {
      solid: '#b25000',
      solidHover: '#994400',
      solidText: '#ffffff',
      subtle: '#fff1de',
      subtleText: '#8a4300',
      border: '#c45d00',
    },
    danger: {
      solid: '#d70015',
      solidHover: '#b80012',
      solidText: '#ffffff',
      subtle: '#ffebea',
      subtleText: '#b80012',
      border: '#e0241b',
    },
    info: {
      solid: '#5856d6',
      solidHover: '#4744c0',
      solidText: '#ffffff',
      subtle: '#eeeefc',
      subtleText: '#4543b8',
      border: '#5856d6',
    },
  },
  accent: '#007aff',
  fill: {
    hover: 'rgba(0, 0, 0, 0.04)',
    pressed: 'rgba(0, 0, 0, 0.08)',
    secondary: 'rgba(120, 120, 128, 0.12)',
    track: '#e3e3e8',
  },
  trackBorder: { colour: '#86868b', width: 1 },
  edgeHighlight: null,
  material: {
    chrome: { background: 'rgba(245, 245, 247, 0.92)', saturate: 180 },
    popover: { background: 'rgba(255, 255, 255, 0.96)', saturate: 180 },
  },
  chart: { ...chartLight, grid: '#e5e5ea', axis: '#c7c7cc' },
  shadow: '#1d1d1f',
  shadowStrength: 1,
  scrim: 'rgba(15, 15, 20, 0.32)',
};

/**
 * The same language after dark.
 *
 * Surfaces step up in lightness as they come forward — canvas, raised,
 * overlay — far enough apart (about 1.2:1 each) that a card reads as a card
 * without a border. Filled buttons keep the light theme's blue and white text;
 * warning is the exception, because an amber light enough to read as amber on
 * black cannot also carry white text, so it carries near-black.
 */
const appleDark: ColourTheme = {
  scheme: 'dark',
  contrast: 'standard',
  surface: {
    canvas: '#000000',
    raised: '#1c1c1e',
    sunken: '#121214',
    overlay: '#2c2c2e',
    hover: '#2a2a2e',
    accentHover: '#1d2b3d',
    selected: '#1a3350',
    selection: '#3f638b',
    bubble: '#2c2c2e',
    inverse: '#f5f5f7',
  },
  text: {
    primary: '#f5f5f7',
    secondary: '#d1d1d6',
    muted: '#a1a1a6',
    disabled: '#6c6c70',
    link: '#4da3ff',
    inverse: '#1d1d1f',
  },
  border: {
    subtle: '#38383a',
    interactive: '#818187',
    strong: '#8e8e93',
    focus: '#0a84ff',
  },
  intent: {
    brand: {
      solid: '#0071e3',
      solidHover: '#0068d1',
      solidText: '#ffffff',
      subtle: '#11304f',
      subtleText: '#70b5ff',
      border: '#0a84ff',
    },
    neutral: {
      solid: '#6e6e73',
      solidHover: '#636366',
      solidText: '#ffffff',
      subtle: '#333336',
      subtleText: '#d1d1d6',
      border: '#8e8e93',
    },
    success: {
      solid: '#1a7f37',
      solidHover: '#16702f',
      solidText: '#ffffff',
      subtle: '#10311b',
      subtleText: '#5edb7f',
      border: '#30d158',
    },
    warning: {
      solid: '#ff9f0a',
      solidHover: '#ffb340',
      solidText: '#1d1d1f',
      subtle: '#36260b',
      subtleText: '#ffb340',
      border: '#ff9f0a',
    },
    danger: {
      solid: '#e0262d',
      solidHover: '#c81e25',
      solidText: '#ffffff',
      subtle: '#3d1719',
      subtleText: '#ff7a72',
      border: '#ff453a',
    },
    info: {
      solid: '#5e5ce6',
      solidHover: '#5250d0',
      solidText: '#ffffff',
      subtle: '#23224a',
      subtleText: '#a5a3ff',
      border: '#7d7aff',
    },
  },
  accent: '#0a84ff',
  fill: {
    hover: 'rgba(255, 255, 255, 0.06)',
    pressed: 'rgba(255, 255, 255, 0.1)',
    secondary: 'rgba(120, 120, 128, 0.24)',
    track: '#39393d',
  },
  trackBorder: { colour: '#818187', width: 1 },
  edgeHighlight: 'rgba(255, 255, 255, 0.06)',
  material: {
    chrome: { background: 'rgba(28, 28, 30, 0.92)', saturate: 150 },
    popover: { background: 'rgba(44, 44, 46, 0.96)', saturate: 150 },
  },
  chart: { ...chartDark, grid: '#38383a', axis: '#545458' },
  shadow: '#000000',
  shadowStrength: 2.2,
  scrim: 'rgba(0, 0, 0, 0.56)',
};

/**
 * High contrast. Not "the light theme with darker greys": it removes tint from
 * surfaces, makes every border a real border, draws outlines where the other
 * themes draw shadows, turns glass solid, and holds text to AAA (7:1) so that
 * people who need it have headroom over the AA floor.
 */
const highContrast: ColourTheme = {
  scheme: 'light',
  contrast: 'more',
  surface: {
    canvas: '#ffffff',
    raised: '#ffffff',
    sunken: '#f2f2f2',
    overlay: '#ffffff',
    hover: '#e6e6e6',
    accentHover: '#e6eeff',
    selected: '#dce6ff',
    selection: '#b3d7ff',
    bubble: '#e6e6e6',
    inverse: '#000000',
  },
  text: {
    primary: '#000000',
    secondary: '#1a1a1a',
    muted: '#333333',
    disabled: '#595959',
    link: '#0033b3',
    inverse: '#ffffff',
  },
  border: {
    subtle: '#595959',
    interactive: '#000000',
    strong: '#000000',
    focus: '#0040dd',
  },
  intent: {
    brand: {
      solid: '#0040dd',
      solidHover: '#0033b3',
      solidText: '#ffffff',
      subtle: '#dce6ff',
      subtleText: '#002e9e',
      border: '#0040dd',
    },
    neutral: {
      solid: '#333333',
      solidHover: '#1a1a1a',
      solidText: '#ffffff',
      subtle: '#e6e6e6',
      subtleText: '#1a1a1a',
      border: '#000000',
    },
    success: {
      solid: '#0b5e1e',
      solidHover: '#084a17',
      solidText: '#ffffff',
      subtle: '#e0f2e4',
      subtleText: '#0a4f1a',
      border: '#0b5e1e',
    },
    warning: {
      solid: '#7a3a00',
      solidHover: '#632f00',
      solidText: '#ffffff',
      subtle: '#fff0db',
      subtleText: '#6b3300',
      border: '#7a3a00',
    },
    danger: {
      solid: '#a0000e',
      solidHover: '#85000b',
      solidText: '#ffffff',
      subtle: '#ffe5e3',
      subtleText: '#8c000c',
      border: '#a0000e',
    },
    info: {
      solid: '#3634a3',
      solidHover: '#2b2a85',
      solidText: '#ffffff',
      subtle: '#e9e9fb',
      subtleText: '#2e2c8c',
      border: '#3634a3',
    },
  },
  accent: '#0040dd',
  fill: {
    hover: '#e6e6e6',
    pressed: '#d1d1d1',
    secondary: '#e6e6e6',
    track: '#ffffff',
  },
  trackBorder: { colour: '#000000', width: 2 },
  edgeHighlight: null,
  material: {
    chrome: { background: '#ffffff', saturate: null },
    popover: { background: '#ffffff', saturate: null },
  },
  chart: { ...chartLight, grid: '#e5e5ea', axis: '#000000' },
  shadow: '#000000',
  shadowStrength: 0,
  scrim: 'rgba(0, 0, 0, 0.6)',
};

/**
 * High contrast after dark: the same rules as `highContrast` — AAA text, real
 * borders, outlines for shadows, no glass — on black. Filled intents are light
 * and carry black text, since white text on a hue bright enough to stand out
 * against black cannot reach 7:1.
 */
const highContrastDark: ColourTheme = {
  scheme: 'dark',
  contrast: 'more',
  surface: {
    canvas: '#000000',
    raised: '#000000',
    sunken: '#0d0d0d',
    overlay: '#121212',
    hover: '#1f1f1f',
    accentHover: '#0a1f40',
    selected: '#061a3a',
    selection: '#2a4e80',
    bubble: '#1f1f1f',
    inverse: '#ffffff',
  },
  text: {
    primary: '#ffffff',
    secondary: '#f2f2f7',
    muted: '#d1d1d6',
    disabled: '#9a9a9f',
    link: '#6cb6ff',
    inverse: '#000000',
  },
  border: {
    subtle: '#a1a1a6',
    interactive: '#ffffff',
    strong: '#ffffff',
    focus: '#6cb6ff',
  },
  intent: {
    brand: {
      solid: '#6cb6ff',
      solidHover: '#8cc6ff',
      solidText: '#000000',
      subtle: '#061c3f',
      subtleText: '#a8d3ff',
      border: '#6cb6ff',
    },
    neutral: {
      solid: '#d1d1d6',
      solidHover: '#e5e5ea',
      solidText: '#000000',
      subtle: '#1f1f1f',
      subtleText: '#f2f2f7',
      border: '#d1d1d6',
    },
    success: {
      solid: '#5ee07f',
      solidHover: '#7ae896',
      solidText: '#000000',
      subtle: '#05220e',
      subtleText: '#8ceba3',
      border: '#5ee07f',
    },
    warning: {
      solid: '#ffc066',
      solidHover: '#ffcf8a',
      solidText: '#000000',
      subtle: '#332205',
      subtleText: '#ffd699',
      border: '#ffc066',
    },
    danger: {
      solid: '#ff8a82',
      solidHover: '#ffa39d',
      solidText: '#000000',
      subtle: '#3a0f12',
      subtleText: '#ffb3ad',
      border: '#ff8a82',
    },
    info: {
      solid: '#b3b1ff',
      solidHover: '#c7c5ff',
      solidText: '#000000',
      subtle: '#1f1e45',
      subtleText: '#cfcdff',
      border: '#b3b1ff',
    },
  },
  accent: '#6cb6ff',
  fill: {
    hover: '#1f1f1f',
    pressed: '#2e2e2e',
    secondary: '#1f1f1f',
    track: '#000000',
  },
  trackBorder: { colour: '#ffffff', width: 2 },
  edgeHighlight: null,
  material: {
    chrome: { background: '#000000', saturate: null },
    popover: { background: '#121212', saturate: null },
  },
  chart: { ...chartDark, grid: '#38383a', axis: '#ffffff' },
  shadow: '#000000',
  shadowStrength: 0,
  scrim: 'rgba(0, 0, 0, 0.8)',
};

export const colour: Readonly<Record<ThemeName, ColourTheme>> = {
  apple,
  'apple-dark': appleDark,
  'high-contrast': highContrast,
  'high-contrast-dark': highContrastDark,
};

/** Everything a renderer needs, in one object, so `css.ts` and `native.ts` stay honest. */
export const tokens = {
  spacing,
  radius,
  lift,
  pressScale,
  borderWidth,
  controlHeight,
  density,
  focusRing,
  layout,
  contentWidth,
  sheetWidth,
  pageGutter,
  fontFamily,
  fontSize,
  lineHeight,
  fontWeight,
  letterSpacing,
  textStyle,
  textRamp,
  iconSize,
  elevation,
  materialBlur,
  duration,
  easing,
  zIndex,
  breakpoint,
  colour,
} as const;

export type Tokens = typeof tokens;
