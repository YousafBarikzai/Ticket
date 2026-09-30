/**
 * The tools every `*.styles.ts` module is written with: the `css` tag, the
 * cascade layers and the media-query helpers.
 *
 * Styles stay TypeScript strings rather than `.css` files. The stylesheet is
 * served whole from one cached route and inlined on the offline page, both of
 * which need it as a value on the server; a string needs no loader, no
 * bundler rule and nothing Next has to understand. What this file adds is the
 * discipline a `.css` file would have had from tooling: a layer per module and
 * a check on the variables it spends.
 */
import { structuralVariables, themeVariables } from '../tokens/css.js';
import { breakpoint, themeNames, type BreakpointToken } from '../tokens/tokens.js';

/* -------------------------------------------------------------------------
 * Cascade layers
 * ---------------------------------------------------------------------- */

/**
 * The layers, lowest priority first.
 *
 * The order is the whole point of having them. A rule in a later layer beats a
 * rule in an earlier one whatever the two selectors' specificity, so a
 * component never has to out-specify the base layer and a utility never has
 * to reach for `!important`. An application's own stylesheet is unlayered, and
 * unlayered rules beat every layer: an app can adjust a design-system
 * component with a plain class selector, and cannot lose to one by accident of
 * specificity or of which `<style>` element happened to load last.
 */
export const layerNames = ['reset', 'tokens', 'base', 'components', 'patterns', 'utilities'] as const;
export type LayerName = (typeof layerNames)[number];

/**
 * Declares the layer order. It has to be the first thing in the stylesheet:
 * layers are otherwise ordered by first appearance, and one module registered
 * out of place would silently reorder the cascade.
 */
export const layerOrderStatement = `@layer ${layerNames.map((name) => `itsm.${name}`).join(', ')};`;

/**
 * Wraps a module's rules in its layer. Every style module's export goes
 * through this. A module with no rules yet — a component registered ahead of
 * the styles it will have — renders as nothing rather than as an empty block.
 */
export function layer(name: LayerName, body: string): string {
  const rules = body.trim();
  return rules === '' ? '' : `@layer itsm.${name} {\n${rules}\n}\n`;
}

/* -------------------------------------------------------------------------
 * The css tag
 * ---------------------------------------------------------------------- */

let emitted: ReadonlySet<string> | undefined;

/** Every custom property the token pipeline emits, across every theme. Built once, on first use. */
function emittedVariables(): ReadonlySet<string> {
  emitted ??= new Set([
    ...Object.keys(structuralVariables()),
    ...themeNames.flatMap((theme) => Object.keys(themeVariables(theme))),
  ]);
  return emitted;
}

/**
 * The `--itsm-*` names a piece of CSS reads through `var()` that the token
 * pipeline does not emit, fallbacks ignored. Empty when the CSS is sound.
 *
 * The same check `stylesheet-vars.test.ts` makes over the whole sheet. It
 * lives here as well so that the `css` tag can make it while a module is being
 * written, not only when the tests next run.
 */
export function unknownVariables(text: string): string[] {
  const known = emittedVariables();
  const found = new Set<string>();
  for (const match of text.matchAll(/var\(\s*(--itsm-[a-zA-Z0-9-]+)/g)) {
    const name = match[1]!;
    if (!known.has(name)) found.add(name);
  }
  return [...found].sort();
}

/** Spelled `process.env.NODE_ENV` exactly, which is the form bundlers replace at build time. */
function isDevelopment(): boolean {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'development';
}

/**
 * The template tag style modules are written with. It returns the text as
 * written — interpolations are the `mq` helpers and nothing else.
 *
 * In development it throws on a variable the pipeline does not emit. A
 * misspelled custom property is the one stylesheet mistake with no symptom:
 * the declaration is dropped, the element keeps whatever it inherited, and the
 * hover state that was meant to lift simply does not. Throwing turns that into
 * an error on the first page load after the typo. Production and tests skip
 * it — production because the sheet is already built and checked, tests
 * because `stylesheet-vars.test.ts` makes the same check and names the module.
 */
export function css(strings: TemplateStringsArray, ...values: readonly (string | number)[]): string {
  let text = strings[0] ?? '';
  for (let index = 0; index < values.length; index++) text += String(values[index]) + (strings[index + 1] ?? '');
  if (isDevelopment()) {
    const unknown = unknownVariables(text);
    if (unknown.length > 0) {
      throw new Error(`@itsm/ui: a style module reads custom properties the tokens do not emit: ${unknown.join(', ')}`);
    }
  }
  return text;
}

/* -------------------------------------------------------------------------
 * Media queries
 * ---------------------------------------------------------------------- */

/** rem rather than px, so a person who has raised their browser's default text size gets the narrower layout sooner. */
function rem(px: number): string {
  return `${Number((px / 16).toFixed(4))}rem`;
}

type Up = { readonly [K in BreakpointToken]: string };
type Below = { readonly [K in BreakpointToken as `below${Capitalize<K>}`]: string };

function up(token: BreakpointToken): string {
  return `@media (min-width: ${rem(breakpoint[token])})`;
}

/** One pixel under the breakpoint, so `below…` and the matching `up` never both apply. */
function below(token: BreakpointToken): string {
  return `@media (max-width: ${rem(breakpoint[token] - 1)})`;
}

/**
 * Media queries from the breakpoint tokens, interpolated into modules as
 * `${mq.md} { … }` so the numbers have one source.
 *
 * `mq.md` and the other bare names are mobile-first `min-width` queries, which
 * is how new rules should be written. `mq.belowMd` and friends exist because
 * the existing components were written desktop-first, and a module that moves
 * its rules across keeps their meaning. Components should prefer container
 * queries (§3.3 of the redesign spec); only the shell adapts to the viewport.
 */
interface Conditions {
  readonly reducedMotion: string;
  readonly reducedTransparency: string;
  /** A touch screen: the pointer the larger density sizes are for. */
  readonly coarse: string;
  /**
   * A pointer that can hover. A hover rule that moves something (a card's
   * lift) goes inside it: a touch screen applies `:hover` on tap and keeps it
   * until the next tap elsewhere, so a card tapped and returned to stays
   * raised. Colour-only hover feedback does not need it.
   */
  readonly hover: string;
  readonly forcedColors: string;
}

export const mq: Up & Below & Conditions = {
  sm: up('sm'),
  md: up('md'),
  lg: up('lg'),
  xl: up('xl'),
  '2xl': up('2xl'),
  belowSm: below('sm'),
  belowMd: below('md'),
  belowLg: below('lg'),
  belowXl: below('xl'),
  below2xl: below('2xl'),
  reducedMotion: '@media (prefers-reduced-motion: reduce)',
  reducedTransparency: '@media (prefers-reduced-transparency: reduce)',
  coarse: '@media (pointer: coarse)',
  hover: '@media (hover: hover)',
  forcedColors: '@media (forced-colors: active)',
};

/**
 * The person's own choices, as selector prefixes, for the few rules the token
 * layer cannot express as a variable. `${prefers.reducedMotion} .itsm-X` pairs
 * with `${mq.reducedMotion} { .itsm-X … }`: one answers the product's setting,
 * the other the operating system's, and a rule that wants both writes both.
 */
export const prefers = {
  reducedMotion: ':root[data-itsm-motion="reduced"]',
  reducedTransparency: ':root[data-itsm-transparency="reduced"]',
} as const;
