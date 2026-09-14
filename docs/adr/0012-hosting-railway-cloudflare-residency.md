# ADR-0012 · Hosting on Railway with Cloudflare in front; data-residency stance

**Status:** Proposed (hosting closed by the product owner; residency option D-01 open) · **Date:** 2026-09 · **Specification reference:** §4.2 Hosting, R-07

## Context

The product owner confirmed Railway (API, web apps, workers, PostgreSQL, Redis) with Cloudflare (CDN, WAF, DNS) and asked for UK data residency. Railway's regions are US West, US East, EU West (Amsterdam) and Singapore; Cloudflare R2 supports an EU jurisdiction but not a UK one.

## Decision

- Deploy on Railway in **EU West (Amsterdam)** with Cloudflare in front, R2 (EU jurisdiction) for object storage, Grafana Cloud EU and Sentry EU for telemetry. This is option A of decision D-01 and is assumed by the architecture documents.
- Keep every store behind a connection string and every deployable a container so that option B (London-hosted PostgreSQL and S3 with Railway compute) or option C (AWS London for everything) is an infrastructure change only.
- Record `region` on every tenant from PH-1; per-region buckets; AI provider region policy per tenant.
- The steering group closes D-01 in PH-1 week 1 with data-protection evidence (pilot requirements, contracts, DPIA stance on email and AI).

## Alternatives considered

- **AWS or Azure from day one.** Not chosen by the product owner; documented as option C.
- **Cloud-neutral without naming a provider.** Rejected: delays concrete infrastructure work in PH-1; portability is preserved anyway.

## Consequences

- Fastest path to a working pipeline and environments.
- If "UK at rest" is mandatory, option B adds cross-region latency and vendors; option C adds PH-1 infrastructure effort. Neither changes application code.
- Multi-region cells (PH-5) reuse the same per-environment layout.
