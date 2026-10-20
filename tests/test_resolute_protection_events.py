import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest

ROOT=Path(__file__).resolve().parents[1]
def module(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts/resolute'/f'{name}.py')
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result
p=module('protection');e=module('protection_events')
class Objects:
    def __init__(self):self.files={};self.mutate=False;self.calls=0
    def put_object(self,**kw):self.files[kw['Key']]=kw['Body']
    def get_object(self,**kw):return {'Body':io.BytesIO(self.files[kw['Key']])}
    def get_paginator(self,op):return self
    def paginate(self,**kw):
        self.calls+=1
        values=[{'Key':k,'Size':len(v),'ETag':str(len(v))} for k,v in self.files.items() if k.startswith(kw['Prefix'])]
        if self.mutate and self.calls>1:values=[]
        # Exercise pagination including an empty page.
        return [{'Contents':values[:1]},{'Contents':[]},{'Contents':values[1:]}]
class EventsTests(unittest.TestCase):
    def fixture(self):
        script="""import {encryptProtection,protectionObjectKey} from './lib/resolute/protection-ledger.ts';
const key=Buffer.alloc(32,7);const event={version:1,userId:'user_fixture',revision:3,kind:'delete',at:'2026-10-19T06:00:00.000Z'};
console.log(JSON.stringify({name:protectionObjectKey(event,key),body:encryptProtection(event,key).toString('hex')}));"""
        result=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',script],cwd=ROOT,capture_output=True,text=True,check=True)
        data=json.loads(result.stdout);return data['name'],bytes.fromhex(data['body'])
    def test_node_cipher_restores_through_python_and_sealed_manifest(self):
        name,body=self.fixture();s3=Objects();s3.files[name]=body;key=bytes([7])*32
        pin=e.seal_manifest(s3,'private',key,p)
        ledger=e.load_manifest(s3,'private',key,pin,p)
        self.assertEqual(ledger['deletions'][0]['revision'],3)
        self.assertEqual(len(ledger['deletions']),1)
        s3.files[name]=body[:-1]+bytes([body[-1]^1])
        with self.assertRaisesRegex(ValueError,'checksum'):e.load_manifest(s3,'private',key,pin,p)
    def test_missing_object_or_changing_inventory_cannot_be_sealed(self):
        name,body=self.fixture();s3=Objects();s3.files[name]=body;s3.mutate=True
        with self.assertRaisesRegex(ValueError,'changed'):e.seal_manifest(s3,'private',bytes([7])*32,p)
    def test_wrong_key_and_unpinned_manifest_fail(self):
        name,body=self.fixture();s3=Objects();s3.files[name]=body
        with self.assertRaises(Exception):e.decrypt_event(body,bytes([8])*32,name,p)
        for pin in (None,'','latest','../'):
            with self.assertRaises(ValueError):e.load_manifest(s3,'private',bytes([7])*32,pin,p)

    def test_empty_bootstrap_manifest_rejects_later_event(self):
        s3=Objects();key=bytes([7])*32
        pin=e.seal_manifest(s3,'private',key,p)
        self.assertEqual(e.load_manifest(s3,'private',key,pin,p,require_complete_inventory=True)['deletions'],[])
        name,body=self.fixture();s3.files[name]=body
        with self.assertRaisesRegex(ValueError,'inventory'):
            e.load_manifest(s3,'private',key,pin,p,require_complete_inventory=True)

    def test_complete_inventory_replay_and_change_during_read(self):
        name,body=self.fixture();s3=Objects();s3.files[name]=body;key=bytes([7])*32
        pin=e.seal_manifest(s3,'private',key,p)
        self.assertEqual(len(e.load_manifest(s3,'private',key,pin,p,require_complete_inventory=True)['deletions']),1)
        s3.calls=0;s3.mutate=True
        with self.assertRaisesRegex(ValueError,'inventory'):
            e.load_manifest(s3,'private',key,pin,p,require_complete_inventory=True)

    def test_missing_list_permission_cannot_skip_freshness_check(self):
        s3=Objects();key=bytes([7])*32;pin=e.seal_manifest(s3,'private',key,p)
        def forbidden(_):raise PermissionError('List unavailable')
        s3.get_paginator=forbidden
        with self.assertRaises(PermissionError):
            e.load_manifest(s3,'private',key,pin,p,require_complete_inventory=True)
