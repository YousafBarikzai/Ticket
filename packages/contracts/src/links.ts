/**
 * `@itsm/contracts/links` — which links a person may be shown (D23, §4.7.5).
 *
 * Links authored inside the product — knowledge articles, form instructions,
 * the status page's support link, a major incident's bridge link, contract
 * links — are rendered for other people, so an author who can type
 * `javascript:` into one can run script in every reader's session. The status
 * page's support link is the sharp case: the API renders that page from a
 * string template, which React does not protect. The rule is therefore an
 * allow-list, applied for every tenant (not only the demo): `https:` and
 * `mailto:`, nothing else.
 *
 * Zod-free, because the renderer (`RichText`) checks stored links before it
 * draws an anchor and runs in the browser. The schema form for the API lives
 * in `links-schemas.ts` (`@itsm/contracts/links/schemas`).
 */

export const SAFE_LINK_PROTOCOLS = Object.freeze(['https:', 'mailto:'] as const);
export type SafeLinkProtocol = (typeof SAFE_LINK_PROTOCOLS)[number];

/** Longer than any honest link; a bound keeps a stored document from carrying a payload in one. */
export const MAX_SAFE_HREF_LENGTH = 2048;

/** The field error an author sees for a refused link. */
export const UNSAFE_LINK_MESSAGE = 'Links must start with https:// or mailto:';

// Whitespace and control characters anywhere are refused rather than trimmed:
// browsers strip some of them while parsing (`java\tscript:` runs), so a
// string that contains one does not mean what it appears to mean.
const WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u2060\ufeff]/;

/**
 * True for an absolute `https:` or `mailto:` link that is safe to render.
 *
 * Refused: anything relative or protocol-relative (`/x`, `//evil.example`),
 * every other scheme in any case (`javascript:`, `data:`, `vbscript:`,
 * `http:`), whitespace or control characters anywhere, `https:` without its
 * `//` (a browser resolves `https:foo` against the current page), a user name
 * or password before the host (`https://bank.example@evil.example` reads as
 * the bank to a person), and more than 2,048 characters.
 */
export function isSafeHref(href: unknown): href is string {
  if (typeof href !== 'string' || href.length === 0 || href.length > MAX_SAFE_HREF_LENGTH) return false;
  if (WHITESPACE_OR_CONTROL.test(href)) return false;
  let url: URL;
  try {
    // No base: a relative or protocol-relative string does not parse at all.
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') {
    return /^https:\/\//i.test(href) && url.hostname.length > 0 && url.username === '' && url.password === '';
  }
  if (url.protocol === 'mailto:') {
    return /^mailto:/i.test(href) && url.pathname.length > 0;
  }
  return false;
}

export interface UnsafeLink {
  /** Dotted path from the value's root, e.g. `2.content.0.href`; field errors read `body.<path>`. */
  readonly path: string;
  /** The same path as segments, for a schema issue's `path`. */
  readonly segments: readonly (string | number)[];
  /** The refused value, as text. */
  readonly href: string;
}

/**
 * Every `href` in a JSON value that `isSafeHref` refuses: rich-text blocks,
 * form elements, anything else that stores links as `{ href }`. Walks with an
 * explicit stack, so a deeply nested document cannot overflow the call stack
 * of the request that validates it.
 */
export function findUnsafeLinks(value: unknown): UnsafeLink[] {
  // Each visit points at its parent instead of copying its path, so a deeply
  // nested document costs memory in proportion to its size, not its size
  // times its depth.
  interface Visit {
    readonly node: unknown;
    readonly key: string | number | null;
    readonly parent: Visit | null;
  }
  const segmentsOf = (visit: Visit): (string | number)[] => {
    const segments: (string | number)[] = [];
    for (let at: Visit | null = visit; at !== null && at.key !== null; at = at.parent) segments.push(at.key);
    return segments.reverse();
  };
  const found: UnsafeLink[] = [];
  const seen = new Set<object>();
  const stack: Visit[] = [{ node: value, key: null, parent: null }];
  while (stack.length > 0) {
    const visit = stack.pop()!;
    const { node } = visit;
    if (visit.key === 'href') {
      if (node !== undefined && !isSafeHref(node)) {
        const segments = segmentsOf(visit);
        found.push({ path: segments.join('.'), segments, href: describe(node) });
      }
      continue;
    }
    if (node === null || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    // Children are pushed last-first, so they are visited in document order and
    // the first error an author sees is the first link they wrote.
    const children: [string | number, unknown][] = Array.isArray(node)
      ? node.map((child, index): [number, unknown] => [index, child])
      : Object.entries(node as Record<string, unknown>);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const [key, child] = children[index]!;
      stack.push({ node: child, key, parent: visit });
    }
  }
  return found;
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
