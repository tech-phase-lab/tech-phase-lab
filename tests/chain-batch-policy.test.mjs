import test from 'node:test';import assert from 'node:assert/strict';
import {stopReasons} from '../scripts/chain/batch-policy.mjs';
test('no fetch error or rejection percentage stops a batch',()=>{for(const error of ['http_403','http_429','fetch_unavailable'])assert.deepEqual(stopReasons({checks:[{source_url:'https://data.sec.gov/x',error}],created:10,rejected:10}),[])});
