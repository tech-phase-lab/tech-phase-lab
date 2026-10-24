-- Explicit preparation only, after 004. No role/login, scheduler or delivery changes.
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
END $$;
CREATE TABLE resolute.notification_suppressions (
 clerk_user_id text NOT NULL CHECK (clerk_user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
 revision bigint NOT NULL CHECK (revision > 0 AND revision < 9007199254740991),
 kind text NOT NULL CHECK (kind IN ('alerts','morning')),
 stopped_at timestamptz NOT NULL,
 PRIMARY KEY (clerk_user_id, revision, kind)
);
REVOKE ALL ON resolute.notification_suppressions FROM PUBLIC;
-- The definer is the explicit migration owner, not the runtime writer. Fixed schema,
-- no dynamic SQL, no caller-controlled search path, no public function execution.
CREATE FUNCTION resolute.record_notification_suppression() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
 IF NEW.settings->>'alertsEnabled' = 'false' THEN
  INSERT INTO resolute.notification_suppressions VALUES
   (NEW.clerk_user_id, NEW.revision, 'alerts', NEW.updated_at);
 END IF;
 IF NEW.settings->>'morningEnabled' = 'false' THEN
  INSERT INTO resolute.notification_suppressions VALUES
   (NEW.clerk_user_id, NEW.revision, 'morning', NEW.updated_at);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION resolute.record_notification_suppression() FROM PUBLIC;
CREATE TRIGGER resolute_notification_suppression AFTER INSERT OR UPDATE
 ON resolute.notification_settings FOR EACH ROW
 EXECUTE FUNCTION resolute.record_notification_suppression();
-- Include existing explicit stops before the first independent export.
INSERT INTO resolute.notification_suppressions
 SELECT clerk_user_id, revision, 'alerts', updated_at FROM resolute.notification_settings
 WHERE settings->>'alertsEnabled' = 'false';
INSERT INTO resolute.notification_suppressions
 SELECT clerk_user_id, revision, 'morning', updated_at FROM resolute.notification_settings
 WHERE settings->>'morningEnabled' = 'false';
COMMIT;
