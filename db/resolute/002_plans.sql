-- Explicit application to the dedicated RESOLUTE database only. No runtime migrations.
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
END $$;
CREATE TABLE resolute.plans (
 clerk_user_id text PRIMARY KEY CHECK (clerk_user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
 revision bigint NOT NULL CHECK (revision >= 0 AND revision < 9007199254740991),
 plan jsonb,
 created_at timestamptz,
 updated_at timestamptz,
 deleted_at timestamptz,
 CHECK ((plan IS NULL AND created_at IS NULL AND updated_at IS NULL)
     OR (jsonb_typeof(plan) = 'object' AND created_at IS NOT NULL AND updated_at IS NOT NULL AND deleted_at IS NULL)),
 CHECK (plan IS NULL OR (NOT (plan ? 'answers') AND NOT (plan ? 'fx')))
);
-- Transactional handoff for a future independent encrypted deletion ledger.
-- These rows alone cannot protect a restore from a snapshot preceding deletion.
CREATE TABLE resolute.plan_deletions (
 clerk_user_id text NOT NULL CHECK (clerk_user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
 revision bigint NOT NULL CHECK (revision > 0 AND revision < 9007199254740991),
 deleted_at timestamptz NOT NULL,
 PRIMARY KEY (clerk_user_id, revision)
);
REVOKE ALL ON resolute.plans, resolute.plan_deletions FROM PUBLIC;
-- Provision resolute_plan_writer separately with SELECT on entitlements,
-- SELECT/INSERT/UPDATE on plans, SELECT/INSERT on plan_deletions. No DDL/admin rights.
COMMIT;
