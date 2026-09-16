import axe, { type AxeResults, type Result, type RunOptions } from 'axe-core';

/**
 * axe-core, against the components these tests already render.
 *
 * The design system has had accessibility tests since Phase 1, and they are
 * good ones: focus order, key handling, ARIA wiring, all read straight off the
 * DOM. What they cannot do is notice the failure nobody thought to write a test
 * for — a button whose only label is an icon, a control pointing `aria-labelledby`
 * at an id that no longer exists, a listbox whose options are not its children.
 * Those are exactly the mistakes a rule engine finds for free, and exactly the
 * ones that survive review because the component looks right on screen.
 *
 * So this is not a replacement for the hand-written assertions. It is a second
 * reader that has memorised WCAG and does not get tired.
 *
 * ## What axe cannot see here, and what covers it instead
 *
 * jsdom has no layout engine: nothing has a position, a size or a computed
 * colour, so every rule that depends on rendering is either skipped by axe or —
 * worse — answered from defaults that are not what a browser would compute.
 * Being explicit about which rules those are is the difference between a
 * check that is honest about its reach and one that quietly passes.
 *
 *   - **`color-contrast`** needs real colours. It is disabled here and covered
 *     properly by `tokens/__tests__/contrast.test.ts`, which computes the
 *     ratios from the token values themselves — a better test than axe could
 *     run in a browser, because it checks every pairing rather than the ones a
 *     fixture happens to render.
 *   - **Page-level rules** — `region`, `page-has-heading-one`, `html-has-lang`,
 *     `landmark-one-main`, `bypass`, `document-title` — ask questions about a
 *     whole document. These fixtures render one component into a bare `<div>`,
 *     where the honest answer to "is all content inside a landmark" is "this is
 *     not a page". They belong in an application's own tests, and doc 23
 *     records that there is no full-page audit yet.
 *
 * Everything else runs: names and roles, ARIA attribute validity, ARIA
 * parent/child relationships, form labelling, duplicate ids, list structure,
 * heading order, `tabindex` misuse. That is the majority of what goes wrong in
 * a component library.
 */

/** Rules that ask a question a detached fragment cannot answer. */
const PAGE_LEVEL = [
  'region',
  'page-has-heading-one',
  'html-has-lang',
  'landmark-one-main',
  'bypass',
  'document-title',
  'html-lang-valid',
] as const;

/** Rules that need a layout engine jsdom does not have. */
const NEEDS_LAYOUT = ['color-contrast', 'color-contrast-enhanced', 'target-size', 'scrollable-region-focusable'] as const;

const DISABLED = Object.fromEntries(
  [...PAGE_LEVEL, ...NEEDS_LAYOUT].map((rule) => [rule, { enabled: false }]),
);

const OPTIONS: RunOptions = {
  rules: DISABLED,
  // WCAG 2.2 AA, which is what doc 14 §4 commits this product to, plus axe's
  // own best-practice rules for the ARIA mistakes that are wrong without being
  // a numbered success criterion.
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  resultTypes: ['violations'],
};

/** One violation, rendered so a failing test says what to fix and where. */
function describeViolation(violation: Result): string {
  const where = violation.nodes
    .slice(0, 3)
    .map((node) => `      ${node.html}`)
    .join('\n');
  return [
    `  ${violation.id} (${violation.impact ?? 'unknown impact'}): ${violation.help}`,
    `    ${violation.helpUrl}`,
    where,
  ].join('\n');
}

export async function auditResults(element: Element = document.body): Promise<AxeResults> {
  // `axe.run` is typed for a browser; the cast is the seam between its DOM
  // types and jsdom's, which are structurally the same and nominally not.
  return axe.run(element as never, OPTIONS);
}

/**
 * Fails the test with every violation named, not just the first.
 *
 * Reporting all of them matters more than it looks: accessibility failures come
 * in families — one missing `id` breaks a label, a description and a
 * `aria-activedescendant` at once — and fixing them one test run at a time
 * turns a single mistake into four cycles.
 */
export async function expectNoViolations(element: Element = document.body): Promise<void> {
  const { violations } = await auditResults(element);
  if (violations.length === 0) return;

  throw new Error(
    [`axe found ${violations.length} accessibility violation${violations.length === 1 ? '' : 's'}:`, ...violations.map(describeViolation)].join(
      '\n',
    ),
  );
}
