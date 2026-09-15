-- The four open decisions, made (PH-5).
--
-- Hand-written, like every migration here: `prisma migrate diff` proposes
-- dropping the generated tsvector columns, the trigram indexes and
-- `platform_table_allowlist`, which exist only in hand-written SQL.
--
-- OD-05  a commercial model: per-agent seat pricing on three tiers.
-- OD-07  a time entry is not billable unless somebody says it is.
-- AI     residency: a tenant states where its prompts may be processed.
--
-- OD-06 (hosting) changes no table.

-- ---------------------------------------------------------------------------
-- OD-05 · What a plan costs.
--
-- Micro-pence, the unit every other amount in this platform is held in, so
-- nothing has to know which of two conventions a column follows. Nullable
-- because not every plan has a list price: a trial has none, and an enterprise
-- agreement is negotiated per customer rather than published.
--
-- Nothing in this repository charges anybody. This records what a plan costs;
-- it is not a billing integration, and doc 23 still carries that as absent.
ALTER TABLE "plan" ADD COLUMN "price_per_agent_micros" BIGINT;
ALTER TABLE "plan" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'GBP';

-- ---------------------------------------------------------------------------
-- OD-07 · Billable is a decision, not a default.
--
-- The failure mode of this direction is under-billing, which is a conversation
-- somebody has. The failure mode of the other is invoicing a customer for work
-- nobody meant to charge for, which is a refund and a lost argument about
-- trust.
--
-- Existing rows are deliberately left alone. A time entry already recorded was
-- entered under the old default, and rewriting history to match a new policy
-- would change what somebody has already been billed — the decision applies
-- from here, not backwards.
ALTER TABLE "activity_type" ALTER COLUMN "billable" SET DEFAULT false;
ALTER TABLE "time_entry" ALTER COLUMN "billable" SET DEFAULT false;

-- ---------------------------------------------------------------------------
-- AI residency · Where a tenant's prompts may be processed.
--
-- An empty array means "wherever this tenant's own data lives", resolved
-- against `tenant.region` at the point of the check. That is why there is no
-- backfill: every tenant provisioned before this column existed already has
-- the answer, in the column next to it, and writing a guess into this one
-- would turn an inherited policy into an explicit one nobody chose.
--
-- The gateway refuses a call whose provider processes outside the list. It
-- refuses rather than falling back to another provider: a fallback would be
-- the platform choosing, on a tenant's behalf, to process their data somewhere
-- they had not agreed to.
ALTER TABLE "tenant" ADD COLUMN "ai_allowed_regions" TEXT[] NOT NULL DEFAULT '{}';
