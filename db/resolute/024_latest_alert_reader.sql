-- RESOLUTE「今日のお知らせ」(2026-11-17): resolute-api reads the signed-in member's newest delivered ③ alert
-- (lib/resolute/latest-alert-database.ts) with the existing notification settings role. Read only: no INSERT/UPDATE/DELETE,
-- no new role, no credentials. Applied explicitly by the operator (owner approval), never automatically.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'resolute' THEN RAISE EXCEPTION 'Dedicated database required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='resolute_notification_writer') THEN
  RAISE EXCEPTION 'Notification writer role missing';
 END IF;
END $$;
GRANT SELECT ON resolute.notification_outbox TO resolute_notification_writer;
COMMIT;
