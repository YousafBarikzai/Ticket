-- v3 · the import marker (D20, ADR-0056). Expand-only.
--
-- One field was doing two jobs: `source_channel` said how the requester
-- reached the desk *and* how the row reached the database, because every
-- import was stamped with the channel `import`. The ticket meter then left
-- that channel out (ADR-0038). `origin` takes over the second job, so an
-- import can record the channel the work really came in on and still never
-- move the meter, and the creation API can stop accepting `import` at all.
--
-- `native` for every existing row and every ticket raised from now on; only
-- the import path writes `import`. No backfill: tickets imported before this
-- migration keep `source_channel = 'import'`, which the meter still excludes,
-- and a data migration would also have to run per tenant under FORCE RLS.
-- A constant default makes the column a catalogue-only change, so the table
-- is not rewritten.

ALTER TABLE "ticket" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'native';
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_origin_check" CHECK ("origin" IN ('native', 'import'));

-- The four standard lines of every v3 migration. The blanket grant re-grants
-- writes that earlier migrations revoked, so `reassert_role_revokes()`
-- (20261002110000_v3_sla_cycles_and_grants) takes them away again straight
-- after it.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
SELECT reassert_role_revokes();
SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
