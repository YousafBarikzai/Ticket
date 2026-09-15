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


-- CreateTable
CREATE TABLE "action_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "credential_ref" TEXT,
    "credential_header" TEXT,
    "retry_max" INTEGER NOT NULL DEFAULT 3,
    "timeout_ms" INTEGER NOT NULL DEFAULT 15000,
    "response_mapping" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "action_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_queue_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "action_key" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'open',
    "dismissed_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,

    CONSTRAINT "error_queue_item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "action_definition_tenant_id_key_key" ON "action_definition"("tenant_id", "key");
CREATE INDEX "action_definition_tenant_id_status_idx" ON "action_definition"("tenant_id", "status");

CREATE INDEX "error_queue_item_tenant_id_status_created_at_idx" ON "error_queue_item"("tenant_id", "status", "created_at" DESC);
CREATE INDEX "error_queue_item_tenant_id_source_source_id_idx" ON "error_queue_item"("tenant_id", "source", "source_id");

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
