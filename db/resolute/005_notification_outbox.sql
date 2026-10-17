BEGIN;
DO $$ BEGIN
 IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
END $$;
CREATE TABLE resolute.notification_state (
 clerk_user_id text PRIMARY KEY CHECK (clerk_user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
 rule_key text NOT NULL,
 notified jsonb NOT NULL CHECK (jsonb_typeof(notified)='object')
);
CREATE TABLE resolute.notification_outbox (
 idempotency_key text PRIMARY KEY,
 clerk_user_id text NOT NULL CHECK (clerk_user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
 kind text NOT NULL CHECK (kind IN ('alerts','morning')),
 delivery_date_jst date NOT NULL,
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 accepted_at timestamptz,
 UNIQUE(clerk_user_id,delivery_date_jst,kind)
);
REVOKE ALL ON resolute.notification_state,resolute.notification_outbox FROM PUBLIC;
-- Worker role: USAGE on resolute; SELECT on entitlements, plans and notification_settings;
-- SELECT/INSERT/UPDATE on notification_state; SELECT/INSERT on notification_outbox.
-- Sender acknowledgement gets UPDATE(accepted_at) separately. No email address stored.
-- This migration neither starts a scheduler nor sends email.
COMMIT;
