# Modular IT Ticketing Platform

A browser-first, omnichannel IT service-management platform: one canonical ticket record reachable from the portal, email, Slack, Teams, WhatsApp, voice, PWA and mobile apps, with configuration-first administration and governed AI, built as a multi-tenant modular monolith in TypeScript.

## Status

**Phase 1 (Foundation) built and verified.** The walking skeleton runs end to
end: create a tenant, sign in, raise a ticket, work it, resolve it, and see the
audit trail, SLA timers, notifications and search index all follow from the
events.

**Phase 2 (Service desk MVP) built and verified** — the business rules engine,
approvals, SLA policies with calendars and escalations, notification quiet hours
and digests, the channel framework with its email adapter, and the service
catalogue with its forms. See
[docs/architecture/21](docs/architecture/21-phase-2-readiness.md) for what was
built, what it found, and the one decision it leaves open.

**Phase 3 (Workflow, knowledge and search)** and **Phase 4 (Enterprise ITSM)**
are built; see [docs/architecture/22](docs/architecture/22-phase-3-readiness.md)
and [23](docs/architecture/23-phase-4-readiness.md) for what each delivered,
what it found, and what it left open.

**Phase 5 has begun with the two applications** — the agent workbench and the
requester portal, and the first interface to any of it. See
[docs/architecture/14 §10](docs/architecture/14-experience-architecture.md)
for what exists and where the experience documents are still ahead of it.

The AI provider is settled (ADR-0042): `AI_PROVIDER=anthropic` with a key.
Model prices are the operator's to supply, and a model with no price is
refused rather than counted as free. Residency is still open — there is one
provider per deployment and no per-tenant policy.

`pnpm skeleton` runs 59 assertions end to end against the bundled production
artefacts — a demo that needs no code reading. 1158 unit tests pass, plus the
release-blocking tenant-isolation and permission-matrix suites against a real
PostgreSQL and Redis.

The source requirements are the *Modular IT Ticketing Platform — Build
Specification v2.0* (September 2026).

## Getting started

```bash
pnpm install
pnpm dev:services         # PostgreSQL, Redis, Keycloak, MinIO, Mailpit
pnpm db:prepare           # roles, databases, extensions
pnpm db:migrate           # schema, row-level security, indexes
pnpm seed                 # two tenants with deliberately identical data
pnpm dev:api              # and, in another shell, pnpm dev:worker
pnpm dev:workbench        # the agent workbench, on http://localhost:3100
pnpm dev:portal           # the requester portal, on http://localhost:3200
pnpm skeleton             # the walking skeleton, as a smoke test
```

With no `OIDC_ISSUER` set, both applications sign in through a development-only
endpoint on the API: any active account in a seeded tenant, no password. It
does not exist in production (ADR-0041).

| Command | What it does |
|---|---|
| `pnpm check` | Schema drift, module contract, typecheck, unit tests |
| `pnpm test` | Everything, including the integration suites |
| `pnpm test:isolation` | The release-blocking tenant-isolation suite |
| `pnpm test:permissions` | The release-blocking permission matrix |
| `pnpm platform` | Tenant provisioning, tokens, audit verification, event replay |

## Documentation

- [`docs/architecture`](docs/architecture/README.md) — the software architecture (23 documents: context, runtime topology, modules, platform primitives, data, eventing, API, identity and security, tenancy, engines, AI, experience, operations, deployment, evolution, quality attributes, risks, and a readiness record per phase).
- [`docs/adr`](docs/adr/README.md) — Architecture Decision Records (ADR-0001 … ADR-0042).

## Repository layout

```
apps/        api · worker · workbench · portal   (admin, status, mobile follow)
modules/     one package per MOD-nn: tenancy · identity · ticket · sla · notifications ·
             search · security · integrations · admin · rules · workflow · approvals ·
             catalogue · knowledge · channels · incident · problem · change · assets ·
             workload · analytics · feedback · time · statuspage · migration · esm · ai
packages/    platform · contracts · expr · business-time · ui · sdk · bff · runtime · config
infra/       docker · railway · scripts (migrate, seed, platform console, walking skeleton)
prisma/      schema assembled from each module's fragment, plus migrations
tests/       integration · isolation · permissions
docs/        architecture · adr · runbooks
```

Each module owns its tables and is reachable only through its entry point;
`pnpm lint:boundaries` enforces that, which is what keeps a later extraction a
deployment change rather than a rewrite.
