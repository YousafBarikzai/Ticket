# ADR-0062 · A public site in front of the product

**Status:** Accepted 2026-10-02 · **Date:** 2026-10 · **Specification reference:** SPEC v3 §6.1, §10.1, §15 WP-10; DECISIONS D14, D18, D22, D24; annex A5 §3, §7 · **Related:** ADR-0012, ADR-0041, ADR-0049, ADR-0050

## Context

Until v3 the product had three front doors and no hall. Each application —
the Help Portal, the Service Desk and Administration — has its own origin, its
own BFF and its own session, and the first thing any of them does for a
stranger is send them to Keycloak. There was no address to give a prospect:
nothing that says what the product is, nothing that lets somebody try it
without an account, and nothing that tells a person who *does* have an
account which of the three doors is theirs.

D14 decides that the answer is a public site: a landing page, a sign-in
chooser, shareable role pages that open the demo, and the legal pages. What it
leaves to this record is where that site lives and what it is allowed to be.

The constraints that decide it:

- **The applications hold sessions; a marketing page must not.** Every app
  sets `__Host-` cookies and, in v3, a demo re-entry cookie whose presence
  changes what `/demo` does (D22). A landing page on an app origin would be a
  page whose behaviour depends on a cookie the visitor cannot see.
- **The demo's one-click entry depends on the Referer.** An app's `/demo`
  page auto-submits only when the request's `Referer` names an allowed origin
  (D22). The page that holds the role buttons therefore needs an origin of its
  own that the apps can name, and a referrer policy that sends it.
- **Its links are runtime configuration.** CI builds every image before
  Railway has named the hosts (`railway-deploy.ts` asks for a generated
  domain during the deploy), so anything rendered at build time cannot know
  where the apps are.
- **It is the page most people will judge the product by**, on a phone, often
  once. Weight and accessibility are not secondary here.

## Decision

**A fourth Next application, `apps/site` (`@itsm/site`), on its own origin.**
Railway service `site`, phase 4 with the applications, one replica, the `www.`
subdomain (or the bare domain, `subdomain: "@"`, at the owner's choice). The
same build shape as the applications — standalone output, webpack, the design
system's stylesheet served from its own origin — and the same runtime image
base, so the same scan surface.

**It is inert, and tested to stay so.**
- No session, no BFF, no Redis, no Keycloak client, no service worker and **no
  cookie**. A guard test refuses `@itsm/bff`, `@itsm/sdk`, `@itsm/pwa`,
  `ioredis` and `next/link` anywhere outside its tests, and another refuses a
  route that sets or reads a cookie.
- Every link into the product is a plain `<a>` to another origin: never
  `next/link`, never a form, never `target="_blank"`. Role buttons carry
  `rel="nofollow"` and never `noreferrer`; work-account rows go to the app's
  `/api/session/login?account=1&redirectTo=%2Fresume`, so a real sign-in made
  here is final.
- The browser talks to nothing but the site: `connect-src 'self'`,
  `form-action 'self'`, `object-src 'none'`, COOP `same-origin`,
  `frame-ancestors 'none'`. The demo's status is read by the site's server,
  never by the page.
- `Referrer-Policy: strict-origin-when-cross-origin` is **required**, not a
  default: it is what lets the apps' `/demo` see the site as the Referer.
- HSTS is `max-age=63072000` only. `includeSubDomains` and `preload` would
  bind every host under the owner's domain from a marketing page; neither is
  this service's decision to make.

**Static-first, honestly defined.** The legal pages, the stylesheet and the
icon are built once. The landing page, the chooser, the role pages, `robots.txt`
and the sitemap render per request — only because their links are deployment
facts — from one configuration reader (`src/server/config.ts`) that parses the
four origins and never reads a secret. Every visitor gets the same HTML for a
given minute; there is no per-visitor input and no client-side data fetching.

**Indexed only on the owner's own domain.** The site lets itself be indexed
only when `SITE_ORIGIN` is `https:` and not a Railway-generated
`*.up.railway.app` host, so the move to a custom domain turns indexing on with
no code change and leaves no temporary duplicate behind. `robots.txt` disallows
`/demo` and `/api/` and never `/try/`, so a shared role link still unfurls in
Teams, Slack and LinkedIn; those pages say `noindex` themselves.

**Budgeted like the portal, and tighter.** 150,000 B of first-load JavaScript
per route, growth enforced, against a floor of about 131.5 kB that is the
framework itself. Anything much above the floor on a marketing page is a
defect, and CI fails it.

**The pipeline learns a fourth web service, and a pre-flight.** `site` joins
`WEB_ORIGINS`, so every web service learns `SITE_ORIGIN` and the site learns the
three app origins and `API_BASE_URL`. The deploy publishes `site-url`, which is
what the GitHub environments link to. Because GHCR creates every new package
private, the deploy now asks the registry, before Railway is touched, whether
each image can be pulled anonymously: a refusal stops the deploy only for a
service the deploy would create (the site's first deploy); for a service that
exists it is a warning, since Railway may pull it with a registry credential;
`DEPLOY_SKIP_PULL_CHECK=1` turns the check off. The post-deploy smoke test
probes the site and reads its chooser from outside to warn — never fail — when
a link into an app is missing.

**`DEMO_MODE=on` is set on exactly the six services that read it** — api,
worker-data, portal, workbench, admin and site — and a test holds the catalogue
to that list, so the kill switch has six places and no seventh.

## Alternatives considered

**The landing page in the portal, at `/welcome`.** One fewer service, but the
page would share an origin with a live session store and the demo re-entry
cookie, its behaviour would depend on cookies its visitors cannot see, and the
portal's 250 kB budget and service worker would be paid by every prospect. It
would also make the portal the place to *choose* an area, which is the job the
area switcher already does for people who have signed in.

**A static export on Cloudflare.** Cheaper to serve, but its links would be
baked in at build time, before Railway has named any host; a second build per
environment would be a second pipeline to keep in step. The per-request render
of a handful of server components costs well under 50 ms on one replica.

**`/try/<persona>` as a bare redirect to the app.** A redirect loses the site's
Referer, so the app would show its button page instead of opening the demo, and
a shared link would unfurl with no preview. A small role page with Open Graph
tags and one link keeps both.

**A same-origin status proxy polled from the page.** Unnecessary when the page
renders per request: the server reads the status with a short memo, and the
countdown runs from a pure clock. `connect-src 'self'` with nothing to connect
to is the stronger property.

**An email field on the chooser that pre-fills the identity provider.** It
needs a form or script on a marketing origin, and an email box on a
`*.up.railway.app` host resembles phishing. Not built; if ever added, it builds
the URL in script and navigates, never posts.

## Consequences

- There is one address to share — the deploy prints it as `site-url` — and one
  click from it into the demo.
- The site cannot become an application by accident: the tests above fail the
  first import of a session, a client router or a cookie.
- The owner has one action before the first deploy of v3: make the GHCR package
  `ticket/site` public (or set `DEPLOY_SKIP_PULL_CHECK=1` if Railway pulls with
  a credential). Forgetting it stops the deploy at the pre-flight with that
  instruction, before anything in Railway changes.
- Until the owner moves to a custom domain the site is not indexed. That is the
  point, and it needs no code change to undo.
- A fourth image is built, scanned and pushed on every pull request, and CI
  builds a fourth Next app. The skeleton measured 131.5 kB of first-load
  JavaScript per route — the framework floor — against its 150 kB budget.
- Operations live in `docs/runbooks/public-site.md`.
