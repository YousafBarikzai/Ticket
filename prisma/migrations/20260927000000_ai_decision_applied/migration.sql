-- Triage that sets fields by itself (ADR-0051, auto mode).
--
-- Hand-written, like every migration here: `prisma migrate diff` proposes
-- dropping the generated tsvector columns, the trigram indexes and
-- `platform_table_allowlist`, which exist only in hand-written SQL.
--
-- Additive. `applied` is what a decision set on the ticket by itself: the
-- field, the value before and after, the confidence and when. It is what the
-- one-click undo restores from, and what the automatic step-down counts
-- people's corrections against. Rows written before this applied nothing,
-- and the default reads as that.

ALTER TABLE "ai_decision" ADD COLUMN "applied" JSONB NOT NULL DEFAULT '{}';

-- The step-down reads the most recent applied decisions for a purpose on
-- every correction a person makes.
CREATE INDEX "ai_decision_applied_recent_idx"
  ON "ai_decision" ("tenant_id", "purpose", "created_at" DESC)
  WHERE "outcome" = 'applied';

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
