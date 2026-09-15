-- MOD-08-E1 Major incident management (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL. It also cannot express the partial unique index below,
-- which is the one constraint in this migration that carries a rule.

-- CreateTable
CREATE TABLE "major_incident" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "ticket_id" UUID,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'SEV2',
    "status" TEXT NOT NULL DEFAULT 'declared',
    "impact_summary" TEXT,
    "affected_service_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "customer_facing" BOOLEAN NOT NULL DEFAULT false,
    "bridge_url" TEXT,
    "commander_id" UUID NOT NULL,
    "comms_lead_id" UUID,
    "scribe_id" UUID,
    "update_interval_minutes" INTEGER NOT NULL DEFAULT 30,
    "next_update_due_at" TIMESTAMPTZ(6),
    "declared_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declared_by" UUID,
    "identified_at" TIMESTAMPTZ(6),
    "mitigated_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "major_incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "major_incident_update" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'comms',
    "audience" TEXT NOT NULL DEFAULT 'internal',
    "body" TEXT NOT NULL,
    "status_from" TEXT,
    "status_to" TEXT,
    "author_id" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "major_incident_update_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_incident_review" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" TEXT,
    "root_cause" TEXT,
    "contributing_factors" TEXT,
    "what_went_well" TEXT,
    "what_did_not" TEXT,
    "duration_minutes" INTEGER,
    "due_on" DATE,
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "post_incident_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "owner_id" UUID,
    "due_on" DATE,
    "status" TEXT NOT NULL DEFAULT 'open',
    "ticket_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "action_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "major_incident_tenant_id_number_key" ON "major_incident"("tenant_id", "number");
CREATE INDEX "major_incident_tenant_id_status_declared_at_idx" ON "major_incident"("tenant_id", "status", "declared_at" DESC);
CREATE INDEX "major_incident_tenant_id_ticket_id_idx" ON "major_incident"("tenant_id", "ticket_id");

-- The comms sweep's whole query: incidents still communicating whose promised
-- update has come due. Partial, because the rows it must never miss are a small
-- and shrinking fraction of every incident ever declared.
CREATE INDEX "major_incident_due_update_idx"
  ON "major_incident"("tenant_id", "next_update_due_at")
  WHERE "next_update_due_at" IS NOT NULL
    AND "status" NOT IN ('resolved', 'closed', 'stood_down');

-- One open major incident per ticket, and the reason it is a constraint rather
-- than a check in the service: two people declaring the same outage within the
-- same second is the normal case, not a rare one, and the symptom is two bridges
-- with half the responders on each. Closed and stood-down incidents are excluded
-- so the same ticket can be declared again if it breaks again.
CREATE UNIQUE INDEX "major_incident_one_open_per_ticket"
  ON "major_incident"("tenant_id", "ticket_id")
  WHERE "ticket_id" IS NOT NULL AND "status" NOT IN ('closed', 'stood_down');

CREATE INDEX "major_incident_update_tenant_id_incident_id_occurred_at_idx" ON "major_incident_update"("tenant_id", "incident_id", "occurred_at");
CREATE INDEX "major_incident_update_tenant_id_audience_occurred_at_idx" ON "major_incident_update"("tenant_id", "audience", "occurred_at" DESC);

CREATE UNIQUE INDEX "post_incident_review_incident_id_key" ON "post_incident_review"("incident_id");
CREATE INDEX "post_incident_review_tenant_id_status_due_on_idx" ON "post_incident_review"("tenant_id", "status", "due_on");

CREATE INDEX "action_item_tenant_id_status_due_on_idx" ON "action_item"("tenant_id", "status", "due_on");
CREATE INDEX "action_item_tenant_id_owner_id_status_idx" ON "action_item"("tenant_id", "owner_id", "status");

-- AddForeignKey
ALTER TABLE "major_incident_update" ADD CONSTRAINT "major_incident_update_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "major_incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_incident_review" ADD CONSTRAINT "post_incident_review_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "major_incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "action_item" ADD CONSTRAINT "action_item_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "post_incident_review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- A timeline entry is never rewritten.
--
-- The same argument as the audit trail (ADR-0014), one layer up: a review
-- answers "what did we know, and when?", and a timeline somebody can revise
-- afterwards cannot answer it. Enforced in the database rather than by
-- convention, because the person most motivated to soften an entry is the
-- person the entry is about.
--
-- UPDATE only, deliberately. Blocking DELETE as well would also block the
-- cascade from the incident and, worse, the tenant purge — which deletes every
-- tenant-scoped table and would leave a purged customer's incident timelines
-- behind. `audit_event` is allowed to survive a purge because retaining it is a
-- decision somebody made on purpose; an incident timeline is ordinary tenant
-- data, and a rule that quietly exempted it from erasure would be the Phase 2
-- purge defect returning one table along.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION major_incident_update_is_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'major_incident_update is append-only: UPDATE attempted on %', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER major_incident_update_no_rewrite
  BEFORE UPDATE ON "major_incident_update"
  FOR EACH ROW EXECUTE FUNCTION major_incident_update_is_immutable();

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
