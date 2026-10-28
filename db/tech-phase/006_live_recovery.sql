BEGIN;
-- Durable due-time queue: each completed item is its own resume checkpoint.
CREATE TABLE IF NOT EXISTS tech_phase_billing_live.recovery_queue (
 subscription_id uuid PRIMARY KEY REFERENCES tech_phase_billing_live.subscriptions(id),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,
 lease_until timestamptz,
 failures integer NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 20),
 last_outcome text CHECK (last_outcome IN ('verified','payment-pending','review-required','failed')),
 checked_at timestamptz,
 CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
CREATE INDEX IF NOT EXISTS recovery_due ON tech_phase_billing_live.recovery_queue(next_attempt_at,subscription_id);
CREATE OR REPLACE FUNCTION tech_phase_billing_live.enqueue_recovery() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF NEW.paypal_id IS NOT NULL THEN
  INSERT INTO tech_phase_billing_live.recovery_queue(subscription_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION tech_phase_billing_live.enqueue_recovery() FROM PUBLIC;
DROP TRIGGER IF EXISTS enqueue_recovery ON tech_phase_billing_live.subscriptions;
CREATE TRIGGER enqueue_recovery AFTER INSERT OR UPDATE OF paypal_id ON tech_phase_billing_live.subscriptions
 FOR EACH ROW EXECUTE FUNCTION tech_phase_billing_live.enqueue_recovery();
INSERT INTO tech_phase_billing_live.recovery_queue(subscription_id)
 SELECT id FROM tech_phase_billing_live.subscriptions WHERE paypal_id IS NOT NULL ON CONFLICT DO NOTHING;
REVOKE ALL ON tech_phase_billing_live.recovery_queue FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON tech_phase_billing_live.recovery_queue TO tech_phase_billing_live_writer;
COMMIT;
