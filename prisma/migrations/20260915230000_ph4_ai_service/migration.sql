-- MOD-09 AI, the governed capability service (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL. Table names are taken from each model's `@@map`.
--
-- `ai_prompt`, `ai_prompt_version`, `ai_eval_dataset`, `ai_eval_case` and
-- `ai_eval_run` carry no `tenant_id`: a prompt and its evaluation are the
-- deployment's, every tenant reads the same rows, and no tenant may write one
-- (ADR-0040). Row-level security has nothing to attach to and the allow-list
-- has nothing to say about them. Budgets, jobs and suggestions are the
-- tenant's and are isolated like everything else.

-- CreateTable
CREATE TABLE "ai_prompt" (
    "key" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "current_version" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_prompt_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ai_prompt_version" (
    "id" UUID NOT NULL,
    "prompt_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "score" DOUBLE PRECISION,
    "evaluated_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "change_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_prompt_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_eval_dataset" (
    "key" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_eval_dataset_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ai_eval_case" (
    "id" UUID NOT NULL,
    "dataset_key" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "expect" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_eval_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_eval_run" (
    "id" UUID NOT NULL,
    "prompt_version_id" UUID NOT NULL,
    "dataset_key" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "cost_micros" BIGINT NOT NULL DEFAULT 0,
    "cases" JSONB NOT NULL DEFAULT '[]',
    "ran_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_eval_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_budget" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period_key" TEXT NOT NULL,
    "limit_pence" INTEGER,
    "warn_pence" INTEGER,
    "spent_micros" BIGINT NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'ok',
    "warned_at" TIMESTAMPTZ(6),
    "blocked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_job" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "requested_by" UUID NOT NULL,
    "prompt_key" TEXT NOT NULL,
    "prompt_version" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" BIGINT NOT NULL DEFAULT 0,
    "period_key" TEXT NOT NULL,
    "error" TEXT,
    "prompt_text" TEXT,
    "completion_text" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "ai_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestion" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "outcome_by" UUID,
    "outcome_at" TIMESTAMPTZ(6),
    "outcome_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_prompt_capability_idx" ON "ai_prompt"("capability");
CREATE UNIQUE INDEX "ai_prompt_version_prompt_key_version_key" ON "ai_prompt_version"("prompt_key", "version");
CREATE INDEX "ai_prompt_version_prompt_key_status_idx" ON "ai_prompt_version"("prompt_key", "status");
CREATE INDEX "ai_eval_dataset_capability_idx" ON "ai_eval_dataset"("capability");
CREATE UNIQUE INDEX "ai_eval_case_dataset_key_key_key" ON "ai_eval_case"("dataset_key", "key");
CREATE INDEX "ai_eval_run_prompt_version_id_created_at_idx" ON "ai_eval_run"("prompt_version_id", "created_at" DESC);
CREATE UNIQUE INDEX "ai_budget_tenant_id_period_key_key" ON "ai_budget"("tenant_id", "period_key");
CREATE INDEX "ai_job_tenant_id_status_idx" ON "ai_job"("tenant_id", "status");
CREATE INDEX "ai_job_tenant_id_period_key_status_idx" ON "ai_job"("tenant_id", "period_key", "status");
CREATE INDEX "ai_job_tenant_id_subject_type_subject_id_created_at_idx" ON "ai_job"("tenant_id", "subject_type", "subject_id", "created_at" DESC);
CREATE INDEX "ai_job_tenant_id_created_at_idx" ON "ai_job"("tenant_id", "created_at");
CREATE UNIQUE INDEX "ai_suggestion_job_id_key" ON "ai_suggestion"("job_id");
CREATE INDEX "ai_suggestion_tenant_id_subject_type_subject_id_created_at_idx" ON "ai_suggestion"("tenant_id", "subject_type", "subject_id", "created_at" DESC);
CREATE INDEX "ai_suggestion_tenant_id_capability_outcome_idx" ON "ai_suggestion"("tenant_id", "capability", "outcome");

-- AddForeignKey
ALTER TABLE "ai_prompt_version" ADD CONSTRAINT "ai_prompt_version_prompt_key_fkey" FOREIGN KEY ("prompt_key") REFERENCES "ai_prompt"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_eval_case" ADD CONSTRAINT "ai_eval_case_dataset_key_fkey" FOREIGN KEY ("dataset_key") REFERENCES "ai_eval_dataset"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_eval_run" ADD CONSTRAINT "ai_eval_run_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_eval_run" ADD CONSTRAINT "ai_eval_run_dataset_key_fkey" FOREIGN KEY ("dataset_key") REFERENCES "ai_eval_dataset"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_suggestion" ADD CONSTRAINT "ai_suggestion_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "ai_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- The vocabulary is small and fixed (modules/ai/src/domain).
-- -----------------------------------------------------------------------------
ALTER TABLE "ai_prompt"
  ADD CONSTRAINT "ai_prompt_capability_is_known"
  CHECK ("capability" IN ('reply-draft', 'ticket-summary', 'article-draft', 'similar-work'));
ALTER TABLE "ai_eval_dataset"
  ADD CONSTRAINT "ai_eval_dataset_capability_is_known"
  CHECK ("capability" IN ('reply-draft', 'ticket-summary', 'article-draft', 'similar-work'));
ALTER TABLE "ai_job"
  ADD CONSTRAINT "ai_job_capability_is_known"
  CHECK ("capability" IN ('reply-draft', 'ticket-summary', 'article-draft', 'similar-work'));
ALTER TABLE "ai_suggestion"
  ADD CONSTRAINT "ai_suggestion_capability_is_known"
  CHECK ("capability" IN ('reply-draft', 'ticket-summary', 'article-draft', 'similar-work'));
ALTER TABLE "ai_prompt_version"
  ADD CONSTRAINT "ai_prompt_version_status_is_known"
  CHECK ("status" IN ('draft', 'evaluated', 'published', 'retired'));
ALTER TABLE "ai_job"
  ADD CONSTRAINT "ai_job_status_is_known"
  CHECK ("status" IN ('queued', 'running', 'completed', 'failed', 'refused'));
ALTER TABLE "ai_suggestion"
  ADD CONSTRAINT "ai_suggestion_outcome_is_known"
  CHECK ("outcome" IN ('pending', 'accepted', 'edited', 'rejected'));
ALTER TABLE "ai_suggestion"
  ADD CONSTRAINT "ai_suggestion_confidence_is_a_band"
  CHECK ("confidence" IN ('low', 'medium', 'high'));
ALTER TABLE "ai_budget"
  ADD CONSTRAINT "ai_budget_state_is_known" CHECK ("state" IN ('ok', 'warned', 'blocked'));

-- Money is never negative, and a warning above the cap is a warning that is
-- never reached. The service refuses both first; the database refuses them last.
ALTER TABLE "ai_budget"
  ADD CONSTRAINT "ai_budget_lines_are_sane"
  CHECK (
    "spent_micros" >= 0
    AND ("limit_pence" IS NULL OR "limit_pence" >= 0)
    AND ("warn_pence" IS NULL OR "warn_pence" >= 0)
    AND ("limit_pence" IS NULL OR "warn_pence" IS NULL OR "warn_pence" <= "limit_pence")
  );
ALTER TABLE "ai_job"
  ADD CONSTRAINT "ai_job_cost_is_not_negative"
  CHECK ("cost_micros" >= 0 AND "input_tokens" >= 0 AND "output_tokens" >= 0);

-- A score is a proportion. A threshold that could sit outside 0..1 would make
-- "passed" mean whatever the last person to type a number wanted it to.
ALTER TABLE "ai_eval_dataset"
  ADD CONSTRAINT "ai_eval_dataset_threshold_is_a_proportion" CHECK ("threshold" >= 0 AND "threshold" <= 1);
ALTER TABLE "ai_eval_run"
  ADD CONSTRAINT "ai_eval_run_score_is_a_proportion"
  CHECK ("score" >= 0 AND "score" <= 1 AND "threshold" >= 0 AND "threshold" <= 1);
ALTER TABLE "ai_prompt_version"
  ADD CONSTRAINT "ai_prompt_version_score_is_a_proportion" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 1));

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
