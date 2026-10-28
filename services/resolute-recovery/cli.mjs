import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { authConfig } from '../resolute-api/auth.mjs';
import { createRecoveryHandler } from './handler.mjs';
import { createRecoveryExecutor, assertIsolatedEnvironment } from './executor.mjs';
import { createAcceptanceObjects } from './storage.mjs';
import { OWNER_ACCOUNT_ID } from '../../lib/membership/entitlements.ts';

// One-shot synthetic signed session, no public server, no cron, no real owner JWT.
// Live owner-session transport acceptance remains a separate verification step.
if(process.env.RESOLUTE_RECOVERY_SYNTHETIC_ENABLED!=='true'){
 console.log(JSON.stringify({event:'RESOLUTE_RECOVERY_ACCEPTANCE_DISABLED'}));
}else{
 let objects;
 try{
  assertIsolatedEnvironment(process.env);
  if(process.argv.length!==2)throw Error('INVALID_ARGUMENT');
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const issuer='https://synthetic.clerk.accounts.dev',origin='https://synthetic.example.test';
  const serviceToken=randomBytes(48).toString('base64url');
  const config=authConfig({RESOLUTE_API_SERVICE_TOKEN:serviceToken,RESOLUTE_CLERK_ISSUER:issuer,RESOLUTE_CLERK_AUTHORIZED_PARTIES:JSON.stringify([origin]),RESOLUTE_CLERK_JWT_PUBLIC_KEY:publicKey.export({type:'spki',format:'pem'})});
  const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({iss:issuer,azp:origin,sub:OWNER_ACCOUNT_ID,sid:'sess_synthetic',iat:now-1,nbf:now-1,exp:now+120})).toString('base64url');
  const token=`${header}.${payload}.${sign('RSA-SHA256',Buffer.from(`${header}.${payload}`),privateKey).toString('base64url')}`;
  objects=createAcceptanceObjects(process.env);
  const execute=createRecoveryExecutor({config,objects,onStage:stage=>console.log(JSON.stringify({event:'RESOLUTE_RECOVERY_STAGE',stage}))});
  const handler=createRecoveryHandler({config,enabled:true,until:new Date(Date.now()+60000).toISOString(),claim:async()=>true,execute});
  const response=await handler(new Request('https://isolated.invalid/internal/v1/recovery-check',{method:'POST',headers:{authorization:`Bearer ${token}`,'x-resolute-service-token':serviceToken,'content-type':'application/json'},body:JSON.stringify({requestId:randomUUID()})}));
  if(response.status!==200)throw Error('ACCEPTANCE_FAILED');
  const result=await response.json();
  console.log(JSON.stringify({event:'RESOLUTE_RECOVERY_ACCEPTANCE_OK',checks:result.checks,syntheticSession:true,liveOwnerSession:false,realPostgres:true,externalStorage:true,productionTouched:false,mailSent:false,livePayment:false,aiCalled:false}));
 }catch{console.error(JSON.stringify({event:'RESOLUTE_RECOVERY_ACCEPTANCE_FAILED'}));process.exitCode=1;}
 finally{objects?.close();}
}
