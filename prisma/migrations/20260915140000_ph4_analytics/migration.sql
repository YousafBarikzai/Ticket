-- MOD-12 Reporting and analytics: the projection pipeline (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL.
--
-- `dim_date` is the one table here with no `tenant_id`, and deliberately: a
-- Tuesday in March is the same Tuesday for every tenant. It therefore takes no
-- row-level security policy — `apply_tenant_rls()` only touches tables that
-- have the column — and needs no entry in `platform_table_allowlist`, which
-- lists tables that HAVE a tenant and are exempt anyway.

-- CreateTable
CREATE TABLE "dim_date" (
    "date" DATE NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "iso_week" INTEGER NOT NULL,
    "iso_year" INTEGER NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "is_weekend" BOOLEAN NOT NULL,

    CONSTRAINT "dim_date_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "dim_user" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "team_id" UUID,
    "team_name" TEXT,
    "org_id" UUID,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),

    CONSTRAINT "dim_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dim_team" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "org_id" UUID,

    CONSTRAINT "dim_team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dim_service" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "owner_id" UUID,

    CONSTRAINT "dim_service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dim_category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parent_name" TEXT,

    CONSTRAINT "dim_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dim_channel" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "dim_channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_ticket" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priority" TEXT,
    "status" TEXT NOT NULL,
    "service_id" UUID,
    "category_id" UUID,
    "team_id" UUID,
    "assignee_id" UUID,
    "requester_id" UUID,
    "channel" TEXT,
    "created_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "first_response_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "time_to_first_response_minutes" INTEGER,
    "time_to_resolve_minutes" INTEGER,
    "elapsed_to_resolve_minutes" INTEGER,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "breached" BOOLEAN NOT NULL DEFAULT false,
    "last_event_id" UUID NOT NULL,
    "last_event_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fact_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_sla_timer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "timer_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "policy_id" UUID,
    "target" TEXT NOT NULL,
    "priority" TEXT,
    "team_id" UUID,
    "service_id" UUID,
    "started_date" DATE NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "due_at" TIMESTAMPTZ(6),
    "stopped_at" TIMESTAMPTZ(6),
    "outcome" TEXT NOT NULL DEFAULT 'running',
    "paused_minutes" INTEGER NOT NULL DEFAULT 0,
    "business_minutes" INTEGER,
    "margin_minutes" INTEGER,
    "last_event_id" UUID NOT NULL,
    "last_event_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fact_sla_timer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_approval" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "policy_id" UUID,
    "requested_date" DATE NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "decider_id" UUID,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "turnaround_minutes" INTEGER,
    "last_event_id" UUID NOT NULL,
    "last_event_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fact_approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "assignee_id" UUID,
    "team_id" UUID,
    "created_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "completion_minutes" INTEGER,
    "last_event_id" UUID NOT NULL,
    "last_event_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fact_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_notification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "template_key" TEXT,
    "queued_date" DATE NOT NULL,
    "queued_at" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "outcome" TEXT NOT NULL DEFAULT 'queued',
    "failure_reason" TEXT,
    "latency_minutes" INTEGER,
    "last_event_id" UUID NOT NULL,
    "last_event_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fact_notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_survey" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "response_id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "ticket_id" UUID,
    "respondent_id" UUID,
    "team_id" UUID,
    "service_id" UUID,
    "responded_date" DATE NOT NULL,
    "responded_at" TIMESTAMPTZ(6) NOT NULL,
    "score" INTEGER,
    "scale" TEXT,
    "comment" TEXT,
    "last_event_id" UUID NOT NULL,
    "last_event_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fact_survey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rollup_ticket_daily" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "grouping_key" TEXT NOT NULL,
    "team_id" UUID,
    "service_id" UUID,
    "priority" TEXT,
    "created" INTEGER NOT NULL DEFAULT 0,
    "resolved" INTEGER NOT NULL DEFAULT 0,
    "closed" INTEGER NOT NULL DEFAULT 0,
    "reopened" INTEGER NOT NULL DEFAULT 0,
    "breached" INTEGER NOT NULL DEFAULT 0,
    "resolve_minutes_sum" INTEGER NOT NULL DEFAULT 0,
    "resolve_minutes_count" INTEGER NOT NULL DEFAULT 0,
    "first_response_minutes_sum" INTEGER NOT NULL DEFAULT 0,
    "first_response_minutes_count" INTEGER NOT NULL DEFAULT 0,
    "rebuilt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rollup_ticket_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projection_cursor" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "projector" TEXT NOT NULL,
    "last_event_id" UUID,
    "last_event_at" TIMESTAMPTZ(6),
    "processed" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projection_cursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projection_drift" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projector" TEXT NOT NULL,
    "expected" INTEGER NOT NULL,
    "actual" INTEGER NOT NULL,
    "drift_ratio" DOUBLE PRECISION NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "projection_drift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dim_date_year_month_idx" ON "dim_date"("year", "month");

-- CreateIndex
CREATE INDEX "dim_user_tenant_id_user_id_valid_to_idx" ON "dim_user"("tenant_id", "user_id", "valid_to");

-- CreateIndex
CREATE UNIQUE INDEX "dim_user_tenant_id_user_id_valid_from_key" ON "dim_user"("tenant_id", "user_id", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "dim_team_tenant_id_team_id_key" ON "dim_team"("tenant_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "dim_service_tenant_id_service_id_key" ON "dim_service"("tenant_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "dim_category_tenant_id_category_id_key" ON "dim_category"("tenant_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "dim_channel_tenant_id_key_key" ON "dim_channel"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "fact_ticket_tenant_id_created_date_idx" ON "fact_ticket"("tenant_id", "created_date");

-- CreateIndex
CREATE INDEX "fact_ticket_tenant_id_team_id_created_date_idx" ON "fact_ticket"("tenant_id", "team_id", "created_date");

-- CreateIndex
CREATE INDEX "fact_ticket_tenant_id_service_id_created_date_idx" ON "fact_ticket"("tenant_id", "service_id", "created_date");

-- CreateIndex
CREATE INDEX "fact_ticket_tenant_id_status_created_date_idx" ON "fact_ticket"("tenant_id", "status", "created_date");

-- CreateIndex
CREATE UNIQUE INDEX "fact_ticket_tenant_id_ticket_id_key" ON "fact_ticket"("tenant_id", "ticket_id");

-- CreateIndex
CREATE INDEX "fact_sla_timer_tenant_id_started_date_idx" ON "fact_sla_timer"("tenant_id", "started_date");

-- CreateIndex
CREATE INDEX "fact_sla_timer_tenant_id_outcome_started_date_idx" ON "fact_sla_timer"("tenant_id", "outcome", "started_date");

-- CreateIndex
CREATE INDEX "fact_sla_timer_tenant_id_team_id_outcome_idx" ON "fact_sla_timer"("tenant_id", "team_id", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "fact_sla_timer_tenant_id_timer_id_key" ON "fact_sla_timer"("tenant_id", "timer_id");

-- CreateIndex
CREATE INDEX "fact_approval_tenant_id_requested_date_idx" ON "fact_approval"("tenant_id", "requested_date");

-- CreateIndex
CREATE INDEX "fact_approval_tenant_id_outcome_requested_date_idx" ON "fact_approval"("tenant_id", "outcome", "requested_date");

-- CreateIndex
CREATE UNIQUE INDEX "fact_approval_tenant_id_request_id_key" ON "fact_approval"("tenant_id", "request_id");

-- CreateIndex
CREATE INDEX "fact_task_tenant_id_created_date_idx" ON "fact_task"("tenant_id", "created_date");

-- CreateIndex
CREATE UNIQUE INDEX "fact_task_tenant_id_task_id_key" ON "fact_task"("tenant_id", "task_id");

-- CreateIndex
CREATE INDEX "fact_notification_tenant_id_queued_date_idx" ON "fact_notification"("tenant_id", "queued_date");

-- CreateIndex
CREATE INDEX "fact_notification_tenant_id_outcome_channel_idx" ON "fact_notification"("tenant_id", "outcome", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "fact_notification_tenant_id_notification_id_key" ON "fact_notification"("tenant_id", "notification_id");

-- CreateIndex
CREATE INDEX "fact_survey_tenant_id_responded_date_idx" ON "fact_survey"("tenant_id", "responded_date");

-- CreateIndex
CREATE UNIQUE INDEX "fact_survey_tenant_id_response_id_key" ON "fact_survey"("tenant_id", "response_id");

-- CreateIndex
CREATE INDEX "rollup_ticket_daily_tenant_id_date_idx" ON "rollup_ticket_daily"("tenant_id", "date");

-- CreateIndex
CREATE INDEX "rollup_ticket_daily_tenant_id_team_id_date_idx" ON "rollup_ticket_daily"("tenant_id", "team_id", "date");

-- CreateIndex
CREATE INDEX "rollup_ticket_daily_tenant_id_service_id_date_idx" ON "rollup_ticket_daily"("tenant_id", "service_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "rollup_ticket_daily_tenant_id_date_grouping_key_key" ON "rollup_ticket_daily"("tenant_id", "date", "grouping_key");

-- CreateIndex
CREATE UNIQUE INDEX "projection_cursor_tenant_id_projector_key" ON "projection_cursor"("tenant_id", "projector");

-- CreateIndex
CREATE INDEX "projection_drift_tenant_id_checked_at_idx" ON "projection_drift"("tenant_id", "checked_at");

-- CreateIndex
CREATE INDEX "projection_drift_tenant_id_resolved_checked_at_idx" ON "projection_drift"("tenant_id", "resolved", "checked_at");


-- -----------------------------------------------------------------------------
-- Invariants.
--
-- Only the ones ordinary operation cannot violate. A CHECK inside a projector's
-- transaction fails the event handler, which retries it, which fails again: the
-- analytics consumer stops and takes every later projection with it. A wrong
-- number that the nightly rebuild corrects is a far smaller problem than a
-- consumer that will not move, so the counters carry no non-negative
-- constraint even though a negative one would mean a bug.
-- -----------------------------------------------------------------------------

-- A timer has one of three outcomes and no others; "running" is a real answer,
-- because "how many are at risk right now" is a question about the ones that
-- have not finished.
ALTER TABLE "fact_sla_timer"
  ADD CONSTRAINT "fact_sla_timer_outcome_is_known"
  CHECK ("outcome" IN ('running', 'met', 'breached'));

ALTER TABLE "fact_notification"
  ADD CONSTRAINT "fact_notification_outcome_is_known"
  CHECK ("outcome" IN ('queued', 'sent', 'failed'));

-- Drift is a magnitude. A negative ratio would mean the comparison itself is
-- the wrong way round, which is worth failing on rather than charting.
ALTER TABLE "projection_drift"
  ADD CONSTRAINT "projection_drift_ratio_is_a_magnitude" CHECK ("drift_ratio" >= 0);

-- The grouping key is the row's identity — see the model comment on why it
-- exists rather than a unique index over three nullable columns — so an empty
-- one would let two "all" rows coexist and every total would double.
ALTER TABLE "rollup_ticket_daily"
  ADD CONSTRAINT "rollup_ticket_daily_grouping_key_is_present" CHECK (length("grouping_key") > 0);

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
