# ADR-0019 · Monorepo with pnpm workspaces and Turborepo; modules and packages as workspace packages

**Status:** Accepted 2026-09-14 · **Date:** 2026-09 · **Specification reference:** §4.3

## Context

One language (TypeScript) across API, worker, web, mobile and SDK; shared contracts and design system; module extraction without moving code out of the repository; small team.

## Decision

A single repository with `apps/*` (deployables), `modules/*` (one package per MOD-nn or channel adapter), `packages/*` (`contracts`, `ui`, `platform`, `sdk`, `config`, `expr`, `business-time`, `i18n`), `packs/*` (ESM configuration packages), `infra/*` and `docs/*`. pnpm workspaces for dependency isolation; Turborepo for task graph, caching and affected-only CI; Changesets-style versioning for published packages (`sdk`, `ui`); CODEOWNERS by module; conventional commits; trunk-based development with squash merges.

## Alternatives considered

- **Polyrepo per module.** Rejected: contract drift and cross-cutting refactors become expensive.
- **Nx.** Viable; Turborepo chosen for simplicity and remote-cache ergonomics on GitHub Actions.

## Consequences

- One pipeline, one dependency graph, fast local development.
- Repository size grows; mitigated by affected-only builds and remote caching.
