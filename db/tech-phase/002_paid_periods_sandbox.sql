-- Separate verified periods from subscription status: ACTIVE is not payment proof.
BEGIN;
CREATE TABLE IF NOT EXISTS tech_phase_billing_sandbox.periods (
  transaction_id text PRIMARY KEY REFERENCES tech_phase_billing_sandbox.payments(transaction_id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  CHECK (period_end - period_start BETWEEN interval '28 days' AND interval '31 days')
);
CREATE TABLE IF NOT EXISTS tech_phase_billing_sandbox.review_holds (
  subscription_id uuid PRIMARY KEY REFERENCES tech_phase_billing_sandbox.subscriptions(id),
  reason text NOT NULL CHECK (reason IN ('REFUNDED','PARTIALLY_REFUNDED','REVERSED','DISPUTED')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
-- Adverse notifications may arrive before the payment row. Keep a tombstone
-- without a payment FK so a delayed completion cannot restore refunded access.
CREATE TABLE IF NOT EXISTS tech_phase_billing_sandbox.adverse_transactions (
  transaction_id text PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('REFUNDED','REVERSED')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
-- Read-only consumers need only this view, never raw payment or payer records.
CREATE OR REPLACE VIEW tech_phase_billing_sandbox.entitlement_periods AS
 SELECT s.user_id, p.transaction_id, g.period_start, g.period_end
 FROM tech_phase_billing_sandbox.periods g
 JOIN tech_phase_billing_sandbox.payments p USING (transaction_id)
 JOIN tech_phase_billing_sandbox.subscriptions s ON s.id = p.subscription_id
 WHERE NOT EXISTS (SELECT 1 FROM tech_phase_billing_sandbox.review_holds h WHERE h.subscription_id = s.id)
 AND NOT EXISTS (SELECT 1 FROM tech_phase_billing_sandbox.adverse_transactions a WHERE a.transaction_id=p.transaction_id);
COMMIT;
