-- v3: the shared demo's generation ledger (D12, D19; SPEC v3 §5.3, A4 §3.4).
--
-- Hand-written, like every migration here: `prisma migrate diff` proposes
-- dropping the generated tsvector columns, the trigram indexes and
-- `platform_table_allowlist`, which exist only in hand-written SQL.
--
-- Expand-only: one new table, nothing existing changes. Named after
-- 20261002130000 so migrations apply in the order the waves land them (RV7).
--
-- The demo is rebuilt every night into a new tenant and swapped in when the
-- build has checked itself (build-then-swap). Each attempt gets a row here:
-- what was built, from which seed and anchor, how long each step took, what
-- the checks found, why a failure failed, and how many audit rows the purge
-- of a retired generation had to leave behind. The ledger is how an operator
-- answers "why is the demo yesterday's?" without reading logs, how the next
-- attempt gets a job id BullMQ has not seen (`attempt`, Y-B3), and how the
-- status read estimates a build's duration.

-- -----------------------------------------------------------------------------
-- 1. The table
--
-- A platform table: `demo_tenant_id`, deliberately not `tenant_id`, so
-- `apply_tenant_rls()` leaves it alone. It describes tenants rather than
-- living in one, like the tenant directory. No foreign key to `tenant`: the
-- purge deletes a retired generation's tenant row, and this row is then the
-- record that it existed.
-- -----------------------------------------------------------------------------
CREATE TABLE "demo_generation" (
  "id"                UUID          NOT NULL,
  "generation"        INTEGER       NOT NULL,
  "demo_tenant_id"    UUID          NOT NULL,
  "status"            TEXT          NOT NULL,
  "reason"            TEXT          NOT NULL,
  "attempt"           INTEGER       NOT NULL DEFAULT 1,
  "seed"              INTEGER       NOT NULL,
  "anchor"            TIMESTAMPTZ(6) NOT NULL,
  "scale"             DECIMAL(4, 2) NOT NULL,
  "generator_version" TEXT          NOT NULL,
  "plan_hash"         TEXT,
  "started_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at"       TIMESTAMPTZ(6),
  "swapped_at"        TIMESTAMPTZ(6),
  "retired_at"        TIMESTAMPTZ(6),
  "purged_at"         TIMESTAMPTZ(6),
  "build_ms"          INTEGER,
  "step_ms"           JSONB         NOT NULL DEFAULT '{}',
  "checks"            JSONB         NOT NULL DEFAULT '{}',
  "failure"           JSONB,
  "audit_retained"    INTEGER,

  CONSTRAINT "demo_generation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "demo_generation_status_is_known"
    CHECK ("status" IN ('building', 'failed', 'live', 'retired', 'purged')),
  CONSTRAINT "demo_generation_reason_is_known"
    CHECK ("reason" IN ('initial', 'scheduled', 'catch-up', 'manual', 'operator')),
  CONSTRAINT "demo_generation_generation_is_positive" CHECK ("generation" >= 1),
  CONSTRAINT "demo_generation_attempt_is_positive" CHECK ("attempt" >= 1)
);

-- Two builds can never both go live as the same generation: the swap's
-- optimistic check catches a concurrent swap first, and this catches whatever
-- it could not. Failed attempts at a number are left out, so a build that
-- failed may be retried as the same generation. Partial, so Prisma cannot
-- express it; the schema fragment says so.
CREATE UNIQUE INDEX "demo_generation_succeeded" ON "demo_generation" ("generation")
  WHERE "status" IN ('live', 'retired', 'purged');

-- The status read ("the last five good builds") and the operator's
-- `pnpm platform demo status` (the newest rows) both read by status, newest first.
CREATE INDEX "demo_generation_status_idx" ON "demo_generation" ("status", "started_at" DESC);

-- -----------------------------------------------------------------------------
-- 2. The standard closing lines, in the order every v3 migration uses
--
-- The blanket grant gives the application role writes on the new table;
-- `reassert_role_revokes()` (20261002110000) takes them away again, since it
-- names `demo_generation` once the table exists. Only the platform role
-- writes the ledger; `tests/isolation/role-grants.test.ts` checks it.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
SELECT reassert_role_revokes();
SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
