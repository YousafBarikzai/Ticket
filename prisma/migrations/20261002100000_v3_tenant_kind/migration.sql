-- v3: a tenant's kind (D25, ADR-0054).
--
-- Hand-written, like every migration here: `prisma migrate diff` proposes
-- dropping the generated tsvector columns, the trigram indexes and
-- `platform_table_allowlist`, which exist only in hand-written SQL.
--
-- Expand-only. `kind` says whether a tenant is a real customer ('standard') or
-- the shared, rebuilt-nightly demo ('demo'). The API's interlock reads it on
-- every request: a demo token reaches only a demo tenant, and a demo tenant
-- accepts only demo tokens. The egress guards read it too, so a demo tenant
-- never sends e-mail, calls a webhook or reaches a provider.
--
-- Adding a NOT NULL column with a constant default is a catalogue change on
-- PostgreSQL 16, not a table rewrite, so every existing tenant reads as
-- 'standard' without a backfill or a long lock.

ALTER TABLE "tenant" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_kind_check" CHECK ("kind" IN ('standard', 'demo'));

-- The demo lifecycle looks its tenants up by status (the live one, the one
-- being built, the retired ones awaiting purge). There are only ever a
-- handful, so the index holds only them.
CREATE INDEX "tenant_kind_demo_idx" ON "tenant" ("status") WHERE "kind" = 'demo';

-- A tenant's kind is fixed when it is inserted. Flipping a real tenant to
-- 'demo' would silence its e-mail and lock its people out; flipping the demo
-- to 'standard' would open its egress to anyone holding a demo session.
-- Neither may happen by accident, through any role: the application role
-- cannot write `tenant` at all (row-level security and the revokes that
-- `reassert_role_revokes()` repeats), and this trigger extends the rule to the
-- platform and owner roles.
CREATE OR REPLACE FUNCTION tenant_kind_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'tenant.kind is immutable (tenant %)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_kind_immutable ON "tenant";
CREATE TRIGGER tenant_kind_immutable BEFORE UPDATE OF "kind" ON "tenant"
  FOR EACH ROW EXECUTE FUNCTION tenant_kind_immutable();

-- The standard closing lines. The next migration
-- (20261002110000_v3_sla_cycles_and_grants) creates `reassert_role_revokes()`
-- and calls it straight after its own blanket grant, which repairs what this
-- grant gives back to the application role on the directory tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
