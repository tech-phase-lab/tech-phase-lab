-- Preparation only. Apply after the required restoration inventory, before enabling.
-- Use a dedicated writer (SELECT/INSERT) and reader (SELECT); no browser access.
CREATE TABLE IF NOT EXISTS resolute_thermometer_snapshots (
  session_date date PRIMARY KEY,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND snapshot->>'asOf' = session_date::text),
  created_at timestamptz NOT NULL DEFAULT now()
);
