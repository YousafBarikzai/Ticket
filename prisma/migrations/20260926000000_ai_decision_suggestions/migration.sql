-- Triage suggestions shown to agents (ADR-0051, suggest mode).
--
-- Hand-written, like every migration here: `prisma migrate diff` proposes
-- dropping the generated tsvector columns, the trigram indexes and
-- `platform_table_allowlist`, which exist only in hand-written SQL.
--
-- Additive. `baseline` is the ticket's triage fields when a decision was made,
-- so a suggestion can be withdrawn once a person changes the field. `responses`
-- is what agents did with each suggestion. Rows written before this have
-- neither, and the defaults read as "nothing recorded".

ALTER TABLE "ai_decision" ADD COLUMN "baseline" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ai_decision" ADD COLUMN "responses" JSONB NOT NULL DEFAULT '{}';

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
