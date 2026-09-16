# syntax=docker/dockerfile:1.7

# One image per deployable, built from one context so the workspace resolves.
# Both targets run the same module code from different entry points (ADR-0001),
# which is what keeps the API and the worker honest about sharing rules.
#
# The runtime image contains no build toolchain. An earlier version ran the
# TypeScript sources directly through `tsx`, which meant shipping a transpiler —
# and esbuild's Go binary, and whatever CVEs its Go release carried — into
# production for no benefit: nothing in production ever compiles anything. Each
# deployable is now bundled to one JavaScript file at build time and the runtime
# stage installs production dependencies only.

# What the application needs to run: Node, OpenSSL for Prisma, and nothing else.
FROM node:22-bookworm-slim AS runtime-base
# `upgrade` as well as `install`: the base image is rebuilt on its own schedule,
# so between rebuilds it carries whatever security updates Debian has published
# since. The scan found two in libpcre2 alone, both with fixes already released.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# What the build needs on top of that: a package manager.
#
# Kept out of the runtime image deliberately. pnpm bundles its own dependencies,
# and the image scan reported a critical CVE in one of them — in a package the
# application never loads, shipped only because the package manager came along
# for the ride. The runtime image runs `node dist/…`; it has no use for pnpm.
FROM runtime-base AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

# The workspace, as the build needs to see it.
FROM base AS source
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
COPY modules ./modules
COPY apps ./apps
COPY infra ./infra
COPY prisma ./prisma
COPY tsconfig.json turbo.json ./

# The install, on its own, because five stages need it.
#
# Before the web applications existed this lived in `build`, and moving it out
# is not tidying: `deps` is one layer that `build` and each `build-<app>` stage
# start from, so a Dockerfile that produces six images resolves the workspace
# once rather than six times.
FROM source AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
# Assert rather than assemble: assembling here would quietly paper over a module
# fragment changed without regenerating the committed schema, which is the drift
# this step exists to catch.
RUN pnpm exec tsx infra/scripts/assemble-schema.ts --check \
 && pnpm bundle

# Production dependencies only, installed separately rather than pruned from the
# build stage, so what ends up in the image is decided by the lockfile rather
# than by what a prune happened to leave behind.
FROM source AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod
# Generated against the packages actually installed here, so the client in the
# image always matches the @prisma/client next to it.
RUN pnpm exec prisma generate --schema prisma/schema.prisma

FROM runtime-base AS runtime
ENV NODE_ENV=production
# npm ships inside the Node image and bundles its own copy of its dependencies.
# The image scan flagged a critical CVE in one of them (`tar`), in code this
# application never loads — npm is not run here, or anywhere in the container.
# Third time the same principle: whatever the runtime does not execute should
# not be in the image to be found.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/prisma ./prisma
COPY --from=build /app/dist ./dist
# Never run as root: a container escape should not start as the machine's owner.
RUN useradd --system --uid 10001 --home /app itsm && chown -R itsm:itsm /app
USER itsm
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

FROM runtime AS api
EXPOSE 3000
CMD ["node", "dist/api.js"]

# Migrations run from their own image, on the same runtime base as the rest.
#
# This was `FROM build` until the pipeline started scanning every image rather
# than only the API's. The migration image is the one thing here that runs with
# `app_owner` — the credential that owns every table — and building it on the
# toolchain stage gave it pnpm, pnpm's bundled `tar` and esbuild's Go binary:
# two CRITICAL advisories in code it never executes. The same argument this
# file already makes twice, for npm and for pnpm, one image short of the one
# that mattered most.
#
# It needed the toolchain because `db:migrate` spawned `npx` and `tsx`. It no
# longer does either: `infra/scripts/migrate.ts` is bundled to `dist/migrate.js`
# like the API and the worker, resolves the Prisma CLI through Node's own
# resolver, and skips the schema assembly in production — where the committed
# schema has already been asserted to match its fragments by the build stage
# above, so re-deriving it would replace a verified file with an unverified one.
FROM runtime AS migrate
HEALTHCHECK NONE
CMD ["node", "dist/migrate.js"]

FROM runtime AS worker
# The worker has no HTTP surface, so it carries no health check of its own; the
# platform watches its queue depth and job outcomes instead.
HEALTHCHECK NONE
ENV WORKER_QUEUES=*
CMD ["node", "dist/worker.js"]

# ---------------------------------------------------------------------------
# The three web applications (docs/architecture/14 §1, 16 §1).
#
# Next's `output: 'standalone'` traces what each app actually imports and emits
# a directory that runs under a bare `node`, with no package manager, no pnpm
# store and no workspace symlinks. That is why these images do not reuse the
# `prod-deps` stage the API and worker share: the tracer has already decided
# what belongs, and installing a second `node_modules` beside its answer would
# only add what it deliberately left out.
#
# `outputFileTracingRoot` in each `next.config.ts` points at the workspace root,
# so the emitted tree is rooted there too — `server.js` sits at
# `<app>/.next/standalone/apps/<app>/server.js` with a shared `node_modules` and
# `packages/` beside it. Copying the standalone directory to `/app` therefore
# reproduces the workspace layout the traced requires expect, which is why the
# start command names a path two segments deep rather than `server.js`.
#
# Two things the tracer does not copy, and a deploy that forgets either is a
# site that renders unstyled and 404s every asset:
#   `.next/static`  — the hashed client bundles, served at `/_next/static`
#   `public`        — the service worker built by `pnpm sw`, for the two apps
#                     that have one (the console has none, by ADR-0049)

FROM deps AS build-portal
RUN pnpm --filter @itsm/portal build

FROM deps AS build-workbench
RUN pnpm --filter @itsm/workbench build

FROM deps AS build-admin
RUN pnpm --filter @itsm/admin build

# What all three web images have in common, so the differences below are only
# the differences.
FROM runtime-base AS web-runtime
ENV NODE_ENV=production
# Next binds to localhost unless told otherwise, and a container that binds to
# localhost is a container nothing can reach.
ENV HOSTNAME=0.0.0.0
# The same removal as the API image, for the same reason: npm ships inside the
# Node image with its own bundled dependencies, none of which anything here
# executes, and every one of which a scanner will find.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
RUN useradd --system --uid 10001 --home /app itsm && chown -R itsm:itsm /app
USER itsm

FROM web-runtime AS portal
ENV PORT=3200
COPY --from=build-portal --chown=itsm:itsm /app/apps/portal/.next/standalone ./
COPY --from=build-portal --chown=itsm:itsm /app/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=build-portal --chown=itsm:itsm /app/apps/portal/public ./apps/portal/public
EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/portal/server.js"]

FROM web-runtime AS workbench
ENV PORT=3100
COPY --from=build-workbench --chown=itsm:itsm /app/apps/workbench/.next/standalone ./
COPY --from=build-workbench --chown=itsm:itsm /app/apps/workbench/.next/static ./apps/workbench/.next/static
COPY --from=build-workbench --chown=itsm:itsm /app/apps/workbench/public ./apps/workbench/public
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/workbench/server.js"]

# No `public` copy: the console is the one application here with no service
# worker (ADR-0049), so it has no `public` directory for `COPY` to find, and a
# COPY of a path that does not exist fails the build rather than being skipped.
FROM web-runtime AS admin
ENV PORT=3300
COPY --from=build-admin --chown=itsm:itsm /app/apps/admin/.next/standalone ./
COPY --from=build-admin --chown=itsm:itsm /app/apps/admin/.next/static ./apps/admin/.next/static
EXPOSE 3300
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/admin/server.js"]
