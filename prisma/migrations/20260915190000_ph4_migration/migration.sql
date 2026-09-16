-- MOD-24 Migration (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL.

-- CreateTable
CREATE TABLE "import_mapping" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_file" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "mapping" JSONB NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'dry_run',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "seen" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "file_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_record" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "external_key" TEXT,
    "outcome" TEXT NOT NULL,
    "entity_id" UUID,
    "mapped" JSONB,
    "problems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_link" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "external_key" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "job_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_mapping_tenant_id_key_key" ON "import_mapping"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "import_file_tenant_id_created_at_idx" ON "import_file"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "import_job_tenant_id_created_at_idx" ON "import_job"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "import_job_tenant_id_status_idx" ON "import_job"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "import_record_tenant_id_job_id_outcome_idx" ON "import_record"("tenant_id", "job_id", "outcome");

-- CreateIndex
CREATE INDEX "import_record_tenant_id_job_id_row_number_idx" ON "import_record"("tenant_id", "job_id", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "import_link_tenant_id_entity_external_key_key" ON "import_link"("tenant_id", "entity", "external_key");

-- CreateIndex
CREATE INDEX "import_link_tenant_id_entity_entity_id_idx" ON "import_link"("tenant_id", "entity", "entity_id");

-- AddForeignKey
ALTER TABLE "import_record" ADD CONSTRAINT "import_record_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "import_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- The vocabulary is small and fixed (modules/migration/src/domain).
-- -----------------------------------------------------------------------------
ALTER TABLE "import_mapping"
  ADD CONSTRAINT "import_mapping_entity_is_known"
  CHECK ("entity" IN ('users', 'teams', 'services', 'tickets', 'comments'));
ALTER TABLE "import_job"
  ADD CONSTRAINT "import_job_entity_is_known"
  CHECK ("entity" IN ('users', 'teams', 'services', 'tickets', 'comments'));
ALTER TABLE "import_job"
  ADD CONSTRAINT "import_job_source_is_known"
  CHECK ("source" IN ('csv', 'http_json', 'servicenow', 'jira', 'freshservice'));
ALTER TABLE "import_job"
  ADD CONSTRAINT "import_job_mode_is_known" CHECK ("mode" IN ('dry_run', 'commit'));
ALTER TABLE "import_job"
  ADD CONSTRAINT "import_job_status_is_known"
  CHECK ("status" IN ('pending', 'running', 'completed', 'failed', 'cancelled'));
ALTER TABLE "import_record"
  ADD CONSTRAINT "import_record_outcome_is_known"
  CHECK ("outcome" IN ('would_create', 'would_update', 'would_skip', 'created', 'updated', 'unchanged', 'failed'));
ALTER TABLE "import_link"
  ADD CONSTRAINT "import_link_entity_is_known"
  CHECK ("entity" IN ('users', 'teams', 'services', 'tickets', 'comments'));
-- An uploaded file is bounded; the service checks first, the database last.
ALTER TABLE "import_file"
  ADD CONSTRAINT "import_file_is_bounded" CHECK ("bytes" > 0 AND "bytes" <= 20971520);

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
