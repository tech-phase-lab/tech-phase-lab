-- Member erasure and retention purge for RESOLUTE (owner-approved design, 2026-11-20).
-- FILE ONLY: applying this to any real database is a production change that needs the owner's approval.
-- Explicit application after 001-025 with the migration owner. Idempotent. Nothing runs until a dedicated
-- erasure login (resolute_member_erasure) is created and the default-OFF erasure job is enabled.
--
-- Personal settings (diagnosis plan, notification settings/state/outbox, entitlements, renewal notices and
-- the stored PayPal vault reference) are removed. Deletion and stop tombstones (plan_deletions,
-- notification_suppressions, protection_outbox) are written through the existing triggers so a restore
-- from an older backup cannot bring the plan or a notification back. Payment evidence (orders, grants,
-- renewal_charges, audit) is kept for the statutory period with the Clerk user id replaced by a random
-- pseudonym (user_erased + 32 hex; it satisfies the existing user_id checks). The owner accounts are refused.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'resolute' THEN RAISE EXCEPTION 'Dedicated resolute database required'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS resolute.member_erasures (
  pseudonym text PRIMARY KEY CHECK (pseudonym ~ '^user_erased[a-f0-9]{32}$'),
  erased_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz NOT NULL
);
REVOKE ALL ON resolute.member_erasures FROM PUBLIC;

CREATE OR REPLACE FUNCTION resolute.erase_member(p_user_id text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_pseudonym text;
  v_last timestamptz;
  v_revision bigint;
  v_schema text;
  v_count bigint;
  v_paid boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^user_[A-Za-z0-9]{1,128}$' OR p_user_id ~ '^user_erased' THEN
    RAISE EXCEPTION 'invalid-member';
  END IF;
  -- OWNER_ACCOUNT_ID / PRODUCTION_OWNER_ACCOUNT_ID (lib/membership/entitlements.ts): never erased automatically.
  IF p_user_id IN ('user_3JulL4D07KtVl5Eg2zdY1iczKbC', 'user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb') THEN
    RAISE EXCEPTION 'owner-account';
  END IF;
  -- The same subject lock the plan, entitlement and notification writers take.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id, 0));

  -- An auto-renewal that can still charge must be stopped (and its vault token removed at PayPal) first.
  FOREACH v_schema IN ARRAY ARRAY['resolute_payments_live', 'resolute_payments_sandbox'] LOOP
    IF to_regclass(v_schema || '.renewal_plans') IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I.renewal_plans WHERE user_id = $1 AND state IN (''active'', ''review'')', v_schema)
        INTO v_count USING p_user_id;
      IF v_count > 0 THEN RAISE EXCEPTION 'open-renewal'; END IF;
    END IF;
    IF to_regclass(v_schema || '.orders') IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I.orders WHERE user_id = $1 AND state IN (''creating'', ''created'', ''capturing'')', v_schema)
        INTO v_count USING p_user_id;
      IF v_count > 0 THEN RAISE EXCEPTION 'open-order'; END IF;
    END IF;
  END LOOP;

  -- Diagnosis plan: same convention as the plan API's DELETE (tombstone row, plan_deletions -> protection_outbox).
  IF to_regclass('resolute.plans') IS NOT NULL THEN
    SELECT revision INTO v_revision FROM resolute.plans WHERE clerk_user_id = p_user_id FOR UPDATE;
    IF FOUND AND EXISTS (SELECT 1 FROM resolute.plans WHERE clerk_user_id = p_user_id AND plan IS NOT NULL) THEN
      UPDATE resolute.plans SET revision = v_revision + 1, plan = NULL, created_at = NULL, updated_at = NULL,
        deleted_at = statement_timestamp() WHERE clerk_user_id = p_user_id;
      INSERT INTO resolute.plan_deletions(clerk_user_id, revision, deleted_at)
        VALUES (p_user_id, v_revision + 1, statement_timestamp());
    END IF;
  END IF;

  -- Notifications: record the stop (suppression trigger -> protection_outbox), then remove the settings.
  IF to_regclass('resolute.notification_settings') IS NOT NULL THEN
    UPDATE resolute.notification_settings
       SET settings = settings || '{"alertsEnabled": false, "morningEnabled": false}'::jsonb,
           revision = revision + 1, updated_at = statement_timestamp()
     WHERE clerk_user_id = p_user_id
       AND (settings->>'alertsEnabled' = 'true' OR settings->>'morningEnabled' = 'true');
    DELETE FROM resolute.notification_settings WHERE clerk_user_id = p_user_id;
  END IF;
  IF to_regclass('resolute.notification_state') IS NOT NULL THEN
    DELETE FROM resolute.notification_state WHERE clerk_user_id = p_user_id;
  END IF;
  IF to_regclass('resolute.notification_outbox') IS NOT NULL THEN
    DELETE FROM resolute.notification_outbox WHERE clerk_user_id = p_user_id;
  END IF;
  IF to_regclass('resolute.entitlements') IS NOT NULL THEN
    DELETE FROM resolute.entitlements WHERE clerk_user_id = p_user_id;
  END IF;

  -- Payment evidence: keep, detached from the identity.
  v_pseudonym := 'user_erased' || replace(gen_random_uuid()::text, '-', '');
  FOREACH v_schema IN ARRAY ARRAY['resolute_payments_live', 'resolute_payments_sandbox'] LOOP
    IF to_regclass(v_schema || '.orders') IS NULL THEN CONTINUE; END IF;
    IF to_regclass(v_schema || '.renewal_notices') IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I.renewal_notices WHERE user_id = $1', v_schema) USING p_user_id;
    END IF;
    IF to_regclass(v_schema || '.renewal_plans') IS NOT NULL THEN
      -- Stopped/ended/failed plans only (checked above). The vault reference is not a payment record.
      EXECUTE format('DELETE FROM %I.renewal_plans WHERE user_id = $1', v_schema) USING p_user_id;
    END IF;
    EXECUTE format('SELECT max(greatest(created_at, paid_at)) FROM %I.orders WHERE user_id = $1', v_schema)
      INTO v_last USING p_user_id;
    IF v_last IS NOT NULL THEN
      v_paid := true;
      IF NOT EXISTS (SELECT 1 FROM resolute.member_erasures WHERE pseudonym = v_pseudonym) THEN
        INSERT INTO resolute.member_erasures(pseudonym, retain_until)
          VALUES (v_pseudonym, date_trunc('year', v_last AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo' + interval '8 years 6 months');
      ELSE
        UPDATE resolute.member_erasures SET retain_until = greatest(retain_until,
          date_trunc('year', v_last AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo' + interval '8 years 6 months')
         WHERE pseudonym = v_pseudonym;
      END IF;
    END IF;
    IF to_regclass(v_schema || '.renewal_charges') IS NOT NULL THEN
      EXECUTE format('UPDATE %I.renewal_charges SET user_id = $2 WHERE user_id = $1', v_schema) USING p_user_id, v_pseudonym;
    END IF;
    EXECUTE format('UPDATE %I.grants SET user_id = $2 WHERE user_id = $1', v_schema) USING p_user_id, v_pseudonym;
    EXECUTE format('UPDATE %I.orders SET user_id = $2 WHERE user_id = $1', v_schema) USING p_user_id, v_pseudonym;
  END LOOP;
  RETURN CASE WHEN v_paid THEN 'erased' ELSE 'erased-no-payments' END;
END $$;
REVOKE ALL ON FUNCTION resolute.erase_member(text) FROM PUBLIC;

-- Periodic purge: payment evidence of erased members after the statutory period, and delivered
-- notification outbox rows older than 90 days. Counts only.
CREATE OR REPLACE FUNCTION resolute.purge_expired(p_now timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_schema text; v_outbox bigint := 0; v_members bigint := 0; v_expired text[];
BEGIN
  IF to_regclass('resolute.notification_outbox') IS NOT NULL THEN
    DELETE FROM resolute.notification_outbox WHERE accepted_at IS NOT NULL AND created_at < p_now - interval '90 days';
    GET DIAGNOSTICS v_outbox = ROW_COUNT;
  END IF;
  v_expired := ARRAY(SELECT pseudonym FROM resolute.member_erasures WHERE retain_until < p_now);
  IF cardinality(v_expired) > 0 THEN
    FOREACH v_schema IN ARRAY ARRAY['resolute_payments_live', 'resolute_payments_sandbox'] LOOP
      IF to_regclass(v_schema || '.orders') IS NULL THEN CONTINUE; END IF;
      IF to_regclass(v_schema || '.guest_receipts') IS NOT NULL THEN
        EXECUTE format('DELETE FROM %1$I.guest_receipts r USING %1$I.orders o WHERE r.order_id = o.id AND o.user_id = ANY($1)', v_schema) USING v_expired;
      END IF;
      IF to_regclass(v_schema || '.renewal_charges') IS NOT NULL THEN
        EXECUTE format('DELETE FROM %I.renewal_charges WHERE user_id = ANY($1)', v_schema) USING v_expired;
      END IF;
      EXECUTE format('DELETE FROM %1$I.alert_outbox x USING %1$I.audit a, %1$I.orders o WHERE x.audit_id = a.id AND a.order_id = o.id AND o.user_id = ANY($1)', v_schema) USING v_expired;
      EXECUTE format('DELETE FROM %1$I.audit a USING %1$I.orders o WHERE a.order_id = o.id AND o.user_id = ANY($1)', v_schema) USING v_expired;
      EXECUTE format('DELETE FROM %I.grants WHERE user_id = ANY($1)', v_schema) USING v_expired;
      EXECUTE format('DELETE FROM %I.orders WHERE user_id = ANY($1)', v_schema) USING v_expired;
    END LOOP;
    DELETE FROM resolute.member_erasures WHERE pseudonym = ANY(v_expired);
    GET DIAGNOSTICS v_members = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('notificationOutbox', v_outbox, 'erasedMembersPurged', v_members);
END $$;
REVOKE ALL ON FUNCTION resolute.purge_expired(timestamptz) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resolute_member_erasure') THEN
    GRANT USAGE ON SCHEMA resolute TO resolute_member_erasure;
    GRANT EXECUTE ON FUNCTION resolute.erase_member(text) TO resolute_member_erasure;
    GRANT EXECUTE ON FUNCTION resolute.purge_expired(timestamptz) TO resolute_member_erasure;
  END IF;
END $$;
COMMIT;
