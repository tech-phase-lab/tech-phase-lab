-- Explicit migration only; applying this does not enable guest checkout or sales.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
END $$;
ALTER TABLE resolute_payments_live.orders DROP CONSTRAINT orders_user_id_check;
ALTER TABLE resolute_payments_live.orders ADD CONSTRAINT orders_user_id_check
  CHECK (user_id ~ '^user_[A-Za-z0-9]{1,128}$' OR
    (user_id ~ '^guest_[a-f0-9]{64}$' AND COALESCE(quote->>'kind' = 'initial' AND quote->>'product' = 'resolute_v1', false)));
ALTER TABLE resolute_payments_live.orders ADD COLUMN guest_id text
  CHECK (guest_id ~ '^guest_[a-f0-9]{64}$');
CREATE UNIQUE INDEX guest_request_once ON resolute_payments_live.orders(guest_id,request_key) WHERE guest_id IS NOT NULL;
-- Guest principals can own payments, but never receive account entitlements.
ALTER TABLE resolute_payments_live.grants ADD CONSTRAINT grants_account_check
  CHECK (user_id ~ '^user_[A-Za-z0-9]{1,128}$');
COMMIT;
