-- Explicit preparation only: no password, no LOGIN, no member/reader grants.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
END $$;
CREATE ROLE resolute_payment_live_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE resolute TO resolute_payment_live_writer;
GRANT USAGE ON SCHEMA resolute_payments_live TO resolute_payment_live_writer;
GRANT SELECT,INSERT,UPDATE ON resolute_payments_live.orders,resolute_payments_live.grants TO resolute_payment_live_writer;
GRANT SELECT,INSERT ON resolute_payments_live.events,resolute_payments_live.audit,resolute_payments_live.alert_outbox TO resolute_payment_live_writer;
GRANT SELECT ON resolute_payments_live.entitlement_periods TO resolute_payment_live_writer;
GRANT USAGE ON SEQUENCE resolute_payments_live.audit_id_seq TO resolute_payment_live_writer;
ALTER ROLE resolute_payment_live_writer IN DATABASE resolute SET statement_timeout = 3000;
ALTER ROLE resolute_payment_live_writer IN DATABASE resolute SET idle_in_transaction_session_timeout = 10000;
-- No DELETE, TRUNCATE, DDL, mutable audit/event history or email-delivery marking.
COMMIT;
