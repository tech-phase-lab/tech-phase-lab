-- Reviewed setup only; never run automatically on startup.
-- Run as the schema owner. The runtime cannot delete/reset an attempted check.
BEGIN;
CREATE TABLE IF NOT EXISTS resolute.ai_connection_checks (
 id text PRIMARY KEY CHECK (id = 'owner-key-check-2026-10-23'),
 state text NOT NULL CHECK (state IN ('claimed','verified','unverified')),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON resolute.ai_connection_checks FROM PUBLIC;
GRANT SELECT, INSERT ON resolute.ai_connection_checks TO resolute_risk_writer;
GRANT UPDATE (state,result) ON resolute.ai_connection_checks TO resolute_risk_writer;
COMMIT;
