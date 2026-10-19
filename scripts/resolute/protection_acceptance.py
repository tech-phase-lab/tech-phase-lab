"""One-shot synthetic acceptance. No source DB credentials, mail, AI or cron edits.
Run in the existing isolated restore container with supplied bundle modules/migrations.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile
import uuid

def validate_environment(env):
    """Fail before importing clients or starting processes with live credentials."""
    if env.get('RESOLUTE_PROTECTION_ACCEPTANCE_ONLY') != 'true':
        raise RuntimeError('acceptance only')
    for name, value in env.items():
        if value and (name.startswith('PG') or name.endswith(('_DB_URL', 'DATABASE_URL')) or name.startswith('DATABASE_')):
            raise RuntimeError('production connection forbidden')


def verify_restore_state(sql, *, protected):
    """Prove the stale backup exists before replay, then check each replay."""
    check = json.loads(sql("""SELECT json_build_object(
'plans',(SELECT count(*) FROM resolute.plans),
'planPresent',(SELECT plan IS NOT NULL FROM resolute.plans WHERE clerk_user_id='user_acceptance'),
'planRevision',(SELECT revision FROM resolute.plans WHERE clerk_user_id='user_acceptance'),
'alertsEnabled',(SELECT (settings->>'alertsEnabled')::boolean FROM resolute.notification_settings WHERE clerk_user_id='user_acceptance'),
'morningEnabled',(SELECT (settings->>'morningEnabled')::boolean FROM resolute.notification_settings WHERE clerk_user_id='user_acceptance'),
'settingsRevision',(SELECT revision FROM resolute.notification_settings WHERE clerk_user_id='user_acceptance'),
'pending',(SELECT count(*) FROM resolute.notification_outbox WHERE accepted_at IS NULL));""", 'resolute_restore_test'))
    expected = dict(plans=1, planPresent=not protected, planRevision=2 if protected else 1,
                    alertsEnabled=not protected, morningEnabled=not protected,
                    settingsRevision=2 if protected else 1, pending=0 if protected else 1)
    if check != expected:
        raise RuntimeError('acceptance restore state differs')


def main():
    validate_environment(os.environ)
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import protection
    import protection_events as events
    import backup
    bucket=os.environ['BACKUP_BUCKET']
    s3=boto3.client('s3',endpoint_url=os.environ['BACKUP_ENDPOINT'],region_name=os.environ['BACKUP_REGION'],
        aws_access_key_id=os.environ['BACKUP_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['BACKUP_SECRET_ACCESS_KEY'],
        config=Config(s3={'addressing_style':'virtual'},retries={'max_attempts':0},connect_timeout=10,read_timeout=20))
    # Old distro boto3 models may not expose IfNoneMatch yet. Add the official
    # signed HTTP header before signing; exercise the storage server's behavior.
    def conditional(request,**kwargs):request.headers['If-None-Match']='*'
    s3.meta.events.register('before-sign.s3.PutObject',conditional)
    namespace='resolute/protection/acceptance/'+uuid.uuid4().hex+'/'
    events.PREFIX=namespace+'events/';events.MANIFEST_PREFIX=namespace+'manifests/'
    key=os.urandom(32);stored_bytes=0
    with tempfile.TemporaryDirectory(prefix='resolute-protection-acceptance-') as temp:
        root=Path(temp);cluster=root/'cluster';cluster.mkdir()
        run=backup.run
        run(['chown','-R','postgres:postgres',str(root)])
        run(['runuser','-u','postgres','--','initdb','-D',str(cluster),'-A','trust','--no-locale','--encoding=UTF8'])
        run(['runuser','-u','postgres','--','pg_ctl','-D',str(cluster),'-l',str(root/'pg.log'),'-o',"-c listen_addresses='' -k "+str(root),'-w','start'])
        try:
            env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
            env.update(PGHOST=str(root),PGUSER='postgres',PGDATABASE='postgres',PGSSLMODE='disable')
            def sql(text,db='resolute'):
                return run(['psql','-XqAt','-v','ON_ERROR_STOP=1'],env=dict(env,PGDATABASE=db),data=text.encode())
            sql('CREATE DATABASE resolute; CREATE DATABASE resolute_restore_test; CREATE ROLE resolute_plan_writer NOLOGIN; CREATE ROLE resolute_notification_writer NOLOGIN;','postgres')
            migrations=json.loads(base64.b64decode(os.environ['RESOLUTE_ACCEPTANCE_MIGRATIONS_B64']))
            for migration in migrations:sql(migration)
            sql("""INSERT INTO resolute.plans VALUES('user_acceptance',1,'{"answersVersion":1,"answers":{"q01":"synthetic"},"fx":{"note":"synthetic"}}',NOW(),NOW(),NULL);
INSERT INTO resolute.notification_settings VALUES('user_acceptance','{"deliveryHourJst":7,"alertsEnabled":true,"morningEnabled":true,"watchItems":[{"symbol":"MU","referencePrice":100}],"surgeCapPct":null}',1,NOW());
INSERT INTO resolute.notification_outbox(idempotency_key,clerk_user_id,kind,delivery_date_jst,payload) VALUES('synthetic-pending','user_acceptance','alerts','2026-10-19','{}');""")
            dump=root/'before.dump'
            run(['pg_dump','-Fc','--no-owner','--no-acl','-f',str(dump)],env=dict(env,PGDATABASE='resolute'))
            sql("""BEGIN;UPDATE resolute.plans SET revision=2,plan=NULL,created_at=NULL,updated_at=NULL,deleted_at=statement_timestamp();
INSERT INTO resolute.plan_deletions SELECT clerk_user_id,revision,deleted_at FROM resolute.plans;
UPDATE resolute.notification_settings SET revision=2,settings=settings||'{"alertsEnabled":false,"morningEnabled":false}'::jsonb,updated_at=statement_timestamp();COMMIT;""")
            rows=json.loads(sql("""SELECT json_agg(json_build_object('version',1,'userId',clerk_user_id,'revision',revision,'kind',kind,'at',to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) FROM resolute.protection_outbox;"""))
            duplicate_rejected=0
            for event in rows:
                name=events.object_key(event,key);nonce=os.urandom(12)
                encrypted=AESGCM(key).encrypt(nonce,json.dumps(event,separators=(',',':')).encode(),name.encode())
                body=b'RPE1'+nonce+encrypted[-16:]+encrypted[:-16]
                s3.put_object(Bucket=bucket,Key=name,Body=body);stored_bytes+=len(body)
                try:s3.put_object(Bucket=bucket,Key=name,Body=b'overwrite-must-fail')
                except ClientError as error:
                    if error.response['ResponseMetadata']['HTTPStatusCode']!=412:raise
                    duplicate_rejected+=1
                else:raise RuntimeError('conditional overwrite not enforced')
                readback=s3.get_object(Bucket=bucket,Key=name)['Body'].read(2049)
                if readback!=body:raise RuntimeError('readback differs')
                events.decrypt_event(readback,key,name,protection)
            pin=events.seal_manifest(s3,bucket,key,protection)
            ledger=events.load_manifest(s3,bucket,key,pin,protection)
            run(['pg_restore','--exit-on-error','--no-owner','--no-acl','-d','resolute_restore_test',str(dump)],env=dict(env,PGDATABASE='resolute_restore_test'))
            verify_restore_state(sql, protected=False)
            for _ in range(2):
                sql(protection.restore_sql(ledger),'resolute_restore_test')
                verify_restore_state(sql, protected=True)
            if duplicate_rejected != 3:
                raise RuntimeError('acceptance result differs')
            print(json.dumps({'event':'RESOLUTE_PROTECTION_ACCEPTANCE_OK','synthetic_events':3,'conditional_conflicts':3,'encrypted_event_bytes':stored_bytes,'real_pg_dump_restore':True,'stale_backup_verified':True,'replay_checks':2,'replay_idempotent':True,'plan_erased':True,'notifications_off':True,'pending_outbox':0,'source_db_connected':False,'mail_sent':False}),flush=True)
        finally:
            run(['runuser','-u','postgres','--','pg_ctl','-D',str(cluster),'-m','immediate','-w','stop'])
if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'event':'RESOLUTE_PROTECTION_ACCEPTANCE_FAILED','type':type(error).__name__}),flush=True)
        raise SystemExit(1)
