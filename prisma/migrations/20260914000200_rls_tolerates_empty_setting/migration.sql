-- =============================================================================
-- Make the tenant policies tolerate an empty `app.tenant_id`.
--
-- `SET LOCAL` on a custom setting reverts at the end of its transaction to the
-- SESSION value, and for a setting that was never set at session level
-- PostgreSQL leaves an EMPTY STRING rather than NULL. A later query on the same
-- pooled connection, outside any transaction, then evaluates
-- `current_setting('app.tenant_id', true)::uuid` against '' and raises
-- "invalid input syntax for type uuid" instead of simply matching no rows.
--
-- Failing closed is safe, but an error is the wrong failure: it turns a
-- correctly-refused query into an incident. `nullif(..., '')` yields NULL, the
-- comparison is NULL, and the row is filtered out — which is the behaviour the
-- isolation suite asserts.
-- =============================================================================

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

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
         USING (tenant_id = current_tenant_id())
         WITH CHECK (tenant_id = current_tenant_id())',
      r.table_name);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

SELECT apply_tenant_rls();

-- The directory tables carry their own policies and need the same treatment.
DROP POLICY IF EXISTS tenant_self_read ON tenant;
CREATE POLICY tenant_self_read ON tenant FOR SELECT TO app_user, app_readonly
  USING (id = current_tenant_id());

DROP POLICY IF EXISTS tenant_domain_self ON tenant_domain;
CREATE POLICY tenant_domain_self ON tenant_domain FOR SELECT TO app_user, app_readonly
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS channel_directory_self ON channel_directory;
CREATE POLICY channel_directory_self ON channel_directory FOR SELECT TO app_user, app_readonly
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_grant_party ON tenant_grant;
CREATE POLICY tenant_grant_party ON tenant_grant FOR SELECT TO app_user
  USING (grantee_tenant_id = current_tenant_id() OR target_tenant_id = current_tenant_id());

GRANT EXECUTE ON FUNCTION current_tenant_id() TO app_user, app_platform, app_readonly;

SELECT assert_tenant_rls_complete();
