-- Explicit migration only. Sandbox data MUST NOT grant production entitlements.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
END $$;
CREATE SCHEMA resolute_payments_sandbox;
CREATE TABLE resolute_payments_sandbox.orders (
  id uuid PRIMARY KEY,
  user_id text NOT NULL CHECK (user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
  request_key uuid NOT NULL,
  capture_key uuid NOT NULL UNIQUE,
  quote jsonb NOT NULL,
  paypal_id text UNIQUE,
  capture_id text UNIQUE,
  state text NOT NULL CHECK (state IN ('creating','created','capturing','paid','held','suspended','revoked')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  capture_checked_at timestamptz,
  capture_pro_until timestamptz,
  paid_at timestamptz,
  UNIQUE (user_id, request_key),
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX one_capture_per_member ON resolute_payments_sandbox.orders(user_id) WHERE state='capturing';
CREATE TABLE resolute_payments_sandbox.grants (
  order_id uuid PRIMARY KEY REFERENCES resolute_payments_sandbox.orders(id),
  user_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('initial','renewal')),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > starts_at),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','suspended','revoked'))
);
CREATE INDEX ON resolute_payments_sandbox.grants (user_id);
CREATE TABLE resolute_payments_sandbox.events (
  id text PRIMARY KEY,
  digest text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE resolute_payments_sandbox.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid REFERENCES resolute_payments_sandbox.orders(id),
  code text NOT NULL,
  dedup_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE resolute_payments_sandbox.alert_outbox (
  audit_id bigint PRIMARY KEY REFERENCES resolute_payments_sandbox.audit(id),
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz
);
-- No application startup DDL, grants to the existing reader, or public network exposure.
REVOKE ALL ON SCHEMA resolute_payments_sandbox FROM PUBLIC;
COMMIT;
