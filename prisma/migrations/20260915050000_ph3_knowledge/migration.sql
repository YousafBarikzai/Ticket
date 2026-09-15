-- MOD-09 Knowledge (PH-3).
--
-- Hand-written, like every migration since PH-2: `prisma migrate diff` proposes
-- dropping the generated tsvector columns, the trigram indexes and
-- `platform_table_allowlist`, because those exist only in hand-written SQL.
-- Only the additive statements are taken.

-- CreateTable
CREATE TABLE "knowledge_article" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "current_version_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "audience" TEXT NOT NULL DEFAULT 'internal',
    "org_id" UUID,
    "category_id" UUID,
    "owner_id" UUID,
    "author_id" UUID,
    "review_due_at" TIMESTAMPTZ(6),
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "helpful_count" INTEGER NOT NULL DEFAULT 0,
    "unhelpful_count" INTEGER NOT NULL DEFAULT 0,
    "deflection_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),

    CONSTRAINT "knowledge_article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_article_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" JSONB NOT NULL DEFAULT '[]',
    "change_note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "author_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "published_by" UUID,

    CONSTRAINT "knowledge_article_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_feedback" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "version_id" UUID,
    "user_id" UUID NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_ticket_link" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'referenced',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_ticket_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "path" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_article_tenant_id_key_key" ON "knowledge_article"("tenant_id", "key");
CREATE INDEX "knowledge_article_tenant_id_status_updated_at_idx" ON "knowledge_article"("tenant_id", "status", "updated_at" DESC);
CREATE INDEX "knowledge_article_tenant_id_category_id_idx" ON "knowledge_article"("tenant_id", "category_id");
CREATE INDEX "knowledge_article_tenant_id_review_due_at_idx" ON "knowledge_article"("tenant_id", "review_due_at");

CREATE UNIQUE INDEX "knowledge_article_version_tenant_id_article_id_version_key" ON "knowledge_article_version"("tenant_id", "article_id", "version");
CREATE INDEX "knowledge_article_version_tenant_id_article_id_version_idx" ON "knowledge_article_version"("tenant_id", "article_id", "version" DESC);

CREATE UNIQUE INDEX "knowledge_feedback_tenant_id_article_id_user_id_key" ON "knowledge_feedback"("tenant_id", "article_id", "user_id");
CREATE INDEX "knowledge_feedback_tenant_id_article_id_created_at_idx" ON "knowledge_feedback"("tenant_id", "article_id", "created_at" DESC);

CREATE UNIQUE INDEX "knowledge_ticket_link_tenant_id_article_id_ticket_id_key" ON "knowledge_ticket_link"("tenant_id", "article_id", "ticket_id");
CREATE INDEX "knowledge_ticket_link_tenant_id_ticket_id_idx" ON "knowledge_ticket_link"("tenant_id", "ticket_id");

CREATE UNIQUE INDEX "knowledge_category_tenant_id_key_key" ON "knowledge_category"("tenant_id", "key");
CREATE INDEX "knowledge_category_tenant_id_path_idx" ON "knowledge_category"("tenant_id", "path");

-- AddForeignKey
ALTER TABLE "knowledge_article_version" ADD CONSTRAINT "knowledge_article_version_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "knowledge_article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_feedback" ADD CONSTRAINT "knowledge_feedback_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "knowledge_article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_ticket_link" ADD CONSTRAINT "knowledge_ticket_link_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "knowledge_article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Isolation and grants.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

SELECT apply_tenant_rls();
SELECT assert_tenant_rls_complete();
