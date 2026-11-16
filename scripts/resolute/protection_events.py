"""Immutable online records; seal a manifest only after fencing all writers.

Restore verification is append-only (see docs/RESOLUTE-PROTECTION-CHAIN.md): the
pinned anchor manifest and every chained manifest linked back to it must still be
present byte-for-byte; additional objects must be authentic events that the
restored database also records (or that are newer than the backup).
"""
import datetime as dt
import hashlib
import hmac
import json
import re
PREFIX = 'resolute/protection/events-v1/'
MANIFEST_PREFIX = 'resolute/protection/manifests-v1/'
CHAIN_PREFIX = 'resolute/protection/manifests-v2/'
MAX_OBJECTS = 100000
MAX_CHAIN_MANIFESTS = 5000
MAX_MANIFEST_BYTES = 32 * 1024 * 1024
# Fixed, non-secret diagnostics for RESOLUTE_JOB_FAILED. Never add data to them.
REASONS = frozenset({
    'listing-incomplete', 'listing-invalid', 'inventory-missing-object',
    'inventory-modified-object', 'inventory-unknown-event', 'inventory-db-mismatch',
    'inventory-changed', 'chain-anchor-unreadable', 'chain-anchor-invalid',
    'chain-invalid', 'chain-write-failed', 'protection-config'})


class InventoryError(ValueError):
    """Fail-closed protection error carrying one fixed reason code."""
    def __init__(self, reason, message):
        if reason not in REASONS:
            raise AssertionError('unknown reason code')
        super().__init__(message)
        self.reason = reason

def object_key(event,key):
    identity=f"resolute-event-v1\n{event['userId']}\n{event['kind']}\n{event['revision']}".encode()
    return PREFIX+hmac.new(key,identity,hashlib.sha256).hexdigest()+'.bin'

def decrypt_event(body,key,name,protection):
    return _ledger(decrypt_raw_event(body,key,name,protection),protection)

def decrypt_raw_event(body,key,name,protection):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if len(key)!=32 or not 33<=len(body)<=2048 or body[:4]!=b'RPE1':
        raise ValueError('invalid encrypted protection event')
    raw=AESGCM(key).decrypt(body[4:16],body[32:]+body[16:32],name.encode())
    def unique(pairs):
        result={}
        for k,v in pairs:
            if k in result: raise ValueError('duplicate event field')
            result[k]=v
        return result
    event=json.loads(raw,object_pairs_hook=unique)
    if not isinstance(event,dict) or set(event)!={'version','userId','revision','kind','at'} or type(event['version']) is not int or event['version']!=1:
        raise ValueError('invalid protection event')
    if event['kind'] not in ('delete','alerts_off','morning_off'): raise ValueError('invalid protection kind')
    _ledger(event,protection)
    if object_key(event,key)!=name: raise ValueError('protection event identity mismatch')
    return event

def _ledger(event,protection):
    kind=event['kind']
    marker={k:event[k] for k in ('userId','revision','at')}
    ledger={'version':1,'deletions':[],'suppressions':[]}
    if kind=='delete': ledger['deletions'].append(marker)
    else: ledger['suppressions'].append(dict(marker,kind=kind.removesuffix('_off')))
    return protection.validate(ledger)

def inventory(s3,bucket):
    return _listing(s3,bucket,PREFIX,r'[0-9a-f]{64}\.bin',33,2048,MAX_OBJECTS)

def _listing(s3,bucket,prefix,pattern,min_size,max_size,limit):
    items={};complete=False
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket,Prefix=prefix):
        # Exhausting an iterator is not proof that the provider returned every
        # page. Require an explicit final page before sealing or restoring.
        if complete or type(page.get('IsTruncated')) is not bool:
            raise InventoryError('listing-incomplete','invalid protection inventory pagination')
        complete=not page['IsTruncated']
        if not complete and (not isinstance(page.get('NextContinuationToken'),str) or not page['NextContinuationToken']):
            raise InventoryError('listing-incomplete','incomplete protection inventory pagination')
        for item in page.get('Contents',[]):
            name=item['Key']
            if not re.fullmatch(re.escape(prefix)+pattern,name) or name in items or not min_size<=item['Size']<=max_size:
                raise InventoryError('listing-invalid','invalid protection inventory')
            items[name]={'size':item['Size'],'etag':item['ETag']}
            if len(items)>limit: raise InventoryError('listing-invalid','protection inventory exceeds reviewed limit')
    if not complete: raise InventoryError('listing-incomplete','incomplete protection inventory pagination')
    return items

def read_object(s3,bucket,name,limit):
    # Bounded reads may leave unread bytes on failure. Always release the HTTP
    # response, including when the provider raises during streaming.
    stream=s3.get_object(Bucket=bucket,Key=name)['Body']
    try:
        return stream.read(limit)
    finally:
        stream.close()

def seal_manifest(s3,bucket,key,protection):
    before=inventory(s3,bucket);objects=[]
    for name in sorted(before):
        body=read_object(s3,bucket,name,2049)
        decrypt_event(body,key,name,protection)
        objects.append({'key':name,'sha256':hashlib.sha256(body).hexdigest()})
    if inventory(s3,bucket)!=before: raise ValueError('protection inventory changed; fence writers first')
    body=json.dumps({'version':1,'objects':objects},sort_keys=True,separators=(',',':')).encode()
    pin=hashlib.sha256(body).hexdigest()
    s3.put_object(Bucket=bucket,Key=MANIFEST_PREFIX+pin+'.json',Body=body)
    if read_object(s3,bucket,MANIFEST_PREFIX+pin+'.json',len(body)+1)!=body:
        raise ValueError('protection manifest readback mismatch')
    return pin

def load_manifest(s3,bucket,key,pin,protection,*,require_complete_inventory=False):
    if not isinstance(pin,str) or not re.fullmatch('[0-9a-f]{64}',pin):
        raise ValueError('independent online protection manifest required')
    raw=read_object(s3,bucket,MANIFEST_PREFIX+pin+'.json',32*1024*1024+1)
    if len(raw)>32*1024*1024 or hashlib.sha256(raw).hexdigest()!=pin:
        raise ValueError('protection manifest checksum mismatch')
    manifest=json.loads(raw)
    if not isinstance(manifest,dict) or set(manifest)!={'version','objects'} or type(manifest['version']) is not int or manifest['version']!=1 or not isinstance(manifest['objects'],list) or len(manifest['objects'])>MAX_OBJECTS:
        raise ValueError('invalid protection manifest')
    # A pinned manifest may be authentic but stale. Live-store restore must also
    # reject omitted/new objects and concurrent inventory changes. Operators must
    # still fence writers: two observations cannot prevent a later write.
    before=inventory(s3,bucket) if require_complete_inventory else None
    ledger={'version':1,'deletions':[],'suppressions':[]};seen=set()
    for item in manifest['objects']:
        if not isinstance(item,dict) or set(item)!={'key','sha256'} or not isinstance(item['key'],str) or not re.fullmatch(re.escape(PREFIX)+r'[0-9a-f]{64}\.bin',item['key']) or not isinstance(item['sha256'],str) or not re.fullmatch('[0-9a-f]{64}',item['sha256']) or item['key'] in seen:
            raise ValueError('invalid protection manifest entry')
        seen.add(item['key'])
        body=read_object(s3,bucket,item['key'],2049)
        if hashlib.sha256(body).hexdigest()!=item['sha256']: raise ValueError('protection event checksum mismatch')
        event=decrypt_event(body,key,item['key'],protection)
        for group in ('deletions','suppressions'):ledger[group].extend(event[group])
    if before is not None and (seen!=set(before) or inventory(s3,bucket)!=before):
        raise ValueError('incomplete or changing protection inventory; fence writers and reseal manifest')
    return protection.validate(ledger)

# --- Append-only chain verification (weekly restore) -------------------------

_SHA = re.compile('[0-9a-f]{64}')
_TIME = '%Y-%m-%dT%H:%M:%S.%fZ'
_KINDS = ('delete','alerts_off','morning_off')

def canonical(value):
    """Byte-identical to Node JSON.stringify with sorted keys (ASCII content)."""
    return json.dumps(value,sort_keys=True,separators=(',',':')).encode()

def _parse_objects(objects,*,ordered):
    if not isinstance(objects,list) or len(objects)>MAX_OBJECTS: raise ValueError('objects')
    result={};last=''
    for item in objects:
        if (not isinstance(item,dict) or set(item)!={'key','sha256'} or not isinstance(item['key'],str)
                or not re.fullmatch(re.escape(PREFIX)+r'[0-9a-f]{64}\.bin',item['key'])
                or not isinstance(item['sha256'],str) or not _SHA.fullmatch(item['sha256'])
                or item['key'] in result or (ordered and item['key']<=last)):
            raise ValueError('entry')
        last=item['key'];result[item['key']]=item['sha256']
    return result

def _read_manifest(s3,bucket,name,digest,raw=None):
    if raw is None: raw=read_object(s3,bucket,name,MAX_MANIFEST_BYTES+1)
    if len(raw)>MAX_MANIFEST_BYTES or hashlib.sha256(raw).hexdigest()!=digest: raise ValueError('checksum')
    def unique(pairs):
        result={}
        for k,v in pairs:
            if k in result: raise ValueError('duplicate manifest field')
            result[k]=v
        return result
    return json.loads(raw,object_pairs_hook=unique)

def load_anchor(s3,bucket,pin):
    """The pinned, write-fenced version 1 manifest that every chain starts from."""
    if not isinstance(pin,str) or not _SHA.fullmatch(pin):
        raise InventoryError('protection-config','independent online protection manifest required')
    try:
        raw=read_object(s3,bucket,MANIFEST_PREFIX+pin+'.json',MAX_MANIFEST_BYTES+1)
    except Exception as error:
        raise InventoryError('chain-anchor-unreadable','protection anchor manifest unreadable') from error
    try:
        manifest=_read_manifest(s3,bucket,None,pin,raw)
        if (not isinstance(manifest,dict) or set(manifest)!={'version','objects'}
                or type(manifest['version']) is not int or manifest['version']!=1):
            raise ValueError('shape')
        return _parse_objects(manifest['objects'],ordered=False)
    except Exception as error:
        raise InventoryError('chain-anchor-invalid','invalid protection anchor manifest') from error

def _chain_objects(manifest,pin):
    if (not isinstance(manifest,dict) or set(manifest)!={'version','anchor','previous','height','mode','sealedAt','objects'}
            or type(manifest['version']) is not int or manifest['version']!=2
            or not isinstance(manifest['anchor'],str) or not _SHA.fullmatch(manifest['anchor'])
            or not isinstance(manifest['previous'],str) or not _SHA.fullmatch(manifest['previous'])
            or type(manifest['height']) is not int or not 0<manifest['height']<=MAX_CHAIN_MANIFESTS
            or manifest['mode'] not in ('restore','maintenance') or not isinstance(manifest['sealedAt'],str)):
        raise ValueError('shape')
    dt.datetime.strptime(manifest['sealedAt'],_TIME)
    objects=_parse_objects(manifest['objects'],ordered=True)
    if manifest['anchor']!=pin: return None
    if (manifest['height']==1)!=(manifest['previous']==pin): raise ValueError('height')
    return objects

def load_chain(s3,bucket,pin):
    """Anchor objects plus every chained manifest that links back to the pin.

    Each chained manifest records its predecessor's SHA256 and height and must
    contain every predecessor object with an identical checksum. Manifests are
    content-addressed, so rewriting history changes their name. Manifests of a
    different anchor are ignored; malformed or unlinked ones fail closed.
    """
    anchor=load_anchor(s3,bucket,pin)
    listed=_listing(s3,bucket,CHAIN_PREFIX,r'[0-9a-f]{64}\.json',2,MAX_MANIFEST_BYTES,MAX_CHAIN_MANIFESTS)
    found={}
    for name in sorted(listed):
        digest=name[len(CHAIN_PREFIX):-len('.json')]
        try:
            raw=read_object(s3,bucket,name,MAX_MANIFEST_BYTES+1)
            manifest=_read_manifest(s3,bucket,name,digest,raw)
            # Writers emit canonical bytes only; anything else is not ours.
            if canonical(manifest)!=raw: raise ValueError('non-canonical manifest')
            objects=_chain_objects(manifest,pin)
        except Exception as error:
            raise InventoryError('chain-invalid','invalid chained protection manifest') from error
        if objects is not None: found[digest]=(manifest,objects)
    linked={pin:(0,anchor)}
    for digest,(manifest,objects) in sorted(found.items(),key=lambda x:(x[1][0]['height'],x[0])):
        parent=linked.get(manifest['previous'])
        if parent is None or parent[0]+1!=manifest['height']:
            raise InventoryError('chain-invalid','chained manifest does not link back to the anchor')
        if any(objects.get(k)!=v for k,v in parent[1].items()):
            raise InventoryError('chain-invalid','chained manifest is not append-only')
        linked[digest]=(manifest['height'],objects)
    expected={}
    for _,objects in linked.values():
        for k,v in objects.items():
            if expected.setdefault(k,v)!=v: raise InventoryError('chain-invalid','conflicting chained manifests')
    # Deterministic tip: greatest height, then smallest digest. Every linked
    # manifest (including any fork) is verified through `expected` regardless.
    tip=max(linked,key=lambda d:(linked[d][0],[-ord(c) for c in d]))
    return {'anchor':anchor,'expected':expected,'tip':tip,'height':linked[tip][0],
            'tip_objects':linked[tip][1],'linked':len(linked)-1}

def _database_history(rows):
    if not isinstance(rows,list): raise InventoryError('inventory-db-mismatch','invalid database history')
    result={}
    for row in rows:
        if (not isinstance(row,dict) or set(row)!={'userId','revision','kind','at'}
                or row['kind'] not in _KINDS or not isinstance(row['at'],str)):
            raise InventoryError('inventory-db-mismatch','invalid database history')
        identity=(row['userId'],row['revision'],row['kind'])
        if identity in result: raise InventoryError('inventory-db-mismatch','duplicate database history')
        result[identity]=row['at']
    return result

def verify_append_only(s3,bucket,key,pin,protection,*,db_events,backup_cutoff):
    """Accept the live inventory only if it extends the sealed chain.

    (a) every object in the anchor and in every linked chained manifest is still
    present with an identical SHA256; (b) every object authenticates as an event
    under its own object key; (c) every non-anchor event has its exact restored
    protection_outbox row or is strictly newer than backup_cutoff, and every
    restored row has its event; (d) listing is explicitly complete, and nothing
    listed disappears or changes while it is read. Anything else fails closed.
    """
    if not isinstance(backup_cutoff,dt.datetime) or backup_cutoff.tzinfo is None:
        raise InventoryError('protection-config','backup point in time required')
    database=_database_history(db_events)
    chain=load_chain(s3,bucket,pin)
    before=inventory(s3,bucket)
    if any(name not in before for name in chain['expected']):
        raise InventoryError('inventory-missing-object','sealed protection object missing')
    objects=[];stored={};ledger={'version':1,'deletions':[],'suppressions':[]};newer=0
    for name in sorted(before):
        body=read_object(s3,bucket,name,2049)
        digest=hashlib.sha256(body).hexdigest()
        if name in chain['expected'] and chain['expected'][name]!=digest:
            raise InventoryError('inventory-modified-object','sealed protection object changed')
        try:
            event=decrypt_raw_event(body,key,name,protection)
        except Exception as error:
            raise InventoryError('inventory-unknown-event','unauthenticated protection object') from error
        identity=(event['userId'],event['revision'],event['kind'])
        recorded=database.get(identity)
        if recorded is not None and recorded!=event['at']:
            raise InventoryError('inventory-db-mismatch','protection event conflicts with database history')
        if recorded is None and name not in chain['anchor']:
            at=dt.datetime.strptime(event['at'],_TIME).replace(tzinfo=dt.timezone.utc)
            if at<=backup_cutoff:
                raise InventoryError('inventory-db-mismatch','protection event missing from database history')
            newer+=1
        stored[identity]=event['at']
        objects.append({'key':name,'sha256':digest})
        part=_ledger(event,protection)
        for group in ('deletions','suppressions'): ledger[group].extend(part[group])
    if any(stored.get(identity)!=at for identity,at in database.items()):
        raise InventoryError('inventory-db-mismatch','database history missing from protection store')
    after=inventory(s3,bucket)
    for name,meta in before.items():
        if name not in after: raise InventoryError('inventory-missing-object','protection object disappeared')
        if after[name]!=meta: raise InventoryError('inventory-changed','protection object changed during read')
    protection.validate(ledger)
    return {'ledger':ledger,'objects':objects,'tip':chain['tip'],'height':chain['height'],
            'tip_objects':chain['tip_objects'],'linked':chain['linked'],
            'added':sum(1 for item in objects if item['key'] not in chain['tip_objects']),
            'newer_than_backup':newer}

def chain_manifest(pin,previous,height,objects,mode,sealed_at):
    body=canonical({'version':2,'anchor':pin,'previous':previous,'height':height,'mode':mode,
                    'sealedAt':sealed_at,'objects':objects})
    if len(body)>MAX_MANIFEST_BYTES: raise InventoryError('chain-write-failed','chained manifest too large')
    return hashlib.sha256(body).hexdigest(),body

def extend_chain(s3,bucket,pin,result,*,mode,sealed_at):
    """Write a new content-addressed chained manifest; never overwrite one.

    Returns None (nothing written) when the verified inventory equals the tip.
    """
    if {o['key']:o['sha256'] for o in result['objects']}==result['tip_objects']:
        return None
    digest,body=chain_manifest(pin,result['tip'],result['height']+1,result['objects'],mode,sealed_at)
    name=CHAIN_PREFIX+digest+'.json'
    try:
        s3.put_object(Bucket=bucket,Key=name,Body=body,ContentType='application/json',
                      **({'IfNoneMatch':'*'} if _supports_if_none_match(s3) else {}))
    except Exception as error:
        # An existing object at this content address is fine only if identical;
        # the readback below proves that either way.
        if not _precondition_failed(error):
            raise InventoryError('chain-write-failed','chained manifest write failed') from error
    try:
        readback=read_object(s3,bucket,name,len(body)+1)
    except Exception as error:
        raise InventoryError('chain-write-failed','chained manifest readback failed') from error
    if readback!=body: raise InventoryError('chain-write-failed','chained manifest readback mismatch')
    return digest

def _supports_if_none_match(s3):
    try: return 'IfNoneMatch' in s3.meta.service_model.operation_model('PutObject').input_shape.members
    except Exception: return False

def _precondition_failed(error):
    response=getattr(error,'response',None)
    return isinstance(response,dict) and response.get('ResponseMetadata',{}).get('HTTPStatusCode')==412
