-- Structured decisions (ADR-0051).
--
-- Hand-written, like every migration here: `prisma migrate diff` proposes
-- dropping the generated tsvector columns, the trigram indexes and
-- `platform_table_allowlist`, which exist only in hand-written SQL.
--
-- Additive only. One new tenant table, and two nullable columns on `ai_job`
-- so generation keeps the same latency and provider-request record a decision
-- does. Nothing existing changes meaning, and nothing reads the new table
-- until a tenant switches a purpose on.

-- AlterTable
ALTER TABLE "ai_job" ADD COLUMN "latency_ms" INTEGER;
ALTER TABLE "ai_job" ADD COLUMN "provider_request_id" TEXT;

-- CreateTable
CREATE TABLE "ai_decision" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "question_set_version" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "provider_request_id" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "proposed" JSONB NOT NULL DEFAULT '{}',
    "plan" JSONB NOT NULL DEFAULT '[]',
    "attempts" JSONB NOT NULL DEFAULT '[]',
    "problems" JSONB NOT NULL DEFAULT '[]',
    "omitted" JSONB NOT NULL DEFAULT '[]',
    "outcome" TEXT NOT NULL,
    "settled" JSONB,
    "settled_at" TIMESTAMPTZ(6),
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" BIGINT NOT NULL DEFAULT 0,
    "period_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_decision_tenant_id_subject_type_subject_id_created_at_idx" ON "ai_decision"("tenant_id", "subject_type", "subject_id", "created_at" DESC);
CREATE INDEX "ai_decision_tenant_id_purpose_created_at_idx" ON "ai_decision"("tenant_id", "purpose", "created_at" DESC);
CREATE INDEX "ai_decision_tenant_id_period_key_idx" ON "ai_decision"("tenant_id", "period_key");

-- -----------------------------------------------------------------------------
-- The vocabulary is small and fixed (modules/ai/src/domain/decisions.ts).
-- `off` is not a stored mode: a purpose that is off sends nothing and records
-- nothing.
-- -----------------------------------------------------------------------------
ALTER TABLE "ai_decision"
  ADD CONSTRAINT "ai_decision_purpose_is_known" CHECK ("purpose" IN ('triage'));
ALTER TABLE "ai_decision"
  ADD CONSTRAINT "ai_decision_mode_is_known" CHECK ("mode" IN ('shadow', 'suggest', 'auto'));
ALTER TABLE "ai_decision"
  ADD CONSTRAINT "ai_decision_outcome_is_known" CHECK ("outcome" IN ('shadowed', 'suggested', 'applied', 'none'));

-- A decision nobody answered names no model. One that was
-- answered names who answered it.
ALTER TABLE "ai_decision"
  ADD CONSTRAINT "ai_decision_rules_means_no_model"
  CHECK (("provider" = 'rules') = ("model" IS NULL));

ALTER TABLE "ai_decision"
  ADD CONSTRAINT "ai_decision_cost_is_not_negative"
  CHECK ("cost_micros" >= 0 AND "input_tokens" >= 0 AND "output_tokens" >= 0 AND "latency_ms" >= 0);
ALTER TABLE "ai_job"
  ADD CONSTRAINT "ai_job_latency_is_not_negative" CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0);

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
