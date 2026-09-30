/**
 * `@itsm/ui/styles` — the design system's stylesheet, as a string.
 *
 * Server-safe on purpose: no hooks, no DOM, no `'use client'`. A server
 * component calls `uiStylesheet()` to put the sheet into the document head
 * during server rendering, which is the difference between a first paint and a
 * flash of unstyled content; a function exported from a client module could
 * only be passed around there, never called.
 *
 * Every declaration resolves to a token variable, so a theme or density change
 * needs no edit here. Layout uses logical properties (`inline`/`block`,
 * `start`/`end`) so right-to-left locales mirror without a second sheet.
 */
import { renderTokenStylesheet } from '../tokens/css.js';
import { layer, layerOrderStatement } from './css.js';
import { styleRegistry } from './registry.js';

// The `css` tag, `layer()`, `mq` and the registry stay internal: they are how
// this package writes its sheet, and an application writing `itsm-` rules with
// them would be the thing the `app-` prefix exists to prevent.

/** Every registered module's rules, in registry order: everything except the tokens. */
export const componentStylesheet: string = styleRegistry
  .map((entry) => entry.css)
  .filter((rules) => rules !== '')
  .join('\n');

/**
 * The layer order first, then the tokens, then the components.
 *
 * The token variables go into their own layer here rather than in
 * `renderTokenStylesheet()`, which stays a plain rendering of the tokens that
 * other callers and tests read as it is.
 */
const stylesheet = `${layerOrderStatement}\n\n${layer('tokens', renderTokenStylesheet())}\n${componentStylesheet}`;

/**
 * The whole stylesheet. Built once per process: it depends on nothing but the
 * tokens and the modules, which cannot change while it runs.
 */
export function uiStylesheet(): string {
  return stylesheet;
}

/**
 * 32-bit FNV-1a over the UTF-16 code units, as eight hex digits. Not a
 * security measure — a cache key, so a stylesheet URL changes whenever a byte
 * of the sheet does and an immutable cache can never serve a stale copy.
 */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** A short digest of `uiStylesheet()`, for a cache-busting `?v=` on the stylesheet URL. */
export const uiStylesheetVersion: string = fnv1a(stylesheet);
