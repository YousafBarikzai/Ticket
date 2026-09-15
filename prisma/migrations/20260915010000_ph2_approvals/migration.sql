-- =============================================================================
-- Phase 2: approvals (MOD-17).
--
-- The additive statements were taken from `prisma migrate diff` and filtered to
-- the approval tables. The diff cannot be used whole on this schema: it proposes
-- dropping the generated tsvector columns, the trigram indexes and
-- platform_table_allowlist, all of which exist only in hand-written SQL.
-- =============================================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "approval_policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subject_type" TEXT NOT NULL,
    "match" JSONB NOT NULL DEFAULT '{"always":true}',
    "specificity" INTEGER NOT NULL DEFAULT 0,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,

    CONSTRAINT "approval_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "approval_policy_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID,

    CONSTRAINT "approval_policy_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "approval_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "ticket_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "outcome" TEXT,
    "requested_by" UUID,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "approval_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "approval_step" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quorum" INTEGER NOT NULL DEFAULT 1,
    "approver_ids" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "opened_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6),
    "on_timeout" TEXT NOT NULL DEFAULT 'escalate',

    CONSTRAINT "approval_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "approval_decision" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "approver_id" UUID NOT NULL,
    "acted_by_id" UUID,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "via" TEXT NOT NULL DEFAULT 'api',
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "approval_delegation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "reason" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "approval_delegation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_policy_tenant_id_subject_type_status_specificity_idx" ON "approval_policy"("tenant_id", "subject_type", "status", "specificity" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "approval_policy_tenant_id_key_key" ON "approval_policy"("tenant_id", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_policy_version_tenant_id_idx" ON "approval_policy_version"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "approval_policy_version_policy_id_version_key" ON "approval_policy_version"("policy_id", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_request_tenant_id_status_due_at_idx" ON "approval_request"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_request_tenant_id_ticket_id_idx" ON "approval_request"("tenant_id", "ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "approval_request_tenant_id_subject_type_subject_id_key" ON "approval_request"("tenant_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_step_tenant_id_status_due_at_idx" ON "approval_step"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "approval_step_request_id_sequence_key" ON "approval_step"("request_id", "sequence");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_decision_tenant_id_approver_id_idx" ON "approval_decision"("tenant_id", "approver_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "approval_decision_step_id_approver_id_key" ON "approval_decision"("step_id", "approver_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_delegation_tenant_id_from_user_id_starts_at_ends_a_idx" ON "approval_delegation"("tenant_id", "from_user_id", "starts_at", "ends_at");

-- AddForeignKey
ALTER TABLE "approval_policy_version" ADD CONSTRAINT "approval_policy_version_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "approval_policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "approval_policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step" ADD CONSTRAINT "approval_step_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decision" ADD CONSTRAINT "approval_decision_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "approval_step"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Isolation and grants. apply_tenant_rls() finds the new tables by their
-- tenant_id column, and assert_tenant_rls_complete() refuses to let the
-- migration finish if any were missed.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
