-- =============================================================================
-- Phase 2: the channel adapter framework and the email channel (MOD-03).
--
-- Additive statements taken from `prisma migrate diff` and filtered to the
-- channel tables. The diff cannot be used whole: it proposes dropping the
-- generated tsvector columns, the trigram indexes and platform_table_allowlist,
-- which exist only in hand-written SQL.
-- =============================================================================

-- CreateTable
CREATE TABLE IF NOT EXISTS "channel_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "channel" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_message_at" TIMESTAMPTZ(6),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "channel_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "channel_identity" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "user_id" UUID,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(6),
    "method" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "conversation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "ticket_id" UUID,
    "external_thread_id" TEXT,
    "state" JSONB NOT NULL DEFAULT '{}',
    "last_inbound_at" TIMESTAMPTZ(6),
    "last_outbound_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "inbound_message" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "external_message_id" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "conversation_id" UUID,
    "ticket_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'received',
    "rejected_reason" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "inbound_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "channel_account_tenant_id_channel_status_idx" ON "channel_account"("tenant_id", "channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "channel_account_tenant_id_channel_key_key" ON "channel_account"("tenant_id", "channel", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "channel_identity_tenant_id_user_id_idx" ON "channel_identity"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "channel_identity_tenant_id_channel_external_id_key" ON "channel_identity"("tenant_id", "channel", "external_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversation_tenant_id_ticket_id_idx" ON "conversation"("tenant_id", "ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_tenant_id_channel_external_thread_id_key" ON "conversation"("tenant_id", "channel", "external_thread_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inbound_message_tenant_id_status_received_at_idx" ON "inbound_message"("tenant_id", "status", "received_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inbound_message_tenant_id_from_address_received_at_idx" ON "inbound_message"("tenant_id", "from_address", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_message_tenant_id_channel_external_message_id_key" ON "inbound_message"("tenant_id", "channel", "external_message_id");

-- AddForeignKey
ALTER TABLE "channel_identity" ADD CONSTRAINT "channel_identity_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "channel_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "channel_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_message" ADD CONSTRAINT "inbound_message_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "channel_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Isolation and grants.
--
-- channel_account is deliberately NOT on the platform allowlist even though it
-- is read before a tenant context exists: that read runs as app_platform, which
-- the directory policy below allows, while the application role stays confined
-- to its own tenant like every other table.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();

-- The platform role resolves an inbound address to its tenant before any
-- context exists, so it needs to see across tenants on this one table.
DROP POLICY IF EXISTS channel_account_directory ON channel_account;
CREATE POLICY channel_account_directory ON channel_account FOR SELECT TO app_platform USING (true);

SELECT assert_tenant_rls_complete();
