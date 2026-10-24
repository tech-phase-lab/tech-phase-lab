-- Explicit application only; no automatic migration or role changes.
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
END $$;
CREATE TABLE resolute.notification_settings (
 clerk_user_id text PRIMARY KEY CHECK (clerk_user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
 settings jsonb NOT NULL CHECK (jsonb_typeof(settings)='object'),
 revision bigint NOT NULL CHECK (revision>0 AND revision<9007199254740991),
 updated_at timestamptz NOT NULL,
 CHECK (settings->>'deliveryHourJst' IN ('7','8','9','10')),
 CHECK (jsonb_typeof(settings->'morningEnabled')='boolean'),
 CHECK (jsonb_typeof(settings->'alertsEnabled')='boolean'),
 CHECK (jsonb_typeof(settings->'watchItems')='array' AND jsonb_array_length(settings->'watchItems')<=5)
);
REVOKE ALL ON resolute.notification_settings FROM PUBLIC;
-- Provision separately: resolute_notification_writer gets USAGE on resolute,
-- SELECT on entitlements and SELECT/INSERT/UPDATE on notification_settings only.
-- The runtime does not grant roles, create tables, enqueue or send mail.
COMMIT;
