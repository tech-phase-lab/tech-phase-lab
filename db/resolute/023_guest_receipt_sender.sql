-- Explicit role preparation only; no LOGIN or password, no existing-role changes.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
END $$;
CREATE ROLE resolute_guest_mail_sender NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE resolute TO resolute_guest_mail_sender;
GRANT USAGE ON SCHEMA resolute_payments_live TO resolute_guest_mail_sender;
GRANT SELECT ON resolute_payments_live.orders TO resolute_guest_mail_sender;
GRANT SELECT,UPDATE ON resolute_payments_live.guest_receipts TO resolute_guest_mail_sender;
ALTER ROLE resolute_guest_mail_sender IN DATABASE resolute SET statement_timeout=3000;
ALTER ROLE resolute_guest_mail_sender IN DATABASE resolute SET idle_in_transaction_session_timeout=10000;
COMMIT;
