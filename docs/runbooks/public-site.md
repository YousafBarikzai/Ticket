# The public site

`apps/site`, the Railway service `site`: the address to share. It holds the
landing page, the sign-in chooser, the shareable role pages that open the demo,
and the privacy, cookies and terms pages (ADR-0062).

It is not an application. It has no session, no database, no Redis, no
Keycloak client and no secret, so there is **nothing to set on it by hand**: the
deploy gives it everything it reads. If it is down, nobody loses work; the three
applications keep running and can be reached at their own addresses.

| | |
|---|---|
| Service | `site`, phase 4 with the applications, one replica |
| Image | `ghcr.io/<repository>/site:<tag>` (`infra/docker/Dockerfile`, target `site`) |
| Address | `www.<DEPLOY_DOMAIN>` (`www.<environment>.<domain>` outside production), or the Railway-generated host when there is no domain |
| Health | `GET /api/health` → `{"status":"ok","app":"site"}` (Railway's check and the smoke test) |
| Variables (all set by the deploy) | `SITE_ORIGIN`, `PORTAL_ORIGIN`, `WORKBENCH_ORIGIN`, `ADMIN_ORIGIN`, `API_BASE_URL`, `DEMO_MODE=on`, `OTEL_SERVICE_NAME=itsm-site`, `PORT=3400` |

## Before the first deploy that includes it

GitHub creates every new package **private**, and Railway pulls anonymously.
After the pull request's first image build has pushed `ticket/site`, and before
merging, do **one** of:

1. **Make the package public** (as the other six are): GitHub → your profile →
   Packages → `ticket/site` → Package settings → Change visibility → Public.
2. **Or, if Railway pulls every image with a registry credential**, add that
   credential to the `site` service once it exists, and set the repository
   variable `DEPLOY_SKIP_PULL_CHECK` to `1` (GitHub → Settings → Secrets and
   variables → Actions → Variables).

If you forget, nothing breaks: the deploy's pre-flight asks the registry before
it touches Railway, and stops with this instruction:

```
The deploy stopped before changing anything in Railway:
  - ghcr.io/<repository>/site is not publicly pullable, so Railway cannot pull it. Make it public: …
```

The pre-flight stops a deploy only for a service the deploy would create. For a
service that already exists it prints a `::warning` instead and carries on,
because that service may pull with a credential.

## What a deploy does

1. Builds, scans (Trivy, `CRITICAL,HIGH`) and pushes the `site` image with the
   others.
2. Checks every image can be pulled (above).
3. In phase 4, creates the `site` service if the project lacks it
   (`--ensure-services`), sets its image, asks Railway for its address, then
   gives all four web services each other's origins and redeploys them. The
   applications learn `SITE_ORIGIN`; the site learns the three app origins and
   `API_BASE_URL`.
4. Publishes the address as the `site-url` output; the GitHub `production`
   environment links to it.
5. Smoke test: `site` liveness with the others, then a warn-only read of the
   site's chooser (`/sign-in?start=demo`) that checks each published app has its
   sign-in link and, while the demo is on, its role button.

## Check it worked

```sh
curl -fsS https://<site>/api/health                  # {"status":"ok","app":"site"}
curl -fsS https://<site>/robots.txt                  # Disallow: /demo and /api/
curl -sI  https://<site>/ | grep -i -E 'set-cookie|referrer-policy|strict-transport'
```

- No `set-cookie` line, ever. `referrer-policy: strict-origin-when-cross-origin`
  and `strict-transport-security: max-age=63072000` are present.
- Open the address. Each area's "Sign in" row goes to that app's
  `/api/session/login?account=1&redirectTo=%2Fresume`.
- The smoke test's log has no `Site links` warning.

## When something is wrong

| You see | It means | Do |
|---|---|---|
| The deploy stopped at the pre-flight naming `ticket/site` | The package is private and the service is new | Make it public, or add a credential and set `DEPLOY_SKIP_PULL_CHECK=1` (above); re-run the deploy |
| `::warning title=Image pull::… could not check …` | The registry did not answer the pre-flight | Nothing; the deploy carried on. If the image then fails to pull, it is the package's visibility |
| A page says "This part isn't available right now." | The site has no origin for that app | Re-run the deploy; it sets every origin. A value removed by hand in Railway is put back by the next deploy |
| `::warning title=Site links::…` in the smoke test | The chooser is missing a link the deploy expected | Same as the row above; the warning names the variable |
| `::warning title=Site links::… answered 404` | The chooser page is not in this build | Expected only before the chooser ships; otherwise check the image tag |
| The site is not in search results | It is on a Railway-generated host, which is never indexed | Move it to your domain (below) |

## Moving to your own domain

Set `DEPLOY_DOMAIN` (for example `itsm.vnetechsolutions.com`) and deploy; the
site answers on `www.<domain>`. To serve it on the bare domain instead, change
the site's `subdomain` to `"@"` in `infra/railway/services.json` — a preview then
uses `<environment>.<domain>`, never the apex. Add the DNS record the deploy
asks for (the CNAME for `www`, or your provider's apex alias for `@`).

Indexing switches on by itself once `SITE_ORIGIN` is `https:` and not a
`*.up.railway.app` host: the pages drop `noindex` and the sitemap fills in.
Verify the domain in Google Search Console with a DNS TXT record. Nothing in the
code changes.

**Renaming the Railway-generated host** (Railway → `site` → Settings →
Networking) is safe for the site and only the site: it has no Keycloak client
and no redirect URI, and the next deploy reads the new name back and gives it to
the applications. Do not rename the applications' hosts this way; their names
are registered in Keycloak.

## Turning the demo off

`DEMO_MODE` is `on` on exactly six services in `infra/railway/services.json`
(api, worker-data, portal, workbench, admin, site). Change all six to `off` and
deploy; a value edited by hand in Railway is put back by the next deploy. With
the demo off the site shows no demo strip and no role buttons, and its role
pages answer 404.

## Rolling back

Redeploy the previous `site` image in Railway (Deployments → the previous one →
Redeploy). The site holds no state, so there is nothing else to undo.
