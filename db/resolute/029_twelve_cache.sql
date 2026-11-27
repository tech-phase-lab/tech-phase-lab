-- RESOLUTE's shared Twelve Data copies (owner, 2026-11-26: Twelve Data use must never grow with members).
-- One row per symbol and U.S. market date for the daily closes, one row per symbol for the split history (with the ET day it was read).
-- Written only by the daily prefetch (services/resolute-api/twelve-prefetch.mjs, the resolute_notification_queue role, which also
-- stores closes the alert step had to read itself); read by the alert step, 「今日やること」 (resolute_today_plan_writer) and the
-- notification settings API (resolute_notification_writer). Market data only: no member id, no amount.
-- FILE ONLY: applying this to any real database is a production change that needs the owner's approval.
-- Explicit application after 001-028 with the migration owner, never at startup. Idempotent. A role that does not exist yet is skipped
-- (re-apply after creating it); until applied, every reader falls back to what it did when a provider read failed.
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
 IF to_regclass('resolute.notification_settings') IS NULL THEN RAISE EXCEPTION 'Prerequisite RESOLUTE tables missing'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS resolute.twelve_daily_closes (
 symbol text NOT NULL CHECK (symbol ~ '^[A-Z][A-Z0-9./-]{0,14}$'),
 market_date date NOT NULL,
 bars jsonb NOT NULL CHECK (jsonb_typeof(bars) = 'array' AND jsonb_array_length(bars) <= 5 AND octet_length(bars::text) <= 1024),
 read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (symbol, market_date)
);
CREATE INDEX IF NOT EXISTS twelve_daily_closes_market_date ON resolute.twelve_daily_closes (market_date);
CREATE TABLE IF NOT EXISTS resolute.twelve_splits (
 symbol text PRIMARY KEY CHECK (symbol ~ '^[A-Z][A-Z0-9./-]{0,14}$'),
 splits jsonb NOT NULL CHECK (jsonb_typeof(splits) = 'array' AND octet_length(splits::text) <= 16384),
 read_at timestamptz NOT NULL,
 read_day date NOT NULL
);
REVOKE ALL ON resolute.twelve_daily_closes, resolute.twelve_splits FROM PUBLIC;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resolute_notification_queue') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON resolute.twelve_daily_closes TO resolute_notification_queue;
  GRANT SELECT, INSERT, UPDATE ON resolute.twelve_splits TO resolute_notification_queue;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resolute_today_plan_writer') THEN
  GRANT SELECT ON resolute.twelve_daily_closes, resolute.twelve_splits TO resolute_today_plan_writer;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resolute_notification_writer') THEN
  GRANT SELECT ON resolute.twelve_splits TO resolute_notification_writer;
 END IF;
END $$;
COMMIT;
