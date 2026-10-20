-- Provider billing time may differ from the initial start time by less than a
-- day. The application separately verifies the exact monthly calendar date.
-- Preserve all rows and privileges; only replace the elapsed-duration bound.
BEGIN;
ALTER TABLE tech_phase_billing_sandbox.periods DROP CONSTRAINT IF EXISTS periods_check1;
ALTER TABLE tech_phase_billing_sandbox.periods DROP CONSTRAINT IF EXISTS periods_month_window;
ALTER TABLE tech_phase_billing_sandbox.periods ADD CONSTRAINT periods_month_window
  CHECK (period_end - period_start >= interval '27 days'
     AND period_end - period_start < interval '32 days');
COMMIT;
