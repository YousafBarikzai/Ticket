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

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# The workspace, as the build needs to see it.
FROM base AS source
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
COPY modules ./modules
COPY apps ./apps
COPY infra ./infra
COPY prisma ./prisma
COPY tsconfig.json turbo.json ./

FROM source AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
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

FROM base AS runtime
ENV NODE_ENV=production
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

FROM runtime AS worker
# The worker has no HTTP surface, so it carries no health check of its own; the
# platform watches its queue depth and job outcomes instead.
HEALTHCHECK NONE
ENV WORKER_QUEUES=*
CMD ["node", "dist/worker.js"]
