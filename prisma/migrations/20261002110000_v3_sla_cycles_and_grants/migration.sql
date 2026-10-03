-- v3: the SLA update cycle (F1, ADR-0057) and the repair of the role grants (D25).
--
-- Hand-written, like every migration here: `prisma migrate diff` proposes
-- dropping the generated tsvector columns, the trigram indexes and
-- `platform_table_allowlist`, which exist only in hand-written SQL.
--
-- Expand-only: two columns with defaults, a check, and a function.

-- -----------------------------------------------------------------------------
-- 1. The update cycle
--
-- An `update` target is a promise to keep the requester informed: every agent
-- reply meets the current cycle and starts the next one. A cycle is a counter
-- on the timer's row, never a new row, because `sla_timer` is unique on
-- (tenant_id, ticket_id, target_type) and reporting keeps one fact per ticket
-- and target. `cycle_started_at` is NULL until the first restart; until then
-- the cycle began when the timer did.
-- -----------------------------------------------------------------------------
ALTER TABLE "sla_timer"
  ADD COLUMN "cycle" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "cycle_started_at" TIMESTAMPTZ(6);
ALTER TABLE "sla_timer" ADD CONSTRAINT "sla_timer_cycle_is_positive" CHECK ("cycle" >= 1);

-- A cancelled timer is no verdict (U7): the fact says `cancelled`, and
-- attainment, which counts only `met` and `breached`, leaves it out. Before
-- F1 nothing told reporting about a cancellation, so the fact said `running`
-- for ever. The check is widened, never narrowed: every existing value stays
-- valid, and re-adding it validates every existing row.
ALTER TABLE "fact_sla_timer" DROP CONSTRAINT "fact_sla_timer_outcome_is_known";
ALTER TABLE "fact_sla_timer"
  ADD CONSTRAINT "fact_sla_timer_outcome_is_known"
  CHECK ("outcome" IN ('running', 'met', 'breached', 'cancelled'));

-- -----------------------------------------------------------------------------
-- 2. The role revokes, reasserted
--
-- The security migration (20260914000100, section 4) revokes writes the
-- application role must never have: UPDATE and DELETE on the audit trail
-- (ADR-0014), any write to the isolation allow-list, and writes to the tenant
-- directory, which only the platform role keeps. The metering migration does
-- the same for `plan` and `plan_limit`. But every later migration ends with
-- the blanket `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES`, and that
-- statement gives every one of those privileges straight back.
--
-- Row-level security still held the line on `tenant` and `tenant_grant`
-- (their application-role policies are SELECT-only and their security is
-- forced), and the audit trigger refuses changes whatever the grant says. But
-- `plan`, `plan_limit`, `consumer_registry` and the allow-list have no
-- row-level security, so only the absence of application code that writes
-- them kept the application role out — every writer goes through the platform
-- role, which is also why revoking again breaks nothing. A control that the
-- next migration undoes is not a control. This
-- function states the revokes once, and **every migration from this one on
-- calls it straight after its blanket grant**, exactly as every migration
-- already calls `apply_tenant_rls()`. `tests/isolation/role-grants.test.ts`
-- checks the privileges themselves with `has_table_privilege`, so a future
-- migration that forgets the call fails CI.
--
-- `demo_generation` (the demo ledger, 20261002140000) is covered once it
-- exists; the platform role writes it, the application role only reads it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reassert_role_revokes() RETURNS void AS $$
BEGIN
  REVOKE UPDATE, DELETE ON audit_event FROM app_user, app_platform, app_readonly;
  REVOKE INSERT, UPDATE, DELETE ON platform_table_allowlist FROM app_user, app_platform, app_readonly;

  -- Directory tables: the application role reads, the platform role writes.
  REVOKE INSERT, UPDATE, DELETE ON tenant, tenant_grant, consumer_registry FROM app_user;
  REVOKE INSERT, UPDATE, DELETE ON plan, plan_limit FROM app_user;
  IF to_regclass('public.demo_generation') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON demo_generation FROM app_user';
  END IF;

  REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM app_readonly;
END;
$$ LANGUAGE plpgsql;

-- The standard closing lines, in the order every v3 migration uses.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
SELECT reassert_role_revokes();

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
