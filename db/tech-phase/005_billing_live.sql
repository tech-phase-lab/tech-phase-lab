BEGIN;
-- Apply only to a dedicated Tech Phase billing database after provisioning.
-- Sandbox data never feeds production Clerk metadata.

CREATE SCHEMA IF NOT EXISTS tech_phase_billing_live;
CREATE TABLE IF NOT EXISTS tech_phase_billing_live.subscriptions (
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
  ON tech_phase_billing_live.subscriptions(user_id)
  WHERE state NOT IN ('cancelled', 'expired');
CREATE TABLE IF NOT EXISTS tech_phase_billing_live.payments (
  transaction_id text PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES tech_phase_billing_live.subscriptions(id),
  currency text NOT NULL,
  minor integer NOT NULL CHECK (minor > 0),
  paid_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
-- Minimal audit metadata only; do not persist webhook payloads containing payer PII.
CREATE TABLE IF NOT EXISTS tech_phase_billing_live.events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  transaction_id text NOT NULL,
  subscription_id uuid NOT NULL REFERENCES tech_phase_billing_live.subscriptions(id),
  processed_at timestamptz NOT NULL DEFAULT now()
);


-- Separate verified periods from subscription status: ACTIVE is not payment proof.

CREATE TABLE IF NOT EXISTS tech_phase_billing_live.periods (
  transaction_id text PRIMARY KEY REFERENCES tech_phase_billing_live.payments(transaction_id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  CHECK (period_end - period_start BETWEEN interval '28 days' AND interval '31 days')
);
CREATE TABLE IF NOT EXISTS tech_phase_billing_live.review_holds (
  subscription_id uuid PRIMARY KEY REFERENCES tech_phase_billing_live.subscriptions(id),
  reason text NOT NULL CHECK (reason IN ('REFUNDED','PARTIALLY_REFUNDED','REVERSED','DISPUTED')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
-- Adverse notifications may arrive before the payment row. Keep a tombstone
-- without a payment FK so a delayed completion cannot restore refunded access.
CREATE TABLE IF NOT EXISTS tech_phase_billing_live.adverse_transactions (
  transaction_id text PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('REFUNDED','REVERSED')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
-- Read-only consumers need only this view, never raw payment or payer records.
CREATE OR REPLACE VIEW tech_phase_billing_live.entitlement_periods AS
 SELECT s.user_id, p.transaction_id, g.period_start, g.period_end
 FROM tech_phase_billing_live.periods g
 JOIN tech_phase_billing_live.payments p USING (transaction_id)
 JOIN tech_phase_billing_live.subscriptions s ON s.id = p.subscription_id
 WHERE NOT EXISTS (SELECT 1 FROM tech_phase_billing_live.review_holds h WHERE h.subscription_id = s.id)
 AND NOT EXISTS (SELECT 1 FROM tech_phase_billing_live.adverse_transactions a WHERE a.transaction_id=p.transaction_id);


-- Provider billing time may differ from the initial start time by less than a
-- day. The application separately verifies the exact monthly calendar date.
-- Preserve all rows and privileges; only replace the elapsed-duration bound.

ALTER TABLE tech_phase_billing_live.periods DROP CONSTRAINT IF EXISTS periods_check1;
ALTER TABLE tech_phase_billing_live.periods DROP CONSTRAINT IF EXISTS periods_month_window;
ALTER TABLE tech_phase_billing_live.periods ADD CONSTRAINT periods_month_window
  CHECK (period_end - period_start >= interval '27 days'
     AND period_end - period_start < interval '32 days');


-- Retain signed adverse evidence even when it arrives before the local payment.
-- Apply to the dedicated PRO Sandbox database before deploying dispute handling.

ALTER TABLE tech_phase_billing_live.adverse_transactions
  DROP CONSTRAINT IF EXISTS adverse_transactions_reason_check;
ALTER TABLE tech_phase_billing_live.adverse_transactions
  ADD CONSTRAINT adverse_transactions_reason_check
  CHECK (reason IN ('REFUNDED','REVERSED','DISPUTED'));
CREATE OR REPLACE VIEW tech_phase_billing_live.entitlement_periods AS
 SELECT s.user_id, p.transaction_id, g.period_start, g.period_end
 FROM tech_phase_billing_live.periods g
 JOIN tech_phase_billing_live.payments p USING (transaction_id)
 JOIN tech_phase_billing_live.subscriptions s ON s.id = p.subscription_id
 WHERE NOT EXISTS (SELECT 1 FROM tech_phase_billing_live.review_holds h WHERE h.subscription_id = s.id)
 AND NOT EXISTS (
   SELECT 1 FROM tech_phase_billing_live.adverse_transactions a
   JOIN tech_phase_billing_live.payments affected ON affected.transaction_id=a.transaction_id
   WHERE affected.subscription_id=s.id
 );


REVOKE ALL ON SCHEMA tech_phase_billing_live FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA tech_phase_billing_live FROM PUBLIC;
GRANT USAGE ON SCHEMA tech_phase_billing_live TO tech_phase_billing_live_writer;
GRANT SELECT,INSERT,UPDATE ON tech_phase_billing_live.subscriptions TO tech_phase_billing_live_writer;
GRANT SELECT,INSERT ON tech_phase_billing_live.payments,tech_phase_billing_live.events,tech_phase_billing_live.periods,tech_phase_billing_live.review_holds,tech_phase_billing_live.adverse_transactions TO tech_phase_billing_live_writer;
GRANT SELECT ON tech_phase_billing_live.entitlement_periods TO tech_phase_billing_live_writer;
COMMIT;
