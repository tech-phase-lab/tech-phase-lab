-- Retain signed adverse evidence even when it arrives before the local payment.
-- Apply to the dedicated PRO Sandbox database before deploying dispute handling.
BEGIN;
ALTER TABLE tech_phase_billing_sandbox.adverse_transactions
  DROP CONSTRAINT IF EXISTS adverse_transactions_reason_check;
ALTER TABLE tech_phase_billing_sandbox.adverse_transactions
  ADD CONSTRAINT adverse_transactions_reason_check
  CHECK (reason IN ('REFUNDED','REVERSED','DISPUTED'));
CREATE OR REPLACE VIEW tech_phase_billing_sandbox.entitlement_periods AS
 SELECT s.user_id, p.transaction_id, g.period_start, g.period_end
 FROM tech_phase_billing_sandbox.periods g
 JOIN tech_phase_billing_sandbox.payments p USING (transaction_id)
 JOIN tech_phase_billing_sandbox.subscriptions s ON s.id = p.subscription_id
 WHERE NOT EXISTS (SELECT 1 FROM tech_phase_billing_sandbox.review_holds h WHERE h.subscription_id = s.id)
 AND NOT EXISTS (
   SELECT 1 FROM tech_phase_billing_sandbox.adverse_transactions a
   JOIN tech_phase_billing_sandbox.payments affected ON affected.transaction_id=a.transaction_id
   WHERE affected.subscription_id=s.id
 );
COMMIT;
