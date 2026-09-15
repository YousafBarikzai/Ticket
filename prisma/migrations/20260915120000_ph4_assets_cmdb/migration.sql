-- MOD-10-E1 Assets and the CMDB (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL.

-- CreateTable
CREATE TABLE "ci_class" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '[]',
    "parent_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ci_class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuration_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "external_key" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'operational',
    "criticality" TEXT NOT NULL DEFAULT 'medium',
    "service_id" UUID,
    "owner_id" UUID,
    "environment" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "retired_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "configuration_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ci_relationship" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_ci" UUID NOT NULL,
    "to_ci" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "ci_relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_model" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'hardware',
    "lifespan_months" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tag" TEXT NOT NULL,
    "serial" TEXT,
    "model_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "ci_id" UUID,
    "purchased_on" DATE,
    "purchase_cost" DECIMAL(12,2),
    "currency" CHAR(3),
    "warranty_ends_on" DATE,
    "supplier" TEXT,
    "cost_centre" TEXT,
    "location" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "retired_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_assignment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "user_id" UUID,
    "location" TEXT,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returned_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_by" UUID,

    CONSTRAINT "asset_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affected_ci" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "ci_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'affected',
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linked_by" UUID,

    CONSTRAINT "affected_ci_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ci_class" ADD CONSTRAINT "ci_class_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "ci_class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Restrict rather than cascade: deleting a class that items still belong to
-- would take the items with it, and the items are the record.
ALTER TABLE "configuration_item" ADD CONSTRAINT "configuration_item_class_id_fkey"
  FOREIGN KEY ("class_id") REFERENCES "ci_class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ci_relationship" ADD CONSTRAINT "ci_relationship_from_ci_fkey"
  FOREIGN KEY ("from_ci") REFERENCES "configuration_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ci_relationship" ADD CONSTRAINT "ci_relationship_to_ci_fkey"
  FOREIGN KEY ("to_ci") REFERENCES "configuration_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset" ADD CONSTRAINT "asset_model_id_fkey"
  FOREIGN KEY ("model_id") REFERENCES "asset_model"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "asset" ADD CONSTRAINT "asset_ci_id_fkey"
  FOREIGN KEY ("ci_id") REFERENCES "configuration_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cascading here only ever fires on a tenant purge: configuration items are
-- retired, never deleted, precisely so this history survives.
ALTER TABLE "affected_ci" ADD CONSTRAINT "affected_ci_ci_id_fkey"
  FOREIGN KEY ("ci_id") REFERENCES "configuration_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "ci_class_tenant_id_key_key" ON "ci_class"("tenant_id", "key");
CREATE INDEX "ci_class_tenant_id_status_idx" ON "ci_class"("tenant_id", "status");

CREATE UNIQUE INDEX "configuration_item_tenant_id_external_key_key" ON "configuration_item"("tenant_id", "external_key");
CREATE INDEX "configuration_item_tenant_id_status_criticality_idx" ON "configuration_item"("tenant_id", "status", "criticality");
CREATE INDEX "configuration_item_tenant_id_class_id_status_idx" ON "configuration_item"("tenant_id", "class_id", "status");
CREATE INDEX "configuration_item_tenant_id_service_id_idx" ON "configuration_item"("tenant_id", "service_id");

-- The two indexes docs/architecture/06 §2.4 names. Both directions, because the
-- traversal walks incoming edges for impact and outgoing edges for
-- dependencies, and an index that serves one leaves the other doing a
-- sequential scan per level — which is the difference between the sub-second
-- target at 500 000 relationships and a query nobody waits for.
CREATE UNIQUE INDEX "ci_relationship_tenant_id_from_ci_to_ci_type_key" ON "ci_relationship"("tenant_id", "from_ci", "to_ci", "type");
CREATE INDEX "ci_relationship_tenant_id_from_ci_type_idx" ON "ci_relationship"("tenant_id", "from_ci", "type");
CREATE INDEX "ci_relationship_tenant_id_to_ci_type_idx" ON "ci_relationship"("tenant_id", "to_ci", "type");

CREATE UNIQUE INDEX "asset_model_tenant_id_manufacturer_model_key" ON "asset_model"("tenant_id", "manufacturer", "model");

CREATE UNIQUE INDEX "asset_tenant_id_tag_key" ON "asset"("tenant_id", "tag");
CREATE UNIQUE INDEX "asset_ci_id_key" ON "asset"("ci_id");
CREATE INDEX "asset_tenant_id_status_idx" ON "asset"("tenant_id", "status");
CREATE INDEX "asset_tenant_id_serial_idx" ON "asset"("tenant_id", "serial");
CREATE INDEX "asset_tenant_id_warranty_ends_on_idx" ON "asset"("tenant_id", "warranty_ends_on");

CREATE INDEX "asset_assignment_tenant_id_asset_id_assigned_at_idx" ON "asset_assignment"("tenant_id", "asset_id", "assigned_at");
CREATE INDEX "asset_assignment_tenant_id_user_id_returned_at_idx" ON "asset_assignment"("tenant_id", "user_id", "returned_at");

CREATE UNIQUE INDEX "affected_ci_tenant_id_entity_type_entity_id_ci_id_role_key" ON "affected_ci"("tenant_id", "entity_type", "entity_id", "ci_id", "role");
CREATE INDEX "affected_ci_tenant_id_ci_id_linked_at_idx" ON "affected_ci"("tenant_id", "ci_id", "linked_at");
CREATE INDEX "affected_ci_tenant_id_entity_type_entity_id_idx" ON "affected_ci"("tenant_id", "entity_type", "entity_id");

-- One asset may hold one configuration item, so the register of what you own
-- and the register of what can break agree on which row is which thing.
-- Partial, so the many assets that are not configuration items are unaffected.
CREATE UNIQUE INDEX "asset_one_per_ci" ON "asset"("tenant_id", "ci_id") WHERE "ci_id" IS NOT NULL;

-- One open holding per asset. The history is what answers "who had this in
-- March?", and two open rows make that question unanswerable — which is
-- exactly when it gets asked.
CREATE UNIQUE INDEX "asset_assignment_one_open_per_asset"
  ON "asset_assignment"("tenant_id", "asset_id")
  WHERE "returned_at" IS NULL;

-- A configuration item cannot need itself. Harmless to the traversal, which
-- refuses to revisit a node anyway, but it is always a mistake and the register
-- is read by people.
ALTER TABLE "ci_relationship"
  ADD CONSTRAINT "ci_relationship_not_self" CHECK ("from_ci" <> "to_ci");

-- Retirement is read from `retired_at`, not from `status`: the traversal filters
-- on the timestamp, so a row calling itself retired with no timestamp would
-- keep carrying impact through itself while looking decommissioned in every
-- list. The two must agree.
ALTER TABLE "configuration_item"
  ADD CONSTRAINT "configuration_item_retired_has_timestamp"
  CHECK ("status" <> 'retired' OR "retired_at" IS NOT NULL);

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
