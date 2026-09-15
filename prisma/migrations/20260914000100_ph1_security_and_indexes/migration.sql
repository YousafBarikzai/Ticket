-- =============================================================================
-- Phase 1: roles, grants, row-level security, search columns and hot indexes.
--
-- Everything Prisma cannot express lives here. It is written by hand and
-- reviewed as carefully as application code, because this file is what makes
-- cross-tenant leakage impossible (ADR-0004) and the audit trail append-only
-- (ADR-0014).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Platform tables
--
-- The only tables without a tenant_id, or exempt from tenant isolation, are the
-- ones that RESOLVE a tenant in the first place. The list is closed and the
-- isolation suite asserts nothing else joins it.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_table_allowlist (
  table_name text PRIMARY KEY,
  reason     text NOT NULL
);

INSERT INTO platform_table_allowlist (table_name, reason) VALUES
  ('tenant',                   'the tenant directory itself'),
  ('tenant_domain',            'host to tenant resolution, needed before any context exists'),
  ('channel_directory',        'channel account to tenant resolution for provider webhooks'),
  ('tenant_grant',             'cross-tenant MSP grants, checked in the permission layer'),
  ('consumer_registry',        'event consumers, built from module manifests at boot'),
  ('platform_table_allowlist', 'this list'),
  ('_prisma_migrations',       'migration history')
ON CONFLICT (table_name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Tenant isolation
--
-- Applied by a function rather than a static list so that a table added in a
-- later migration cannot be forgotten: every migration ends by calling it.
-- A missing app.tenant_id yields NULL, so a query without tenant context
-- returns zero rows and an insert fails its WITH CHECK.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_tenant_rls() RETURNS void AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT IN (SELECT table_name FROM platform_table_allowlist)
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id'
      )
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', r.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      r.table_name);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Fails the migration if any tenant-scoped table is left unprotected.
CREATE OR REPLACE FUNCTION assert_tenant_rls_complete() RETURNS void AS $$
DECLARE
  unprotected text[];
BEGIN
  SELECT array_agg(c.relname ORDER BY c.relname) INTO unprotected
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname NOT IN (SELECT table_name FROM platform_table_allowlist)
    AND EXISTS (
      SELECT 1 FROM information_schema.columns col
      WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id'
    )
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);

  IF unprotected IS NOT NULL THEN
    RAISE EXCEPTION 'tables without forced row-level security: %', array_to_string(unprotected, ', ');
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT apply_tenant_rls();

-- -----------------------------------------------------------------------------
-- 3. Platform-table policies
--
-- app_platform may read and write the directory tables; the application role
-- may read only its own tenant's rows, so a bug in tenant resolution cannot
-- enumerate other customers.
-- -----------------------------------------------------------------------------
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_platform ON tenant;
CREATE POLICY tenant_platform ON tenant TO app_platform USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS tenant_self_read ON tenant;
CREATE POLICY tenant_self_read ON tenant FOR SELECT TO app_user, app_readonly
  USING (id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE tenant_domain ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_domain FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_domain_platform ON tenant_domain;
CREATE POLICY tenant_domain_platform ON tenant_domain TO app_platform USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS tenant_domain_self ON tenant_domain;
CREATE POLICY tenant_domain_self ON tenant_domain FOR SELECT TO app_user, app_readonly
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE channel_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_directory FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channel_directory_platform ON channel_directory;
CREATE POLICY channel_directory_platform ON channel_directory TO app_platform USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS channel_directory_self ON channel_directory;
CREATE POLICY channel_directory_self ON channel_directory FOR SELECT TO app_user, app_readonly
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE tenant_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_grant FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_grant_platform ON tenant_grant;
CREATE POLICY tenant_grant_platform ON tenant_grant TO app_platform USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS tenant_grant_party ON tenant_grant;
CREATE POLICY tenant_grant_party ON tenant_grant FOR SELECT TO app_user
  USING (
    grantee_tenant_id = current_setting('app.tenant_id', true)::uuid
    OR target_tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- -----------------------------------------------------------------------------
-- 4. Grants
--
-- app_user is the application role. It can write everything except the audit
-- trail, which it may only append to: the tamper evidence in ADR-0014 rests on
-- there being no UPDATE or DELETE grant at all.
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO app_user, app_platform, app_readonly;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_platform;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user, app_platform;

REVOKE UPDATE, DELETE ON audit_event FROM app_user, app_platform, app_readonly;
REVOKE INSERT, UPDATE, DELETE ON platform_table_allowlist FROM app_user, app_platform, app_readonly;

-- Directory tables: the application role reads, the platform role writes.
REVOKE INSERT, UPDATE, DELETE ON tenant, tenant_grant, consumer_registry FROM app_user;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM app_readonly;

-- Tables created by later migrations inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user, app_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user, app_platform;

-- -----------------------------------------------------------------------------
-- 5. Full-text search
--
-- Generated columns keep the index in step with the row inside the same write,
-- so search freshness never depends on a trigger firing or a job running.
-- -----------------------------------------------------------------------------
ALTER TABLE ticket
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS ticket_search_tsv_idx ON ticket USING gin (tenant_id, search_tsv);

ALTER TABLE search_document
  ADD COLUMN IF NOT EXISTS body_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(body_text, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS search_document_body_tsv_idx ON search_document USING gin (tenant_id, body_tsv);

-- Custom field values: equality and containment filters without a table scan.
CREATE INDEX IF NOT EXISTS ticket_custom_idx ON ticket USING gin (custom jsonb_path_ops);

-- Typeahead on people and tickets.
CREATE INDEX IF NOT EXISTS app_user_account_display_name_trgm_idx ON app_user_account USING gin (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS app_user_account_email_trgm_idx ON app_user_account USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ticket_number_trgm_idx ON ticket USING gin (number gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 6. Hot partial indexes
--
-- The scheduler and the outbox publisher each scan one small slice repeatedly;
-- partial indexes keep those scans proportional to the work outstanding rather
-- than to the size of the table.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS sla_timer_due_running_idx
  ON sla_timer (partition, due_at) WHERE state = 'running';

CREATE INDEX IF NOT EXISTS sla_timer_next_warning_idx
  ON sla_timer (partition, next_warning_at) WHERE state = 'running' AND next_warning_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS outbox_event_unpublished_idx
  ON outbox_event (created_at) WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS webhook_delivery_pending_idx
  ON webhook_delivery (next_attempt_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS notification_unread_idx
  ON notification (tenant_id, recipient_id, created_at DESC) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS attachment_pending_scan_idx
  ON attachment (tenant_id, created_at) WHERE scan_status = 'pending';

CREATE INDEX IF NOT EXISTS ticket_open_idx
  ON ticket (tenant_id, group_id, due_at) WHERE status_category IN ('open', 'paused');

-- -----------------------------------------------------------------------------
-- 7. Audit trail: append-only at the table level as well as by grant.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_event_is_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only (ADR-0014): % attempted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_event_no_update ON audit_event;
CREATE TRIGGER audit_event_no_update BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_is_immutable();

-- -----------------------------------------------------------------------------
-- 8. Verify
-- -----------------------------------------------------------------------------
SELECT assert_tenant_rls_complete();
