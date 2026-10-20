"""Immutable online records; seal a manifest only after fencing all writers."""
import hashlib
import hmac
import json
import re
PREFIX = 'resolute/protection/events-v1/'
MANIFEST_PREFIX = 'resolute/protection/manifests-v1/'
MAX_OBJECTS = 100000

def object_key(event,key):
    identity=f"resolute-event-v1\n{event['userId']}\n{event['kind']}\n{event['revision']}".encode()
    return PREFIX+hmac.new(key,identity,hashlib.sha256).hexdigest()+'.bin'

def decrypt_event(body,key,name,protection):
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
    kind=event['kind']
    if kind not in ('delete','alerts_off','morning_off'): raise ValueError('invalid protection kind')
    marker={k:event[k] for k in ('userId','revision','at')}
    ledger={'version':1,'deletions':[],'suppressions':[]}
    if kind=='delete': ledger['deletions'].append(marker)
    else: ledger['suppressions'].append(dict(marker,kind=kind.removesuffix('_off')))
    protection.validate(ledger)
    if object_key(event,key)!=name: raise ValueError('protection event identity mismatch')
    return ledger

def inventory(s3,bucket):
    items={};complete=False
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket,Prefix=PREFIX):
        # Exhausting an iterator is not proof that the provider returned every
        # page. Require an explicit final page before sealing or restoring.
        if complete or type(page.get('IsTruncated')) is not bool:
            raise ValueError('invalid protection inventory pagination')
        complete=not page['IsTruncated']
        if not complete and (not isinstance(page.get('NextContinuationToken'),str) or not page['NextContinuationToken']):
            raise ValueError('incomplete protection inventory pagination')
        for item in page.get('Contents',[]):
            name=item['Key']
            if not re.fullmatch(re.escape(PREFIX)+r'[0-9a-f]{64}\.bin',name) or name in items or not 33<=item['Size']<=2048:
                raise ValueError('invalid protection inventory')
            items[name]={'size':item['Size'],'etag':item['ETag']}
            if len(items)>MAX_OBJECTS: raise ValueError('protection inventory exceeds reviewed limit')
    if not complete: raise ValueError('incomplete protection inventory pagination')
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
