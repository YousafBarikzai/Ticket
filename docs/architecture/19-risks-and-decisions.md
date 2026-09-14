# 19 · Risks, decisions and assumptions

## 1. Decisions needed from the steering group

### D-01

**UK data residency versus Railway regions.** The product owner asked for tenant data resident in the United Kingdom and for hosting on Railway with Cloudflare in front. Railway's regions are US West, US East, EU West (Amsterdam) and Singapore; Cloudflare R2 offers an EU jurisdiction but no UK one. The architecture is designed so that all three options below are configuration and infrastructure choices, not structural changes, but one must be selected in **PH-1 week 1** because it determines the accounts to provision and the latency budget for the API.

| Option | Where data rests | Compliance basis | Latency | Effort | Recommendation |
|---|---|---|---|---|---|
| **A · Railway EU West + R2 EU** | EEA (Netherlands; R2 EU data centres) | UK GDPR international transfer to the EEA under the UK adequacy regulations; standard for UK controllers | Best (single region) | Lowest | **Recommended** unless a contractual or policy requirement says "UK only" |
| B · Railway compute + London data stores | UK (AWS RDS/Neon/Supabase `eu-west-2`, S3 `eu-west-2`); processing in the EEA | Data at rest in the UK; in-memory processing in the EEA (still an EEA transfer for processing) | ≈ 8–12 ms per database round trip; mitigated by composed endpoints but material | Medium | Only if "at rest in UK" is the actual requirement and processing in the EEA is acceptable |
| C · AWS London | UK for everything | No international transfer | Best | Highest in PH-1 (ECS, RDS, ElastiCache, S3, IAM, CI deploy) | If "UK only" is contractual; the containerised design ports without code change |

Evidence to gather before deciding: the pilot organisation's data-protection requirements, any customer contracts with residency clauses, and the DPIA stance on email (Postmark processes in the US; Microsoft Graph keeps mail in the tenant's Microsoft geography).

### Other open decisions from the specification

| ID | Decision | Status | Recommendation in this architecture | Needed by |
|---|---|---|---|---|
| OD-01 | Identity broker | **Closed:** self-hosted Keycloak (product owner, Sept 2026) | Single realm with Keycloak Organizations per tenant; realm-per-tenant escape hatch (ADR-0011) | — |
| OD-02 | Search engine beyond PostgreSQL FTS | Open | Meilisearch (simpler operations, per-tenant index, typo tolerance) unless PH-2 relevance feedback demands OpenSearch analytics (ADR-0017) | PH-3 start |
| OD-03 | Email provider | Open | Postmark default adapter plus Microsoft Graph adapter for Microsoft 365 tenants; per-tenant choice from PH-3 (07 §6) | PH-2 start |
| OD-04 | AI providers and residency | Open | Provider-abstracted gateway; UK/EEA endpoints (Azure OpenAI UK South, Bedrock `eu-west-2`) as defaults for UK tenants; per-tenant policy (13 §6) | PH-4 start |
| OD-05 | Commercial model | Open | Metering design supports seats and usage meters; MSP roll-ups via tenant hierarchy (10 §1, §5) | PH-3 |
| OD-06 | Product name, domain, branding | Open | Domain layout assumed: `help`, `desk`, `admin`, `api`, `auth`, `status` subdomains plus wildcard for tenants (16 §2) | PH-2 |
| OD-07 | Time tracking default | Open | Default off (module disabled per tenant unless enabled) | PH-3 |
| — | Hosting target | **Closed:** Railway + Cloudflare (ADR-0012), subject to D-01 | | — |
| — | Deliverable format | **Closed:** Markdown in the repository | | — |

## 2. Architecture risks

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| AR-01 | RLS with connection pooling: a pooled connection leaks `app.tenant_id` between requests | Low | Critical | `SET LOCAL` only (transaction-scoped); PgBouncer in transaction mode only; isolation suite runs raw-connection tests; lint forbids `SET` without `LOCAL` | Platform |
| AR-02 | Prisma limitations (RLS session settings, multi-file schema maturity, raw SQL for partitions) slow the data layer | Medium | Medium | Thin repo layer; raw SQL allowed in `repo/` for partitions, counters, FTS; spike in PH-1 week 2; Drizzle or Kysely as fallback behind the same repo interfaces | Platform |
| AR-03 | BullMQ ordering and Redis durability assumptions cause duplicate or out-of-order handling | Medium | High | Order-tolerant handlers; per-aggregate locks where needed; inbox; reconciler; chaos tests at PH-3 gate | Platform |
| AR-04 | Keycloak Organizations feature gaps (SAML edge cases, SCIM interplay, theme) | Medium | Medium | Spike in PH-1 week 2 with one OIDC and one SAML test IdP; realm-per-tenant escape hatch; Keycloak 26+ pinned | Platform |
| AR-05 | Railway managed PostgreSQL lacks a read replica or PITR granularity when needed | Medium | Medium | Analytics on a separate pool with limits until replica exists; external managed PostgreSQL is a connection-string change (see D-01 option B) | SRE |
| AR-06 | Single-database monolith becomes a write hotspot before extraction | Low (in plan horizon) | High | Partitioned high-volume tables; counters per type; measured extraction path (17) | Tech lead |
| AR-07 | Expression language grows into a scripting language | Medium | Medium | Closed operator set; schema in contracts; sandboxed scripting is a separate, flagged action type | Catalogue/workflow squad |
| AR-08 | SSE fan-out via Redis pub/sub at scale (many tabs per tenant) | Low | Medium | Topic-scoped channels; heartbeats; connection limits per user; swap to a dedicated realtime service is an interface change | Experience squad |
| AR-09 | Email residency (Postmark US) conflicts with UK/EEA stance | Medium | Medium | Graph adapter; per-tenant transport; DPIA input to D-01 | Security champion |
| AR-10 | Telemetry volume and cost with 100 % tracing | Medium | Low | Tail-based sampling; attribute allow-list | SRE |
| AR-11 | Design-system dual targets (web + native) double component effort | High | Medium | Shared props and tests; native subset prioritised by mobile journeys; react-native-web for stories | Design lead |
| AR-12 | Cloudflare authenticated origin pulls or Access not supported end-to-end on Railway custom domains | Low | Medium | Verify in PH-1 week 1; fallback to IP allow-list plus origin secret header | SRE |

The specification's RAID log (R-01…R-09) remains authoritative for delivery risks; the entries above are architecture-specific additions.

## 3. Assumptions

| ID | Assumption | If false |
|---|---|---|
| AA-01 | Option A of D-01 (EEA under adequacy) is acceptable for the pilot | Switch to option B or C before provisioning; no code change |
| AA-02 | The pilot's identity provider supports OIDC or SAML with group claims | JIT mapping by email domain only until SCIM (PH-4) |
| AA-03 | Railway supports private networking, config-as-code, per-service replicas and health checks as documented | Adjust `infra/` only |
| AA-04 | Keycloak 26 Organizations is GA and stable for identity-first login with domain-based IdP routing | Realm-per-tenant escape hatch |
| AA-05 | PostgreSQL 16 on Railway allows `pgvector`, `pg_trgm`, `pgcrypto`, `btree_gin` | External managed PostgreSQL (D-01 option B) |
| AA-06 | Team size follows the specification's shape (platform squad of ~6 in PH-1) | Re-plan PH-1 duration; architecture unchanged |
| AA-07 | Apple Developer and Google Play accounts are available by PH-2 | Mobile foundation slips; web PWA unaffected |

## 4. Specification change requests

Items where this architecture deviates from, or found an inconsistency in, the specification. Each needs the specification owner's acknowledgement; none blocks PH-1.

| ID | Specification reference | Proposed change | Reason |
|---|---|---|---|
| SCR-01 | §5.2 / MOD-16 entities | Move `DeviceRegistration` from MOD-16 to MOD-11 | MOD-16 has no server module; the notification dispatcher is the only writer |
| SCR-02 | §4.3 / MOD-03 packages | Shared channel framework and conversation state in `modules/channels`, not `packages/platform` | Keeps channel concerns extractable with the adapters |
| SCR-03 | §4.3 / MOD-06 packages | Add `modules/rules` alongside `modules/workflow`; add `modules/portal` for MOD-02's server side | PH-2 rules ship before the PH-3 workflow package; composed portal endpoints need a home |
| SCR-04 | §6 event catalogue | Add `sla.timer.at_risk` (PH-4 forecasting) and `ux.*` product-analytics namespace | Forecast signals and analytics events are not domain events |
| SCR-05 | §6 event catalogue | Name publishers for `request.fulfilled` (MOD-05), `knowledge.article.submitted` (MOD-09) and `config.publish.requested` (MOD-13) | They appear only as consumed events |
| SCR-06 | PH-1 epic table | Add MOD-07-E0 Timer engine to the PH-1 epic list | The module-by-phase matrix and the MOD-07 epics table already place it in PH-1 |
| SCR-07 | MOD-15-E2 | Note that attachment scanning and the classification registry are delivered in PH-1 (policy and administration UI remain PH-2) | PH-1 ticket API and audit redaction depend on them |
| SCR-08 | §4.4 / MOD-21-E1-S1 | Record the platform-table exception to "every table has `tenant_id`" (`tenant`, `tenant_domain`, `channel_directory`, `plan`, `platform_setting`, `consumer_registry`) | Tenant resolution needs a small set of pre-context tables, protected by role-based policies |
| SCR-09 | §7 Concurrency | State that `If-Match` is required (missing → 428) rather than merely "sent" | Removes ambiguity for SDK and mobile clients |
