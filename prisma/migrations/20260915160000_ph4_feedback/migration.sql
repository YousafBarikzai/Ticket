-- MOD-18 Feedback and surveys (PH-4).
--
-- Hand-written; `prisma migrate diff` proposes dropping the generated tsvector
-- columns, the trigram indexes and `platform_table_allowlist`, which exist only
-- in hand-written SQL.

-- CreateTable
CREATE TABLE "survey_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "document" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "survey_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID,

    CONSTRAINT "survey_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_trigger" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "conditions" JSONB,
    "throttle_days" INTEGER NOT NULL DEFAULT 7,
    "expiry_days" INTEGER NOT NULL DEFAULT 14,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "survey_trigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_invitation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "trigger_id" UUID,
    "ticket_id" UUID,
    "incident_id" UUID,
    "recipient_id" UUID NOT NULL,
    "conversation_id" UUID,
    "token_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "responded_at" TIMESTAMPTZ(6),
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "survey_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_response" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "ticket_id" UUID,
    "respondent_id" UUID,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER,
    "scale" TEXT,
    "comment" TEXT,
    "via" TEXT NOT NULL,
    "responded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_response_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "survey_definition_tenant_id_key_key" ON "survey_definition"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "survey_version_tenant_id_idx" ON "survey_version"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_version_definition_id_version_key" ON "survey_version"("definition_id", "version");

-- CreateIndex
CREATE INDEX "survey_trigger_tenant_id_kind_is_active_idx" ON "survey_trigger"("tenant_id", "kind", "is_active");

-- CreateIndex
CREATE INDEX "survey_trigger_tenant_id_survey_id_idx" ON "survey_trigger"("tenant_id", "survey_id");

-- CreateIndex
CREATE INDEX "survey_invitation_tenant_id_recipient_id_sent_at_idx" ON "survey_invitation"("tenant_id", "recipient_id", "sent_at" DESC);

-- CreateIndex
CREATE INDEX "survey_invitation_tenant_id_status_expires_at_idx" ON "survey_invitation"("tenant_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "survey_invitation_tenant_id_survey_id_ticket_id_recipient_i_key" ON "survey_invitation"("tenant_id", "survey_id", "ticket_id", "recipient_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_response_invitation_id_key" ON "survey_response"("invitation_id");

-- CreateIndex
CREATE INDEX "survey_response_tenant_id_survey_id_responded_at_idx" ON "survey_response"("tenant_id", "survey_id", "responded_at" DESC);

-- CreateIndex
CREATE INDEX "survey_response_tenant_id_ticket_id_idx" ON "survey_response"("tenant_id", "ticket_id");

-- AddForeignKey
ALTER TABLE "survey_version" ADD CONSTRAINT "survey_version_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "survey_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_trigger" ADD CONSTRAINT "survey_trigger_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "survey_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_invitation" ADD CONSTRAINT "survey_invitation_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "survey_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "survey_invitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "survey_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- Invariants.
-- -----------------------------------------------------------------------------

ALTER TABLE "survey_definition"
  ADD CONSTRAINT "survey_definition_status_is_known" CHECK ("status" IN ('draft', 'published', 'retired'));

-- A trigger is one of the three outcomes the platform publishes. A fourth kind
-- would be a row nothing ever fires for.
ALTER TABLE "survey_trigger"
  ADD CONSTRAINT "survey_trigger_kind_is_known"
  CHECK ("kind" IN ('ticket.resolved', 'request.fulfilled', 'incident.major.resolved'));
ALTER TABLE "survey_trigger"
  ADD CONSTRAINT "survey_trigger_windows_are_sane"
  CHECK ("throttle_days" BETWEEN 0 AND 365 AND "expiry_days" BETWEEN 1 AND 90);

ALTER TABLE "survey_invitation"
  ADD CONSTRAINT "survey_invitation_status_is_known"
  CHECK ("status" IN ('pending', 'responded', 'expired', 'declined'));
-- A link that expires before it was sent is a link nobody could ever use.
ALTER TABLE "survey_invitation"
  ADD CONSTRAINT "survey_invitation_expires_after_sending" CHECK ("expires_at" > "sent_at");

-- The score is normalised to a percentage at write time, whatever the scale.
ALTER TABLE "survey_response"
  ADD CONSTRAINT "survey_response_score_is_a_percentage" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100);

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
