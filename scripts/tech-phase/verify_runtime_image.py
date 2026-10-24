"""Probe an already restored Docker image locally with networking disabled.

No pull, deployment, production credentials, DB writes, mail, payment or AI calls.
HTTP readiness/static assets and disabled CLIs are distinct from live acceptance.
"""
import argparse
import json
import os
import re
import subprocess
import uuid

from external_runtime import SERVICES

# Public release-signing fingerprint in docker-library/python 3.12/slim-trixie.
# This is not a private key or a provider credential; unknown values still fail.
PUBLIC_IMAGE_ENV = {'GPG_KEY': frozenset({'7169605F62C751356D054A26A821E680E5FA6305'})}
DOCKER = ['docker', '--host', 'unix:///var/run/docker.sock']
COMMON = ['--pull=never', '--network=none', '--read-only',
          '--tmpfs=/tmp:rw,nosuid,nodev,size=256m', '--cap-drop=ALL',
          '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=1g', '--cpus=2']


def command(args, timeout=90, combined=False):
    result = subprocess.run(DOCKER + args, check=False, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT if combined else subprocess.PIPE, text=True,
                            timeout=timeout, env={'PATH': os.environ['PATH']})
    if result.returncode:
        # Probes run only after image-config checks, with fixture-only settings.
        diagnostic = ((result.stdout or '') + (result.stderr or ''))[-6000:]
        print(json.dumps({'event':'RUNTIME_DOCKER_COMMAND_FAILED','operation':args[0],
                          'exit':result.returncode,'diagnostic':diagnostic}),flush=True)
        raise subprocess.CalledProcessError(result.returncode,['local-docker',args[0]])
    return result.stdout.strip()


def configuration(service):
    if service not in SERVICES:
        raise ValueError('unknown service')
    env = {'PYTHONDONTWRITEBYTECODE': '1'}
    if service == 'api':
        env.update(PORT='3000', RESOLUTE_RIZEL_DAILY_REVIEW_ENABLED='false',
            RESOLUTE_PAYMENTS_ENABLED='false', RESOLUTE_PAYPAL_LIVE_ENABLED='false',
            RESOLUTE_PLAN_API_ENABLED='false', RESOLUTE_NOTIFICATION_API_ENABLED='false',
            RESOLUTE_AI_CHECK_ENABLED='false', RESOLUTE_PROTECTION_RETRY_ENABLED='false',
            RESOLUTE_CLERK_ISSUER='https://offline.invalid',
            RESOLUTE_CLERK_AUTHORIZED_PARTIES='["https://offline.invalid"]',
            RESOLUTE_CLERK_JWT_PUBLIC_KEY='-----BEGIN PUBLIC KEY-----\nOFFLINE_FIXTURE_ONLY\n-----END PUBLIC KEY-----',
            RESOLUTE_API_SERVICE_TOKEN='offline-fixture-only-' * 3,
            ENTITLEMENT_DB_URL='postgresql://resolute_api_reader:offline-fixture@127.0.0.1:1/resolute')
    elif service == 'billing':
        env.update(PORT='8080', TECH_PHASE_BILLING_OWNER_ID='user_offlinefixture',
            TECH_PHASE_BILLING_SANDBOX_ENABLED='false',
            TECH_PHASE_BILLING_SANDBOX_WEBHOOK_ENABLED='false', TECH_PHASE_PAYPAL_ENV='sandbox')
    elif service == 'research':
        env.update(PORT='8080', RESEARCH_STREAM_ENABLED='false', RESEARCH_TICKERS='MU',
            RESEARCH_DATA_DIR='/tmp/research', RESEARCH_SIGNALS_ENABLED='false',
            RESEARCH_FAST_POLL_SECONDS='86400', RESEARCH_STANDARD_POLL_SECONDS='86400',
            RESEARCH_REQUEST_TIMEOUT_SECONDS='1')
    elif service == 'frontend':
        env.update(PORT='3000', NEXT_TELEMETRY_DISABLED='1')
    elif service == 'protection':
        env['RESOLUTE_WRITER_ENABLED'] = 'false'
    elif service == 'recovery':
        env['RESOLUTE_RECOVERY_SYNTHETIC_ENABLED'] = 'false'
    return env


def http_script(service):
    routes = [['/healthz', 200, {'status': 'ok'}],
              ['/internal/v1/entitlements', 401, {'error': 'AUTH_REQUIRED'}],
              ['/internal/v1/plan', 401, {'error': 'AUTH_REQUIRED'}],
              ['/internal/v1/notification-settings', 401, {'error': 'AUTH_REQUIRED'}],
              ['/internal/v1/ai-check', 401, {'error': 'AUTH_REQUIRED'}],
              ['/internal/v1/payments', 503, {'error': 'PAYMENT_DISABLED'}],
              ['/internal/v1/live-payments', 503, {'error': 'PAYMENT_DISABLED'}]] if service == 'api' else [
              ['/healthz', 200, {'status': 'up', 'environment': 'sandbox'}],
              ['/sandbox/status', 503, {'error': 'billing-disabled'}],
              ['/webhooks/paypal/sandbox', 503, {'error': 'billing-disabled'}]]
    port = 3000 if service == 'api' else 8080
    return """
const assert=require('node:assert/strict');
(async()=>{
 const routes=ROUTES, base='http://127.0.0.1:PORT';
 const deadline=Date.now()+45000;
 for(;;){try{const r=await fetch(base+'/healthz',{signal:AbortSignal.timeout(1000)});assert.equal(r.status,200);break;}catch(e){if(Date.now()>deadline)throw e;await new Promise(r=>setTimeout(r,200));}}
 for(const [path,status,body] of routes){const r=await fetch(base+path,{method:path.includes('webhooks')?'POST':'GET',signal:AbortSignal.timeout(3000)});assert.equal(r.status,status,path);assert.deepEqual(await r.json(),body,path);}
 console.log(JSON.stringify({http_checks:routes.length,node_version:process.version,glibc:process.report.getReport().header.glibcVersionRuntime}));
})().catch(()=>process.exit(1));
""".replace('ROUTES', json.dumps(routes)).replace('PORT', str(port))


FRONTEND = """
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const rel=fs.readdirSync('/app/.next/static',{recursive:true}).find(p=>p.endsWith('.js')&&fs.statSync('/app/.next/static/'+p).isFile());
 assert.ok(rel);const expected=fs.readFileSync('/app/.next/static/'+rel),deadline=Date.now()+45000;
 for(;;){try{const r=await fetch('http://127.0.0.1:3000/_next/static/'+rel,{signal:AbortSignal.timeout(1000)});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),expected);break;}catch(e){if(Date.now()>deadline)throw e;await new Promise(r=>setTimeout(r,200));}}
 console.log(JSON.stringify({static_asset_verified:true,authenticated_pages_verified:false,node_version:process.version,glibc:process.report.getReport().header.glibcVersionRuntime}));
})().catch(()=>process.exit(1));
"""
RESEARCH = """
import json, time, urllib.request, sqlite3, platform, importlib.metadata
import pypdf, aiohttp, pywebpush
end=time.monotonic()+45
while True:
    try:
        with urllib.request.urlopen('http://127.0.0.1:8080/livez',timeout=1) as r:
            assert r.status==200 and json.load(r)=={'ok':True,'status':'alive'}
        break
    except Exception:
        if time.monotonic()>end:raise
        time.sleep(.2)
with sqlite3.connect('file:/tmp/research/automatic.sqlite?mode=ro',uri=True) as db:
    assert db.execute('PRAGMA integrity_check').fetchone()==('ok',)
print(json.dumps({'health_verified':True,'disposable_sqlite_verified':True,'live_data_verified':False,'python_version':platform.python_version(),'libc':platform.libc_ver(),'packages':{x:importlib.metadata.version(x) for x in ('pypdf','aiohttp','pywebpush')}}))
"""
BACKUP = """
import boto3, cryptography, json, subprocess, platform
versions={}
for tool in ('pg_dump','pg_restore'):
    result=subprocess.run([tool,'--version'],check=True,capture_output=True,text=True,timeout=5)
    assert 'PostgreSQL' in result.stdout and '18.' in result.stdout
    versions[tool]=result.stdout.strip()
print(json.dumps({'backup_toolchain_verified':True,'database_connected':False,'postgres_tools':versions,'python_version':platform.python_version(),'libc':platform.libc_ver(),'boto3_version':boto3.__version__,'cryptography_version':cryptography.__version__}))
"""


def inspect_image(image_id, commit):
    if (not re.fullmatch('sha256:[a-f0-9]{64}', image_id) or
            not re.fullmatch('[a-f0-9]{40}', commit)):
        raise ValueError('exact image and source identity required')
    info=json.loads(command(['image','inspect',image_id]))[0]
    if (info['Id'] != image_id or info.get('Architecture') != 'amd64' or info.get('Os') != 'linux' or
            (info['Config'].get('Labels') or {}).get('org.opencontainers.image.revision') != commit):
        raise ValueError('restored image identity or platform mismatch')
    for item in info['Config'].get('Env',[]) or []:
        name, _, value = item.partition('=')
        if value in PUBLIC_IMAGE_ENV.get(name, ()):
            continue
        if re.search(r'(SECRET|PASSWORD|TOKEN|(?:^|_)KEY(?:_|$)|DATABASE_URL|DB_URL)',name.upper()):
            raise ValueError('credential-like configuration baked into image')
    return {'image_id': image_id, 'commit': commit, 'architecture': 'amd64', 'os': 'linux',
            'image_config_checked': True, 'layer_count': len(info['RootFS']['Layers'])}


def verify(service, image_id, commit):
    if service not in SERVICES:
        raise ValueError('unknown service')
    inspected = inspect_image(image_id, commit)
    name='runtime-'+service+'-'+uuid.uuid4().hex[:12]
    args=['create','--name',name,*COMMON]
    for key,value in configuration(service).items():
        args.extend(['--env',key+'='+value])
    if service=='backup':args.extend(['--entrypoint','/opt/backup/bin/python'])
    args.append(image_id)
    if service=='backup':args.extend(['-c',BACKUP])
    created=False
    started=False
    try:
        command(args)
        created=True
        info=json.loads(command(['inspect',name]))[0]
        host=info['HostConfig']
        if (host['NetworkMode']!='none' or not host['ReadonlyRootfs'] or
                'ALL' not in host['CapDrop'] or host.get('Binds') or host.get('CapAdd') or
                host.get('Privileged') is not False or not any(
                    item in ('no-new-privileges','no-new-privileges:true')
                    for item in host.get('SecurityOpt',[]))):
            raise ValueError('container isolation not established')
        oneshot=service in {'backup','protection','recovery'}
        if oneshot:
            output=command(['start','--attach',name])
            started=True
            code=int(command(['inspect','--format','{{.State.ExitCode}}',name]))
            if code!=0:raise ValueError('disabled runtime failed')
            expected={'backup':'backup_toolchain_verified',
                      'protection':'RESOLUTE_WRITER_DISABLED',
                      'recovery':'RESOLUTE_RECOVERY_ACCEPTANCE_DISABLED'}[service]
            receipt=json.loads(output.splitlines()[-1])
            if service=='backup':
                if receipt.get(expected) is not True or receipt.get('database_connected') is not False:
                    raise ValueError('backup toolchain receipt missing')
            elif receipt.get('event') != expected:
                raise ValueError('disabled runtime receipt missing')
            detail={**(receipt if service=='backup' else {}),'disabled_cli_verified':service!='backup','backup_toolchain_verified':service=='backup'}
        else:
            command(['start',name])
            started=True
            if service=='research':result=command(['exec',name,'python','-c',RESEARCH])
            else:result=command(['exec',name,'node','-e',FRONTEND if service=='frontend' else http_script(service)])
            detail=json.loads(result.splitlines()[-1])
            required={'api':{'http_checks':7},'billing':{'http_checks':3},
                      'frontend':{'static_asset_verified':True,'authenticated_pages_verified':False},
                      'research':{'health_verified':True,'disposable_sqlite_verified':True,'live_data_verified':False}}[service]
            if any(type(detail.get(k)) is not type(v) or detail[k] != v for k,v in required.items()):
                raise ValueError('runtime probe result incomplete')
            if command(['inspect','--format','{{.State.Running}}',name])!='true':
                raise ValueError('service stopped before completion')
        return {'event':'RUNTIME_OFFLINE_PROBE_OK','service':service,**inspected,
                'image_loaded':True,'network_disabled':True,'runtime_probe_verified':True,
                'application_server_boot_verified':not oneshot,**detail,
                'provider_credentials_present':False,'live_database_verified':False,
                'authenticated_storage_verified':False,'live_payments':0,'live_ai_calls':0}
    except Exception:
        if started:
            try:
                log=command(['logs','--tail','60',name],combined=True)
                if log:print(json.dumps({'event':'RUNTIME_CONTAINER_DIAGNOSTIC','service':service,'log':log[-6000:]}),flush=True)
            except Exception:
                pass
        raise
    finally:
        if created:
            command(['rm','--force','--volumes',name])


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--service',required=True,choices=sorted(SERVICES))
    parser.add_argument('--image-id',required=True)
    parser.add_argument('--expected-commit',required=True)
    parser.add_argument('--inspect-only',action='store_true')
    args=parser.parse_args()
    try:
        report = inspect_image(args.image_id,args.expected_commit) if args.inspect_only else verify(args.service,args.image_id,args.expected_commit)
        print(json.dumps(report),flush=True)
    except Exception as error:
        reason=str(error) if isinstance(error,ValueError) else type(error).__name__
        print(json.dumps({'event':'RUNTIME_OFFLINE_PROBE_FAILED','service':args.service,'reason':reason}),flush=True)
        raise SystemExit(1)
