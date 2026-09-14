# `@itsm/ui` — design system

One design language for six experiences: the requester portal, the agent
workbench, the admin console, the two PWAs and the mobile app. Implements
epic **MOD-16-E1** and the decision recorded in
[ADR-0005](../../docs/adr/0005-design-system-shared-tokens.md); the surrounding
architecture is §2 of
[14 · Experience architecture](../../docs/architecture/14-experience-architecture.md).

```
src/
  tokens/   colour, type, spacing, radius, elevation, motion — defined once
  a11y/     focus trap, roving tabindex, live-region announcer, id helpers
  web/      React components for the Next.js apps
  forms/    FormRenderer: one renderer for catalogue forms, everywhere
```

## The token pipeline

`tokens/tokens.ts` is the source of truth and the only file in the repository
that contains a hex code, a font size or an animation duration. Everything else
derives from it:

```
                 tokens.ts  (plain TypeScript data)
                     │
      ┌──────────────┼───────────────┐
      ▼              ▼               ▼
   css.ts        native.ts       contrast.ts
 CSS custom     React Native      the audit
 properties     theme object      (a test, not a doc)
```

- **`css.ts`** renders the tokens as `--itsm-*` custom properties for three
  themes: light, dark and high contrast. A theme is selected by
  `data-itsm-theme` on any ancestor, which lets an admin preview pane render one
  theme inside another. With no attribute the operating system decides, through
  `prefers-color-scheme` and `prefers-contrast`.
- **`native.ts`** projects the same values into the shapes React Native wants:
  absolute line heights in points, letter spacing in points, weights as strings,
  and shadows split into the iOS `shadow*` props and Android's `elevation`. It
  declares its own structural types rather than importing `react-native`, so the
  package typechecks in CI without the Expo toolchain.
- **`contrast.ts`** implements the WCAG 2.2 relative-luminance and contrast-ratio
  formulas and declares the *contrast contract*: every foreground/background
  pairing the components actually produce, tagged with the minimum that applies
  to it (4.5:1 body text, 3:1 large text and interface boundaries).
  `__tests__/contrast.test.ts` walks the contract across all three themes — 192
  assertions today. The high-contrast theme is held to AAA (7:1), because a
  theme that only reaches the AA floor is decoration rather than an
  accommodation.

Two tokens are deliberately outside the contract, and the reasons are in the
code next to them: `border.subtle` is a decorative divider (SC 1.4.11 covers
boundaries needed to identify a control, not rules between rows), and
`text.disabled` is exempt under SC 1.4.3 — we hold it to the 3:1 UI floor
anyway, so an unavailable action stays readable.

If a token fails the audit, darken the token. Never loosen the test.

**Sizes are numbers.** Spacing and type are stored in CSS pixels and rendered as
`rem` on the web (so browser zoom and the user's own font size work) and as
points on native. Storing `"16px"` would make one of the two platforms wrong.

**Motion is answered at the token layer.** Under
`prefers-reduced-motion: reduce` the stylesheet collapses every duration
variable to `1ms`, so components that transition with
`var(--itsm-duration-fast)` respect the preference whether or not their author
thought about it. Components that animate in JavaScript use `useReducedMotion`.

### Using the tokens

```tsx
import { ThemeProvider, uiStylesheet } from '@itsm/ui';

// Runtime injection (Storybook, tests, client-only apps):
<ThemeProvider defaultTheme="system">{children}</ThemeProvider>

// Or emit the stylesheet at build time to avoid a flash of unstyled content:
<style dangerouslySetInnerHTML={{ __html: uiStylesheet() }} />
<ThemeProvider injectStyles={false}>{children}</ThemeProvider>
```

## The web / native split

ADR-0005 chose two implementations over one cross-platform kit, because the
workbench and the admin console live or die on web-native components — tables,
a command palette, rich editors — that a lowest-common-denominator kit renders
badly. The trade is duplicated work (risk AR-11), and it is contained by
single-sourcing the two things where drift actually hurts:

| Shared | Duplicated |
|---|---|
| Tokens (`tokens/`) | Component rendering |
| Form definitions and their conditions (`forms/logic.ts`) | Platform gestures and layout |
| Props and accessibility contracts | — |

`src/web` is React for the Next.js apps. The native component set is built
against the same props and the same `logic.ts`, prioritised by the mobile
journeys rather than implemented wholesale — a native `Table` would be a
pretence.

The web components depend on `react` and `react-dom` and nothing else. No
Radix, no shadcn, no Tailwind, no class-name library: a `cx` helper is three
lines, and the portal's 250 kB initial-JS budget is real. Components are styled
by one stylesheet (`web/stylesheet.ts`) in which every colour, space, type,
radius, shadow and duration is a token variable — only a component's own fixed
geometry (the diameter of a radio, the width of a switch) is stated there
directly. A stylesheet rather than inline styles, because `:hover`, `:focus-visible`, `::placeholder` and
`@media` cannot be expressed as inline styles — and focus rings and reduced
motion depend on exactly those. Layout uses logical properties, so Arabic and
Hebrew mirror without a second stylesheet.

## How a component earns its place

A component belongs in this package when it is used in at least two of the
applications, when its behaviour is worth getting right once, and when it can
answer all of the following. If it is a one-off arrangement of existing
components, it belongs in the application.

1. **It is operable by keyboard alone.** Every action reachable with Tab and the
   arrow keys, one tab stop per composite widget (`useRovingTabIndex`), and
   nothing that only works with a pointer.
2. **It manages focus honestly.** Overlays trap focus and give it back
   (`useFocusTrap`); a control that becomes busy does not vanish from the tab
   order underneath the user's fingers; a skip link exists for anything that
   repeats on every page.
3. **It has a correct name, role and value.** `IconButton` takes `label` as a
   required prop for exactly this reason: the type system asks for the
   accessible name rather than a linter mentioning it later.
4. **It says what changed.** Anything that happens away from the user's focus —
   a toast, a result count, a saved draft — is announced through
   `a11y/announcer.ts`.
5. **It respects `prefers-reduced-motion`**, through the duration variables or
   `useReducedMotion`.
6. **It carries no colour-only meaning.** Every status has a label or an icon as
   well as a hue (SC 1.4.1), and every pairing it introduces is added to the
   contrast contract.
7. **It uses tokens, not literals.** Colour, spacing, type, radius, elevation
   and motion always come from tokens. A component's own fixed geometry is
   allowed, once, in the stylesheet — never a hex code, and never a duration.
8. **Its behaviour is tested, not its markup.** The tests in this package assert
   focus order, key handling and ARIA wiring — the things that break silently.

### Current set

Actions: `Button`, `IconButton` · Inputs: `Input`, `Textarea`, `Select`,
`Combobox`, `DatePicker`, `Checkbox`, `RadioGroup`, `Switch`, `FormField` ·
Display: `Badge`, `Avatar`, `Card`, `Table`, `Skeleton`, `EmptyState`,
`Timeline` · Navigation and overlays: `Tabs`, `Dialog`, `Toast`, `Tooltip`,
`CommandPalette`, `AppShell` · Plus `ThemeProvider` and `VisuallyHidden`.

Some choices are deliberate and worth knowing before you "fix" them:

- **`Select` is a native `<select>`.** It gets the platform's type-ahead, screen
  reader behaviour and mobile picker for free. Search, multiple selection or
  asynchronous options mean you want `Combobox`, which is a different control,
  not a styling preference.
- **`Dialog` is not the native `<dialog>` element.** `showModal()` cannot be
  driven from React state without the DOM and the virtual DOM disagreeing about
  whether the dialog is open. What the element would have given us — trap,
  Escape, inert background — is implemented and tested here instead.
- **`RadioGroup` is built from `div[role="radio"]`**, not native inputs, because
  native radios cannot carry a per-option description or skip disabled options
  the way the APG requires. The debt that creates — real keyboard support — is
  paid by `useRovingTabIndex` and proved by `__tests__/roving-tabindex.test.ts`.

## `FormRenderer`

One renderer for catalogue forms in the portal, the mobile app, the admin
preview and (after a server-side transformation to Block Kit and Adaptive Cards)
the Slack and Teams modals.

A form definition is a JSON Schema for the data plus a UI schema for the
presentation. Conditions — `visibleWhen`, `requiredWhen`, `readOnlyWhen` — are
`@itsm/expr` expressions, the platform's one expression language, so the browser
and the API reach the same conclusion from the same stored objects. A condition
written in JavaScript here would be a rule the server could not enforce.

```ts
import { FormRenderer, validateForm, submissionValues } from '@itsm/ui';

const errors = validateForm(definition, values, { user });
const payload = submissionValues(definition, values, { user });
```

`forms/logic.ts` holds all of it as pure functions — visibility, conditional
requirement, validation and which values may be submitted — so the same answers
can be checked in a test, in the admin preview and on a server without a DOM.

**Hidden answers are not submitted.** `submissionValues` drops the value of any
field the user cannot currently see; leaving a stale answer in place is how a
request gets approved against a condition nobody saw. The API applies the same
rule.

**Rich instructions render from a structured document, never an HTML string.**
Definitions are authored by administrators through a governed builder, but "the
author is trusted" is not a security model: `dangerouslySetInnerHTML` would turn
one compromised admin account into stored cross-site scripting for every
requester who opens the form.

Field types: `text`, `longtext`, `number`, `date`, `select`, `multiselect`,
`checkbox`, `user` (a combobox over an injected async loader), plus `section`
and `instruction` elements. The user picker's loader is injected, because the
design system must not know about the SDK, the session or tenancy.

## Tests

```bash
pnpm --filter @itsm/ui test        # this package (79 tests)
pnpm --filter @itsm/ui typecheck
pnpm test:unit                     # the workspace's unit project
```

The package's `test` script points back at the root Vitest configuration
(`--root ../.. --project unit packages/ui`), because the workspace defines its
projects once, at the root, and a package-local run would otherwise find no
project that matches its files.

DOM tests carry a `// @vitest-environment jsdom` docblock, which keeps the root
Vitest configuration free of per-package environments. They use React's own
`act` and `react-dom/client` rather than a query library: the behaviour under
test is read straight off the DOM, and these tests should fail for the same
reasons a browser would.

## Not here yet

`icons/`, `stories/` (Storybook with axe-core), the native component set and the
`ai/` cards from PH-4 are scheduled after this epic. The contrast audit and the
keyboard tests stand in for axe-core until Storybook lands; axe-core checks
rendered markup, which is the part these tests do not cover.
