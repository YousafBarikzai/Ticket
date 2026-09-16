# ADR-0050 · A pipeline that runs before it can deploy

**Status:** Accepted 2026-09-16 · **Date:** 2026-09 · **Specification reference:** OD-06, doc 16 §1–§5, ADR-0012

## Context

OD-06 was closed in favour of Railway (ADR-0047), which unblocked the pipeline
without building it. `ci.yml` carried a comment saying stages 4 to 6 "live in
`deploy.yml` once the hosting accounts exist", and doc 16 described a deployment
in some detail: preview environments per pull request, staging on merge,
production behind a manual approval, images built by CI with SBOMs and scans,
Keycloak realm applied as code.

None of it existed, and three things doc 16 assumed did not exist either. There
was no Docker target for any of the three Next applications — the image story
covered the API and the worker only, so the product's entire user interface had
no way to be deployed. There was no `infra/keycloak/realm.json`, and without one
no token would carry `tenant_id`, which `apps/api/src/auth/verify.ts` refuses
every request without. And `prepare-database.sh` created a fixed pair of
development databases with one shared password for all four roles.

The hosting account exists; the credentials were hours away when this was
written. That gap is the interesting constraint, because the obvious answers are
both bad: wait, and the pipeline is written against nothing and reviewed by
nobody; or write it live, and every push is red until a secret is pasted in.

## Decision

**Every deploy job is gated on `vars.DEPLOY_DOMAIN` and `secrets.RAILWAY_TOKEN`
being present.** Absent, the job prints the deploy plan it would have run and
exits green. Present, the same job deploys, with no edit to the file. The images
are built, scanned and pushed either way, so the expensive half of the pipeline
is exercised on every push from the day it merges.

**One `Dockerfile`, six targets.** `api`, `worker` and `migrate` as before, plus
`portal`, `workbench` and `admin` from Next's `output: 'standalone'`. The
install moved into its own stage, so six images resolve the workspace once.

**The service catalogue is `infra/railway/services.json`, and something reads
it.** Not a `railway.json` per service: Railway reads its own config-as-code
when Railway builds from the repository, and these services run images CI built,
so a `railway.json` here would be a file nothing opens — which is the bug this
codebase has now found in four registers (ADR-0044, ADR-0045, ADR-0047,
ADR-0048) and had no business adding a fifth of. `railway-deploy.ts` reads the
catalogue and applies it through the Railway API.

**The realm is applied, not written out.** Same reasoning. Its redirect URIs are
derived from the same catalogue the deploy reads rather than substituted into a
template, so the URI Keycloak accepts and the origin the application is served
on cannot drift apart.

**Migrations and seeding run inside the environment, as phases 0 and 1.** The
`migrate` image already existed for this. No runner ever holds a public database
URL, and a preview seeds itself while production does not.

**Per-environment database roles, with a refusal.** Four passwords rather than
one, and `prepare-database.sh` refuses to prepare anything but `local` while a
password is still `devpass`.

## Consequences

The deployment order is now a tested property rather than a paragraph. Doc 16 §4
says workers before the API and the API before the applications; a test asserts
it off the catalogue, and it fails when the catalogue says otherwise — which was
checked by making it say otherwise. The same applies to the realm: the mappers
the API refuses a token without, the callback path the applications actually
serve, the audience that makes `jwtVerify` accept anything at all.

**The image that was scanned is the image that runs.** The first draft of this
built the image twice — once with `load` to scan, once with `push` — and the
second build, from cache, would almost always be identical. "Almost always
identically" is not a claim worth making about a supply chain, so it builds
once and `docker push`es that image.

**Three things are true about this pipeline that are worth stating rather than
discovering.** It has never run: there was no account to run it against, and the
verification behind it is a local reproduction of each image's runtime layout, a
dry run of every deploy plan, all three paths of the database script against a
real PostgreSQL, and 31 unit tests. The Railway and Keycloak API calls
themselves are the part no local check can reach, and the first real deploy is
where they will be found wrong if they are. Stage 4 runs the walking skeleton
and not Playwright, axe-on-a-page or Lighthouse, because none of those exists
here — doc 16 §3 now says so in the table rather than implying a browser suite
nobody wrote. And rollback is a person redeploying the previous image; the
expand-only migration discipline is what makes that safe, and there is no script
for it because a rollback script that has never been run is worse than knowing
there isn't one.

## Alternatives considered

**Let Railway build from the repository.** Simplest: no registry, no image
plumbing, a `railway.json` that Railway would genuinely read. Rejected because
the image Railway built would not be the image CI scanned, which throws away the
SBOM and the Trivy gate doc 16 §3 makes a release condition.

**Write the pipeline once the credentials land.** Rejected because it makes the
pipeline unreviewable now and puts it on the critical path of the first deploy,
which is the worst moment to be reading it for the first time.

**Hard-code the domain.** Rejected: six subdomains times three environments is
eighteen strings to keep in step, and the one that goes stale is always a
redirect URI, found by somebody who cannot sign in. One repository variable,
every hostname derived.
