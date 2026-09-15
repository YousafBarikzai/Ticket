-- =============================================================================
-- Phase 2: the service catalogue and its forms (MOD-05, MOD-02).
--
-- Additive statements taken from `prisma migrate diff` and filtered to the
-- catalogue tables. The diff cannot be used whole: it proposes dropping the
-- generated tsvector columns, the trigram indexes and platform_table_allowlist,
-- which exist only in hand-written SQL.
-- =============================================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "service" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_id" UUID,
    "group_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "request_type" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "short_summary" TEXT,
    "form_key" TEXT,
    "entitlement" JSONB,
    "group_id" UUID,
    "priority" TEXT NOT NULL DEFAULT 'P3',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "request_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "form_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "document" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,

    CONSTRAINT "form_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "form_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID,

    CONSTRAINT "form_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "form_submission" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_type_id" UUID,
    "form_version_id" UUID NOT NULL,
    "ticket_id" UUID,
    "submitted_by" UUID,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "service_tenant_id_status_idx" ON "service"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "service_tenant_id_key_key" ON "service"("tenant_id", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "request_type_tenant_id_status_sort_order_idx" ON "request_type"("tenant_id", "status", "sort_order");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "request_type_tenant_id_service_id_idx" ON "request_type"("tenant_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "request_type_tenant_id_key_key" ON "request_type"("tenant_id", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "form_definition_tenant_id_status_idx" ON "form_definition"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "form_definition_tenant_id_key_key" ON "form_definition"("tenant_id", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "form_version_tenant_id_idx" ON "form_version"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "form_version_definition_id_version_key" ON "form_version"("definition_id", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "form_submission_tenant_id_ticket_id_idx" ON "form_submission"("tenant_id", "ticket_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "form_submission_tenant_id_request_type_id_created_at_idx" ON "form_submission"("tenant_id", "request_type_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "request_type" ADD CONSTRAINT "request_type_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_version" ADD CONSTRAINT "form_version_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "form_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_request_type_id_fkey" FOREIGN KEY ("request_type_id") REFERENCES "request_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
