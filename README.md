# Modular IT Ticketing Platform

A browser-first, omnichannel IT service-management platform: one canonical ticket record reachable from the portal, email, Slack, Teams, WhatsApp, voice, PWA and mobile apps, with configuration-first administration and governed AI, built as a multi-tenant modular monolith in TypeScript.

## Status

**Architecture defined; Phase 1 (Foundation) not yet started.** The source requirements are the *Modular IT Ticketing Platform — Build Specification v2.0* (September 2026).

## Documentation

- [`docs/architecture`](docs/architecture/README.md) — the software architecture (20 documents: context, runtime topology, modules, platform primitives, data, eventing, API, identity and security, tenancy, engines, AI, experience, operations, deployment, evolution, quality attributes, risks, Phase 1 readiness).
- [`docs/adr`](docs/adr/README.md) — Architecture Decision Records (ADR-0001 … ADR-0020).

## Planned repository layout (created in Phase 1)

```
apps/        api · worker · portal · workbench · admin · status · mobile
modules/     one package per functional module (MOD-01 … MOD-24) and per channel adapter
packages/    contracts · platform · ui · sdk · config · expr · business-time · i18n
packs/       enterprise service-management configuration packs
infra/       Dockerfiles · Railway config · Keycloak realm · GitHub Actions · seed · load tests · alerts
docs/        architecture · adr · runbooks
```
