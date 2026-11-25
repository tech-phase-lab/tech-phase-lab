-- RESOLUTE 今夜のひと息 (owner, 2026-11-25): the member's rough nights (opens of the page on ★4+ or alert days), the answer chosen
-- in the next morning note, and the night's three questions. Read and written by resolute-api (lib/resolute/tonight-database.ts) with
-- the existing notification settings role; tonight's questions are written by the daily member job (resolute_today_plan_writer,
-- 027_today_plans.sql). No new role, no credentials. FILE ONLY: applied explicitly by the operator after 027 and the owner's
-- approval, never automatically. Idempotent.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'resolute' THEN RAISE EXCEPTION 'Dedicated database required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='resolute_notification_writer') THEN
  RAISE EXCEPTION 'Notification writer role missing';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='resolute_today_plan_writer') THEN
  RAISE EXCEPTION 'Apply 027_today_plans.sql first';
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS resolute.tonight_nights (
 clerk_user_id text NOT NULL CHECK (clerk_user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
 night_date date NOT NULL,
 stars smallint CHECK (stars BETWEEN 0 AND 5),
 alert boolean NOT NULL DEFAULT false,
 opened_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 answer text CHECK (answer IN ('done','skipped','unsure')),
 answered_at timestamptz,
 PRIMARY KEY (clerk_user_id, night_date),
 CHECK (alert OR stars >= 4),
 CHECK ((answer IS NULL) = (answered_at IS NULL))
);
CREATE TABLE IF NOT EXISTS resolute.tonight_questions (
 clerk_user_id text NOT NULL CHECK (clerk_user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
 night_date date NOT NULL,
 state text NOT NULL CHECK (state IN ('claimed','ready','failed')),
 questions jsonb CHECK (questions IS NULL OR jsonb_typeof(questions)='object' AND octet_length(questions::text) <= 8192),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY (clerk_user_id, night_date),
 CHECK ((state='ready') = (questions IS NOT NULL))
);
REVOKE ALL ON resolute.tonight_nights, resolute.tonight_questions FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON resolute.tonight_nights, resolute.tonight_questions TO resolute_notification_writer;
-- The alert-day check reads delivered alerts (already granted by 024_latest_alert_reader.sql; repeated here so the order does not matter).
GRANT SELECT ON resolute.notification_outbox TO resolute_notification_writer;
-- The daily member job writes tonight's questions (its AI cost goes to its own bucket, resolute.today_plan_budget).
GRANT SELECT, INSERT, UPDATE ON resolute.tonight_questions TO resolute_today_plan_writer;
-- A deleted plan (the plan API's DELETE, or resolute.erase_member) takes the member's nights, answers and questions with it.
CREATE OR REPLACE FUNCTION resolute.forget_tonight() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
 IF NEW.plan IS NULL THEN
  DELETE FROM resolute.tonight_nights WHERE clerk_user_id = NEW.clerk_user_id;
  DELETE FROM resolute.tonight_questions WHERE clerk_user_id = NEW.clerk_user_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION resolute.forget_tonight() FROM PUBLIC;
DROP TRIGGER IF EXISTS resolute_forget_tonight ON resolute.plans;
CREATE TRIGGER resolute_forget_tonight AFTER INSERT OR UPDATE OF plan ON resolute.plans
 FOR EACH ROW EXECUTE FUNCTION resolute.forget_tonight();
COMMIT;
