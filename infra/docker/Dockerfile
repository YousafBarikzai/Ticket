# syntax=docker/dockerfile:1.7

# One image per deployable, built from one context so the workspace resolves.
# Both targets run the same module code from different entry points (ADR-0001),
# which is what keeps the API and the worker honest about sharing rules.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
COPY modules ./modules
COPY apps ./apps
COPY infra ./infra
COPY prisma ./prisma
COPY tsconfig.json turbo.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# Assert rather than assemble: assembling here would quietly paper over a module
# fragment that was changed without regenerating the committed schema, which is
# the drift this step exists to catch. The client is then generated at build time
# so the image never needs the schema at start-up.
RUN pnpm exec tsx infra/scripts/assemble-schema.ts --check \
 && pnpm db:generate

FROM deps AS runtime
# Never run as root: a container escape should not start as the machine's owner.
RUN useradd --system --uid 10001 --home /app itsm && chown -R itsm:itsm /app
USER itsm
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

FROM runtime AS api
EXPOSE 3000
CMD ["pnpm", "exec", "tsx", "apps/api/src/main.ts"]

FROM runtime AS worker
# The worker has no HTTP surface, so it carries no health check of its own; the
# platform watches its queue depth and job outcomes instead.
HEALTHCHECK NONE
ENV WORKER_QUEUES=*
CMD ["pnpm", "exec", "tsx", "apps/worker/src/main.ts"]
