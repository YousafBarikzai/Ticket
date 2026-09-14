# ADR-0005 · One design system with shared tokens for web and native

**Status:** Accepted 2026-09-14 · **Date:** 2026-09 · **Specification reference:** ADR-05

## Context

Six experiences (portal, workbench, admin, PWAs, iOS, Android) must look and behave the same and meet WCAG 2.2 AA, with a small front-end team.

## Decision

`packages/ui` defines design tokens once (exported as CSS variables for web and a theme object for React Native) and ships core components for both targets with the same props and accessibility behaviour, each with a Storybook story, an axe-core test and a keyboard test. `FormRenderer` renders catalogue form definitions identically on every surface. Web components build on Radix primitives with Tailwind (shadcn/ui style); native components use React Native primitives.

## Alternatives considered

- **A single cross-platform UI kit (e.g. Tamagui or react-native-web everywhere).** Considered; rejected for the workbench and admin, where web-native components (tables, command palette, rich editors) matter more than sharing code with mobile.
- **Separate design systems per platform.** Rejected: drift and duplicated a11y work.

## Consequences

- Dual implementations for the ~20 core components (risk AR-11), mitigated by shared tests and a native subset prioritised by mobile journeys.
- Tokens and form rendering are genuinely single-sourced, which is where consistency matters most.
