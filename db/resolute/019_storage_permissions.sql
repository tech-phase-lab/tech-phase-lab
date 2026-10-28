-- Operator-only preparation after 002-005/016-018. Never enables logins.
-- Use provision-storage-permissions.mjs for the atomic post-grant ACL audit.
BEGIN;
DO $$
DECLARE target text;
BEGIN
 IF current_database()<>'resolute' THEN RAISE EXCEPTION 'Dedicated database required'; END IF;
 FOREACH target IN ARRAY ARRAY['resolute_plan_writer','resolute_notification_writer','resolute_protection_writer'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=target AND NOT rolcanlogin
   AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
   AND NOT rolbypassrls AND NOT rolinherit)
   OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member OR r.oid=m.roleid WHERE r.rolname=target)
  THEN RAISE EXCEPTION 'Expected dormant isolated writer required'; END IF;
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA resolute TO resolute_plan_writer,resolute_notification_writer,resolute_protection_writer;
GRANT SELECT ON resolute.entitlements TO resolute_plan_writer,resolute_notification_writer;
GRANT SELECT,INSERT,UPDATE ON resolute.plans TO resolute_plan_writer;
GRANT SELECT,INSERT ON resolute.plan_deletions TO resolute_plan_writer;
GRANT SELECT,INSERT,UPDATE ON resolute.notification_settings TO resolute_notification_writer;
-- No access to notification delivery state/outbox, journals or raw payment tables.
-- Protection receipt column grants are supplied by 018 and checked by the runner.
COMMIT;
