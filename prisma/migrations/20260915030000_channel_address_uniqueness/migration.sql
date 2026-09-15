-- =============================================================================
-- An inbound channel address is globally unique while it is active.
--
-- Found by the email channel's own tests. `channel_account` is the one table
-- read *across* tenants — a provider webhook arrives with no tenant context and
-- the address is what says whose it is — so two rows claiming the same address
-- mean mail is routed to whichever the query happened to return first.
--
-- In the test that surfaced it the second row was an orphan left behind by a
-- deleted tenant, but the same shape lets one tenant claim another's mailbox,
-- which is cross-tenant delivery of somebody else's correspondence.
--
-- Partial, on the active rows only: a disabled account may keep its address so
-- an administrator can see what it used to be, and a tenant that is migrating
-- between providers may stage a replacement before switching over.
-- =============================================================================

-- A data migration on a tenant-scoped table cannot simply UPDATE.
--
-- Migrations run as app_owner, and every tenant-scoped table has row-level
-- security FORCED, which applies to the table's owner too. With no app.tenant_id
-- set, the statement below matches zero rows and the migration then fails on the
-- index it was supposed to have cleared the way for — silently doing nothing is
-- the failure mode to watch for in every future data migration. Lifting FORCE
-- for the statement, and restoring it immediately, is the narrowest way through.
ALTER TABLE channel_account NO FORCE ROW LEVEL SECURITY;

-- Any existing duplicates are deactivated, oldest kept: a row that cannot be
-- attributed to a live tenant must not be the one receiving mail.
UPDATE channel_account ca
SET status = 'disabled'
WHERE ca.status = 'active'
  AND EXISTS (
    SELECT 1 FROM channel_account other
    WHERE other.channel = ca.channel
      AND lower(other.address) = lower(ca.address)
      AND other.status = 'active'
      AND (other.created_at < ca.created_at OR (other.created_at = ca.created_at AND other.id < ca.id))
  );

-- Orphans of deleted tenants are removed outright rather than disabled: they
-- belong to nobody, and `purgeTenant` now stops more being created.
DELETE FROM channel_account ca
WHERE NOT EXISTS (SELECT 1 FROM tenant t WHERE t.id = ca.tenant_id);

ALTER TABLE channel_account FORCE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS channel_account_active_address_key
  ON channel_account (channel, lower(address))
  WHERE status = 'active';
