-- Apply only to a dedicated Tech Phase billing database after provisioning.
-- Sandbox data never feeds production Clerk metadata.
BEGIN;
CREATE SCHEMA IF NOT EXISTS tech_phase_billing_sandbox;
CREATE TABLE IF NOT EXISTS tech_phase_billing_sandbox.subscriptions (
  id uuid PRIMARY KEY,
  user_id text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 128),
  currency text NOT NULL CHECK (currency IN ('JPY', 'USD')),
  minor integer NOT NULL,
  terms_version text NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 128),
  paypal_id text UNIQUE,
  state text NOT NULL DEFAULT 'creating' CHECK (state IN ('creating','approval_pending','active','suspended','cancelled','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((currency = 'JPY' AND minor = 2980) OR (currency = 'USD' AND minor = 2000))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_subscription_per_member
  ON tech_phase_billing_sandbox.subscriptions(user_id)
  WHERE state NOT IN ('cancelled', 'expired');
CREATE TABLE IF NOT EXISTS tech_phase_billing_sandbox.payments (
  transaction_id text PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES tech_phase_billing_sandbox.subscriptions(id),
  currency text NOT NULL,
  minor integer NOT NULL CHECK (minor > 0),
  paid_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
-- Minimal audit metadata only; do not persist webhook payloads containing payer PII.
CREATE TABLE IF NOT EXISTS tech_phase_billing_sandbox.events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  transaction_id text NOT NULL,
  subscription_id uuid NOT NULL REFERENCES tech_phase_billing_sandbox.subscriptions(id),
  processed_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
