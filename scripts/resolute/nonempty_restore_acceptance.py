"""Restore real backup and replay independently stored synthetic protection events.
Only an isolated backup-restore container may run this; never a source DB.
"""
import json
import os
import re


def checked_user(value):
    if not isinstance(value, str) or not re.fullmatch(r'user_acceptance[a-f0-9]{32}', value):
        raise RuntimeError('synthetic identity required')
    return value


def validate_ledger(ledger, user):
    expected = [(user, 1, None), (user, 2, 'alerts'), (user, 3, 'morning')]
    actual = [(r['userId'], r['revision'], r.get('kind'))
              for group in ('deletions', 'suppressions') for r in ledger[group]]
    if sorted(actual, key=lambda row: (row[0], row[1], row[2] or '')) != expected:
        raise RuntimeError('unexpected production inventory')


def verify_state(value, protected):
    expected = dict(planPresent=not protected, planRevision=1,
                    alertsEnabled=not protected, morningEnabled=not protected,
                    settingsRevision=3 if protected else 1,
                    deletions=1 if protected else 0,
                    suppressions=2 if protected else 0,
                    pending=0 if protected else 1)
    if value != expected:
        raise RuntimeError('isolated replay state differs')


def main():
    import protection_acceptance
    protection_acceptance.validate_environment(os.environ)
    if os.environ.get('RESOLUTE_BACKUP_MODE') != 'restore':
        raise RuntimeError('restore mode required')
    if os.environ.get('BACKUP_MONITOR_PING_URL'):
        raise RuntimeError('monitor calls forbidden')
    user = checked_user(os.environ.get('RESOLUTE_MAINTENANCE_USER'))
    import backup
    original_run, original_load = backup.run, backup.load_online_protection
    state = dict(seed=False, inventory=False, replay=0)

    def scoped(env):
        if not env or env.get('PGDATABASE') != 'resolute_restore_test' or not env.get('PGHOST', '').startswith('/') or env.get('PGHOSTADDR'):
            raise RuntimeError('isolated socket required')

    def sql(text, env):
        scoped(env)
        return original_run(['psql', '-XqAt', '-v', 'ON_ERROR_STOP=1'], env=env, data=text.encode())

    def check(env, protected):
        value = json.loads(sql(f"""SELECT json_build_object(
'planPresent',(SELECT plan IS NOT NULL FROM resolute.plans WHERE clerk_user_id='{user}'),
'planRevision',(SELECT revision FROM resolute.plans WHERE clerk_user_id='{user}'),
'alertsEnabled',(SELECT (settings->>'alertsEnabled')::boolean FROM resolute.notification_settings WHERE clerk_user_id='{user}'),
'morningEnabled',(SELECT (settings->>'morningEnabled')::boolean FROM resolute.notification_settings WHERE clerk_user_id='{user}'),
'settingsRevision',(SELECT revision FROM resolute.notification_settings WHERE clerk_user_id='{user}'),
'deletions',(SELECT count(*) FROM resolute.plan_deletions WHERE clerk_user_id='{user}'),
'suppressions',(SELECT count(*) FROM resolute.notification_suppressions WHERE clerk_user_id='{user}'),
'pending',(SELECT count(*) FROM resolute.notification_outbox WHERE accepted_at IS NULL));""", env))
        verify_state(value, protected)
        # Include timestamps/payloads/all columns to catch a non-idempotent replay.
        return sql(f"""SELECT json_build_object(
'plans',(SELECT jsonb_agg(to_jsonb(t)) FROM resolute.plans t WHERE clerk_user_id='{user}'),
'settings',(SELECT jsonb_agg(to_jsonb(t)) FROM resolute.notification_settings t WHERE clerk_user_id='{user}'),
'deletions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY revision) FROM resolute.plan_deletions t WHERE clerk_user_id='{user}'),
'suppressions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY revision,kind) FROM resolute.notification_suppressions t WHERE clerk_user_id='{user}'));""", env)

    def load(*args, **kwargs):
        ledger = original_load(*args, **kwargs)
        validate_ledger(ledger, user)
        state['inventory'] = True
        return ledger

    def run(command, *, env=None, data=None):
        result = original_run(command, env=env, data=data)
        if command[0] == 'pg_restore':
            scoped(env)
            if state['seed']:
                raise RuntimeError('duplicate restore')
            # Real backup remains untouched. Seed only its disposable restored DB.
            sql(f"""BEGIN;
INSERT INTO resolute.plans(clerk_user_id,revision,plan,created_at,updated_at)
VALUES('{user}',1,'{{"answersVersion":1,"answers":{{}},"fx":{{}}}}',NOW(),NOW());
INSERT INTO resolute.notification_settings VALUES('{user}','{{"deliveryHourJst":7,"alertsEnabled":true,"morningEnabled":true,"watchItems":[],"surgeCapPct":null}}',1,NOW());
INSERT INTO resolute.notification_outbox(idempotency_key,clerk_user_id,kind,delivery_date_jst,payload)
VALUES('{user}','{user}','alerts','2026-10-20','{{}}');
COMMIT;""", env)
            check(env, False)
            state['seed'] = True
        if data and b'CREATE TEMP TABLE protection_input' in data:
            if not state['seed'] or not state['inventory'] or state['replay']:
                raise RuntimeError('invalid replay order')
            before = check(env, True)
            original_run(command, env=env, data=data)
            if check(env, True) != before:
                raise RuntimeError('replay is not idempotent')
            state['replay'] = 2
        return result

    backup.run, backup.load_online_protection = run, load
    try:
        backup.main()
        if state != dict(seed=True, inventory=True, replay=2):
            raise RuntimeError('acceptance incomplete')
        print(json.dumps(dict(event='RESOLUTE_NONEMPTY_RESTORE_OK', real_backup_restored=True,
                              stale_fixture_in_restored_db=True, production_db_connected=False,
                              plan_erased=True, both_notifications_off=True, pending=0,
                              replay_checks=2, replay_idempotent=True, mail_sent=False)), flush=True)
    finally:
        backup.run, backup.load_online_protection = original_run, original_load


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'event': 'RESOLUTE_NONEMPTY_RESTORE_FAILED', 'type': type(error).__name__}), flush=True)
        raise SystemExit(1)
