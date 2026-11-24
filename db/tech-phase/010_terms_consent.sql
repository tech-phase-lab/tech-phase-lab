-- Consent time for Tech Phase PRO checkouts (lawyer review, Nov 24): the time the member ticked
-- 「利用規約とプライバシーポリシーに同意する」 above the purchase button. The billing service writes it on every new
-- checkout, so this must be applied to the live (and sandbox) billing database BEFORE the service that writes it is
-- deployed. Existing rows keep NULL (they were bought before the consent line existed). Idempotent; adds one nullable
-- column and nothing else. NOTE: applying this to the live database is a production change that needs the owner's approval.
BEGIN;
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['tech_phase_billing_sandbox','tech_phase_billing_live'] LOOP
    IF to_regclass(s || '.subscriptions') IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE %I.subscriptions ADD COLUMN IF NOT EXISTS terms_consent_at timestamptz', s);
  END LOOP;
END $$;
COMMIT;
