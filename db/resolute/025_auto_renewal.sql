-- RESOLUTE automatic renewal (owner request 2026-11-19). Explicit migration only; safe to run twice.
-- Applying it changes nothing for buyers: no order asks PayPal to save a payment method and no renewal job
-- charges anyone until RESOLUTE_AUTO_RENEWAL_ENABLED=true is set (owner approval) and the job is scheduled.
-- Applies to each payment ledger that exists (live, and Sandbox for acceptance checks).
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
END $$;
DO $migration$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['resolute_payments_live','resolute_payments_sandbox'] LOOP
    IF to_regnamespace(s) IS NULL THEN CONTINUE; END IF;
    -- The order asked PayPal to save the payment method (PayPal Vault, merchant use); consent = the agree click
    -- on a screen that showed the auto-renewal line.
    EXECUTE format('ALTER TABLE %I.orders ADD COLUMN IF NOT EXISTS auto_renewal_offered boolean NOT NULL DEFAULT false', s);
    EXECUTE format('ALTER TABLE %I.orders ADD COLUMN IF NOT EXISTS auto_renewal_consent_at timestamptz', s);
    -- A declined merchant-initiated renewal is a terminal order state (no money moved).
    EXECUTE format('ALTER TABLE %I.orders DROP CONSTRAINT IF EXISTS orders_state_check', s);
    EXECUTE format($q$ALTER TABLE %I.orders ADD CONSTRAINT orders_state_check
      CHECK (state IN ('creating','created','capturing','paid','held','suspended','revoked','declined'))$q$, s);
    EXECUTE format($q$CREATE TABLE IF NOT EXISTS %I.renewal_plans (
      user_id text PRIMARY KEY CHECK (user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
      source_order_id uuid NOT NULL UNIQUE REFERENCES %I.orders(id),
      token_id text NOT NULL UNIQUE CHECK (token_id ~ '^[A-Za-z0-9_-]{1,64}$'),
      customer_id text CHECK (customer_id ~ '^[A-Za-z0-9_-]{1,64}$'),
      language text NOT NULL CHECK (language IN ('ja','en')),
      state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','stopped','failed','ended','review')),
      consent_at timestamptz NOT NULL,
      consent_version text NOT NULL,
      next_renewal_at timestamptz NOT NULL,
      failures integer NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 3),
      next_attempt_at timestamptz,
      stopped_at timestamptz,
      end_reason text,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )$q$, s, s);
    -- One row per attempt; at most one live (charging/pending/uncertain/paid/review) attempt per renewal period.
    EXECUTE format($q$CREATE TABLE IF NOT EXISTS %I.renewal_charges (
      order_id uuid PRIMARY KEY REFERENCES %I.orders(id),
      user_id text NOT NULL CHECK (user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
      period_end timestamptz NOT NULL,
      attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
      state text NOT NULL CHECK (state IN ('charging','pending','uncertain','paid','declined','review')),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, period_end, attempt)
    )$q$, s, s);
    EXECUTE format($q$CREATE UNIQUE INDEX IF NOT EXISTS renewal_charge_once ON %I.renewal_charges(user_id, period_end)
      WHERE state IN ('charging','pending','uncertain','paid','review')$q$, s);
    -- Notices hold no address or text: a hash key, the channel that accepted it, and counts.
    EXECUTE format($q$CREATE TABLE IF NOT EXISTS %I.renewal_notices (
      notice_key text PRIMARY KEY CHECK (notice_key ~ '^[a-f0-9]{32}$'),
      user_id text NOT NULL CHECK (user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
      period_end timestamptz NOT NULL,
      kind text NOT NULL CHECK (kind IN ('upcoming_auto','upcoming_manual','failed')),
      state text NOT NULL CHECK (state IN ('claimed','push','mail','failed','skipped')),
      attempts integer NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 0 AND 10),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, period_end, kind)
    )$q$, s);
    EXECUTE format('REVOKE ALL ON %I.renewal_plans, %I.renewal_charges, %I.renewal_notices FROM PUBLIC', s, s, s);
  END LOOP;
  IF to_regnamespace('resolute_payments_live') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname='resolute_payment_live_writer') THEN
    GRANT SELECT,INSERT,UPDATE ON resolute_payments_live.renewal_plans, resolute_payments_live.renewal_charges,
      resolute_payments_live.renewal_notices TO resolute_payment_live_writer;
  END IF;
  IF to_regnamespace('resolute_payments_sandbox') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname='resolute_payment_sandbox_writer') THEN
    GRANT SELECT,INSERT,UPDATE ON resolute_payments_sandbox.renewal_plans, resolute_payments_sandbox.renewal_charges,
      resolute_payments_sandbox.renewal_notices TO resolute_payment_sandbox_writer;
  END IF;
END $migration$;
COMMIT;
