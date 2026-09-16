-- MOD-21 Plans, limits and metering (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL. Table names are taken from each model's `@@map`.
--
-- `plan` and `plan_limit` carry no `tenant_id`: a plan is the deployment's and
-- every tenant reads the same row, so row-level security has nothing to
-- attach to and the allow-list has nothing to say about them. The meters and
-- the tenant's own thresholds are tenant-scoped and isolated like everything
-- else.

-- CreateTable
CREATE TABLE "plan" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_retired" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "plan_limit" (
    "id" UUID NOT NULL,
    "plan_key" TEXT NOT NULL,
    "meter" TEXT NOT NULL,
    "soft" BIGINT,
    "hard" BIGINT,

    CONSTRAINT "plan_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_meter" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meter" TEXT NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "period_key" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'ok',
    "warned_at" TIMESTAMPTZ(6),
    "blocked_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "usage_meter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_limit_override" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "meter" TEXT NOT NULL,
    "soft" BIGINT NOT NULL,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_limit_override_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_limit_plan_key_meter_key" ON "plan_limit"("plan_key", "meter");

-- The period is spelled out rather than left as nullable dates: PostgreSQL
-- treats NULLs in a unique index as distinct, so a live meter keyed on a null
-- period would never conflict with itself and would insert a duplicate on
-- every upsert. MOD-12's rollup learned this the same way.
CREATE UNIQUE INDEX "usage_meter_tenant_id_meter_period_key_key" ON "usage_meter"("tenant_id", "meter", "period_key");
CREATE INDEX "usage_meter_tenant_id_state_idx" ON "usage_meter"("tenant_id", "state");
CREATE UNIQUE INDEX "tenant_limit_override_tenant_id_meter_key" ON "tenant_limit_override"("tenant_id", "meter");

-- AddForeignKey
ALTER TABLE "plan_limit" ADD CONSTRAINT "plan_limit_plan_key_fkey" FOREIGN KEY ("plan_key") REFERENCES "plan"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- The vocabulary is small and fixed (modules/tenancy/src/domain/meters.ts).
-- -----------------------------------------------------------------------------
ALTER TABLE "plan_limit"
  ADD CONSTRAINT "plan_limit_meter_is_known" CHECK ("meter" IN ('agents', 'tickets', 'storage', 'api_calls'));
ALTER TABLE "usage_meter"
  ADD CONSTRAINT "usage_meter_meter_is_known" CHECK ("meter" IN ('agents', 'tickets', 'storage', 'api_calls'));
ALTER TABLE "tenant_limit_override"
  ADD CONSTRAINT "tenant_limit_override_meter_is_known" CHECK ("meter" IN ('agents', 'tickets', 'storage', 'api_calls'));
ALTER TABLE "usage_meter"
  ADD CONSTRAINT "usage_meter_state_is_known" CHECK ("state" IN ('ok', 'warned', 'blocked'));

-- A warning after the refusal is a warning nobody ever sees.
ALTER TABLE "plan_limit"
  ADD CONSTRAINT "plan_limit_warns_before_it_refuses"
  CHECK ("soft" IS NULL OR "hard" IS NULL OR "soft" <= "hard");
-- A meter never goes backwards past nothing.
ALTER TABLE "usage_meter" ADD CONSTRAINT "usage_meter_is_not_negative" CHECK ("value" >= 0);
-- A counted meter has a period; a live one does not.
ALTER TABLE "usage_meter"
  ADD CONSTRAINT "usage_meter_period_matches_its_shape"
  CHECK (("period_key" = 'live') = ("period_start" IS NULL AND "period_end" IS NULL));

-- -----------------------------------------------------------------------------
-- Grants. `plan` and `plan_limit` are read by every tenant and written only by
-- the platform role, like the tenant directory.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
REVOKE INSERT, UPDATE, DELETE ON "plan", "plan_limit" FROM app_user;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
