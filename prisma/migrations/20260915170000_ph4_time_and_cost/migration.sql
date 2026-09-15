-- MOD-19 Time and cost (PH-4), and MOD-12's fact_time_entry.
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL.

-- CreateTable
CREATE TABLE "fact_time_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "task_id" UUID,
    "user_id" UUID NOT NULL,
    "team_id" UUID,
    "service_id" UUID,
    "activity_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "logged_date" DATE NOT NULL,
    "logged_at" TIMESTAMPTZ(6) NOT NULL,
    "last_event_id" UUID NOT NULL,
    "last_event_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fact_time_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_type" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "rate_per_hour" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'GBP',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "activity_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_rate" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "activity_type_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "rate_per_hour" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cost_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "task_id" UUID,
    "user_id" UUID NOT NULL,
    "activity_type_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "rate_per_hour" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'GBP',
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "logged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "time_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "running_timer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "activity_type_id" UUID NOT NULL,
    "note" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "running_timer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_status_span" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "entered_at" TIMESTAMPTZ(6) NOT NULL,
    "exited_at" TIMESTAMPTZ(6),

    CONSTRAINT "ticket_status_span_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" UUID,
    "period_kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "warn_at" INTEGER NOT NULL DEFAULT 80,
    "owner_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_period" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "spent" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "warned_at" TIMESTAMPTZ(6),
    "reached_at" TIMESTAMPTZ(6),
    "recomputed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "budget_period_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fact_time_entry_tenant_id_logged_date_idx" ON "fact_time_entry"("tenant_id", "logged_date");

-- CreateIndex
CREATE INDEX "fact_time_entry_tenant_id_team_id_logged_date_idx" ON "fact_time_entry"("tenant_id", "team_id", "logged_date");

-- CreateIndex
CREATE INDEX "fact_time_entry_tenant_id_kind_logged_date_idx" ON "fact_time_entry"("tenant_id", "kind", "logged_date");

-- CreateIndex
CREATE UNIQUE INDEX "fact_time_entry_tenant_id_entry_id_key" ON "fact_time_entry"("tenant_id", "entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_type_tenant_id_key_key" ON "activity_type"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "cost_rate_tenant_id_activity_type_id_team_id_key" ON "cost_rate"("tenant_id", "activity_type_id", "team_id");

-- CreateIndex
CREATE INDEX "time_entry_tenant_id_ticket_id_idx" ON "time_entry"("tenant_id", "ticket_id");

-- CreateIndex
CREATE INDEX "time_entry_tenant_id_user_id_logged_at_idx" ON "time_entry"("tenant_id", "user_id", "logged_at" DESC);

-- CreateIndex
CREATE INDEX "time_entry_tenant_id_logged_at_idx" ON "time_entry"("tenant_id", "logged_at");

-- CreateIndex
CREATE UNIQUE INDEX "running_timer_tenant_id_user_id_key" ON "running_timer"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "ticket_status_span_tenant_id_ticket_id_exited_at_idx" ON "ticket_status_span"("tenant_id", "ticket_id", "exited_at");

-- CreateIndex
CREATE INDEX "budget_tenant_id_scope_type_scope_id_is_active_idx" ON "budget"("tenant_id", "scope_type", "scope_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "budget_tenant_id_key_key" ON "budget"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "budget_period_tenant_id_period_start_idx" ON "budget_period"("tenant_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "budget_period_budget_id_period_start_key" ON "budget_period"("budget_id", "period_start");

-- AddForeignKey
ALTER TABLE "cost_rate" ADD CONSTRAINT "cost_rate_activity_type_id_fkey" FOREIGN KEY ("activity_type_id") REFERENCES "activity_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_period" ADD CONSTRAINT "budget_period_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Invariants.
-- -----------------------------------------------------------------------------

-- Three kinds of time, and the third is never priced: elapsed time is a
-- measurement, and a row that priced it would be counted as effort by the
-- first report that forgot to filter.
ALTER TABLE "time_entry"
  ADD CONSTRAINT "time_entry_kind_is_known" CHECK ("kind" IN ('manual', 'timer', 'automatic'));
ALTER TABLE "time_entry"
  ADD CONSTRAINT "time_entry_elapsed_costs_nothing" CHECK ("kind" <> 'automatic' OR ("cost" = 0 AND "billable" = false));
ALTER TABLE "time_entry"
  ADD CONSTRAINT "time_entry_minutes_are_positive" CHECK ("minutes" >= 0);
ALTER TABLE "time_entry"
  ADD CONSTRAINT "time_entry_cost_is_not_negative" CHECK ("cost" >= 0 AND "rate_per_hour" >= 0);

ALTER TABLE "fact_time_entry"
  ADD CONSTRAINT "fact_time_entry_kind_is_known" CHECK ("kind" IN ('manual', 'timer', 'automatic'));

ALTER TABLE "activity_type"
  ADD CONSTRAINT "activity_type_rate_is_not_negative" CHECK ("rate_per_hour" >= 0);
ALTER TABLE "cost_rate"
  ADD CONSTRAINT "cost_rate_is_not_negative" CHECK ("rate_per_hour" >= 0);

-- A budget names what it bounds, and a tenant-wide one names nothing.
ALTER TABLE "budget"
  ADD CONSTRAINT "budget_scope_is_known" CHECK ("scope_type" IN ('tenant', 'service', 'organisation', 'team'));
ALTER TABLE "budget"
  ADD CONSTRAINT "budget_scope_names_its_subject" CHECK (("scope_type" = 'tenant') = ("scope_id" IS NULL));
ALTER TABLE "budget"
  ADD CONSTRAINT "budget_period_is_known" CHECK ("period_kind" IN ('month', 'quarter', 'year'));
ALTER TABLE "budget"
  ADD CONSTRAINT "budget_amount_is_positive" CHECK ("amount" > 0);
ALTER TABLE "budget"
  ADD CONSTRAINT "budget_warns_before_its_limit" CHECK ("warn_at" BETWEEN 1 AND 99);

ALTER TABLE "budget_period"
  ADD CONSTRAINT "budget_period_runs_forwards" CHECK ("period_end" > "period_start");

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
