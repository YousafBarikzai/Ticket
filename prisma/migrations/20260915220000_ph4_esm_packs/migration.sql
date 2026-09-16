-- MOD-22 Enterprise service management packs (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL.

-- CreateTable
CREATE TABLE "pack_installation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pack_key" TEXT NOT NULL,
    "pack_version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "last_request_at" TIMESTAMPTZ(6),
    "installed_by" UUID,
    "installed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pack_installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pack_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "item_key" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "declined_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pack_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pack_installation_tenant_id_pack_key_key" ON "pack_installation"("tenant_id", "pack_key");

-- CreateIndex
CREATE UNIQUE INDEX "pack_item_tenant_id_kind_item_key_key" ON "pack_item"("tenant_id", "kind", "item_key");

-- CreateIndex
CREATE INDEX "pack_item_tenant_id_installation_id_idx" ON "pack_item"("tenant_id", "installation_id");

-- AddForeignKey
ALTER TABLE "pack_item" ADD CONSTRAINT "pack_item_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "pack_installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- The vocabulary is small and fixed (modules/esm/src/domain/pack.ts).
-- -----------------------------------------------------------------------------
ALTER TABLE "pack_item"
  ADD CONSTRAINT "pack_item_kind_is_known"
  CHECK ("kind" IN ('service', 'form', 'request_type', 'workflow', 'sla_policy', 'article'));

-- A version is the deployment's, and it counts from one.
ALTER TABLE "pack_installation"
  ADD CONSTRAINT "pack_installation_version_is_positive" CHECK ("pack_version" >= 1);

-- A hash is a SHA-256 in hexadecimal or it is not a hash. Cheap to check, and
-- it catches a truncated or double-encoded value at the moment it is written
-- rather than the next time a diff reports every item as edited.
ALTER TABLE "pack_item"
  ADD CONSTRAINT "pack_item_source_hash_is_sha256" CHECK ("source_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "pack_item"
  ADD CONSTRAINT "pack_item_declined_hash_is_sha256"
  CHECK ("declined_hash" IS NULL OR "declined_hash" ~ '^[0-9a-f]{64}$');

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
