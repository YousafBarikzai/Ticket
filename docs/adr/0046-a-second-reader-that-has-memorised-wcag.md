# ADR-0046 · A second reader that has memorised WCAG

**Status:** Accepted 2026-09-15 · **Date:** 2026-09 · **Specification reference:** MOD-16-E1, doc 14 §4, doc 18

## Context

`@itsm/ui` has had accessibility tests since Phase 1 and they are good ones:
focus order, roving tabindex, key handling, live-region politeness, ARIA
wiring, all read straight off the DOM by a hand-rolled harness. Doc 14 §4
commits the product to WCAG 2.2 AA.

What those tests cannot do is notice the failure nobody thought to write a test
for. An icon-only control with no accessible name. An `aria-labelledby`
pointing at an id a refactor removed. A listbox whose options are not its
children. Two elements sharing an id after a re-render. Each of those renders
perfectly on screen, which is why they survive review, and each is a rule an
engine checks for free.

The gap is not rigour. It is that a hand-written test asserts what its author
was thinking about.

## Decision

**axe-core runs over the components in the package's existing jsdom tests.**
`expectNoViolations(element)` in the same support directory as `render`, used by
a new suite that renders every exported component the way an application
actually uses it — including the awkward states a fixture usually skips: a field
in error, a table that sorts, a dialog that is open, a combobox with its list
down — and added to the two existing component tests.

**Two families of rule are disabled, by name and with a reason.**

- **Rules needing a layout engine** (`color-contrast`,
  `color-contrast-enhanced`, `target-size`, `scrollable-region-focusable`).
  jsdom has no rendering, so nothing has a colour, a size or a position.
- **Page-level rules** (`region`, `page-has-heading-one`, `html-has-lang`,
  `landmark-one-main`, `bypass`, `document-title`, `html-lang-valid`). These
  ask questions about a whole document; the fixtures render one component into
  a bare `<div>`, where "is all content inside a landmark" has no honest answer.

**Every violation is reported, not just the first**, with the rule id, the
impact, the Deque URL and the offending markup.

**The audit is asserted to work.** Two tests render markup that is definitely
wrong and check the audit rejects it. Without them, every other test in the
file would pass just as happily against an audit that never looked.

## Consequences

**It found two things on its first run**, which is the argument for having it.

The first is a component defect and is fixed here: `AiSuggestionCard` rendered
as `<section aria-label=…>`. A named `section` is a `region` landmark, so a
ticket showing three suggestions had three landmarks with identical names —
ambiguous to anyone navigating by landmark, and clutter in a list, since
landmark navigation is for finding the significant parts of a page. It is now
an `<article>`: what a self-contained composition actually is, keeps the
accessible name, and is not a landmark.

The second is a hole the type system cannot close. `Combobox` can be named
three ways — an `id` matched by a `<label for>` (what `FormField` does, and
what the only production caller uses), an `aria-label`, or an
`aria-labelledby` — and all three props are optional, so a combobox with none
of them compiles, renders and has no accessible name. `IconButton` in the same
package makes that impossible by requiring its `label`; `Combobox` cannot,
because an `id` only makes a label *possible* rather than guaranteeing one
exists. No shipped caller is affected. The audit is the enforcement instead, and
a test asserts it catches the nameless case — otherwise that claim would be
hopeful rather than true.

**Colour contrast is not weakened by being disabled here.**
`tokens/__tests__/contrast.test.ts` computes the ratios from the token values
themselves, which is a stronger test than axe could run even in a browser: it
checks every pairing rather than the ones a fixture happens to render.

**There is still no full-page audit.** These fixtures are components, so nothing
checks heading order across a real page, landmark structure, or whether the
skip link works — the things that only exist once components are composed into
a screen. That belongs to the applications and to a browser, alongside the
Lighthouse run doc 14 §5 asks for and that also does not exist. Doc 23 carries
both; this ADR does not pretend to close them.

**A disabled rule is a decision that needs revisiting when the runner
changes.** The two lists are the complete record of what this check does not
look at. If these tests ever run in a real browser, most of both lists should be
deleted rather than carried over.

## Alternatives considered

**`jest-axe` / `vitest-axe`.** A matcher wrapper around the same engine.
Rejected for a package that deliberately hand-rolled its render harness rather
than take `@testing-library/react`: the wrapper adds a dependency and a matcher,
and what was actually needed was twenty lines of formatting and an explicit list
of disabled rules. A wrapper would also have hidden that list behind its own
defaults, which is the one thing worth being loud about.

**Run axe in a real browser via Playwright.** Everything works, including
contrast and target size. Rejected *for now*, not on principle: it is a second
test runner, a browser in CI and a slower suite, to cover rules that are either
already covered better (contrast, from the tokens) or that only matter once
components are composed into pages — which is the full-page audit that is
genuinely missing and belongs to the applications. Worth doing there; not worth
duplicating here.

**Assert on `incomplete` results as well as violations.** axe returns rules it
could not decide, and in jsdom that list is long and mostly layout. Rejected:
a check that fails on "could not determine" trains people to disable it.
