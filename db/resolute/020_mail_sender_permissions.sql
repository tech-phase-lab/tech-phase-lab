-- Explicit operator preparation after the live entitlement view exists.
-- No credentials, login enablement, scheduler or outbound mail.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'resolute' THEN RAISE EXCEPTION 'Dedicated database required'; END IF;
 -- Refuse to reuse an unknown role and silently retain unrelated privileges.
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='resolute_notification_sender') THEN
  RAISE EXCEPTION 'Mail sender role already exists; inspect before provisioning';
 END IF;
END $$;
CREATE ROLE resolute_notification_sender NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA resolute,resolute_payments_live TO resolute_notification_sender;
GRANT SELECT ON resolute.plans,resolute.notification_settings,resolute.notification_outbox,
 resolute_payments_live.entitlement_periods TO resolute_notification_sender;
GRANT UPDATE(payload,accepted_at) ON resolute.notification_outbox TO resolute_notification_sender;
CREATE INDEX notification_outbox_resend_correlation ON resolute.notification_outbox
 ((payload->'resendAttempt'->>'correlation')) WHERE kind IN ('alerts','morning');
COMMIT;
