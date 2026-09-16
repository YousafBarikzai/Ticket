/**
 * Contrast mathematics and the contrast contract.
 *
 * WCAG 2.2 defines contrast as a ratio between the relative luminance of two
 * colours (SC 1.4.3 for text, SC 1.4.11 for user-interface components). This
 * file implements that formula and then declares, as data, every foreground /
 * background pairing the design system actually puts on screen. The audit test
 * walks the contract across all three themes, so a token can never be nudged
 * for looks without the build telling us what it broke.
 */
import { colour, themeNames, type ColourTheme, type IntentName, type ThemeName } from './tokens.js';

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Accepts `#rgb`, `#rrggbb` and `rgb()/rgba()` with integer channels. */
export function parseColour(value: string): Rgb {
  const hex = value.trim();
  if (hex.startsWith('#')) {
    const digits = hex.slice(1);
    if (digits.length === 3) {
      const [r, g, b] = [digits[0], digits[1], digits[2]];
      return {
        r: Number.parseInt(`${r}${r}`, 16),
        g: Number.parseInt(`${g}${g}`, 16),
        b: Number.parseInt(`${b}${b}`, 16),
      };
    }
    if (digits.length === 6) {
      return {
        r: Number.parseInt(digits.slice(0, 2), 16),
        g: Number.parseInt(digits.slice(2, 4), 16),
        b: Number.parseInt(digits.slice(4, 6), 16),
      };
    }
    throw new Error(`unsupported hex colour: ${value}`);
  }
  const match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(hex);
  if (!match) throw new Error(`unsupported colour: ${value}`);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
}

/** The sRGB → linear transfer function from the WCAG definition. */
function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, 0 (black) to 1 (white), per WCAG 2.2. */
export function relativeLuminance(colourValue: string | Rgb): number {
  const { r, g, b } = typeof colourValue === 'string' ? parseColour(colourValue) : colourValue;
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** Contrast ratio between two opaque colours, from 1:1 to 21:1. */
export function contrastRatio(foreground: string | Rgb, background: string | Rgb): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Rounded down to two decimals: 4.499 must never be reported as 4.5. */
export function roundRatio(ratio: number): number {
  return Math.floor(ratio * 100) / 100;
}

/**
 * What a pair is used for, which decides its minimum.
 * - `body`   — text below 18.66px bold / 24px regular (SC 1.4.3 → 4.5:1)
 * - `large`  — headings at or above that size (SC 1.4.3 → 3:1)
 * - `ui`     — component boundaries, focus rings, meaningful graphics (SC 1.4.11 → 3:1)
 */
export type PairKind = 'body' | 'large' | 'ui';

export const wcagMinimum: Readonly<Record<PairKind, number>> = {
  body: 4.5,
  large: 3,
  ui: 3,
};

/**
 * The high-contrast theme exists for people for whom the AA floor is not
 * enough, so we hold it to AAA (SC 1.4.6). Anything less and the theme is
 * decoration rather than an accommodation.
 */
export const themeMinimum: Readonly<Record<ThemeName, Readonly<Record<PairKind, number>>>> = {
  apple: wcagMinimum,
  'apple-dark': wcagMinimum,
  light: wcagMinimum,
  dark: wcagMinimum,
  'high-contrast': { body: 7, large: 4.5, ui: 3 },
};

export interface ContrastPair {
  /** Dotted token path, e.g. `text.muted on surface.raised`. */
  readonly name: string;
  readonly kind: PairKind;
  readonly foreground: (theme: ColourTheme) => string;
  readonly background: (theme: ColourTheme) => string;
}

const intents: readonly IntentName[] = ['brand', 'neutral', 'success', 'warning', 'danger', 'info'];

/** Backgrounds that ordinary body text is ever placed on. */
const bodyBackgrounds: readonly { readonly key: string; readonly pick: (t: ColourTheme) => string }[] = [
  { key: 'surface.canvas', pick: (t) => t.surface.canvas },
  { key: 'surface.raised', pick: (t) => t.surface.raised },
  { key: 'surface.sunken', pick: (t) => t.surface.sunken },
  { key: 'surface.overlay', pick: (t) => t.surface.overlay },
  { key: 'surface.hover', pick: (t) => t.surface.hover },
  { key: 'surface.selected', pick: (t) => t.surface.selected },
];

/**
 * Every pairing the components actually produce.
 *
 * Two tokens are deliberately absent, and the reasons are worth writing down:
 *
 * - `border.subtle` is a decorative divider between blocks of content. SC
 *   1.4.11 covers boundaries needed to *identify* a control; a rule between two
 *   table rows is not one, and holding it to 3:1 would make every list look
 *   like a spreadsheet. Control outlines use `border.interactive`, which is in
 *   the contract.
 * - `surface.*` against each other are not text pairs and carry no requirement.
 *
 * `text.disabled` *is* exempt under SC 1.4.3 ("inactive user interface
 * component"), but we still hold it to the 3:1 UI floor: an unavailable action
 * must remain readable enough to explain why it is unavailable.
 */
export function contrastContract(): readonly ContrastPair[] {
  const pairs: ContrastPair[] = [];

  for (const background of bodyBackgrounds) {
    // `surface.selected` and `surface.hover` only ever carry primary and
    // secondary text (rows and menu items), not the muted/link variants.
    const foregrounds: readonly { readonly key: string; readonly pick: (t: ColourTheme) => string }[] =
      background.key === 'surface.selected' || background.key === 'surface.hover'
        ? [
            { key: 'text.primary', pick: (t) => t.text.primary },
            { key: 'text.secondary', pick: (t) => t.text.secondary },
          ]
        : [
            { key: 'text.primary', pick: (t) => t.text.primary },
            { key: 'text.secondary', pick: (t) => t.text.secondary },
            { key: 'text.muted', pick: (t) => t.text.muted },
            { key: 'text.link', pick: (t) => t.text.link },
          ];

    for (const foreground of foregrounds) {
      pairs.push({
        name: `${foreground.key} on ${background.key}`,
        kind: 'body',
        foreground: foreground.pick,
        background: background.pick,
      });
    }
  }

  pairs.push(
    {
      name: 'text.disabled on surface.canvas',
      kind: 'ui',
      foreground: (t) => t.text.disabled,
      background: (t) => t.surface.canvas,
    },
    {
      name: 'text.disabled on surface.raised',
      kind: 'ui',
      foreground: (t) => t.text.disabled,
      background: (t) => t.surface.raised,
    },
    {
      name: 'text.inverse on surface.inverse',
      kind: 'body',
      foreground: (t) => t.text.inverse,
      background: (t) => t.surface.inverse,
    },
    {
      name: 'border.interactive on surface.canvas',
      kind: 'ui',
      foreground: (t) => t.border.interactive,
      background: (t) => t.surface.canvas,
    },
    {
      name: 'border.interactive on surface.raised',
      kind: 'ui',
      foreground: (t) => t.border.interactive,
      background: (t) => t.surface.raised,
    },
    {
      name: 'border.strong on surface.raised',
      kind: 'ui',
      foreground: (t) => t.border.strong,
      background: (t) => t.surface.raised,
    },
    {
      name: 'border.focus on surface.canvas',
      kind: 'ui',
      foreground: (t) => t.border.focus,
      background: (t) => t.surface.canvas,
    },
    {
      name: 'border.focus on surface.raised',
      kind: 'ui',
      foreground: (t) => t.border.focus,
      background: (t) => t.surface.raised,
    },
  );

  for (const intent of intents) {
    pairs.push(
      {
        name: `intent.${intent}.solidText on intent.${intent}.solid`,
        kind: 'body',
        foreground: (t) => t.intent[intent].solidText,
        background: (t) => t.intent[intent].solid,
      },
      {
        name: `intent.${intent}.solidText on intent.${intent}.solidHover`,
        kind: 'body',
        foreground: (t) => t.intent[intent].solidText,
        background: (t) => t.intent[intent].solidHover,
      },
      {
        name: `intent.${intent}.subtleText on intent.${intent}.subtle`,
        kind: 'body',
        foreground: (t) => t.intent[intent].subtleText,
        background: (t) => t.intent[intent].subtle,
      },
      {
        name: `intent.${intent}.border on surface.canvas`,
        kind: 'ui',
        foreground: (t) => t.intent[intent].border,
        background: (t) => t.surface.canvas,
      },
      {
        name: `intent.${intent}.border on surface.raised`,
        kind: 'ui',
        foreground: (t) => t.intent[intent].border,
        background: (t) => t.surface.raised,
      },
      {
        // A solid fill is itself a "graphical object required to understand
        // content" when it is the only thing distinguishing a badge from the
        // page, so the fill must read against the canvas too.
        name: `intent.${intent}.solid on surface.canvas`,
        kind: 'ui',
        foreground: (t) => t.intent[intent].solid,
        background: (t) => t.surface.canvas,
      },
    );
  }

  return pairs;
}

export interface AuditResult {
  readonly theme: ThemeName;
  readonly pair: string;
  readonly kind: PairKind;
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly minimum: number;
  readonly passes: boolean;
}

export function auditTheme(theme: ThemeName): readonly AuditResult[] {
  const palette = colour[theme];
  const minima = themeMinimum[theme];
  return contrastContract().map((pair) => {
    const foreground = pair.foreground(palette);
    const background = pair.background(palette);
    const ratio = roundRatio(contrastRatio(foreground, background));
    const minimum = minima[pair.kind];
    return { theme, pair: pair.name, kind: pair.kind, foreground, background, ratio, minimum, passes: ratio >= minimum };
  });
}

export function auditAllThemes(): readonly AuditResult[] {
  return themeNames.flatMap((theme) => auditTheme(theme));
}

/** Formats failures for a test message or a CI log. */
export function formatFailures(results: readonly AuditResult[]): string {
  return results
    .filter((r) => !r.passes)
    .map(
      (r) =>
        `${r.theme}: ${r.pair} — ${r.foreground} on ${r.background} is ${r.ratio.toFixed(2)}:1, needs ${r.minimum}:1 (${r.kind})`,
    )
    .join('\n');
}
