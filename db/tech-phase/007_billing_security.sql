BEGIN;
-- Dedicated LIVE billing database only. Apply with the existing migration role.
CREATE TABLE IF NOT EXISTS tech_phase_billing_live.security_windows (
 actor_ref text NOT NULL CHECK (actor_ref ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK (kind IN ('attempt','failure')),
 window_start timestamptz NOT NULL,
 count integer NOT NULL CHECK (count > 0),
 PRIMARY KEY(actor_ref,kind,window_start)
);
CREATE TABLE IF NOT EXISTS tech_phase_billing_live.security_alerts (
 id bigserial PRIMARY KEY,
 actor_ref text NOT NULL CHECK (actor_ref ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK (kind IN ('attempt','failure')),
 window_start timestamptz NOT NULL,
 count integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,
 lease_until timestamptz,
 UNIQUE(actor_ref,kind,window_start)
);
GRANT USAGE ON SCHEMA tech_phase_billing_live TO tech_phase_billing_live_writer;
GRANT SELECT,INSERT,UPDATE,DELETE ON tech_phase_billing_live.security_windows TO tech_phase_billing_live_writer;
GRANT SELECT,INSERT,UPDATE ON tech_phase_billing_live.security_alerts TO tech_phase_billing_live_writer;
GRANT USAGE,SELECT ON SEQUENCE tech_phase_billing_live.security_alerts_id_seq TO tech_phase_billing_live_writer;
COMMIT;
