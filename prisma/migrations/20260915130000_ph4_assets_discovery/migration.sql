-- MOD-10-E2 Discovery, reconciliation and contracts (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL.

-- CreateTable
CREATE TABLE "discovery_source" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "credential_ref" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "interval_minutes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_run_at" TIMESTAMPTZ(6),
    "last_run_status" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "discovery_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "seen" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "proposed" INTEGER NOT NULL DEFAULT 0,
    "applied" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "problems" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "triggered_by" UUID,

    CONSTRAINT "discovery_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_proposal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "external_key" TEXT NOT NULL,
    "ci_id" UUID,
    "proposed" JSONB NOT NULL DEFAULT '{}',
    "current" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_id" UUID,
    "field" TEXT NOT NULL,
    "policy" TEXT NOT NULL DEFAULT 'propose',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "reconciliation_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "account_ref" TEXT,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "support_url" TEXT,
    "support_phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'support',
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "notice_days" INTEGER,
    "auto_renews" BOOLEAN NOT NULL DEFAULT false,
    "cost" DECIMAL(14,2),
    "currency" CHAR(3),
    "cost_period" TEXT,
    "cost_centre" TEXT,
    "owner_id" UUID,
    "document_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_coverage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "asset_id" UUID,
    "ci_id" UUID,
    "note" TEXT,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_coverage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "discovery_run" ADD CONSTRAINT "discovery_run_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "discovery_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discovery_proposal" ADD CONSTRAINT "discovery_proposal_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "discovery_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reconciliation_rule" ADD CONSTRAINT "reconciliation_rule_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "discovery_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict rather than cascade: deleting a supplier that still has contracts
-- would take the contracts with it, and the contract is the record of what was
-- agreed and what it costs.
ALTER TABLE "contract" ADD CONSTRAINT "contract_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_coverage" ADD CONSTRAINT "contract_coverage_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "discovery_source_tenant_id_key_key" ON "discovery_source"("tenant_id", "key");
CREATE INDEX "discovery_source_tenant_id_status_last_run_at_idx" ON "discovery_source"("tenant_id", "status", "last_run_at");

CREATE INDEX "discovery_run_tenant_id_source_id_started_at_idx" ON "discovery_run"("tenant_id", "source_id", "started_at");
CREATE INDEX "discovery_run_tenant_id_status_idx" ON "discovery_run"("tenant_id", "status");

CREATE INDEX "discovery_proposal_tenant_id_status_created_at_idx" ON "discovery_proposal"("tenant_id", "status", "created_at");
CREATE INDEX "discovery_proposal_tenant_id_source_id_external_key_status_idx" ON "discovery_proposal"("tenant_id", "source_id", "external_key", "status");
CREATE INDEX "discovery_proposal_tenant_id_ci_id_idx" ON "discovery_proposal"("tenant_id", "ci_id");

CREATE UNIQUE INDEX "reconciliation_rule_tenant_id_source_id_field_key" ON "reconciliation_rule"("tenant_id", "source_id", "field");
CREATE INDEX "reconciliation_rule_tenant_id_field_idx" ON "reconciliation_rule"("tenant_id", "field");

CREATE UNIQUE INDEX "supplier_tenant_id_name_key" ON "supplier"("tenant_id", "name");
CREATE INDEX "supplier_tenant_id_status_idx" ON "supplier"("tenant_id", "status");

CREATE UNIQUE INDEX "contract_tenant_id_supplier_id_reference_key" ON "contract"("tenant_id", "supplier_id", "reference");
CREATE INDEX "contract_tenant_id_status_ends_on_idx" ON "contract"("tenant_id", "status", "ends_on");
CREATE INDEX "contract_tenant_id_supplier_id_idx" ON "contract"("tenant_id", "supplier_id");

CREATE UNIQUE INDEX "contract_coverage_tenant_id_contract_id_asset_id_ci_id_key" ON "contract_coverage"("tenant_id", "contract_id", "asset_id", "ci_id");
CREATE INDEX "contract_coverage_tenant_id_asset_id_idx" ON "contract_coverage"("tenant_id", "asset_id");
CREATE INDEX "contract_coverage_tenant_id_ci_id_idx" ON "contract_coverage"("tenant_id", "ci_id");

-- A four-column unique index over two nullable columns does not enforce
-- anything: in SQL two NULLs are not equal, so `(contract, asset, NULL)` can be
-- written as often as anybody likes. These two are the constraint that was
-- meant, one per side.
CREATE UNIQUE INDEX "contract_coverage_one_per_asset"
  ON "contract_coverage"("tenant_id", "contract_id", "asset_id")
  WHERE "asset_id" IS NOT NULL;
CREATE UNIQUE INDEX "contract_coverage_one_per_ci"
  ON "contract_coverage"("tenant_id", "contract_id", "ci_id")
  WHERE "ci_id" IS NOT NULL;

-- Coverage names one thing, not both and not neither. An asset and the
-- configuration item it is are two rows, so a row that named both would be
-- ambiguous about which side of the register it covers.
ALTER TABLE "contract_coverage"
  ADD CONSTRAINT "contract_coverage_names_one_thing"
  CHECK (("asset_id" IS NULL) <> ("ci_id" IS NULL));

-- A contract ends after it starts, and notice cannot be longer than the
-- contract: notice that could never be given in time is a data-entry slip that
-- would make every report about it wrong.
ALTER TABLE "contract"
  ADD CONSTRAINT "contract_ends_after_it_starts" CHECK ("ends_on" > "starts_on");
ALTER TABLE "contract"
  ADD CONSTRAINT "contract_notice_fits"
  CHECK ("notice_days" IS NULL OR "notice_days" <= ("ends_on" - "starts_on"));

-- A cost with no currency cannot be added up and a cost with no period cannot
-- be compared: 40,000 a year and 40,000 once are not the same contract.
ALTER TABLE "contract"
  ADD CONSTRAINT "contract_cost_is_comparable"
  CHECK ("cost" IS NULL OR ("currency" IS NOT NULL AND "cost_period" IS NOT NULL));

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
