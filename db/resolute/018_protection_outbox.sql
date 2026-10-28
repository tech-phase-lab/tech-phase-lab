-- Explicit migration after 002, 004, 017. No logins, flags or schedules enabled.
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
END $$;
CREATE TABLE resolute.protection_outbox (
 clerk_user_id text NOT NULL CHECK(clerk_user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
 revision bigint NOT NULL CHECK(revision>0 AND revision<9007199254740991),
 kind text NOT NULL CHECK(kind IN ('delete','alerts_off','morning_off')),
 occurred_at timestamptz NOT NULL,
 receipt_sha256 text CHECK(receipt_sha256 ~ '^[0-9a-f]{64}$'),
 published_at timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_attempt_at timestamptz NOT NULL DEFAULT '-infinity',
 CHECK((receipt_sha256 IS NULL)=(published_at IS NULL)),
 PRIMARY KEY(clerk_user_id,revision,kind)
);
REVOKE ALL ON resolute.protection_outbox FROM PUBLIC;
CREATE FUNCTION resolute.enqueue_protection() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='plan_deletions' THEN
  INSERT INTO resolute.protection_outbox(clerk_user_id,revision,kind,occurred_at)
   VALUES(NEW.clerk_user_id,NEW.revision,'delete',NEW.deleted_at);
 ELSE
  INSERT INTO resolute.protection_outbox(clerk_user_id,revision,kind,occurred_at)
   VALUES(NEW.clerk_user_id,NEW.revision,NEW.kind||'_off',NEW.stopped_at);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION resolute.enqueue_protection() FROM PUBLIC;
CREATE TRIGGER resolute_plan_protection AFTER INSERT ON resolute.plan_deletions
 FOR EACH ROW EXECUTE FUNCTION resolute.enqueue_protection();
CREATE TRIGGER resolute_stop_protection AFTER INSERT ON resolute.notification_suppressions
 FOR EACH ROW EXECUTE FUNCTION resolute.enqueue_protection();
INSERT INTO resolute.protection_outbox(clerk_user_id,revision,kind,occurred_at)
 SELECT clerk_user_id,revision,'delete',deleted_at FROM resolute.plan_deletions;
INSERT INTO resolute.protection_outbox(clerk_user_id,revision,kind,occurred_at)
 SELECT clerk_user_id,revision,kind||'_off',stopped_at FROM resolute.notification_suppressions;
-- Runtime cannot insert, delete or change the event identity/content.
GRANT SELECT ON resolute.protection_outbox TO resolute_plan_writer,resolute_notification_writer;
GRANT UPDATE(receipt_sha256,published_at,attempts,next_attempt_at)
 ON resolute.protection_outbox TO resolute_plan_writer,resolute_notification_writer;
-- Dormant retry worker: no login/secret, no application or payment table access.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='resolute_protection_writer') THEN
  CREATE ROLE resolute_protection_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
 END IF;
END $$;
GRANT USAGE ON SCHEMA resolute TO resolute_protection_writer;
GRANT SELECT ON resolute.protection_outbox TO resolute_protection_writer;
GRANT UPDATE(receipt_sha256,published_at,attempts,next_attempt_at)
 ON resolute.protection_outbox TO resolute_protection_writer;
COMMIT;
