import test from 'node:test';
import assert from 'node:assert/strict';
import {main,checkMailDomain} from '../scripts/resolute/mail-domain-check.mjs';

const env={RESOLUTE_MAIL_DOMAIN_CHECK:'true',RESOLUTE_MAIL_FROM:'alerts@mail.example.test',RESOLUTE_RESEND_API_KEY:'re_'+'a'.repeat(30)};
const dns=records=>async name=>{if(!records[name])throw Object.assign(Error('ENODATA'),{code:'ENODATA'});return records[name].map(v=>[v]);};
const good={'example.test':['v=spf1 include:x -all'],'_dmarc.example.test':['v=DMARC1; p=none'],'resend._domainkey.mail.example.test':['p=SECRETKEYVALUE']};
const domains=(status,name='example.test')=>async()=>Response.json({data:[{name,status}]});

test('disabled by default and refuses a bad configuration without any I/O',async()=>{
 const fail=async()=>assert.fail('no I/O');
 assert.deepEqual(await main({},{request:fail,resolver:fail}),{event:'RESOLUTE_MAIL_DOMAIN_CHECK_DISABLED'});
 for(const patch of [{RESOLUTE_MAIL_FROM:'nope'},{RESOLUTE_RESEND_API_KEY:'x'}])await assert.rejects(main({...env,...patch},{request:fail,resolver:fail}),/Invalid mail configuration/);
});
test('verified domain with SPF, DKIM and DMARC passes; output carries only names and booleans',async()=>{
 const seen=[];
 const r=await checkMailDomain(env,{request:async(url,init)=>{seen.push([String(url),init.method]);return domains('verified')();},resolver:dns(good)});
 assert.equal(r.allPassed,true);assert.equal(r.provider,'verified');
 assert.deepEqual(seen,[['https://api.resend.com/domains','GET']]);
 const out=JSON.stringify(r);for(const secret of ['SECRETKEYVALUE','alerts@','re_aaaa','v=spf1','example.test'])assert.ok(!out.includes(secret),secret);
});
test('unverified or unregistered domain, missing DNS and restricted keys are reported as not passed',async()=>{
 assert.equal((await checkMailDomain(env,{request:domains('pending'),resolver:dns(good)})).provider,'not-verified');
 assert.equal((await checkMailDomain(env,{request:domains('verified','other.test'),resolver:dns(good)})).provider,'domain-not-registered');
 const restricted=await checkMailDomain(env,{request:async()=>new Response('{}',{status:401}),resolver:dns(good)});
 assert.equal(restricted.provider,'key-restricted');assert.equal(restricted.allPassed,false);
 const noDns=await checkMailDomain(env,{request:domains('verified'),resolver:dns({})});
 assert.deepEqual(noDns.checks.filter(c=>c.name.startsWith('dns-')).map(c=>c.ok),[false,false,false]);assert.equal(noDns.allPassed,false);
 const down=await checkMailDomain(env,{request:async()=>{throw new Error('network');},resolver:dns(good)});
 assert.equal(down.allPassed,false);assert.equal(down.provider,'unavailable');
});
