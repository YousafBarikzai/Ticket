-- MOD-06-E1 Workflow engine (PH-3), per ADR-0009.
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL.

-- CreateTable
CREATE TABLE "wf_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "current_version_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "owner_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wf_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wf_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "change_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,

    CONSTRAINT "wf_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wf_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "ticket_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "context" JSONB NOT NULL DEFAULT '{}',
    "current_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "triggered_by" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "wf_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wf_step_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_key" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'started',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT NOT NULL,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "wf_step_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wf_wait" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "event_type" TEXT,
    "event_filter" JSONB,
    "due_at" TIMESTAMPTZ(6),
    "on_timeout_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "wf_wait_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wf_definition_tenant_id_key_key" ON "wf_definition"("tenant_id", "key");
CREATE INDEX "wf_definition_tenant_id_status_idx" ON "wf_definition"("tenant_id", "status");

CREATE UNIQUE INDEX "wf_version_tenant_id_definition_id_version_key" ON "wf_version"("tenant_id", "definition_id", "version");

CREATE INDEX "wf_run_tenant_id_status_started_at_idx" ON "wf_run"("tenant_id", "status", "started_at" DESC);
CREATE INDEX "wf_run_tenant_id_ticket_id_idx" ON "wf_run"("tenant_id", "ticket_id");

-- The constraint the engine's exactly-once protocol rests on: claiming a step
-- means inserting this row, so a second worker reaching the same attempt fails
-- here and stops. No locks, no leases, no clock.
CREATE UNIQUE INDEX "wf_step_run_tenant_id_run_id_step_key_attempt_key" ON "wf_step_run"("tenant_id", "run_id", "step_key", "attempt");
CREATE INDEX "wf_step_run_tenant_id_run_id_started_at_idx" ON "wf_step_run"("tenant_id", "run_id", "started_at");
CREATE INDEX "wf_step_run_tenant_id_status_idx" ON "wf_step_run"("tenant_id", "status");

CREATE UNIQUE INDEX "wf_wait_tenant_id_run_id_step_key_key" ON "wf_wait"("tenant_id", "run_id", "step_key");
CREATE INDEX "wf_wait_tenant_id_status_due_at_idx" ON "wf_wait"("tenant_id", "status", "due_at");
CREATE INDEX "wf_wait_tenant_id_status_event_type_idx" ON "wf_wait"("tenant_id", "status", "event_type");

-- AddForeignKey
ALTER TABLE "wf_version" ADD CONSTRAINT "wf_version_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "wf_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wf_run" ADD CONSTRAINT "wf_run_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "wf_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wf_run" ADD CONSTRAINT "wf_run_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "wf_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wf_step_run" ADD CONSTRAINT "wf_step_run_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "wf_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wf_wait" ADD CONSTRAINT "wf_wait_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "wf_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
