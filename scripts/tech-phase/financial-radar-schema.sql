-- Run once against the existing Tech Phase PostgreSQL database as its owner.
-- No existing tables, account roles, or authentication settings are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.tech_phase_financial_radar (
  genre text NOT NULL CHECK (genre ~ '^[a-z][a-z0-9-]{0,63}$'),
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,19}$'),
  ocf_margin numeric NOT NULL CHECK (ocf_margin > '-Infinity'::numeric AND ocf_margin < 'Infinity'::numeric),
  cover numeric NOT NULL CHECK (cover >= 0 AND cover < 'Infinity'::numeric),
  revenue_growth numeric CHECK (revenue_growth > '-Infinity'::numeric AND revenue_growth < 'Infinity'::numeric),
  revenue_usd numeric NOT NULL CHECK (revenue_usd >= 0 AND revenue_usd < 'Infinity'::numeric),
  period_end date NOT NULL CHECK (isfinite(period_end)),
  previous_ocf_margin numeric CHECK (previous_ocf_margin > '-Infinity'::numeric AND previous_ocf_margin < 'Infinity'::numeric),
  previous_cover numeric CHECK (previous_cover >= 0 AND previous_cover < 'Infinity'::numeric),
  needs_review boolean NOT NULL,
  calculated_at timestamptz NOT NULL CHECK (isfinite(calculated_at)),
  -- These preserve fields already required by the existing PRO payload.
  fcf_margin numeric CHECK (fcf_margin > '-Infinity'::numeric AND fcf_margin < 'Infinity'::numeric),
  basis text CHECK (basis IN ('annual', 'ttm')),
  previous_period_end date CHECK (isfinite(previous_period_end)),
  PRIMARY KEY (genre, ticker),
  CHECK ((previous_ocf_margin IS NULL) = (previous_cover IS NULL))
);

COMMENT ON TABLE public.tech_phase_financial_radar IS
  'Latest financial radar calculation per genre/ticker. No member/account data.';
COMMENT ON COLUMN public.tech_phase_financial_radar.ocf_margin IS 'Operating cash flow / revenue * 100; percent, not a 0-100 score.';
COMMENT ON COLUMN public.tech_phase_financial_radar.cover IS 'Cash / borrowings and leases, in multiples; existing payload normalizes Infinity to 1000.';
COMMENT ON COLUMN public.tech_phase_financial_radar.revenue_growth IS 'Year-over-year revenue change in percent; NULL means unavailable, not zero.';
COMMENT ON COLUMN public.tech_phase_financial_radar.revenue_usd IS 'Revenue in USD, not millions or billions.';
COMMENT ON COLUMN public.tech_phase_financial_radar.period_end IS 'Fiscal period end (existing facts.latest.end), not the earnings announcement timestamp.';
REVOKE ALL ON TABLE public.tech_phase_financial_radar FROM PUBLIC;
COMMIT;
