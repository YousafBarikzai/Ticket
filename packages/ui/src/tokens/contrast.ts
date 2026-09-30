/**
 * Contrast mathematics and the contrast contract.
 *
 * WCAG 2.2 defines contrast as a ratio between the relative luminance of two
 * colours (SC 1.4.3 for text, SC 1.4.11 for user-interface components). This
 * file implements that formula and then declares, as data, every foreground /
 * background pairing the design system actually puts on screen. The audit test
 * walks the contract across all four themes, so a token can never be nudged
 * for looks without the build telling us what it broke.
 *
 * Glass gets a contract of its own, `materialContract()`: a translucent
 * surface has no single background colour, so its text is checked against the
 * surface composited over the worst things that could be behind it.
 */
import { colour, themeNames, type ColourTheme, type IntentName, type MaterialName, type ThemeName } from './tokens.js';

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Rgba extends Rgb {
  /** 0–1 */
  readonly a: number;
}

/** Accepts `#rgb`, `#rrggbb` and `rgb()/rgba()` with integer channels. Alpha is ignored; see `parseColourAlpha`. */
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

/**
 * `parseColour` with the alpha channel kept: 1 for a hex, the fourth argument
 * of an `rgba()`. Separate rather than a change to `parseColour`, whose
 * alpha-dropping behaviour everything written before glass relies on.
 */
export function parseColourAlpha(value: string): Rgba {
  const rgb = parseColour(value);
  const alpha = /^rgba?\(\s*\d+[\s,]+\d+[\s,]+\d+\s*[,/]\s*([\d.]+)(%?)\s*\)$/.exec(value.trim());
  if (!alpha) return { ...rgb, a: 1 };
  const a = Number(alpha[1]) / (alpha[2] === '%' ? 100 : 1);
  if (!(a >= 0 && a <= 1)) throw new Error(`alpha out of range: ${value}`);
  return { ...rgb, a };
}

function hex(channel: number): string {
  return Math.round(channel).toString(16).padStart(2, '0');
}

/**
 * The opaque colour a translucent `foreground` produces over an opaque
 * `background` (source-over, in sRGB as browsers blend), as `#rrggbb`.
 * Channels are rounded to integers, which is what the screen shows.
 */
export function composite(foreground: string, background: string): string {
  const top = parseColourAlpha(foreground);
  const bottom = parseColour(background);
  const blend = (over: number, under: number): number => top.a * over + (1 - top.a) * under;
  return `#${hex(blend(top.r, bottom.r))}${hex(blend(top.g, bottom.g))}${hex(blend(top.b, bottom.b))}`;
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
 * The high-contrast themes exist for people for whom the AA floor is not
 * enough, so we hold both of them to AAA (SC 1.4.6). Anything less and the
 * theme is decoration rather than an accommodation.
 */
const aaa: Readonly<Record<PairKind, number>> = { body: 7, large: 4.5, ui: 3 };

export const themeMinimum: Readonly<Record<ThemeName, Readonly<Record<PairKind, number>>>> = {
  apple: wcagMinimum,
  'apple-dark': wcagMinimum,
  'high-contrast': aaa,
  'high-contrast-dark': aaa,
};

export interface ContrastPair {
  /** Dotted token path, e.g. `text.muted on surface.raised`. */
  readonly name: string;
  readonly kind: PairKind;
  readonly foreground: (theme: ColourTheme) => string;
  readonly background: (theme: ColourTheme) => string;
}

type Pick = (theme: ColourTheme) => string;

const intents: readonly IntentName[] = ['brand', 'neutral', 'success', 'warning', 'danger', 'info'];

/** The text tokens ordinary copy is set in; each must read on every background it can land on. */
const readingText: readonly (readonly [string, Pick])[] = [
  ['text.primary', (t) => t.text.primary],
  ['text.secondary', (t) => t.text.secondary],
  ['text.muted', (t) => t.text.muted],
  ['text.link', (t) => t.text.link],
];

/** Backgrounds that ordinary text is ever placed on: the surfaces, and the three row states. */
const textBackgrounds: readonly (readonly [string, Pick])[] = [
  ['surface.canvas', (t) => t.surface.canvas],
  ['surface.raised', (t) => t.surface.raised],
  ['surface.sunken', (t) => t.surface.sunken],
  ['surface.overlay', (t) => t.surface.overlay],
  ['surface.hover', (t) => t.surface.hover],
  ['surface.selected', (t) => t.surface.selected],
  ['surface.accentHover', (t) => t.surface.accentHover],
];

/**
 * Every pairing the components actually produce: 128 per theme.
 *
 * Grouped by what puts them on screen. Reading text on every surface and row
 * state, because a row's metadata is muted and its title may be a link; the
 * accent on every surface a focus ring or selection bar can sit on; every
 * intent's own text on every surface, because a status reads in its colour
 * wherever it lands; and ordinary text on every intent's tint, because a
 * callout holds a sentence and a link, not only its title.
 *
 * Some tokens are deliberately absent, and the reasons are worth writing down:
 *
 * - `border.subtle` is a decorative divider between blocks of content. SC
 *   1.4.11 covers boundaries needed to *identify* a control; a rule between two
 *   table rows is not one, and holding it to 3:1 would make every list look
 *   like a spreadsheet. Control outlines use `border.interactive`, which is in
 *   the contract.
 * - `border.focus` is the accent in every theme (the test checks they are the
 *   same colour), so the accent's pairs cover it.
 * - `surface.*` against each other are not text pairs and carry no requirement.
 * - The translucent `fill.*` tokens are never under audited text; the one fill
 *   that is — the portal's own-message bubble — is the opaque `surface.bubble`.
 *
 * `text.disabled` *is* exempt under SC 1.4.3 ("inactive user interface
 * component"), but we still hold it to the 3:1 UI floor: an unavailable action
 * must remain readable enough to explain why it is unavailable.
 */
export function contrastContract(): readonly ContrastPair[] {
  const pairs: ContrastPair[] = [];
  const add = (name: string, kind: PairKind, foreground: Pick, background: Pick): void => {
    pairs.push({ name, kind, foreground, background });
  };

  for (const [bgName, background] of textBackgrounds) {
    for (const [fgName, foreground] of readingText) add(`${fgName} on ${bgName}`, 'body', foreground, background);
  }
  // A text selection keeps its text colour; only primary is ever selected in
  // bulk (the base layer sets it on `::selection`).
  add('text.primary on surface.selection', 'body', (t) => t.text.primary, (t) => t.surface.selection);
  add('text.disabled on surface.canvas', 'ui', (t) => t.text.disabled, (t) => t.surface.canvas);
  add('text.disabled on surface.raised', 'ui', (t) => t.text.disabled, (t) => t.surface.raised);
  add('text.inverse on surface.inverse', 'body', (t) => t.text.inverse, (t) => t.surface.inverse);

  for (const [bgName, background] of textBackgrounds.slice(0, 4)) {
    add(`border.interactive on ${bgName}`, 'ui', (t) => t.border.interactive, background);
  }
  add('border.strong on surface.raised', 'ui', (t) => t.border.strong, (t) => t.surface.raised);

  // Focus rings, selection bars, switches and checkboxes: wherever a control
  // can be, including a hovered or selected row.
  for (const [bgName, background] of textBackgrounds.slice(0, 6)) add(`accent on ${bgName}`, 'ui', (t) => t.accent, background);
  // The label of a tinted button inside a selected row.
  add('intent.brand.subtleText on surface.selected', 'body', (t) => t.intent.brand.subtleText, (t) => t.surface.selected);

  for (const intent of intents) {
    const slot = (key: keyof ColourTheme['intent'][IntentName]): Pick => (t) => t.intent[intent][key];
    const prefix = `intent.${intent}`;
    add(`${prefix}.solidText on ${prefix}.solid`, 'body', slot('solidText'), slot('solid'));
    add(`${prefix}.solidText on ${prefix}.solidHover`, 'body', slot('solidText'), slot('solidHover'));
    add(`${prefix}.subtleText on ${prefix}.subtle`, 'body', slot('subtleText'), slot('subtle'));
    add(`text.primary on ${prefix}.subtle`, 'body', (t) => t.text.primary, slot('subtle'));
    add(`text.muted on ${prefix}.subtle`, 'body', (t) => t.text.muted, slot('subtle'));
    add(`text.link on ${prefix}.subtle`, 'body', (t) => t.text.link, slot('subtle'));
    for (const [bgName, background] of [textBackgrounds[1]!, textBackgrounds[0]!, textBackgrounds[2]!, textBackgrounds[3]!]) {
      add(`${prefix}.subtleText on ${bgName}`, 'body', slot('subtleText'), background);
    }
    for (const [bgName, background] of textBackgrounds.slice(0, 2)) {
      add(`${prefix}.border on ${bgName}`, 'ui', slot('border'), background);
    }
    // A solid fill is itself a "graphical object required to understand
    // content" when it is the only thing distinguishing a badge from the
    // page, so the fill must read against the surfaces too.
    for (const [bgName, background] of textBackgrounds.slice(0, 2)) {
      add(`${prefix}.solid on ${bgName}`, 'ui', slot('solid'), background);
    }
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

/* -------------------------------------------------------------------------
 * Materials
 * ---------------------------------------------------------------------- */

/**
 * What can be behind glass, at worst: black, white, and the most saturated
 * fills the product draws — the filled-button blue, the danger red, the dark
 * theme's amber and green, the light theme's orange. Blur is ignored, which
 * only makes the check stricter: blurring averages a backdrop towards its
 * surroundings, never away from them.
 */
export const materialBackdrops: readonly string[] = ['#000000', '#ffffff', '#0071e3', '#d70015', '#ff9f0a', '#30d158', '#b25000'];

/**
 * The tokens allowed on each material. On chrome — the portal's bars and the
 * compact top bar — text is primary or secondary only, and the current item
 * sits on an opaque pill; a popover carries the full range of a menu.
 */
const materialForegrounds: Readonly<Record<MaterialName, readonly (readonly [string, PairKind, Pick])[]>> = {
  chrome: [
    ['text.primary', 'body', (t) => t.text.primary],
    ['text.secondary', 'body', (t) => t.text.secondary],
    ['accent', 'ui', (t) => t.accent],
  ],
  popover: [
    ['text.primary', 'body', (t) => t.text.primary],
    ['text.secondary', 'body', (t) => t.text.secondary],
    ['text.muted', 'body', (t) => t.text.muted],
    ['text.link', 'body', (t) => t.text.link],
    ['intent.danger.subtleText', 'body', (t) => t.intent.danger.subtleText],
    ['border.interactive', 'ui', (t) => t.border.interactive],
    ['accent', 'ui', (t) => t.accent],
  ],
};

export interface MaterialAuditResult {
  readonly theme: ThemeName;
  readonly material: MaterialName;
  /** The material's own tint and alpha. */
  readonly background: string;
  readonly alpha: number;
  readonly token: string;
  readonly kind: PairKind;
  readonly foreground: string;
  /** The ratio over the worst backdrop, and which backdrop that was. */
  readonly ratio: number;
  readonly worstBackdrop: string;
  readonly minimum: number;
  readonly passes: boolean;
}

/**
 * Every token allowed on a material, against that material composited over
 * each backdrop, keeping the worst. A theme with no glass (both high-contrast
 * themes) has an opaque material, so the composite is the material itself and
 * the check reduces to an ordinary pair at that theme's minimum.
 */
export function materialContract(themes: readonly ThemeName[] = themeNames): readonly MaterialAuditResult[] {
  const results: MaterialAuditResult[] = [];
  for (const theme of themes) {
    const palette = colour[theme];
    for (const material of Object.keys(materialForegrounds) as MaterialName[]) {
      const background = palette.material[material].background;
      const composites = materialBackdrops.map((backdrop) => [backdrop, composite(background, backdrop)] as const);
      for (const [token, kind, pick] of materialForegrounds[material]) {
        const foreground = pick(palette);
        let ratio = Number.POSITIVE_INFINITY;
        let worstBackdrop = materialBackdrops[0]!;
        for (const [backdrop, surface] of composites) {
          const r = roundRatio(contrastRatio(foreground, surface));
          if (r < ratio) {
            ratio = r;
            worstBackdrop = backdrop;
          }
        }
        const minimum = themeMinimum[theme][kind];
        results.push({
          theme,
          material,
          background,
          alpha: parseColourAlpha(background).a,
          token,
          kind,
          foreground,
          ratio,
          worstBackdrop,
          minimum,
          passes: ratio >= minimum,
        });
      }
    }
  }
  return results;
}
