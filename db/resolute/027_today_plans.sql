-- RESOLUTE「今日やること」 (owner, 2026-11-25; resolute-pc-1125 §4–§5): one TodayPlan per member per U.S. market date,
-- written by the daily job (services/resolute-api/today-plan-job.mjs) and read by resolute-api (GET /internal/v1/today-plan).
-- FILE ONLY: applying this to any real database is a production change that needs the owner's approval.
-- Explicit application after 001-026 with the migration owner, never at startup. Idempotent.
-- Roles are created NOLOGIN; the operator gives them LOGIN and a password out-of-band (Railway variables only).
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
 IF to_regclass('resolute.plans') IS NULL OR to_regclass('resolute.notification_settings') IS NULL
   OR to_regclass('resolute.risk_days') IS NULL OR to_regclass('resolute.risk_hidden') IS NULL
   OR to_regclass('resolute.resolute_thermometer_snapshots') IS NULL OR to_regclass('resolute.entitlements') IS NULL
   OR to_regclass('resolute_payments_live.entitlement_periods') IS NULL THEN
  RAISE EXCEPTION 'Prerequisite RESOLUTE tables missing';
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS resolute.today_plans (
 clerk_user_id text NOT NULL CHECK (clerk_user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
 market_date date NOT NULL,
 source text NOT NULL CHECK (source IN ('ai','fixed')),
 plan jsonb NOT NULL CHECK (jsonb_typeof(plan) = 'object' AND plan->>'date' = market_date::text AND plan->>'source' = source
   AND octet_length(plan::text) <= 16384),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (clerk_user_id, market_date)
);
CREATE INDEX IF NOT EXISTS today_plans_market_date ON resolute.today_plans (market_date);
-- Its own monthly AI bucket (RESOLUTE_TODAY_PLAN_MONTHLY_LIMIT_USD), separate from the news summaries' risk_budget.
CREATE TABLE IF NOT EXISTS resolute.today_plan_budget (month text PRIMARY KEY, reserved_usd numeric(8,4) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0));
REVOKE ALL ON resolute.today_plans, resolute.today_plan_budget FROM PUBLIC;

-- A deleted plan (the plan API's DELETE, or resolute.erase_member) takes the member's daily plans with it.
CREATE OR REPLACE FUNCTION resolute.forget_today_plans() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
 IF NEW.plan IS NULL THEN DELETE FROM resolute.today_plans WHERE clerk_user_id = NEW.clerk_user_id; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION resolute.forget_today_plans() FROM PUBLIC;
DROP TRIGGER IF EXISTS resolute_forget_today_plans ON resolute.plans;
CREATE TRIGGER resolute_forget_today_plans AFTER INSERT OR UPDATE OF plan ON resolute.plans
 FOR EACH ROW EXECUTE FUNCTION resolute.forget_today_plans();

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='resolute_today_plan_writer') THEN
  CREATE ROLE resolute_today_plan_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='resolute_today_plan_reader') THEN
  CREATE ROLE resolute_today_plan_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('resolute_today_plan_writer','resolute_today_plan_reader')
   AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
  RAISE EXCEPTION 'Today-plan roles must stay scoped';
 END IF;
END $$;
GRANT CONNECT ON DATABASE resolute TO resolute_today_plan_writer, resolute_today_plan_reader;
GRANT USAGE ON SCHEMA resolute TO resolute_today_plan_writer, resolute_today_plan_reader;
-- Job: reads the saved plans, alert settings, the day's Shock Gauge and thermometer snapshots and live entitlements; writes only
-- its own rows and its own budget. No access to payments beyond the entitlement view, mail, or the news candidates.
GRANT SELECT ON resolute.plans, resolute.notification_settings, resolute.risk_days, resolute.risk_hidden,
 resolute.resolute_thermometer_snapshots, resolute.entitlements TO resolute_today_plan_writer;
GRANT USAGE ON SCHEMA resolute_payments_live TO resolute_today_plan_writer;
GRANT SELECT ON resolute_payments_live.entitlement_periods TO resolute_today_plan_writer;
GRANT SELECT, INSERT, DELETE ON resolute.today_plans TO resolute_today_plan_writer;
GRANT SELECT, INSERT, UPDATE ON resolute.today_plan_budget TO resolute_today_plan_writer;
-- resolute-api read path: the stored plans only.
GRANT SELECT ON resolute.today_plans TO resolute_today_plan_reader;
ALTER ROLE resolute_today_plan_reader IN DATABASE resolute SET default_transaction_read_only = on;
COMMIT;
