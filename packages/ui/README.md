# `@itsm/ui` — design system

One design language for six experiences: the requester portal, the agent
workbench, the admin console, the two PWAs and the mobile app. Implements
epic **MOD-16-E1** and the decision recorded in
[ADR-0005](../../docs/adr/0005-design-system-shared-tokens.md); the surrounding
architecture is §2 of
[14 · Experience architecture](../../docs/architecture/14-experience-architecture.md).

```
src/
  tokens/     colour, type, spacing, radius, elevation, motion — defined once
  styles/     the stylesheet: layers, base, one *.styles.ts per component, registry
  theme/      preferences, the pre-paint theme script, ThemeProvider
  provider/   ItsmProvider, URL state, commands, recents and pins, notify
  a11y/       hotkeys, collection keyboard, F6 regions, announcer, focus helpers
  icons/      the lucide-backed icon registry, Icon and BrandMark (server-safe)
  format/     Intl dates, durations, counts; RelativeTime
  web/        the original components, rebuilt in place (Button, Dialog, AppShell…)
  controls/   segmented control, search, number, duration and time fields
  formkit/    Form, FormSection, FormErrorSummary, InlineEdit, drafts
  feedback/   notices, problem and status screens, skeletons, progress, connection
  display/    surfaces, pills, avatars, lists, disclosure, prose, stepper, activity
  overlays/   Radix menus, popovers, sheets, confirm and conflict dialogs, toaster
  data/       DataTable (TanStack Table), filters, bulk actions, pagination
  charts/     stat cards, line/area/bar/donut charts, sparkline, progress ring
  shell/      the frame: sidebar, top and tab bars, palette, page header, nav
  forms/      FormRenderer: one renderer for catalogue forms, everywhere
  workbench/  AI suggestion card, SLA clock
```

The root entry (`@itsm/ui`) is curated and carries the everyday components;
`overlays`, `data`, `charts` and `shell` are subpaths because of their weight
(see *The dependency rule* below).

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

- **`css.ts`** renders the tokens as `--itsm-*` custom properties for four
  themes: `apple` (light, the default), `apple-dark`, `high-contrast` and
  `high-contrast-dark`. A theme is selected by `data-itsm-theme` on any
  ancestor, which lets an admin preview pane render one theme inside another.
  With no attribute the operating system decides, through
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
  `__tests__/contrast.test.ts` walks the contract across all four themes. Both
  high-contrast themes are held to AAA (7:1), because a theme that only reaches
  the AA floor is decoration rather than an accommodation.

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

The stylesheet is one cached, same-origin file, and the person's appearance
is applied before the first paint by a small blocking script (SPEC §3.4–§3.5):

```tsx
// app/itsm-ui.css/route.ts — force-static, immutable: returns uiStylesheet()
// app/layout.tsx — the root layout, a server component with no provider
import { uiStylesheetVersion } from '@itsm/ui/styles';
import { themeInitScript } from '@itsm/ui/theme';

<html lang="en-GB" suppressHydrationWarning>
  <head>
    <script dangerouslySetInnerHTML={{ __html: themeInitScript({ app: 'portal' }) }} />
    <link rel="stylesheet" href={`/itsm-ui.css?v=${uiStylesheetVersion}`} precedence="itsm" />
  </head>
  <body>{children}</body>
</html>

// The group layout ((console), (desk), (portal)) mounts the provider, which
// hosts ThemeProvider, the announcer and the lazily loaded toaster:
<ItsmProvider app="portal" Link={AppLink} router={router} usePathname={usePathname}
  useSearchParams={useSearchParams} locale={me.locale} timeZone={me.timeZone}>
  {children}
</ItsmProvider>
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

### The dependency rule

The portal's 250 kB initial-JS budget is real, so what this package depends on
is decided library by library ([ADR-0052](../../docs/adr/0052-redesign-ui-primitives-and-frame.md))
and reached one way only:

- **The root entry, `@itsm/ui`, depends on `react` and `react-dom` and nothing
  else** — no Radix, no TanStack, no sonner. A root component that needs an
  overlay loads it on intent with `React.lazy`.
- **Third-party weight lives behind a subpath**: Radix and sonner in
  `@itsm/ui/overlays`, TanStack Table and Virtual in `@itsm/ui/data`; lucide
  icon data in `@itsm/ui/icons`, rendered on the server. Applications import
  the subpath, never the library, so a version changes in one place.
- **`"sideEffects": false`**, and the root entry does not re-export
  `@itsm/contracts`: a route pays only for what it imports.
- **No `next`, ever.** Routing reaches components through `ItsmProvider`,
  which the application hands its `Link`, router and hooks. A file without
  `'use client'` stays server-safe — no hooks, no context, no event handlers
  unless the exception is written down with its reason.
  `src/__tests__/guards.test.ts` enforces both.
- No shadcn, no Tailwind, no class-name library: a `cx` helper is three lines.

CI builds all three applications and fails a route over its budget, or more
than 10 kB over its recorded baseline (`infra/scripts/check-bundles.ts`). So a
new dependency, or a heavy import into the root entry, shows up in the change
that adds it rather than in a phone on a train.

Components are styled
by one stylesheet — assembled from a `<Name>.styles.ts` module beside each
component, in cascade layers (`styles/registry.ts`) — in which every colour, space, type,
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
pnpm --filter @itsm/ui test        # this package (93 files, 1,622 tests at the time of writing)
pnpm --filter @itsm/ui typecheck
pnpm test:unit                     # the workspace's unit project
```

Besides the component tests, four suites guard the package as a whole:
`src/__tests__/guards.test.ts` (no `next`; server-safe files stay server-safe),
`src/__tests__/catalogue.test.tsx` (every subpath exports what the
specification names, and the root entry's import graph reaches no Radix,
TanStack or sonner), `web/__tests__/stylesheet-vars.test.ts` (every style
module is registered and references only variables the token pipeline emits)
and `src/__tests__/composition.test.tsx` (the groups rendered together,
unmocked: provider and toaster, table and undo, a gated button in a dialog,
one action spec in two places, the frame and the palette an application hosts).

Every group also has an axe-core suite, `<group>/__tests__/*.audit.test.tsx`,
run on `document.body` so portalled overlays are audited too. jsdom has no
layout, so colour contrast is left to `contrast.test.ts`, which computes every
pairing from the tokens instead.

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

`stories/` (Storybook), the native component set and the `ai/` cards from PH-4
are scheduled after this epic. Until Storybook lands there is no visual
regression check: layout, colour and motion are reviewed in a real browser
during each package's render pass.
