-- MOD-20 Workload and routing (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL.
--
-- Every table here carries `tenant_id`, so `apply_tenant_rls()` at the foot of
-- this file gives each one the isolation policy and
-- `assert_tenant_rls_complete()` refuses the migration if one was missed.

-- CreateTable
CREATE TABLE "agent_availability" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "reason" TEXT,
    "until" TIMESTAMPTZ(6),
    "source" TEXT NOT NULL DEFAULT 'manual',
    "capacity" INTEGER,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "agent_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "time_zone" TEXT NOT NULL,
    "pattern" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_assignment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oncall_rotation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "time_zone" TEXT NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'weekly',
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "members" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "handover_at" TEXT NOT NULL DEFAULT '09:00',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "oncall_rotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oncall_override" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rotation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oncall_override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_skill" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 2,

    CONSTRAINT "agent_skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'least_loaded',
    "default_capacity" INTEGER NOT NULL DEFAULT 10,
    "require_skill" BOOLEAN NOT NULL DEFAULT false,
    "allow_off_shift" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "routing_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_routing_mark" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_assigned_at" TIMESTAMPTZ(6) NOT NULL,
    "assigned_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "agent_routing_mark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_availability_tenant_id_user_id_key" ON "agent_availability"("tenant_id", "user_id");
CREATE INDEX "agent_availability_tenant_id_status_idx" ON "agent_availability"("tenant_id", "status");

CREATE UNIQUE INDEX "shift_tenant_id_key_key" ON "shift"("tenant_id", "key");
CREATE INDEX "shift_tenant_id_team_id_status_idx" ON "shift"("tenant_id", "team_id", "status");

CREATE UNIQUE INDEX "shift_assignment_tenant_id_shift_id_user_id_starts_on_key" ON "shift_assignment"("tenant_id", "shift_id", "user_id", "starts_on");
CREATE INDEX "shift_assignment_tenant_id_user_id_idx" ON "shift_assignment"("tenant_id", "user_id");

CREATE UNIQUE INDEX "oncall_rotation_tenant_id_key_key" ON "oncall_rotation"("tenant_id", "key");
CREATE INDEX "oncall_rotation_tenant_id_team_id_status_idx" ON "oncall_rotation"("tenant_id", "team_id", "status");

CREATE INDEX "oncall_override_tenant_id_rotation_id_starts_at_idx" ON "oncall_override"("tenant_id", "rotation_id", "starts_at");

CREATE UNIQUE INDEX "skill_tenant_id_key_key" ON "skill"("tenant_id", "key");

CREATE UNIQUE INDEX "agent_skill_tenant_id_user_id_skill_id_key" ON "agent_skill"("tenant_id", "user_id", "skill_id");
CREATE INDEX "agent_skill_tenant_id_skill_id_level_idx" ON "agent_skill"("tenant_id", "skill_id", "level");

CREATE UNIQUE INDEX "routing_policy_tenant_id_team_id_key" ON "routing_policy"("tenant_id", "team_id");

CREATE UNIQUE INDEX "agent_routing_mark_tenant_id_user_id_key" ON "agent_routing_mark"("tenant_id", "user_id");

-- AddForeignKey
ALTER TABLE "shift_assignment" ADD CONSTRAINT "shift_assignment_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oncall_override" ADD CONSTRAINT "oncall_override_rotation_id_fkey" FOREIGN KEY ("rotation_id") REFERENCES "oncall_rotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_skill" ADD CONSTRAINT "agent_skill_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
