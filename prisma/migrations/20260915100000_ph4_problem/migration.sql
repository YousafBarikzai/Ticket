-- MOD-08-E2 Problem management (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL.

-- CreateTable
CREATE TABLE "problem" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'investigating',
    "priority" TEXT NOT NULL DEFAULT 'P3',
    "category_id" UUID,
    "service_id" UUID,
    "owner_id" UUID,
    "raised_from" TEXT NOT NULL DEFAULT 'manual',
    "major_incident_id" UUID,
    "root_cause" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "known_error" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "problem_id" UUID NOT NULL,
    "symptom" TEXT NOT NULL,
    "workaround" TEXT NOT NULL,
    "article_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID,
    "retired_at" TIMESTAMPTZ(6),
    "retired_reason" TEXT,

    CONSTRAINT "known_error_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_ticket" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "problem_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "workaround_applied" BOOLEAN NOT NULL DEFAULT false,
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linked_by" UUID,

    CONSTRAINT "problem_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "problem_tenant_id_number_key" ON "problem"("tenant_id", "number");
CREATE INDEX "problem_tenant_id_status_priority_idx" ON "problem"("tenant_id", "status", "priority");
CREATE INDEX "problem_tenant_id_service_id_status_idx" ON "problem"("tenant_id", "service_id", "status");
CREATE INDEX "problem_tenant_id_major_incident_id_idx" ON "problem"("tenant_id", "major_incident_id");

-- One problem per major incident, so a replayed review, a re-published one and
-- a second consumer pass all leave exactly one. The handler checks first; this
-- is what holds when two passes check at the same moment.
CREATE UNIQUE INDEX "problem_one_per_major_incident"
  ON "problem"("tenant_id", "major_incident_id")
  WHERE "major_incident_id" IS NOT NULL;

CREATE UNIQUE INDEX "known_error_problem_id_key" ON "known_error"("problem_id");
CREATE INDEX "known_error_tenant_id_status_idx" ON "known_error"("tenant_id", "status");

-- The number that makes a problem arguable: how many tickets, and how many of
-- them the workaround was actually applied to.
CREATE UNIQUE INDEX "problem_ticket_tenant_id_problem_id_ticket_id_key" ON "problem_ticket"("tenant_id", "problem_id", "ticket_id");
CREATE INDEX "problem_ticket_tenant_id_ticket_id_idx" ON "problem_ticket"("tenant_id", "ticket_id");

-- AddForeignKey
ALTER TABLE "known_error" ADD CONSTRAINT "known_error_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "problem_ticket" ADD CONSTRAINT "problem_ticket_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
