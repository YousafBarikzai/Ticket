-- MOD-01 SCIM provisioning (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL.

-- The identity provider's own identifiers, kept apart from the OIDC subject.
-- (The User model's table is app_user_account: "user" is a reserved word.)
ALTER TABLE "app_user_account" ADD COLUMN "scim_external_id" TEXT;
ALTER TABLE "team" ADD COLUMN "scim_external_id" TEXT;
-- Which SCIM group granted a role, so leaving the group revokes it and
-- nothing granted by hand is touched.
ALTER TABLE "role_assignment" ADD COLUMN "via_scim_team_id" UUID;

-- CreateIndex
CREATE INDEX "app_user_account_tenant_id_scim_external_id_idx" ON "app_user_account"("tenant_id", "scim_external_id");
CREATE INDEX "team_tenant_id_scim_external_id_idx" ON "team"("tenant_id", "scim_external_id");
CREATE INDEX "role_assignment_tenant_id_via_scim_team_id_idx" ON "role_assignment"("tenant_id", "via_scim_team_id");

-- CreateTable
CREATE TABLE "scim_token" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "scim_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_role_mapping" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "group_name" TEXT NOT NULL,
    "role_key" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scim_role_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scim_token_tenant_id_token_hash_key" ON "scim_token"("tenant_id", "token_hash");
CREATE INDEX "scim_token_tenant_id_revoked_at_idx" ON "scim_token"("tenant_id", "revoked_at");
CREATE UNIQUE INDEX "scim_role_mapping_tenant_id_group_name_role_key_key" ON "scim_role_mapping"("tenant_id", "group_name", "role_key");

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
