-- MOD-23 Status page (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL.
--
-- Every table here is tenant-scoped and isolated by `apply_tenant_rls()` like
-- any other. The public page is read through a context for that tenant, never
-- through the platform role: the only thing a stranger may look up before a
-- tenant is known is the tenant directory itself (ADR-0035).

-- CreateTable
CREATE TABLE "status_page" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "time_zone" TEXT NOT NULL DEFAULT 'Europe/London',
    "support_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "status_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_component" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "group_name" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "service_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'operational',
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "status_component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_incident" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "major_incident_id" UUID,
    "title" TEXT NOT NULL,
    "impact" TEXT NOT NULL DEFAULT 'minor',
    "status" TEXT NOT NULL DEFAULT 'investigating',
    "component_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "status_incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_update" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_ref" UUID,
    "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_by" UUID,
    "notified_at" TIMESTAMPTZ(6),

    CONSTRAINT "status_update_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_window" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "change_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "component_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "notified_at" TIMESTAMPTZ(6),

    CONSTRAINT "maintenance_window_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_subscriber" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "unsubscribed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "status_page_tenant_id_key" ON "status_page"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "status_component_tenant_id_key_key" ON "status_component"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "status_component_tenant_id_service_id_idx" ON "status_component"("tenant_id", "service_id");

-- CreateIndex
CREATE INDEX "status_incident_tenant_id_page_id_status_started_at_idx" ON "status_incident"("tenant_id", "page_id", "status", "started_at" DESC);

-- CreateIndex
CREATE INDEX "status_incident_tenant_id_major_incident_id_idx" ON "status_incident"("tenant_id", "major_incident_id");

-- CreateIndex
CREATE UNIQUE INDEX "status_update_tenant_id_source_ref_key" ON "status_update"("tenant_id", "source_ref");

-- CreateIndex
CREATE INDEX "status_update_tenant_id_incident_id_posted_at_idx" ON "status_update"("tenant_id", "incident_id", "posted_at");

-- CreateIndex
CREATE INDEX "maintenance_window_tenant_id_page_id_status_starts_at_idx" ON "maintenance_window"("tenant_id", "page_id", "status", "starts_at");

-- CreateIndex
CREATE INDEX "maintenance_window_tenant_id_change_id_idx" ON "maintenance_window"("tenant_id", "change_id");

-- CreateIndex
CREATE UNIQUE INDEX "status_subscriber_tenant_id_email_key" ON "status_subscriber"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "status_subscriber_tenant_id_page_id_confirmed_at_idx" ON "status_subscriber"("tenant_id", "page_id", "confirmed_at");

-- AddForeignKey
ALTER TABLE "status_component" ADD CONSTRAINT "status_component_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "status_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_incident" ADD CONSTRAINT "status_incident_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "status_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_update" ADD CONSTRAINT "status_update_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "status_incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_window" ADD CONSTRAINT "maintenance_window_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "status_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_subscriber" ADD CONSTRAINT "status_subscriber_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "status_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- The page's vocabulary is small and fixed (modules/statuspage/src/domain).
-- -----------------------------------------------------------------------------
ALTER TABLE "status_component"
  ADD CONSTRAINT "status_component_status_is_known"
  CHECK ("status" IN ('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'));

ALTER TABLE "status_incident"
  ADD CONSTRAINT "status_incident_impact_is_known"
  CHECK ("impact" IN ('none', 'minor', 'major', 'critical'));
ALTER TABLE "status_incident"
  ADD CONSTRAINT "status_incident_status_is_known"
  CHECK ("status" IN ('investigating', 'identified', 'monitoring', 'resolved'));
-- An incident is resolved exactly when it has a resolution time.
ALTER TABLE "status_incident"
  ADD CONSTRAINT "status_incident_resolved_means_resolved_at"
  CHECK (("status" = 'resolved') = ("resolved_at" IS NOT NULL));

ALTER TABLE "status_update"
  ADD CONSTRAINT "status_update_status_is_known"
  CHECK ("status" IN ('investigating', 'identified', 'monitoring', 'resolved'));
ALTER TABLE "status_update"
  ADD CONSTRAINT "status_update_source_is_known"
  CHECK ("source" IN ('major_incident', 'manual'));

ALTER TABLE "maintenance_window"
  ADD CONSTRAINT "maintenance_window_status_is_known"
  CHECK ("status" IN ('scheduled', 'in_progress', 'completed', 'cancelled'));
-- A window that ends before it starts is not a window.
ALTER TABLE "maintenance_window"
  ADD CONSTRAINT "maintenance_window_ends_after_start" CHECK ("ends_at" > "starts_at");

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
