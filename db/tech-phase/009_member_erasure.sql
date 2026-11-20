-- Member erasure and retention purge for the PRO billing ledger (owner-approved design, 2026-11-20).
-- FILE ONLY: applying this to any real database is a production change that needs the owner's approval.
-- Apply with the existing migration role after 005-008. Idempotent. Nothing runs until a dedicated
-- erasure login (tech_phase_member_erasure) is created and the default-OFF erasure job is enabled.
--
-- Payment evidence is kept for the statutory period (Japan: books and records 7 years after the filing
-- deadline of the tax year; see docs/DATA-RETENTION-2026-11-20.md). On erasure the Clerk user id on every
-- subscription is replaced by a random pseudonym (user_erased + 32 hex), so the ledger no longer points
-- at an identity. Amounts, dates, provider ids and refund evidence stay until retain_until.
-- The owner accounts are refused by the function itself.
BEGIN;
CREATE TABLE IF NOT EXISTS tech_phase_billing_live.member_erasures (
  pseudonym text PRIMARY KEY CHECK (pseudonym ~ '^user_erased[a-f0-9]{32}$'),
  erased_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz NOT NULL
);
REVOKE ALL ON tech_phase_billing_live.member_erasures FROM PUBLIC;

CREATE OR REPLACE FUNCTION tech_phase_billing_live.erase_member(p_user_id text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_pseudonym text;
  v_last timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^user_[A-Za-z0-9]{1,128}$' OR p_user_id ~ '^user_erased' THEN
    RAISE EXCEPTION 'invalid-member';
  END IF;
  -- OWNER_ACCOUNT_ID / PRODUCTION_OWNER_ACCOUNT_ID (lib/membership/entitlements.ts): never erased automatically.
  IF p_user_id IN ('user_3JulL4D07KtVl5Eg2zdY1iczKbC', 'user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb') THEN
    RAISE EXCEPTION 'owner-account';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('tech-phase-member-erasure:' || p_user_id, 0));
  -- Abandoned checkouts that never reached the provider and hold no evidence are simply removed.
  DELETE FROM tech_phase_billing_live.subscriptions s
   WHERE s.user_id = p_user_id AND s.state = 'creating' AND s.paypal_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM tech_phase_billing_live.payments p WHERE p.subscription_id = s.id)
     AND NOT EXISTS (SELECT 1 FROM tech_phase_billing_live.events e WHERE e.subscription_id = s.id)
     AND NOT EXISTS (SELECT 1 FROM tech_phase_billing_live.review_holds h WHERE h.subscription_id = s.id)
     AND NOT EXISTS (SELECT 1 FROM tech_phase_billing_live.recovery_queue q WHERE q.subscription_id = s.id);
  -- A contract that can still charge must be cancelled at PayPal first; the job retries later.
  IF EXISTS (SELECT 1 FROM tech_phase_billing_live.subscriptions
             WHERE user_id = p_user_id AND state NOT IN ('cancelled', 'expired')) THEN
    RAISE EXCEPTION 'open-contract';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tech_phase_billing_live.subscriptions WHERE user_id = p_user_id) THEN
    RETURN 'nothing-to-erase';
  END IF;
  SELECT greatest(max(s.updated_at), max(p.paid_at)) INTO v_last
    FROM tech_phase_billing_live.subscriptions s
    LEFT JOIN tech_phase_billing_live.payments p ON p.subscription_id = s.id
   WHERE s.user_id = p_user_id;
  v_pseudonym := 'user_erased' || replace(gen_random_uuid()::text, '-', '');
  -- Kept until 1 July of the 8th year after the last record: the tax year, its filing deadline and 7 years.
  INSERT INTO tech_phase_billing_live.member_erasures(pseudonym, retain_until)
    VALUES (v_pseudonym, date_trunc('year', v_last AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo' + interval '8 years 6 months');
  DELETE FROM tech_phase_billing_live.recovery_queue q
   USING tech_phase_billing_live.subscriptions s WHERE q.subscription_id = s.id AND s.user_id = p_user_id;
  UPDATE tech_phase_billing_live.subscriptions SET user_id = v_pseudonym, updated_at = now() WHERE user_id = p_user_id;
  RETURN 'erased';
END $$;
REVOKE ALL ON FUNCTION tech_phase_billing_live.erase_member(text) FROM PUBLIC;

-- Periodic purge: expired abuse-control windows, old delivered security alerts, and erased members'
-- ledger rows whose statutory retention has ended. Returns counts only.
CREATE OR REPLACE FUNCTION tech_phase_billing_live.purge_expired(p_now timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_windows bigint; v_alerts bigint; v_members bigint; v_ids uuid[];
BEGIN
  DELETE FROM tech_phase_billing_live.security_windows WHERE window_start < p_now - interval '2 days';
  GET DIAGNOSTICS v_windows = ROW_COUNT;
  DELETE FROM tech_phase_billing_live.security_alerts
   WHERE delivered_at IS NOT NULL AND created_at < p_now - interval '400 days';
  GET DIAGNOSTICS v_alerts = ROW_COUNT;
  v_ids := ARRAY(SELECT s.id FROM tech_phase_billing_live.subscriptions s
    JOIN tech_phase_billing_live.member_erasures m ON m.pseudonym = s.user_id
   WHERE m.retain_until < p_now);
  DELETE FROM tech_phase_billing_live.adverse_transactions a USING tech_phase_billing_live.payments p
   WHERE a.transaction_id = p.transaction_id AND p.subscription_id = ANY(v_ids);
  DELETE FROM tech_phase_billing_live.periods g USING tech_phase_billing_live.payments p
   WHERE g.transaction_id = p.transaction_id AND p.subscription_id = ANY(v_ids);
  DELETE FROM tech_phase_billing_live.events WHERE subscription_id = ANY(v_ids);
  DELETE FROM tech_phase_billing_live.payments WHERE subscription_id = ANY(v_ids);
  DELETE FROM tech_phase_billing_live.review_holds WHERE subscription_id = ANY(v_ids);
  DELETE FROM tech_phase_billing_live.recovery_queue WHERE subscription_id = ANY(v_ids);
  DELETE FROM tech_phase_billing_live.subscriptions WHERE id = ANY(v_ids);
  DELETE FROM tech_phase_billing_live.member_erasures m WHERE m.retain_until < p_now
    AND NOT EXISTS (SELECT 1 FROM tech_phase_billing_live.subscriptions s WHERE s.user_id = m.pseudonym);
  GET DIAGNOSTICS v_members = ROW_COUNT;
  RETURN jsonb_build_object('securityWindows', v_windows, 'securityAlerts', v_alerts, 'erasedMembersPurged', v_members);
END $$;
REVOKE ALL ON FUNCTION tech_phase_billing_live.purge_expired(timestamptz) FROM PUBLIC;

-- The erasure login (created separately with the owner's approval) gets EXECUTE only: no table rights.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tech_phase_member_erasure') THEN
    GRANT USAGE ON SCHEMA tech_phase_billing_live TO tech_phase_member_erasure;
    GRANT EXECUTE ON FUNCTION tech_phase_billing_live.erase_member(text) TO tech_phase_member_erasure;
    GRANT EXECUTE ON FUNCTION tech_phase_billing_live.purge_expired(timestamptz) TO tech_phase_member_erasure;
  END IF;
END $$;
COMMIT;
