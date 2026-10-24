import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

/** Separate acceptance namespace. Never write under production event prefixes. */
export function createAcceptanceObjects(env, client) {
 const endpoint=new URL(env.RECOVERY_STORAGE_ENDPOINT??'');
 const bucket=env.RECOVERY_STORAGE_BUCKET,region=env.RECOVERY_STORAGE_REGION;
 const accessKeyId=env.RECOVERY_STORAGE_ACCESS_KEY_ID,secretAccessKey=env.RECOVERY_STORAGE_SECRET_ACCESS_KEY;
 if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.storageapi.dev')||endpoint.pathname!=='/'||endpoint.port||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!bucket||!region||!accessKeyId||!secretAccessKey)throw Error('RECOVERY_STORAGE_CONFIG');
 const s3=client??new S3Client({endpoint:endpoint.origin,region,credentials:{accessKeyId,secretAccessKey},maxAttempts:1});
 const prefix='resolute/protection/acceptance/'+randomUUID()+'/';
 const map=name=>{if(!/^resolute\/protection\/events-v1\/[a-f0-9]{64}\.bin$/.test(name))throw Error('RECOVERY_STORAGE_KEY');return prefix+name.split('/').at(-1);};
 return {
  async putIfAbsent(name,body){
   if(body.length<33||body.length>2048)throw Error('RECOVERY_STORAGE_BODY');
   await s3.send(new PutObjectCommand({Bucket:bucket,Key:map(name),Body:body,IfNoneMatch:'*',ContentType:'application/octet-stream'}),{abortSignal:AbortSignal.timeout(4000)});
  },
  async read(name){
   const response=await s3.send(new GetObjectCommand({Bucket:bucket,Key:map(name)}),{abortSignal:AbortSignal.timeout(4000)});
   const stream=response.Body;
   try{
    if(!stream||!Number.isInteger(response.ContentLength)||response.ContentLength<33||response.ContentLength>2048)throw Error('RECOVERY_STORAGE_BODY');
    const chunks=[];let size=0;
    for await(const chunk of stream){size+=chunk.length;if(size>2048)throw Error('RECOVERY_STORAGE_BODY');chunks.push(chunk);}
    if(size!==response.ContentLength)throw Error('RECOVERY_STORAGE_BODY');return Buffer.concat(chunks);
   }finally{stream?.destroy?.();}
  },
  close(){s3.destroy?.();}
 };
}
