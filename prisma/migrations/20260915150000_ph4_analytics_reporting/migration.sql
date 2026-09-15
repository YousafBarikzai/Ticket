-- MOD-12-E1b Metrics, dashboards and scheduled reports (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL.

-- CreateTable
CREATE TABLE "metric_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fact" TEXT NOT NULL,
    "aggregate" TEXT NOT NULL,
    "field" TEXT,
    "filters" JSONB NOT NULL DEFAULT '[]',
    "numerator_filters" JSONB,
    "unit" TEXT NOT NULL DEFAULT 'count',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "metric_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_id" UUID,
    "seeded" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "dashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_widget" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "dashboard_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '[]',
    "group_by" TEXT,
    "range" TEXT NOT NULL DEFAULT '30d',
    "width" INTEGER NOT NULL DEFAULT 4,
    "options" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "dashboard_widget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "report_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "frequency" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL DEFAULT 0,
    "day_of_week" INTEGER,
    "day_of_month" INTEGER,
    "time_zone" TEXT NOT NULL,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMPTZ(6),
    "next_run_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "schedule_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'running',
    "requested_by" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "period_from" TIMESTAMPTZ(6) NOT NULL,
    "period_to" TIMESTAMPTZ(6) NOT NULL,
    "result" JSONB NOT NULL DEFAULT '[]',
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "error" TEXT,

    CONSTRAINT "report_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "metric_definition_tenant_id_key_key" ON "metric_definition"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "dashboard_tenant_id_owner_id_idx" ON "dashboard"("tenant_id", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_tenant_id_key_key" ON "dashboard"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "dashboard_widget_tenant_id_dashboard_id_position_idx" ON "dashboard_widget"("tenant_id", "dashboard_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "report_definition_tenant_id_key_key" ON "report_definition"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "report_schedule_tenant_id_is_active_next_run_at_idx" ON "report_schedule"("tenant_id", "is_active", "next_run_at");

-- CreateIndex
CREATE INDEX "report_schedule_tenant_id_report_id_idx" ON "report_schedule"("tenant_id", "report_id");

-- CreateIndex
CREATE INDEX "report_run_tenant_id_report_id_started_at_idx" ON "report_run"("tenant_id", "report_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "dashboard_widget" ADD CONSTRAINT "dashboard_widget_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "dashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedule" ADD CONSTRAINT "report_schedule_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_run" ADD CONSTRAINT "report_run_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Invariants. All of these are also checked by the API's schemas; the database
-- copy is for the row written by a script or a migration nobody validated.
-- -----------------------------------------------------------------------------

-- A metric names a fact table and an aggregate this module knows how to run.
-- Anything else would fail at query time with a message about SQL rather than
-- at write time with a message about the metric.
ALTER TABLE "metric_definition"
  ADD CONSTRAINT "metric_definition_fact_is_known"
  CHECK ("fact" IN ('ticket', 'sla_timer', 'approval', 'task', 'notification', 'survey'));
ALTER TABLE "metric_definition"
  ADD CONSTRAINT "metric_definition_aggregate_is_known"
  CHECK ("aggregate" IN ('count', 'sum', 'avg', 'p50', 'p90', 'rate'));

-- Twelve columns; a widget wider than the grid is a widget nobody can see.
ALTER TABLE "dashboard_widget"
  ADD CONSTRAINT "dashboard_widget_fits_the_grid" CHECK ("width" BETWEEN 1 AND 12);

-- A schedule says when, completely. Weekly without a weekday and monthly
-- without a day would both fire never, silently.
ALTER TABLE "report_schedule"
  ADD CONSTRAINT "report_schedule_frequency_is_known" CHECK ("frequency" IN ('daily', 'weekly', 'monthly'));
ALTER TABLE "report_schedule"
  ADD CONSTRAINT "report_schedule_names_its_day"
  CHECK (
    ("frequency" = 'daily') OR
    ("frequency" = 'weekly' AND "day_of_week" BETWEEN 0 AND 6) OR
    ("frequency" = 'monthly' AND "day_of_month" BETWEEN 1 AND 28)
  );
ALTER TABLE "report_schedule"
  ADD CONSTRAINT "report_schedule_time_is_a_time" CHECK ("hour" BETWEEN 0 AND 23 AND "minute" BETWEEN 0 AND 59);

ALTER TABLE "report_run"
  ADD CONSTRAINT "report_run_status_is_known" CHECK ("status" IN ('running', 'done', 'failed'));
ALTER TABLE "report_run"
  ADD CONSTRAINT "report_run_period_runs_forwards" CHECK ("period_to" > "period_from");

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
