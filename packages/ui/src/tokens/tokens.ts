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
 */

export type ThemeName = 'apple' | 'apple-dark' | 'light' | 'dark' | 'high-contrast';

export const themeNames: readonly ThemeName[] = ['apple', 'apple-dark', 'light', 'dark', 'high-contrast'];

/* -------------------------------------------------------------------------
 * Spacing
 * ---------------------------------------------------------------------- */

/**
 * A 4px rhythm. Named rather than numbered so that a change of density (a
 * future "compact" mode for the workbench) can rescale the whole system by
 * editing this one map.
 */
export const spacing = {
  none: 0,
  '3xs': 2,
  '2xs': 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
} as const;
export type SpacingToken = keyof typeof spacing;

/* -------------------------------------------------------------------------
 * Radius, borders and control sizing
 * ---------------------------------------------------------------------- */

export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 20,
  pill: 999,
} as const;
export type RadiusToken = keyof typeof radius;

/**
 * How far an interactive surface rises when it is hovered or focused.
 *
 * A token rather than a number in a rule because the brief asks for the same
 * 2–4px movement on four different things — service tiles, ticket rows,
 * navigation items and metric tiles — and four hand-written `translateY`
 * values are four chances to drift apart.
 *
 * `sm` is for something in a list, where a larger movement would push its
 * neighbours around; `md` is for a tile with space around it.
 */
export const lift = {
  sm: 2,
  md: 4,
} as const;
export type LiftToken = keyof typeof lift;

export const borderWidth = {
  hair: 1,
  thick: 2,
} as const;
export type BorderWidthToken = keyof typeof borderWidth;

/**
 * Minimum hit targets. WCAG 2.2 SC 2.5.8 asks for 24×24 CSS pixels; we take
 * 32px as the floor for the densest control and 44px for touch-first surfaces,
 * so the mobile app and the portal can share components without re-tuning.
 */
export const controlHeight = {
  sm: 32,
  md: 40,
  lg: 48,
} as const;
export type ControlSizeToken = keyof typeof controlHeight;

export const focusRing = {
  width: 2,
  offset: 2,
} as const;

/* -------------------------------------------------------------------------
 * Typography
 * ---------------------------------------------------------------------- */

/**
 * Font stacks as arrays: CSS joins them, React Native takes the first entry it
 * can resolve. No webfont is loaded by default — the portal's LCP budget
 * (§8 of the experience architecture) is easier to hold with system faces.
 */
/**
 * `-apple-system` leads because the theme's typography is the platform's own.
 *
 * It is a keyword rather than a family: the browser resolves it to whatever the
 * operating system's interface face is — San Francisco on Apple platforms,
 * Segoe on Windows, Roboto on Android — which is what makes the same stylesheet
 * look native in three places without shipping a font. Inter stays as the first
 * real family after it, so a machine with neither keyword still gets the face
 * this design system was drawn against.
 */
export const fontFamily = {
  sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'SF Pro Text', 'Segoe UI', 'Roboto', 'system-ui', 'sans-serif'],
  mono: ['SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
} as const;
export type FontFamilyToken = keyof typeof fontFamily;

export const fontSize = {
  '2xs': 11,
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 38,
} as const;
export type FontSizeToken = keyof typeof fontSize;

export const lineHeight = {
  tight: 1.2,
  snug: 1.35,
  normal: 1.5,
  relaxed: 1.65,
} as const;
export type LineHeightToken = keyof typeof lineHeight;

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
 * Composite styles. Components reference these rather than raw size/weight
 * pairs, which is what keeps "a label" looking like a label in the portal, the
 * workbench and the mobile app.
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

/* -------------------------------------------------------------------------
 * Elevation
 * ---------------------------------------------------------------------- */

export interface ShadowLayer {
  readonly offsetY: number;
  readonly blur: number;
  readonly spread: number;
  /** Alpha applied to the theme's shadow colour, 0–1. */
  readonly opacity: number;
}

/**
 * Shadows are stored as geometry plus an alpha, not as finished `box-shadow`
 * strings, because React Native takes the same numbers through different props
 * and the dark theme needs a different shadow colour under identical geometry.
 */
export const elevation = {
  none: [],
  sm: [{ offsetY: 1, blur: 2, spread: 0, opacity: 0.08 }],
  md: [
    { offsetY: 2, blur: 6, spread: -1, opacity: 0.1 },
    { offsetY: 1, blur: 2, spread: 0, opacity: 0.06 },
  ],
  lg: [
    { offsetY: 8, blur: 20, spread: -4, opacity: 0.14 },
    { offsetY: 2, blur: 6, spread: -2, opacity: 0.08 },
  ],
  xl: [
    { offsetY: 20, blur: 40, spread: -8, opacity: 0.2 },
    { offsetY: 6, blur: 12, spread: -6, opacity: 0.1 },
  ],
} as const satisfies Record<string, readonly ShadowLayer[]>;
export type ElevationToken = keyof typeof elevation;

/* -------------------------------------------------------------------------
 * Motion
 * ---------------------------------------------------------------------- */

/** Milliseconds. Anything above `slow` needs a reason: people wait for us. */
export const duration = {
  instant: 0,
  fast: 120,
  normal: 200,
  slow: 320,
  deliberate: 480,
} as const;
export type DurationToken = keyof typeof duration;

export type CubicBezier = readonly [number, number, number, number];

export const easing = {
  standard: [0.2, 0, 0, 1],
  entrance: [0, 0, 0.2, 1],
  exit: [0.4, 0, 1, 1],
  emphasised: [0.3, 0, 0, 1],
} as const satisfies Record<string, CubicBezier>;
export type EasingToken = keyof typeof easing;

/* -------------------------------------------------------------------------
 * Layering and layout
 * ---------------------------------------------------------------------- */

export const zIndex = {
  base: 0,
  sticky: 100,
  dropdown: 200,
  overlay: 300,
  dialog: 400,
  toast: 500,
  tooltip: 600,
} as const;
export type ZIndexToken = keyof typeof zIndex;

/** Minimum widths, in px. 320 is the floor implied by the 400px/200% zoom rule. */
export const breakpoint = {
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;
export type BreakpointToken = keyof typeof breakpoint;

/* -------------------------------------------------------------------------
 * Colour
 * ---------------------------------------------------------------------- */

export type SurfaceToken = 'canvas' | 'raised' | 'sunken' | 'overlay' | 'hover' | 'selected' | 'inverse';
export type TextToken = 'primary' | 'secondary' | 'muted' | 'disabled' | 'link' | 'inverse';
export type BorderToken = 'subtle' | 'interactive' | 'strong' | 'focus';
export type IntentName = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface IntentColours {
  /** Filled backgrounds: primary buttons, solid badges, selected rows. */
  readonly solid: string;
  readonly solidHover: string;
  /** The only colour allowed on `solid`. */
  readonly solidText: string;
  /** Tinted backgrounds: soft badges, callouts, inline validation summaries. */
  readonly subtle: string;
  /** The only colour allowed on `subtle`. */
  readonly subtleText: string;
  /** Outline of a tinted component; must read against the canvas (SC 1.4.11). */
  readonly border: string;
}

export interface ColourTheme {
  readonly surface: Readonly<Record<SurfaceToken, string>>;
  readonly text: Readonly<Record<TextToken, string>>;
  readonly border: Readonly<Record<BorderToken, string>>;
  readonly intent: Readonly<Record<IntentName, IntentColours>>;
  /** Base colour of every shadow layer in this theme. */
  readonly shadow: string;
  /** Backdrop behind modal surfaces. */
  readonly scrim: string;
}


/**
 * The default theme: calm, light, and mostly out of the way.
 *
 * Derived from the visual reference in `claude-apple-theme-brief.md` — a very
 * light neutral canvas, white surfaces, near-black text, one restrained blue —
 * and then corrected against the audit in `contrast.ts`, which is why several
 * values are not the ones the reference used.
 *
 * Three of those corrections are worth recording, because each looks like a
 * mistake next to the reference and is not:
 *
 *   The reference's blue, `#0071e3`, reaches 4.71:1 on white and only 4.32:1
 *   on the `#f5f5f7` canvas. It stays as a *fill* — where it carries white
 *   text at 4.71:1 — and `text.link` is a darker blue that clears 4.5:1 on
 *   both surfaces. A link is read; a button is aimed at.
 *
 *   The reference's green, `#168a62`, is 4.33:1 on white. It is fine as a
 *   border or a fill and not as text, so `success.subtleText` is darker.
 *
 *   `border.interactive` is darker than the reference's hairline, because a
 *   border that separates two controls has to reach 3:1 to be seen at all by
 *   somebody who cannot rely on the subtle one.
 *
 * `surface.hover` is the soft blue the brief asks for on every interactive
 * surface, which is why it is a tint rather than the usual grey: the hover
 * state is a deliberate part of this design rather than a darkening.
 */
const apple: ColourTheme = {
  surface: {
    canvas: '#f5f5f7',
    raised: '#ffffff',
    sunken: '#ececf0',
    overlay: '#ffffff',
    hover: '#eaf3ff',
    selected: '#dcecff',
    inverse: '#1d1d1f',
  },
  text: {
    primary: '#1d1d1f',
    secondary: '#424245',
    muted: '#68686d',
    disabled: '#86868b',
    link: '#0062cc',
    inverse: '#f5f5f7',
  },
  border: {
    subtle: '#e5e5ea',
    interactive: '#86868b',
    strong: '#6e6e73',
    focus: '#0062cc',
  },
  intent: {
    brand: {
      solid: '#0071e3',
      solidHover: '#0062cc',
      solidText: '#ffffff',
      subtle: '#eaf3ff',
      subtleText: '#0a4f9e',
      border: '#3f86d8',
    },
    neutral: {
      solid: '#424245',
      solidHover: '#2c2c2e',
      solidText: '#ffffff',
      subtle: '#ececf0',
      subtleText: '#424245',
      border: '#86868b',
    },
    success: {
      solid: '#0f7351',
      solidHover: '#0b5c41',
      solidText: '#ffffff',
      subtle: '#e3f5ed',
      subtleText: '#0d5a40',
      border: '#168a62',
    },
    warning: {
      solid: '#8a5200',
      solidHover: '#6f4200',
      solidText: '#ffffff',
      subtle: '#fbf0dc',
      subtleText: '#6f4200',
      border: '#b3822f',
    },
    danger: {
      solid: '#c9302c',
      solidHover: '#a32522',
      solidText: '#ffffff',
      subtle: '#fdeae9',
      subtleText: '#9b201d',
      border: '#d05a56',
    },
    info: {
      solid: '#0f5e78',
      solidHover: '#0c4c61',
      solidText: '#ffffff',
      subtle: '#e4f1f6',
      subtleText: '#0d5065',
      border: '#4a93ab',
    },
  },
  shadow: '#1d1d1f',
  scrim: 'rgba(29, 29, 31, 0.45)',
};

/**
 * The same language after dark.
 *
 * Not in the reference, which is light only — but the product follows the
 * operating system, and a great many people run theirs dark. Leaving this out
 * would mean the theme simply stopped applying for them.
 *
 * Filled intents invert exactly as the existing dark theme does: a hue bright
 * enough to read against a near-black canvas cannot also carry white text at
 * 4.5:1, so it carries near-black text instead.
 */
const appleDark: ColourTheme = {
  surface: {
    canvas: '#000000',
    raised: '#1c1c1e',
    sunken: '#0c0c0d',
    overlay: '#2c2c2e',
    hover: '#16324f',
    selected: '#1d3f63',
    inverse: '#f5f5f7',
  },
  text: {
    primary: '#f5f5f7',
    secondary: '#d1d1d6',
    muted: '#a1a1a6',
    disabled: '#8e8e93',
    link: '#6cb2ff',
    inverse: '#1d1d1f',
  },
  border: {
    subtle: '#38383a',
    interactive: '#8e8e93',
    strong: '#aeaeb2',
    focus: '#6cb2ff',
  },
  intent: {
    brand: {
      solid: '#4da2ff',
      solidHover: '#7cbaff',
      solidText: '#00142b',
      subtle: '#10233a',
      subtleText: '#9ccbff',
      border: '#2f6da8',
    },
    neutral: {
      solid: '#aeaeb2',
      solidHover: '#c7c7cc',
      solidText: '#1d1d1f',
      subtle: '#2c2c2e',
      subtleText: '#d1d1d6',
      border: '#8e8e93',
    },
    success: {
      solid: '#4ecb96',
      solidHover: '#7bdcb3',
      solidText: '#00231a',
      subtle: '#0e2a21',
      subtleText: '#8fe0bd',
      border: '#2f8f6b',
    },
    warning: {
      solid: '#e6a44a',
      solidHover: '#f0bb76',
      solidText: '#241600',
      subtle: '#2e2314',
      subtleText: '#eec38a',
      border: '#9a7233',
    },
    danger: {
      solid: '#ff7b74',
      solidHover: '#ffa19b',
      solidText: '#2c0503',
      subtle: '#331614',
      subtleText: '#ffaba6',
      border: '#a8524d',
    },
    info: {
      solid: '#5cc3e0',
      solidHover: '#8ad6ec',
      solidText: '#00202b',
      subtle: '#0d2830',
      subtleText: '#9bdaec',
      border: '#37879e',
    },
  },
  shadow: '#000000',
  scrim: 'rgba(0, 0, 0, 0.65)',
};

/**
 * Light theme. Every value was chosen against the audit in `contrast.ts`
 * rather than by eye: if a hue needed darkening to clear 4.5:1, it was
 * darkened. See `__tests__/contrast.test.ts`.
 */
const light: ColourTheme = {
  surface: {
    canvas: '#f5f7fa',
    raised: '#ffffff',
    sunken: '#eceff4',
    overlay: '#ffffff',
    hover: '#e8ecf3',
    selected: '#dde7fa',
    inverse: '#1b2434',
  },
  text: {
    primary: '#141b26',
    secondary: '#3d4756',
    muted: '#596475',
    disabled: '#767f8d',
    link: '#1350c4',
    inverse: '#f4f7fb',
  },
  border: {
    subtle: '#dfe4ec',
    interactive: '#7d8796',
    strong: '#5b6676',
    focus: '#1350c4',
  },
  intent: {
    brand: {
      solid: '#1350c4',
      solidHover: '#0f43a6',
      solidText: '#ffffff',
      subtle: '#e6eefc',
      subtleText: '#123f9c',
      border: '#5b86dd',
    },
    neutral: {
      solid: '#3d4756',
      solidHover: '#2c3542',
      solidText: '#ffffff',
      subtle: '#e9edf3',
      subtleText: '#3d4756',
      border: '#7d8796',
    },
    success: {
      solid: '#16714a',
      solidHover: '#115b3c',
      solidText: '#ffffff',
      subtle: '#e0f3e9',
      subtleText: '#14603f',
      border: '#4f9e79',
    },
    warning: {
      solid: '#8a5200',
      solidHover: '#6f4200',
      solidText: '#ffffff',
      subtle: '#fbeed4',
      subtleText: '#734400',
      border: '#b3822f',
    },
    danger: {
      solid: '#b3261e',
      solidHover: '#8f1e18',
      solidText: '#ffffff',
      subtle: '#fbe6e4',
      subtleText: '#9a211a',
      border: '#d0655d',
    },
    info: {
      solid: '#0f5e78',
      solidHover: '#0c4c61',
      solidText: '#ffffff',
      subtle: '#e0f0f6',
      subtleText: '#0d5065',
      border: '#4a93ab',
    },
  },
  shadow: '#0b1220',
  scrim: 'rgba(11, 18, 32, 0.55)',
};

/**
 * Dark theme. Filled intents invert: a bright fill carries near-black text,
 * because a saturated hue light enough to be legible against a dark canvas can
 * never also carry white text at 4.5:1.
 */
const dark: ColourTheme = {
  surface: {
    canvas: '#0d131d',
    raised: '#161d29',
    sunken: '#090e16',
    overlay: '#1b2331',
    hover: '#222b3a',
    selected: '#1e3350',
    inverse: '#e9eef6',
  },
  text: {
    primary: '#e9eef6',
    secondary: '#b9c3d2',
    muted: '#98a4b5',
    disabled: '#6d798a',
    link: '#8ab6f5',
    inverse: '#101724',
  },
  border: {
    subtle: '#26303f',
    interactive: '#5d6b7f',
    strong: '#94a1b3',
    focus: '#8ab6f5',
  },
  intent: {
    brand: {
      solid: '#6ca4f4',
      solidHover: '#8bb8f7',
      solidText: '#081222',
      subtle: '#152744',
      subtleText: '#a9c8f8',
      border: '#4a7fc9',
    },
    neutral: {
      solid: '#a9b4c4',
      solidHover: '#bdc6d3',
      solidText: '#0d131d',
      subtle: '#1e2734',
      subtleText: '#c2ccda',
      border: '#5d6b7f',
    },
    success: {
      solid: '#5fc08c',
      solidHover: '#7fcda2',
      solidText: '#04150d',
      subtle: '#10291e',
      subtleText: '#87d2aa',
      border: '#3f8a63',
    },
    warning: {
      solid: '#e0a83c',
      solidHover: '#e9bb62',
      solidText: '#1a1102',
      subtle: '#2e2210',
      subtleText: '#e2b76a',
      border: '#96762c',
    },
    danger: {
      solid: '#f0847c',
      solidHover: '#f4a19b',
      solidText: '#220704',
      subtle: '#341614',
      subtleText: '#f2a49e',
      border: '#a8524b',
    },
    info: {
      solid: '#5fb8d4',
      solidHover: '#84c9df',
      solidText: '#03151c',
      subtle: '#10272f',
      subtleText: '#8ac9de',
      border: '#3d8398',
    },
  },
  shadow: '#000000',
  scrim: 'rgba(3, 7, 14, 0.7)',
};

/**
 * High contrast. Not "the light theme with darker greys": it removes tint from
 * surfaces, makes every border a real border, and holds text to AAA (7:1) so
 * that users who need it have headroom over the AA floor.
 */
const highContrast: ColourTheme = {
  surface: {
    canvas: '#ffffff',
    raised: '#ffffff',
    sunken: '#f2f2f2',
    overlay: '#ffffff',
    hover: '#e4e4e4',
    selected: '#d7e3ff',
    inverse: '#000000',
  },
  text: {
    primary: '#000000',
    secondary: '#1a1a1a',
    muted: '#333333',
    disabled: '#595959',
    link: '#0b3fbf',
    inverse: '#ffffff',
  },
  border: {
    subtle: '#767676',
    interactive: '#000000',
    strong: '#000000',
    focus: '#0b3fbf',
  },
  intent: {
    brand: {
      solid: '#0b3fbf',
      solidHover: '#082f8f',
      solidText: '#ffffff',
      subtle: '#e3ebff',
      subtleText: '#062a83',
      border: '#0b3fbf',
    },
    neutral: {
      solid: '#1a1a1a',
      solidHover: '#000000',
      solidText: '#ffffff',
      subtle: '#ededed',
      subtleText: '#1a1a1a',
      border: '#1a1a1a',
    },
    success: {
      solid: '#0a5233',
      solidHover: '#073d26',
      solidText: '#ffffff',
      subtle: '#dff2e7',
      subtleText: '#06422a',
      border: '#0a5233',
    },
    warning: {
      solid: '#6b3f00',
      solidHover: '#523000',
      solidText: '#ffffff',
      subtle: '#fbeacc',
      subtleText: '#563200',
      border: '#6b3f00',
    },
    danger: {
      solid: '#96100b',
      solidHover: '#750c08',
      solidText: '#ffffff',
      subtle: '#fde3e1',
      subtleText: '#7c0d09',
      border: '#96100b',
    },
    info: {
      solid: '#0a4356',
      solidHover: '#073241',
      solidText: '#ffffff',
      subtle: '#dceef5',
      subtleText: '#073544',
      border: '#0a4356',
    },
  },
  shadow: '#000000',
  scrim: 'rgba(0, 0, 0, 0.75)',
};

export const colour: Readonly<Record<ThemeName, ColourTheme>> = {
  apple,
  'apple-dark': appleDark,
  light,
  dark,
  'high-contrast': highContrast,
};

/** Everything a renderer needs, in one object, so `css.ts` and `native.ts` stay honest. */
export const tokens = {
  spacing,
  radius,
  borderWidth,
  controlHeight,
  focusRing,
  fontFamily,
  fontSize,
  lineHeight,
  fontWeight,
  letterSpacing,
  textStyle,
  elevation,
  duration,
  easing,
  zIndex,
  breakpoint,
  colour,
} as const;

export type Tokens = typeof tokens;
