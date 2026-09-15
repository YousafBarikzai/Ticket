# ADR-0011 · Identity broker: self-hosted Keycloak with one realm and Organizations per tenant

**Status:** Accepted 2026-09-14 (OD-01 closed by the product owner) · **Date:** 2026-09 · **Specification reference:** OD-01, MOD-01

## Context

Tenants bring their own OIDC or SAML identity providers; SCIM (PH-4) and passkeys (PH-5) follow; the platform must never store passwords for SSO users; per-user pricing of hosted brokers is unattractive at MSP scale. The product owner selected self-hosted Keycloak.

## Decision

Run Keycloak 26+ as a Railway service with its own PostgreSQL. Use **one realm (`platform`) with a Keycloak Organization per tenant**, each with its own identity providers and email domains, so identity-first login routes users to their tenant's IdP. Token mappers add `tenant_id`, primary `org_id`, `sid` and MFA evidence; **roles are not carried in tokens** (authorisation is platform data). Local Keycloak accounts exist only for external requesters and break-glass administrators. Web apps use the token-handler (BFF) pattern; mobile uses PKCE. A dedicated realm per tenant remains available as an escape hatch for strict-isolation tenants (`tenant.auth_realm`). Realm configuration is code (`infra/keycloak/realm.json`).

## Alternatives considered

- **Hosted broker (WorkOS, Auth0).** Fastest to start; rejected by the product owner for cost and control.
- **Auth.js in-app, OIDC only.** Rejected: SAML and SCIM would need a broker later anyway; session management would be bespoke.
- **Realm per tenant from the start.** Rejected: operational scaling and client-configuration duplication; kept as an escape hatch.

## Consequences

- One more stateful component to operate (backups, upgrades); mitigated by realm-as-code and a restore runbook.
- Organizations feature must be validated in the PH-1 week-2 spike (risk AR-04) with one OIDC and one SAML provider.
- Session policies (idle/absolute timeouts, device list, revocation) are enforced by the platform's session table and Redis denylist in addition to Keycloak's SSO session.
