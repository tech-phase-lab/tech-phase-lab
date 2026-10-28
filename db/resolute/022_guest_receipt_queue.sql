-- Explicit migration only. No sender activation and no plaintext email/link storage.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
END $$;
CREATE TABLE resolute_payments_live.guest_receipts (
  order_id uuid PRIMARY KEY REFERENCES resolute_payments_live.orders(id),
  state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','attempting','accepted','delivered','uncertain','blocked','closed')),
  provider_id uuid UNIQUE,
  recipient_hash text CHECK(recipient_hash ~ '^[a-f0-9]{64}$'),
  from_hash text CHECK(from_hash ~ '^[a-f0-9]{64}$'),
  attempts integer NOT NULL DEFAULT 0,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_check_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_event text CHECK(last_event IN ('sent','delivered','delivery_delayed','bounced','complained','failed','suppressed','unknown'))
);
CREATE FUNCTION resolute_payments_live.queue_guest_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state='paid' AND NEW.guest_id IS NOT NULL AND NEW.user_id=NEW.guest_id
    AND NEW.capture_id IS NOT NULL AND NEW.paid_at IS NOT NULL THEN
    INSERT INTO resolute_payments_live.guest_receipts(order_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER queue_guest_receipt AFTER INSERT OR UPDATE OF state ON resolute_payments_live.orders
  FOR EACH ROW EXECUTE FUNCTION resolute_payments_live.queue_guest_receipt();
INSERT INTO resolute_payments_live.guest_receipts(order_id)
  SELECT id FROM resolute_payments_live.orders WHERE state='paid' AND guest_id IS NOT NULL AND user_id=guest_id
    AND capture_id IS NOT NULL AND paid_at IS NOT NULL;
REVOKE ALL ON resolute_payments_live.guest_receipts FROM PUBLIC;
REVOKE ALL ON FUNCTION resolute_payments_live.queue_guest_receipt() FROM PUBLIC;
GRANT SELECT,INSERT ON resolute_payments_live.guest_receipts TO resolute_payment_live_writer;
COMMIT;
