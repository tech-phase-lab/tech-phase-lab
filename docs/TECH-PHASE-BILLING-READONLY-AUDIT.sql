-- Restored from the previous local audit after workspace maintenance.
-- Dedicated Sandbox DB only. Inspection, not migration or PayPal verification.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SELECT current_database() = 'tech_phase_billing_sandbox' AS expected_database,
       current_setting('transaction_read_only') AS read_only;
SELECT 'multiple_open_contracts' AS check_name, count(*) AS violations
FROM (SELECT user_id FROM tech_phase_billing_sandbox.subscriptions
      WHERE state NOT IN ('cancelled','expired') GROUP BY user_id HAVING count(*) > 1) duplicates
UNION ALL
SELECT 'payment_price_mismatch', count(*) FROM tech_phase_billing_sandbox.payments p
JOIN tech_phase_billing_sandbox.subscriptions s ON s.id=p.subscription_id
WHERE p.currency<>s.currency OR p.minor<>s.minor
UNION ALL
SELECT 'payment_outside_granted_period', count(*) FROM tech_phase_billing_sandbox.periods g
JOIN tech_phase_billing_sandbox.payments p USING(transaction_id)
WHERE p.paid_at<g.period_start OR p.paid_at>=g.period_end
UNION ALL
SELECT 'entitlement_member_mismatch', count(*) FROM tech_phase_billing_sandbox.entitlement_periods e
JOIN tech_phase_billing_sandbox.payments p USING(transaction_id)
JOIN tech_phase_billing_sandbox.subscriptions s ON s.id=p.subscription_id WHERE e.user_id<>s.user_id
UNION ALL
SELECT 'held_contract_grants_access', count(*) FROM tech_phase_billing_sandbox.entitlement_periods e
JOIN tech_phase_billing_sandbox.payments p USING(transaction_id)
WHERE EXISTS (SELECT 1 FROM tech_phase_billing_sandbox.review_holds h WHERE h.subscription_id=p.subscription_id)
OR EXISTS (SELECT 1 FROM tech_phase_billing_sandbox.adverse_transactions a
           JOIN tech_phase_billing_sandbox.payments affected USING(transaction_id)
           WHERE affected.subscription_id=p.subscription_id);
-- Missing periods may be pending or held. Never grant access from this count.
SELECT count(*) AS payments_without_verified_period FROM tech_phase_billing_sandbox.payments p
LEFT JOIN tech_phase_billing_sandbox.periods g USING(transaction_id) WHERE g.transaction_id IS NULL;
ROLLBACK;
