-- Apply explicitly to the dedicated RESOLUTE database; never from an HTTP request.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'resolute' THEN
    RAISE EXCEPTION 'RESOLUTE migration requires the dedicated resolute database';
  END IF;
END $$;

CREATE SCHEMA resolute;
CREATE TABLE resolute.entitlements (
  clerk_user_id text NOT NULL CHECK (clerk_user_id ~ '^user_[A-Za-z0-9]{1,128}$'),
  product_id text NOT NULL CHECK (product_id = 'resolute_v1'),
  kind text NOT NULL CHECK (kind IN ('use', 'alerts')),
  starts_at timestamptz NOT NULL CHECK (isfinite(starts_at)),
  expires_at timestamptz,
  revoked_at timestamptz CHECK (revoked_at IS NULL OR isfinite(revoked_at)),
  source text NOT NULL CHECK (source IN ('purchase', 'renewal', 'admin')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (clerk_user_id, product_id, kind),
  CHECK ((kind = 'use' AND expires_at IS NULL)
      OR (kind = 'alerts' AND expires_at IS NOT NULL
          AND isfinite(expires_at) AND expires_at > starts_at))
);
COMMENT ON TABLE resolute.entitlements IS
  'Current entitlement state, not a payment ledger. PRO never grants RESOLUTE access.';
-- Payment/order history and idempotency must be implemented separately before
-- payment grants or renewal writes are enabled. One payment can grant both kinds.
COMMIT;
