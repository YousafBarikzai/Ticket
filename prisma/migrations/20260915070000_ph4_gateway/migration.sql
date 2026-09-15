-- MOD-14-E3 Integration gateway and credential store (PH-4).
--
-- Hand-written, like every migration since PH-2: `prisma migrate diff` proposes
-- dropping the generated tsvector columns, the trigram indexes and
-- `platform_table_allowlist`, which exist only in hand-written SQL.

-- CreateTable
CREATE TABLE "integration_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "connector" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "request_headers" JSONB NOT NULL DEFAULT '{}',
    "request_body" JSONB,
    "status" INTEGER NOT NULL DEFAULT 0,
    "response_body" JSONB,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "correlation_id" TEXT,
    "cause_kind" TEXT,
    "cause_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_credential" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'generic',
    "description" TEXT,
    "sealed" JSONB NOT NULL,
    "kek_version" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "connector_credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_log_tenant_id_connector_created_at_idx" ON "integration_log"("tenant_id", "connector", "created_at" DESC);
CREATE INDEX "integration_log_tenant_id_status_created_at_idx" ON "integration_log"("tenant_id", "status", "created_at" DESC);
CREATE INDEX "integration_log_tenant_id_cause_kind_cause_id_idx" ON "integration_log"("tenant_id", "cause_kind", "cause_id");

CREATE UNIQUE INDEX "connector_credential_tenant_id_ref_key" ON "connector_credential"("tenant_id", "ref");
CREATE INDEX "connector_credential_tenant_id_kind_idx" ON "connector_credential"("tenant_id", "kind");
-- Finding what still needs re-wrapping after a key rotation is a query, not a
-- full scan of every tenant's credentials.
CREATE INDEX "connector_credential_tenant_id_kek_version_idx" ON "connector_credential"("tenant_id", "kek_version");

-- -----------------------------------------------------------------------------
-- Isolation and grants.
--
-- The credential table gets the ordinary tenant policy like every other table:
-- the encryption is a second layer, not a substitute for the first. A bug that
-- let one tenant read another's row would still hand them only ciphertext, and
-- a stolen database still needs the KEK — which is the point of having both.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
