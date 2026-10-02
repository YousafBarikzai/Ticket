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
 * The values are v3's (SPEC-v3 §2): the PMO benchmark's slate neutrals, navy
 * hero surfaces and 8 / 12 / 16 geometry on Apple's audited theme structure,
 * with Plus Jakarta Sans for display type. Every colour is audited in four
 * themes by `contrast.ts`.
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
 *
 * v3 is the PMO's 8 / 12 / 16 (controls / cards / dialogs and heroes), not
 * v2's 10 / 18 / 24: depth is now drawn by a 1px border, and an 18px corner on
 * a bordered KPI tile reads as a soft consumer chip where 12 reads precise.
 * The names keep their roles, so a component that asked for "a card corner"
 * changes with no edit. `item` is the 44px control and the list item that
 * sits beside it (kanban card, attention row, area card); `4xl` is the
 * landing page's feature panels.
 */
export const radius = {
  none: 0,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 8,
  item: 10,
  xl: 12,
  '2xl': 12,
  '3xl': 16,
  '4xl': 20,
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
 *
 * v3 takes the PMO's 40px table rows and 36px nav items for a mouse, and
 * keeps v2's coarse-pointer sizes, which is where touch targets come from.
 * `rowHeight2line` is the Service Desk's two-line list row (title over chips).
 */
export const density = {
  comfortable: { controlHeight, rowHeight: 40, rowHeight2line: 64, navItemHeight: 36 },
  compact: { controlHeight: { sm: 24, md: 32, lg: 40 }, rowHeight: 32, rowHeight2line: 52, navItemHeight: 32 },
  coarse: { controlHeight: { md: 40, lg: 48 }, rowHeight: 48, rowHeight2line: 72, navItemHeight: 44 },
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
 *
 * v3 is the PMO frame: a 56px top bar at every width, a 256px sidebar with a
 * 72px rail, and a 60px phone tab bar.
 */
export const layout = {
  topbarHeight: 56,
  sidebarWidth: 256,
  sidebarRail: 72,
  inspectorWidth: 320,
  /** The workbench list pane's starting width; the person can drag it between 300 and 520. */
  listpaneWidth: 360,
  /** Before the bottom safe-area inset is added. */
  tabbarHeight: 60,
  panelInset: 8,
  /** The comfortable two-line list row; `density` carries the compact and coarse sizes. */
  rowHeight2line: 64,
  /**
   * The system (demo) bar above the frame. One 40px line on a desktop; two
   * lines on a phone, where the bar sits in the flow and scrolls away. The
   * frame's offset (`--itsm-system-bar-h`) is not this: it is `0px` until a
   * `SystemBar` is actually on the page, which only `SystemBar.styles.ts`
   * knows (SPEC-v3 §2.15), so a page without the bar reserves nothing.
   */
  systemBarHeight: { desktop: 40, phone: 64 },
  /** A card's inner padding. The PMO's 18, rounded onto the 4pt grid; cards narrower than 35rem drop to 16 themselves. */
  cardPadding: 20,
} as const;

/**
 * Maximum content widths, by how much a page has to say. `max` is where a
 * dashboard stops growing and centres (the PMO's 1600px view).
 */
export const contentWidth = {
  narrow: 720,
  medium: 960,
  default: 1200,
  wide: 1440,
  max: 1600,
} as const;
export type ContentWidthToken = keyof typeof contentWidth;

/** Side sheets, by how much they hold. */
export const sheetWidth = {
  sm: 400,
  md: 560,
  lg: 760,
} as const;
export type SheetWidthToken = keyof typeof sheetWidth;

/**
 * The page's side gutter: 16px on a phone, growing with the viewport to 24px
 * at 800px and beyond (`clamp(16px, 2vw + 8px, 24px)`, the PMO's). v2 grew to
 * 32px, which on a dense dashboard was space taken from the cards.
 */
export const pageGutter = { min: 16, fluidVw: 2, fluidPx: 8, max: 24 } as const;

/* -------------------------------------------------------------------------
 * Typography
 * ---------------------------------------------------------------------- */

/**
 * Font stacks as arrays: CSS joins them, React Native takes the first entry
 * that is a real family name.
 *
 * Inter is the UI face on every platform (D4), so it leads the `sans` stack.
 * v2 put `-apple-system` first, so a Mac rendered San Francisco while it
 * downloaded Inter anyway, and showed a different product from the
 * screenshots, which are taken on Linux. The system faces stay behind Inter
 * for the moment before it loads and for a page rendered outside the apps.
 *
 * `display` is Plus Jakarta Sans for titles, KPI numerals and headlines, and
 * falls back to Inter rather than to a system face, because the two share an
 * x-height and a swap between them barely moves a line.
 *
 * The `var()` entries are custom properties that `next/font` defines on
 * `<html>`, each with a plain family-name fallback. Without the fallback a
 * page rendered outside that `<html>` would make the whole declaration
 * invalid at computed-value time and drop to the browser's serif. Each
 * latin-ext face is listed before its latin face; its `unicode-range` means a
 * latin glyph skips it and costs no download.
 *
 * Entries are unquoted here; `css.ts` quotes any family name with a space in
 * it and leaves the `var()` entries alone.
 */
export const fontFamily = {
  sans: [
    'var(--font-inter-ext, "Inter")',
    'var(--font-inter, "Inter")',
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI Variable Text',
    'Segoe UI',
    'Roboto',
    'Helvetica Neue',
    'Arial',
    'sans-serif',
  ],
  display: [
    'var(--font-jakarta-ext, "Plus Jakarta Sans")',
    'var(--font-jakarta, "Plus Jakarta Sans")',
    'var(--font-inter, "Inter")',
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI',
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
  /** Which stack the style is set in. `display` (Jakarta) only at 16px and above. */
  readonly family: FontFamilyToken;
  /** px */
  readonly size: number;
  /** px, absolute rather than a ratio: the ramp's line heights sit on the 4pt grid only as absolute values. */
  readonly line: number;
  readonly weight: 400 | 500 | 600 | 700 | 800;
  /** em */
  readonly tracking: number;
  /**
   * em, added to the face's own space. Jakarta's space is 0.170em against
   * Inter's 0.281em, so with negative title tracking its words run together
   * ("Progressover time"). Every display style carries 0.06em or more; no
   * sans style carries any (`type.test.ts`).
   */
  readonly wordSpacing: number;
  /** Set only on `kicker`: the one place uppercase is allowed, and only through CSS, so it is read as words. */
  readonly transform?: 'uppercase';
  /** `font-variant-numeric`, where the style is for figures that must line up. */
  readonly numeric?: string;
  /** ch: the longest comfortable line, for running text. */
  readonly measure?: number;
}

/**
 * The type ramp (SPEC-v3 §2.7). Emitted as `--itsm-text-<style>-{size,line,
 * weight,tracking,family,word-spacing}` and as `.itsm-text-<style>` utilities.
 *
 * The names keep their v2 roles, so the components and app pages that use
 * them change with no edit: `title1` is the top bar's page title, `title2` a
 * section, `title3` a card. The display styles are Plus Jakarta Sans; the
 * reading styles stay Inter, a step smaller than v2's (body 14, the PMO's
 * density). `kicker` is the only uppercase style and is for heroes, banners
 * and the landing page (D6); section and group headings are sentence case.
 * `id` is ticket numbers in rows, cards and tables: mono, slashed zero,
 * tabular, so a column of them lines up and an O never passes for a 0.
 */
export const textRamp = {
  display: { family: 'display', size: 56, line: 60, weight: 800, tracking: -0.035, wordSpacing: 0.06 },
  hero: { family: 'display', size: 40, line: 44, weight: 700, tracking: -0.025, wordSpacing: 0.06 },
  largeTitle: { family: 'display', size: 30, line: 36, weight: 700, tracking: -0.02, wordSpacing: 0.07 },
  verdict: { family: 'display', size: 32, line: 36, weight: 700, tracking: -0.02, wordSpacing: 0.07 },
  title1: { family: 'display', size: 20, line: 28, weight: 700, tracking: -0.015, wordSpacing: 0.1 },
  recordTitle: { family: 'display', size: 22, line: 28, weight: 600, tracking: -0.015, wordSpacing: 0.1 },
  title2: { family: 'display', size: 18, line: 26, weight: 600, tracking: -0.012, wordSpacing: 0.1 },
  title3: { family: 'display', size: 16, line: 24, weight: 600, tracking: -0.01, wordSpacing: 0.1 },
  statValue: { family: 'display', size: 28, line: 32, weight: 600, tracking: -0.02, wordSpacing: 0.07 },
  headline: { family: 'sans', size: 15, line: 22, weight: 600, tracking: -0.006, wordSpacing: 0 },
  body: { family: 'sans', size: 14, line: 22, weight: 400, tracking: 0, wordSpacing: 0 },
  callout: { family: 'sans', size: 13, line: 20, weight: 400, tracking: 0, wordSpacing: 0 },
  subheadline: { family: 'sans', size: 13, line: 18, weight: 500, tracking: 0, wordSpacing: 0 },
  footnote: { family: 'sans', size: 12, line: 16, weight: 400, tracking: 0, wordSpacing: 0 },
  caption: { family: 'sans', size: 11, line: 16, weight: 500, tracking: 0.01, wordSpacing: 0 },
  kicker: { family: 'sans', size: 11, line: 16, weight: 600, tracking: 0.07, wordSpacing: 0, transform: 'uppercase' },
  eyebrow: { family: 'sans', size: 14, line: 20, weight: 600, tracking: 0, wordSpacing: 0 },
  lockup: { family: 'sans', size: 15, line: 20, weight: 700, tracking: -0.01, wordSpacing: 0 },
  id: { family: 'mono', size: 12, line: 16, weight: 500, tracking: 0, wordSpacing: 0, numeric: 'slashed-zero tabular-nums' },
  prose: { family: 'sans', size: 16, line: 26, weight: 400, tracking: 0, wordSpacing: 0, measure: 68 },
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
 * v3 depth is border-first (the PMO's): a resting card, table, KPI tile or
 * board column has a 1px `border.subtle` and `none` here. Shadows are long and
 * soft, with negative spread so they pool under the object rather than
 * outlining it, and appear only on hover (`sm`) and on things that float:
 * popovers and menus (`md`), toasts (`lg`), dialogs and sheets (`xl`). `xs` is
 * the whisper under an input or a secondary button. `hero` is the navy hero
 * card's, which sits on the canvas and needs a deeper pool to lift it.
 * `sm`'s geometry is v2's, pinned by the pipeline tests.
 */
export const elevation = {
  none: [],
  xs: [{ offsetY: 1, blur: 2, spread: 0, opacity: 0.05 }],
  sm: [{ offsetY: 1, blur: 2, spread: 0, opacity: 0.08 }],
  md: [
    { offsetY: 8, blur: 24, spread: -12, opacity: 0.22 },
    { offsetY: 2, blur: 6, spread: -2, opacity: 0.08 },
  ],
  lg: [
    { offsetY: 16, blur: 40, spread: -18, opacity: 0.28 },
    { offsetY: 2, blur: 8, spread: -2, opacity: 0.08 },
  ],
  xl: [
    { offsetY: 32, blur: 80, spread: -24, opacity: 0.42 },
    { offsetY: 4, blur: 12, spread: -4, opacity: 0.1 },
  ],
  hero: [{ offsetY: 18, blur: 40, spread: -28, opacity: 0.55 }],
} as const satisfies Record<string, readonly ShadowLayer[]>;
export type ElevationToken = keyof typeof elevation;

/** A shadow layer's alpha never goes above this, however strong the theme makes it. */
export const shadowAlphaCap = 0.6;

/* -------------------------------------------------------------------------
 * Materials
 * ---------------------------------------------------------------------- */

/**
 * Backdrop blur, px. Glass is scarce by rule: the chrome material on the
 * phone tab bars and the compact top bar below 1024px, the popover material
 * on text-bearing popovers, and the scrim. Everything else is opaque — in v3
 * that includes the 56px top bars, which are `surface.raised` like the PMO's.
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
 * everything, `deliberate` only for a full-height sheet on a phone. `reveal`
 * is a chart's one first-paint draw (never on a refetch); like every duration
 * it collapses to 1ms under reduced motion.
 */
export const duration = {
  instant: 0,
  fast: 150,
  normal: 200,
  slow: 250,
  deliberate: 300,
  reveal: 400,
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
 * scrolled content passes under and a scrim covers. `systemBar` (the demo
 * bar) sits above the frame's own bars, which stick beneath it, and below
 * every overlay, so a dialog's scrim still covers it.
 */
export const zIndex = {
  base: 0,
  sticky: 100,
  header: 150,
  systemBar: 160,
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
  | 'raisedAlt'
  | 'sunken'
  | 'overlay'
  | 'hover'
  | 'accentHover'
  | 'selected'
  | 'selection'
  | 'bubble'
  | 'inverse';
export type TextToken = 'primary' | 'secondary' | 'muted' | 'faint' | 'disabled' | 'link' | 'inverse';
export type BorderToken = 'subtle' | 'divider' | 'soft' | 'softHover' | 'interactive' | 'strong' | 'focus';
/**
 * `hold` (fuchsia) is waiting, awaiting approval and paused; `high` (orange) is
 * priority 2. They exist so that amber `warning` can mean SLA risk and "due
 * soon" and nothing else, and blue can mean "you can act on this" (D5).
 */
export type IntentName = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'hold' | 'high';
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
  /** Outline of a tinted component, and the intent's mark in a chart; must read against the canvas (SC 1.4.11). */
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
  /** Eight steps for ordered data, from the step nearest the card to the one furthest from it. */
  readonly sequential: readonly string[];
  /**
   * The label colour for each `sequential` step (heat-map and calendar
   * cells), chosen per step and audited rather than computed at run time.
   */
  readonly sequentialInk: readonly string[];
  readonly grid: string;
  readonly axis: string;
  /** Plan and baseline lines: the muted grey comparison (D8). */
  readonly comparison: string;
  /** The quiet fill (P4, "low"). Always drawn with a 1px `neutral.border` outline, which carries its 3:1 edge. */
  readonly neutralSoft: string;
  /** The "Today" / "As at" pill and milestone diamonds, and the text on that pill. */
  readonly marker: string;
  readonly markerText: string;
}

/**
 * The navy of the loud surfaces (D2): the hero status card, the demo bar, the
 * landing hero and the sign-in panel. They are dark objects in a light
 * product, so their values are the same in the light and dark themes (only
 * `line` steps up after dark, so the card still separates from a black
 * canvas), and they bring their own text, link, accent and status marks:
 * page tokens are drawn for the page's surfaces and do not read on navy.
 *
 * The status colours are marks only, for icons and dots. Status *text* on navy
 * is always `text`, with the icon carrying the hue. The four glows are the
 * blue light in a corner of each surface; the audit checks text against the
 * glow at its strongest, composited over the surface it lights.
 */
export interface HeroColours {
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly surfaceDeep: string;
  readonly surfaceEnd: string;
  readonly line: string;
  readonly lineStrong: string;
  readonly fill: string;
  readonly fillStrong: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly link: string;
  readonly accent: string;
  /** The card's corner glow, over `surface`. */
  readonly glow: string;
  /** The system bar's, over `surfaceDeep`. */
  readonly glowBar: string;
  /** The sign-in panel's, over `surface`. */
  readonly glowPanel: string;
  /** The landing band's, over `surfaceDeep`. */
  readonly glowBand: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  readonly info: string;
  readonly hold: string;
  readonly high: string;
  readonly neutral: string;
}
export type HeroSlot = keyof HeroColours;

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
  /**
   * The soft ring outside a focused text field (the PMO's): decoration around
   * the 2px accent edge that carries the 3:1, so it is never audited.
   * Transparent in high contrast, where the field draws v2's wide outline.
   */
  readonly focusHalo: string;
  /** The lit top edge of a filled button, as a colour; `null` where the theme has none (high contrast). */
  readonly highlightInset: string | null;
  /**
   * The filled button's two-stop gradient, start and end, light to dark, and
   * its hover. Stored as hex stops so every stop is audited; `css.ts` builds
   * the `linear-gradient()`. Hover always darkens: the PMO's brightness lift
   * would drop the light stop below AA. High contrast is flat (both stops
   * equal).
   */
  readonly gradient: {
    readonly brand: readonly [string, string];
    readonly brandHover: readonly [string, string];
  };
  readonly material: Readonly<Record<MaterialName, Material>>;
  readonly chart: ChartColours;
  /**
   * The avatar discs: eight deep fills, picked by a stable hash of the name,
   * with white initials in every theme.
   */
  readonly avatar: { readonly fills: readonly string[]; readonly text: string };
  readonly hero: HeroColours;
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

const categoricalLight = ['#007aff', '#cc780c', '#12a0b7', '#ae8b0c', '#b154e0', '#fc3457', '#5856d6', '#0aac43'] as const;
const categoricalDark = ['#0a84ff', '#ce7f00', '#00a6ba', '#ae9210', '#c25df5', '#ff4063', '#7d83ff', '#08b242'] as const;

/**
 * The two sequential ramps, each running away from the card it is drawn on:
 * darker and darker blue on a white card, lighter and lighter on a dark one.
 * v2 reused the light ramp after dark, so a dark heat map's quietest cell was
 * its brightest; the dark ramp below fixes that, and `palette.test.ts` keeps
 * the two from being the same array again.
 */
const sequentialLight = ['#e0ecff', '#bbd6fe', '#90bdfe', '#61a2fe', '#2081fe', '#0866d5', '#0351ac', '#003c84'] as const;
const sequentialDark = ['#16263f', '#123a6b', '#0b4f9c', '#0866d5', '#2081fe', '#61a2fe', '#90bdfe', '#bbd6fe'] as const;

/** Light ramp labels: slate on the five pale steps, white on the three deep ones. */
const inkOnLight = ['#0f172a', '#0f172a', '#0f172a', '#0f172a', '#0f172a', '#ffffff', '#ffffff', '#ffffff'] as const;
/** Dark ramp labels: near-white on the four deep steps, black on the four bright ones. */
const inkOnDark = ['#f5f5f7', '#f5f5f7', '#f5f5f7', '#f5f5f7', '#000000', '#000000', '#000000', '#000000'] as const;

/** 800-level discs: white initials at 7:1 or more, so one set serves light and both high-contrast themes. */
const avatarDeep = ['#1e3a8a', '#3730a3', '#5b21b6', '#86198f', '#155e75', '#115e59', '#334155', '#3f6212'] as const;
/** 700-level discs after dark: a step lighter, so a disc still reads as a shape on a dark card. */
const avatarDark = ['#1d4ed8', '#4338ca', '#6d28d9', '#a21caf', '#0e7490', '#0f766e', '#475569', '#4d7c0f'] as const;

/** The navy itself, shared by every theme. */
const navy = {
  surface: '#0f172a',
  surfaceRaised: '#1e293b',
  surfaceDeep: '#0b1120',
  surfaceEnd: '#1e2a45',
} as const;

/**
 * Navy in the light and dark themes. `textMuted` is the PMO's `#94a3b8`
 * raised to `#a3b1c6`: the PMO's value is 4.14:1 at the landing band's
 * strongest glow, this is 4.88.
 */
const heroStandard: HeroColours = {
  ...navy,
  line: 'rgba(255, 255, 255, 0.09)',
  lineStrong: 'rgba(255, 255, 255, 0.18)',
  fill: 'rgba(255, 255, 255, 0.06)',
  fillStrong: 'rgba(255, 255, 255, 0.14)',
  text: '#f8fafc',
  textSecondary: '#cbd5e1',
  textMuted: '#a3b1c6',
  link: '#8ec5ff',
  accent: '#69a5fd',
  glow: 'rgba(0, 122, 255, 0.26)',
  glowBar: 'rgba(0, 122, 255, 0.32)',
  glowPanel: 'rgba(0, 122, 255, 0.38)',
  glowBand: 'rgba(0, 122, 255, 0.42)',
  success: '#4ade80',
  warning: '#fbbf24',
  danger: '#f87171',
  info: '#a5b4fc',
  hold: '#f0abfc',
  high: '#fb923c',
  neutral: '#94a3b8',
};

/**
 * Navy in high contrast: no glows, real white edges, solid fills, the muted
 * text lifted to the secondary grey, and the high-contrast-dark theme's own
 * intent fills as the status marks, so text reaches 7:1 and marks 3:1 on
 * every navy surface.
 */
const heroHighContrast: HeroColours = {
  ...navy,
  line: '#ffffff',
  lineStrong: '#ffffff',
  fill: '#1e293b',
  fillStrong: '#334155',
  text: '#f8fafc',
  textSecondary: '#cbd5e1',
  textMuted: '#cbd5e1',
  link: '#8ec5ff',
  accent: '#6cb6ff',
  glow: 'rgba(0, 122, 255, 0)',
  glowBar: 'rgba(0, 122, 255, 0)',
  glowPanel: 'rgba(0, 122, 255, 0)',
  glowBand: 'rgba(0, 122, 255, 0)',
  success: '#5ee07f',
  warning: '#ffc066',
  danger: '#ff8a82',
  info: '#b3b1ff',
  hold: '#f0abfc',
  high: '#fdba74',
  neutral: '#d1d1d6',
};

/** The filled button in the standard themes: `#0071e3` → `#0260c0`, darkening on hover. */
const gradientStandard = {
  brand: ['#0071e3', '#0260c0'],
  brandHover: ['#0062c4', '#0058b0'],
} as const;

/**
 * Light: the PMO's slate. White cards with a 1px `#e3e8f0` edge on a cool
 * `#f5f7fb` canvas, slate ink, one blue.
 *
 * Every value was audited in `contrast.ts` rather than chosen by eye, and
 * where a PMO value failed it was moved the least distance in its own hue
 * that passes with headroom: the control border (`#7a869a`, not the PMO's
 * 1.46:1 `#cfd6e3`), the disabled text, the success and warning text and
 * marks, and the navy's muted text. Three choices look like mistakes next to
 * the benchmark and are not:
 *
 *   The filled-button blue is a gradient from `#0071e3`: a *fill* that
 *   carries white text at 4.69:1. It is too light to read as text on the
 *   canvas, so links use the darker `text.link`, and focus rings and
 *   selection bars use `accent`, Apple's `#007aff`, which only has to reach
 *   3:1 (white on it is 4.01, which is why it is never behind text).
 *
 *   Info is indigo, never blue: blue means "you can act on this", and a status
 *   that looked clickable would be a lie (D5).
 *
 *   `border.interactive` is darker than any card edge, because the outline of
 *   a control has to reach 3:1 to be seen at all by somebody who cannot rely
 *   on the subtle one. `divider`, `soft` and `softHover` are decorative: rules
 *   between rows, and the edges of chips and cards that carry their own label.
 */
const apple: ColourTheme = {
  scheme: 'light',
  contrast: 'standard',
  surface: {
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
  },
  text: {
    primary: '#0f172a',
    secondary: '#334155',
    muted: '#475569',
    faint: '#5b6475',
    disabled: '#7c8aa0',
    link: '#0066cc',
    inverse: '#ffffff',
  },
  border: {
    subtle: '#e3e8f0',
    divider: '#edf0f5',
    soft: '#cfd6e3',
    softHover: '#a9b4c6',
    interactive: '#7a869a',
    strong: '#64748b',
    focus: '#007aff',
  },
  intent: {
    brand: {
      solid: '#0071e3',
      solidHover: '#0062c4',
      solidText: '#ffffff',
      subtle: '#e6f2ff',
      subtleText: '#0058b0',
      border: '#007aff',
    },
    neutral: {
      solid: '#64748b',
      solidHover: '#475569',
      solidText: '#ffffff',
      subtle: '#eef1f6',
      subtleText: '#334155',
      border: '#7a869a',
    },
    success: {
      solid: '#15803d',
      solidHover: '#166534',
      solidText: '#ffffff',
      subtle: '#dcfce7',
      subtleText: '#147638',
      border: '#159e47',
    },
    warning: {
      solid: '#b45309',
      solidHover: '#92400e',
      solidText: '#ffffff',
      subtle: '#fef3c7',
      subtleText: '#a34b07',
      border: '#d07006',
    },
    danger: {
      solid: '#dc2626',
      solidHover: '#b91c1c',
      solidText: '#ffffff',
      subtle: '#fee5e5',
      subtleText: '#b91c1c',
      border: '#dc2626',
    },
    info: {
      solid: '#4f46e5',
      solidHover: '#4338ca',
      solidText: '#ffffff',
      subtle: '#e6eaff',
      subtleText: '#4338ca',
      border: '#4f46e5',
    },
    hold: {
      solid: '#c026d3',
      solidHover: '#a21caf',
      solidText: '#ffffff',
      subtle: '#fae8ff',
      subtleText: '#a21caf',
      border: '#c026d3',
    },
    high: {
      solid: '#c2410c',
      solidHover: '#9a3412',
      solidText: '#ffffff',
      subtle: '#ffedd5',
      subtleText: '#9a3412',
      border: '#ea580c',
    },
  },
  accent: '#007aff',
  fill: {
    hover: 'rgba(15, 23, 42, 0.04)',
    pressed: 'rgba(15, 23, 42, 0.08)',
    secondary: 'rgba(100, 116, 139, 0.12)',
    track: '#e6eaf1',
  },
  trackBorder: { colour: '#7a869a', width: 1 },
  edgeHighlight: null,
  focusHalo: 'rgba(0, 122, 255, 0.18)',
  highlightInset: 'rgba(255, 255, 255, 0.14)',
  gradient: gradientStandard,
  material: {
    chrome: { background: 'rgba(245, 247, 251, 0.92)', saturate: 180 },
    popover: { background: 'rgba(255, 255, 255, 0.96)', saturate: 180 },
  },
  chart: {
    categorical: categoricalLight,
    sequential: sequentialLight,
    sequentialInk: inkOnLight,
    grid: '#edf0f5',
    axis: '#cfd6e3',
    comparison: '#7a869a',
    neutralSoft: '#cbd5e1',
    marker: '#0f172a',
    markerText: '#ffffff',
  },
  avatar: { fills: avatarDeep, text: '#ffffff' },
  hero: heroStandard,
  shadow: '#0f172a',
  shadowStrength: 1,
  scrim: 'rgba(15, 23, 42, 0.4)',
};

/**
 * The same language after dark: v2's audited `apple-dark` surfaces, text,
 * accent and six intents are kept exactly (D3), and v3 only adds to them.
 *
 * Surfaces step up in lightness as they come forward — canvas, raised,
 * overlay — far enough apart (about 1.2:1 each) that a card reads as a card
 * without a border. Filled buttons keep the light theme's blue gradient and
 * white text; warning and `high` are the exceptions, because an amber or an
 * orange light enough to read on black cannot also carry white text, so they
 * carry near-black.
 */
const appleDark: ColourTheme = {
  scheme: 'dark',
  contrast: 'standard',
  surface: {
    canvas: '#000000',
    raised: '#1c1c1e',
    raisedAlt: '#242426',
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
    faint: '#98989d',
    disabled: '#6c6c70',
    link: '#4da3ff',
    inverse: '#1d1d1f',
  },
  border: {
    subtle: '#38383a',
    divider: '#2e2e30',
    soft: '#545458',
    softHover: '#636366',
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
    hold: {
      solid: '#c026d3',
      solidHover: '#a21caf',
      solidText: '#ffffff',
      subtle: '#3d2b41',
      subtleText: '#f0abfc',
      border: '#e879f9',
    },
    high: {
      solid: '#f97316',
      solidHover: '#fb923c',
      solidText: '#1d1d1f',
      subtle: '#403023',
      subtleText: '#fdba74',
      border: '#fb923c',
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
  focusHalo: 'rgba(10, 132, 255, 0.32)',
  highlightInset: 'rgba(255, 255, 255, 0.1)',
  gradient: gradientStandard,
  material: {
    chrome: { background: 'rgba(28, 28, 30, 0.92)', saturate: 150 },
    popover: { background: 'rgba(44, 44, 46, 0.96)', saturate: 150 },
  },
  chart: {
    categorical: categoricalDark,
    sequential: sequentialDark,
    sequentialInk: inkOnDark,
    grid: '#38383a',
    axis: '#545458',
    comparison: '#8e8e93',
    neutralSoft: '#48484a',
    marker: '#f5f5f7',
    markerText: '#1d1d1f',
  },
  avatar: { fills: avatarDark, text: '#ffffff' },
  hero: { ...heroStandard, line: 'rgba(255, 255, 255, 0.1)' },
  shadow: '#000000',
  shadowStrength: 2.2,
  scrim: 'rgba(0, 0, 0, 0.56)',
};

/**
 * High contrast. Not "the light theme with darker greys": it removes tint from
 * surfaces, makes every border a real border, draws outlines where the other
 * themes draw shadows, turns glass solid, and holds text to AAA (7:1) so that
 * people who need it have headroom over the AA floor. v2's values stand; v3's
 * additions are AAA versions of the new tokens, flat buttons and no glows.
 */
const highContrast: ColourTheme = {
  scheme: 'light',
  contrast: 'more',
  surface: {
    canvas: '#ffffff',
    raised: '#ffffff',
    raisedAlt: '#f2f2f2',
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
    faint: '#333333',
    disabled: '#595959',
    link: '#0033b3',
    inverse: '#ffffff',
  },
  border: {
    subtle: '#595959',
    divider: '#595959',
    soft: '#333333',
    softHover: '#000000',
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
    hold: {
      solid: '#86198f',
      solidHover: '#701a75',
      solidText: '#ffffff',
      subtle: '#fae8ff',
      subtleText: '#701a75',
      border: '#86198f',
    },
    high: {
      solid: '#9a3412',
      solidHover: '#7c2d12',
      solidText: '#ffffff',
      subtle: '#ffedd5',
      subtleText: '#7c2d12',
      border: '#9a3412',
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
  focusHalo: 'rgba(0, 64, 221, 0)',
  highlightInset: null,
  gradient: { brand: ['#0040dd', '#0040dd'], brandHover: ['#0033b3', '#0033b3'] },
  material: {
    chrome: { background: '#ffffff', saturate: null },
    popover: { background: '#ffffff', saturate: null },
  },
  chart: {
    categorical: categoricalLight,
    sequential: sequentialLight,
    sequentialInk: ['#000000', '#000000', '#000000', '#000000', '#000000', '#ffffff', '#ffffff', '#ffffff'],
    grid: '#e5e5ea',
    axis: '#000000',
    comparison: '#000000',
    neutralSoft: '#e6e6e6',
    marker: '#000000',
    markerText: '#ffffff',
  },
  avatar: { fills: avatarDeep, text: '#ffffff' },
  hero: heroHighContrast,
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
    raisedAlt: '#0d0d0d',
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
    faint: '#d1d1d6',
    disabled: '#9a9a9f',
    link: '#6cb6ff',
    inverse: '#000000',
  },
  border: {
    subtle: '#a1a1a6',
    divider: '#a1a1a6',
    soft: '#d1d1d6',
    softHover: '#ffffff',
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
    hold: {
      solid: '#f0abfc',
      solidHover: '#f5d0fe',
      solidText: '#000000',
      subtle: '#2e0b33',
      subtleText: '#f5d0fe',
      border: '#f0abfc',
    },
    high: {
      solid: '#fdba74',
      solidHover: '#fed7aa',
      solidText: '#000000',
      subtle: '#331a05',
      subtleText: '#fed7aa',
      border: '#fdba74',
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
  focusHalo: 'rgba(108, 182, 255, 0)',
  highlightInset: null,
  gradient: { brand: ['#6cb6ff', '#6cb6ff'], brandHover: ['#8cc6ff', '#8cc6ff'] },
  material: {
    chrome: { background: '#000000', saturate: null },
    popover: { background: '#121212', saturate: null },
  },
  chart: {
    categorical: categoricalDark,
    sequential: sequentialDark,
    sequentialInk: ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#000000', '#000000', '#000000', '#000000'],
    grid: '#38383a',
    axis: '#ffffff',
    comparison: '#ffffff',
    neutralSoft: '#1f1f1f',
    marker: '#ffffff',
    markerText: '#000000',
  },
  avatar: { fills: avatarDeep, text: '#ffffff' },
  hero: heroHighContrast,
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
