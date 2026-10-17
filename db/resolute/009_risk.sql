-- Additive, RESOLUTE database only. Apply using the migration owner, never at web startup.
BEGIN;
CREATE TABLE IF NOT EXISTS resolute.risk_control (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO resolute.risk_control(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS resolute.risk_candidates (
 id text PRIMARY KEY, url text NOT NULL, title text NOT NULL, body text NOT NULL,
 published_at timestamptz NOT NULL, source_kind text NOT NULL CHECK(source_kind IN('sns','report','official')),
 fingerprint text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), manual boolean NOT NULL DEFAULT false,
 processed_at timestamptz, hidden boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS resolute.risk_days (
 day date PRIMARY KEY, state text NOT NULL CHECK(state IN('processing','ready','failed')),
 articles jsonb NOT NULL DEFAULT '[]', updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS resolute.risk_quotes (id text PRIMARY KEY, value jsonb NOT NULL, revision integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS resolute.risk_hidden (article_id text PRIMARY KEY, hidden_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS resolute.risk_budget (month text PRIMARY KEY, reserved_usd numeric(8,4) NOT NULL DEFAULT 0 CHECK(reserved_usd>=0));
CREATE TABLE IF NOT EXISTS resolute.risk_health (id boolean PRIMARY KEY DEFAULT true CHECK(id), collected_at timestamptz, collection_ok boolean NOT NULL DEFAULT false, last_job_at timestamptz, last_job_ok boolean NOT NULL DEFAULT false);
INSERT INTO resolute.risk_health(id) VALUES(true) ON CONFLICT DO NOTHING;
-- Create LOGIN passwords out-of-band in Railway variables only.
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='resolute_risk_writer') THEN CREATE ROLE resolute_risk_writer NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA resolute TO resolute_risk_writer;
GRANT SELECT,INSERT,UPDATE,DELETE ON resolute.risk_control,resolute.risk_candidates,resolute.risk_days,resolute.risk_quotes,resolute.risk_hidden,resolute.risk_budget,resolute.risk_health TO resolute_risk_writer;
GRANT SELECT ON resolute.entitlements TO resolute_risk_writer;
COMMIT;
