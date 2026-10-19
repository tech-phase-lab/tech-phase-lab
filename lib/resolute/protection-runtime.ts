import {S3Client,PutObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {createProtectionPublisher,ProtectionUnavailable,PROTECTION_PREFIX} from './protection-ledger.ts';
import {createProtectionBarrier} from './protection-outbox.ts';
export function protectionRuntime(env:NodeJS.ProcessEnv=process.env){
 // Configuration alone is not acceptance. Explicit separate gate stays off until
 // actual bucket conditional writes and recovery enumeration have been verified.
 if(env.RESOLUTE_PROTECTION_ENABLED!=='true')throw new ProtectionUnavailable();
 const endpoint=new URL(env.RESOLUTE_PROTECTION_ENDPOINT??'');
 const bucket=env.RESOLUTE_PROTECTION_BUCKET,region=env.RESOLUTE_PROTECTION_REGION;
 const accessKeyId=env.RESOLUTE_PROTECTION_ACCESS_KEY_ID,secretAccessKey=env.RESOLUTE_PROTECTION_SECRET_ACCESS_KEY;
 const hex=env.RESOLUTE_PROTECTION_KEY_HEX;
 if(endpoint.protocol!=='https:'||endpoint.pathname!=='/'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||
  !endpoint.hostname.endsWith('.storageapi.dev')||!bucket||!region||!accessKeyId||!secretAccessKey||!hex||!/^[a-f0-9]{64}$/.test(hex))throw new ProtectionUnavailable();
 const client=new S3Client({endpoint:endpoint.origin,region,credentials:{accessKeyId,secretAccessKey},forcePathStyle:false,maxAttempts:1});
 const publisher=createProtectionPublisher({
  async putIfAbsent(Key,Body){
   if(!Key.startsWith(PROTECTION_PREFIX))throw new ProtectionUnavailable();
   await client.send(new PutObjectCommand({Bucket:bucket,Key,Body,IfNoneMatch:'*',ContentType:'application/octet-stream'}),{abortSignal:AbortSignal.timeout(4000)});
  },
  async read(Key){
   const result=await client.send(new GetObjectCommand({Bucket:bucket,Key}),{abortSignal:AbortSignal.timeout(4000)});
   if(!result.Body||result.ContentLength===undefined||result.ContentLength>2048)throw new ProtectionUnavailable();
   const body=await result.Body.transformToByteArray();if(body.length>2048)throw new ProtectionUnavailable();return body;
  }
 },Buffer.from(hex,'hex'));
 return createProtectionBarrier(publisher);
}
