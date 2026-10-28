BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SET LOCAL idle_in_transaction_session_timeout = '20s';
DO $$ BEGIN
 IF current_database()<>'resolute' THEN RAISE EXCEPTION 'WRONG_DATABASE'; END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN
  ('resolute_plan_writer','resolute_notification_writer','resolute_protection_writer')
  AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
  AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit)<>3
 OR EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename IN
  ('resolute_plan_writer','resolute_notification_writer','resolute_protection_writer'))
 THEN RAISE EXCEPTION 'STORAGE_NOT_DORMANT'; END IF;
END $$;
LOCK TABLE resolute.plans,resolute.plan_deletions,resolute.notification_settings,
 resolute.notification_suppressions,resolute.protection_outbox IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM resolute.plans WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.plan_deletions WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.notification_settings WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.notification_suppressions WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.protection_outbox WHERE clerk_user_id='user_storagecheck20261020rollback')
 THEN RAISE EXCEPTION 'PROBE_ID_ALREADY_EXISTS'; END IF;
END $$;
SET LOCAL ROLE resolute_plan_writer;
INSERT INTO resolute.plans(clerk_user_id,revision,plan,created_at,updated_at)
 VALUES('user_storagecheck20261020rollback',1,'{"answersVersion":1,"answers":{},"fx":{}}',statement_timestamp(),statement_timestamp());
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM resolute.plans WHERE clerk_user_id='user_storagecheck20261020rollback'
  AND revision=1 AND plan='{"answersVersion":1,"answers":{},"fx":{}}'::jsonb) THEN RAISE EXCEPTION 'PLAN_READBACK_FAILED'; END IF;
END $$;
UPDATE resolute.plans SET revision=2,plan=NULL,created_at=NULL,updated_at=NULL,
 deleted_at=statement_timestamp() WHERE clerk_user_id='user_storagecheck20261020rollback';
INSERT INTO resolute.plan_deletions
 SELECT clerk_user_id,revision,deleted_at FROM resolute.plans
 WHERE clerk_user_id='user_storagecheck20261020rollback';
RESET ROLE;
SET LOCAL ROLE resolute_notification_writer;
INSERT INTO resolute.notification_settings VALUES('user_storagecheck20261020rollback',
 '{"deliveryHourJst":7,"alertsEnabled":false,"morningEnabled":false,"watchItems":[],"surgeCapPct":null}',1,statement_timestamp());
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM resolute.notification_settings
  WHERE clerk_user_id='user_storagecheck20261020rollback' AND revision=1
  AND settings->>'alertsEnabled'='false' AND settings->>'morningEnabled'='false')
 THEN RAISE EXCEPTION 'SETTINGS_READBACK_FAILED'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE resolute_protection_writer;
DO $$ BEGIN
 IF (SELECT array_agg(kind ORDER BY kind) FROM resolute.protection_outbox
  WHERE clerk_user_id='user_storagecheck20261020rollback')
  IS DISTINCT FROM ARRAY['alerts_off','delete','morning_off']::text[]
 THEN RAISE EXCEPTION 'PROTECTION_TRIGGER_FAILED'; END IF;
END $$;
UPDATE resolute.protection_outbox SET receipt_sha256=repeat('0',64),
 published_at=statement_timestamp(),next_attempt_at='infinity'
 WHERE clerk_user_id='user_storagecheck20261020rollback';
DO $$ BEGIN
 IF (SELECT count(*) FROM resolute.protection_outbox
  WHERE clerk_user_id='user_storagecheck20261020rollback'
  AND receipt_sha256=repeat('0',64) AND published_at IS NOT NULL)<>3
 THEN RAISE EXCEPTION 'RECEIPT_COLUMN_READBACK_FAILED'; END IF;
 BEGIN
  PERFORM 1 FROM resolute_payments_live.orders LIMIT 0;
  RAISE EXCEPTION 'RAW_PAYMENT_ACCESS_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM 1 FROM resolute.notification_outbox LIMIT 0;
  RAISE EXCEPTION 'DELIVERY_ACCESS_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE resolute.protection_outbox SET kind='delete' WHERE false;
  RAISE EXCEPTION 'EVENT_MUTATION_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  DELETE FROM resolute.protection_outbox WHERE false;
  RAISE EXCEPTION 'EVENT_DELETE_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM resolute.plans WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.plan_deletions WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.notification_settings WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.notification_suppressions WHERE clerk_user_id='user_storagecheck20261020rollback')
 OR EXISTS(SELECT 1 FROM resolute.protection_outbox WHERE clerk_user_id='user_storagecheck20261020rollback')
 THEN RAISE EXCEPTION 'ROLLBACK_FAILED'; END IF;
END $$;
SELECT 'RESOLUTE_SCOPED_ROLLBACK_OK' AS event,0 AS committed_rows,false AS activation;
