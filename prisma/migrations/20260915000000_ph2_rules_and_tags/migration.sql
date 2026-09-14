-- =============================================================================
-- Phase 2: the business rules engine, ticket tags and requester standing.
--
-- Written by hand rather than taken from `prisma migrate diff`. The diff is not
-- safe to use on this schema: the generated tsvector columns, the trigram
-- indexes and platform_table_allowlist exist only in hand-written SQL, so a
-- generated migration proposes dropping all of them. The additive statements
-- below were taken from the diff; nothing destructive was.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Requester standing (MOD-01)
--
-- Business rules and the SLA policy matcher both need to know who a ticket is
-- for. Columns rather than a JSON bag so they can be indexed and so a rule that
-- reads requester.vip is checkable at publish time.
-- -----------------------------------------------------------------------------
ALTER TABLE "app_user_account" ADD COLUMN IF NOT EXISTS "vip" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "app_user_account" ADD COLUMN IF NOT EXISTS "tier" TEXT;
CREATE INDEX IF NOT EXISTS "app_user_account_tenant_vip_idx" ON "app_user_account" ("tenant_id") WHERE "vip";

-- -----------------------------------------------------------------------------
-- 2. Ticket tags (MOD-04)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ticket_tag" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "tag" TEXT NOT NULL,
    "added_by" UUID,
    "added_by_type" TEXT NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_tag_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ticket_tag_tenant_id_tag_idx" ON "ticket_tag"("tenant_id", "tag");
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_tag_ticket_id_tag_key" ON "ticket_tag"("ticket_id", "tag");
ALTER TABLE "ticket_tag" DROP CONSTRAINT IF EXISTS "ticket_tag_ticket_id_fkey";
ALTER TABLE "ticket_tag" ADD CONSTRAINT "ticket_tag_ticket_id_fkey"
  FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 3. Business rules (MOD-06-E0)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "business_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "event" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{"always":true}',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "order" INTEGER NOT NULL DEFAULT 100,
    "mode" TEXT NOT NULL DEFAULT 'continue',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,
    CONSTRAINT "business_rule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "business_rule_tenant_id_key_key" ON "business_rule"("tenant_id", "key");
CREATE INDEX IF NOT EXISTS "business_rule_tenant_id_event_status_order_idx"
  ON "business_rule"("tenant_id", "event", "status", "order");

CREATE TABLE IF NOT EXISTS "business_rule_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID,
    CONSTRAINT "business_rule_version_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "business_rule_version_tenant_id_idx" ON "business_rule_version"("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "business_rule_version_rule_id_version_key"
  ON "business_rule_version"("rule_id", "version");
ALTER TABLE "business_rule_version" DROP CONSTRAINT IF EXISTS "business_rule_version_rule_id_fkey";
ALTER TABLE "business_rule_version" ADD CONSTRAINT "business_rule_version_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "business_rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "rule_application" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "rule_version" INTEGER NOT NULL,
    "ticket_id" UUID,
    "event" TEXT NOT NULL,
    "applied" JSONB NOT NULL DEFAULT '[]',
    "skipped" JSONB NOT NULL DEFAULT '[]',
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rule_application_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "rule_application_tenant_id_ticket_id_idx" ON "rule_application"("tenant_id", "ticket_id");
CREATE INDEX IF NOT EXISTS "rule_application_tenant_id_rule_id_applied_at_idx"
  ON "rule_application"("tenant_id", "rule_id", "applied_at" DESC);
ALTER TABLE "rule_application" DROP CONSTRAINT IF EXISTS "rule_application_rule_id_fkey";
ALTER TABLE "rule_application" ADD CONSTRAINT "rule_application_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "business_rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 4. Isolation and grants for everything added above
--
-- apply_tenant_rls() finds new tables by their tenant_id column rather than by a
-- list, so this is the whole of it; assert_tenant_rls_complete() then refuses to
-- let the migration finish if anything was missed.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
