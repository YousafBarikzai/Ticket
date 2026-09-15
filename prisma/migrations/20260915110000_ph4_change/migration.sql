-- MOD-08-E3 Change management (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL.

-- CreateTable
CREATE TABLE "change" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "risk" TEXT NOT NULL DEFAULT 'medium',
    "impact" TEXT NOT NULL DEFAULT 'medium',
    "service_id" UUID,
    "category_id" UUID,
    "problem_id" UUID,
    "major_incident_id" UUID,
    "requested_by" UUID,
    "owner_id" UUID,
    "template_id" UUID,
    "template_version" INTEGER,
    "implementation_plan" TEXT,
    "backout_plan" TEXT,
    "test_plan" TEXT,
    "planned_start_at" TIMESTAMPTZ(6),
    "planned_end_at" TIMESTAMPTZ(6),
    "actual_start_at" TIMESTAMPTZ(6),
    "actual_end_at" TIMESTAMPTZ(6),
    "approval_note" TEXT,
    "approval_request_id" UUID,
    "retrospective_approved_at" TIMESTAMPTZ(6),
    "retrospective_approved_by" UUID,
    "close_code" TEXT,
    "close_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_window" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'change',
    "name" TEXT NOT NULL,
    "reason" TEXT,
    "time_zone" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "weekday" TEXT,
    "start_time" TEXT,
    "end_time" TEXT,
    "service_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "change_window_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standard_change_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "risk" TEXT NOT NULL DEFAULT 'low',
    "implementation_plan" TEXT,
    "backout_plan" TEXT,
    "test_plan" TEXT,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "standard_change_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "change_tenant_id_number_key" ON "change"("tenant_id", "number");
CREATE INDEX "change_tenant_id_status_planned_start_at_idx" ON "change"("tenant_id", "status", "planned_start_at");
CREATE INDEX "change_tenant_id_kind_status_idx" ON "change"("tenant_id", "kind", "status");
CREATE INDEX "change_tenant_id_service_id_planned_start_at_idx" ON "change"("tenant_id", "service_id", "planned_start_at");

-- The debt the record carries: emergency changes nobody has come back to sign
-- off. Partial, because it is the only query anybody runs against this shape and
-- the rows that satisfy it should be few and shrinking.
CREATE INDEX "change_owed_retrospective_idx"
  ON "change"("tenant_id", "created_at")
  WHERE "kind" = 'emergency' AND "retrospective_approved_at" IS NULL;

CREATE INDEX "change_window_tenant_id_kind_status_idx" ON "change_window"("tenant_id", "kind", "status");

CREATE UNIQUE INDEX "standard_change_template_tenant_id_key_key" ON "standard_change_template"("tenant_id", "key");
CREATE INDEX "standard_change_template_tenant_id_status_idx" ON "standard_change_template"("tenant_id", "status");

-- A published standard change template must have a back-out plan. Every change
-- raised from it inherits an approval nobody looks at twice, and the moment
-- somebody needs the back-out plan is the moment nobody is going to write one.
-- The service refuses first; this is what holds if anything ever writes around
-- it.
ALTER TABLE "standard_change_template"
  ADD CONSTRAINT "standard_change_template_published_needs_backout"
  CHECK ("status" <> 'published' OR "backout_plan" IS NOT NULL);

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
