-- Yearly PRO plans (JPY 29,800 / USD 200 per year) next to the monthly plans.
-- Apply to the sandbox and the live schema. Existing rows are untouched; only
-- the allowed price and billing-window checks widen. Idempotent.
-- NOTE: applying this to the live database is a production change that needs the owner's approval.
BEGIN;
DO $$
DECLARE s text; c record;
BEGIN
  FOREACH s IN ARRAY ARRAY['tech_phase_billing_sandbox','tech_phase_billing_live'] LOOP
    IF to_regclass(s || '.subscriptions') IS NULL THEN CONTINUE; END IF;
    FOR c IN SELECT conname FROM pg_constraint
      WHERE conrelid = (s || '.subscriptions')::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%minor%' AND pg_get_constraintdef(oid) LIKE '%currency%'
        AND conname <> 'subscriptions_offer_check' LOOP
      EXECUTE format('ALTER TABLE %I.subscriptions DROP CONSTRAINT %I', s, c.conname);
    END LOOP;
    EXECUTE format('ALTER TABLE %I.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_offer_check', s);
    EXECUTE format($f$ALTER TABLE %I.subscriptions ADD CONSTRAINT subscriptions_offer_check CHECK (
      (currency = 'JPY' AND minor IN (2980, 29800)) OR (currency = 'USD' AND minor IN (2000, 20000)))$f$, s);
    IF to_regclass(s || '.periods') IS NOT NULL THEN
      FOR c IN SELECT conname FROM pg_constraint
        WHERE conrelid = (s || '.periods')::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%interval%' LOOP
        EXECUTE format('ALTER TABLE %I.periods DROP CONSTRAINT %I', s, c.conname);
      END LOOP;
      -- Monthly: 27-31 days. Yearly: 364-367 days (provider start can drift by under a day; leap years).
      EXECUTE format($f$ALTER TABLE %I.periods ADD CONSTRAINT periods_window CHECK (
        (period_end - period_start >= interval '27 days' AND period_end - period_start < interval '32 days')
        OR (period_end - period_start >= interval '364 days' AND period_end - period_start < interval '368 days'))$f$, s);
    END IF;
  END LOOP;
END $$;
COMMIT;
