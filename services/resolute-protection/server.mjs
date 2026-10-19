/** Dormant isolated writer. Deploy separately; never share its bucket credentials. */
import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {S3Client,PutObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {decryptProtection,PROTECTION_PREFIX} from '../../lib/resolute/protection-ledger.ts';

const route=/^\/v1\/events\/([a-f0-9]{64}\.bin)$/;
export function createWriter({objects,key,token,maxConcurrent=16}) {
 if(!Buffer.isBuffer(key)||key.length!==32||!/^[-_A-Za-z0-9]{48,128}$/.test(token)||!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>32)throw Error('INVALID_WRITER_CONFIG');
 const expected=Buffer.from(`Bearer ${token}`);let active=0;
 const server=createServer(async(req,res)=>{
  const reply=(status,body='')=>{res.writeHead(status,{'cache-control':'no-store','content-type':'application/octet-stream'});res.end(body);};
  const supplied=Buffer.from(req.headers.authorization??'');
  const authCount=req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()==='authorization').length;
  if(authCount!==1||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){reply(401);req.resume();return;}
  const match=route.exec(req.url??'');
  if(!match){reply(404);req.resume();return;}
  if(req.method!=='PUT'&&req.method!=='GET'){reply(405);req.resume();return;}
  if(active>=maxConcurrent){reply(503);req.resume();return;}
  active++;
  req.setTimeout(5000,()=>req.destroy());
  const name=PROTECTION_PREFIX+match[1];
  try {
   if(req.method==='PUT'){
    if(req.headers['if-none-match']!=='*'||req.headers['content-type']!=='application/octet-stream'||req.headers['content-encoding']){reply(400);req.resume();return;}
    if(Number(req.headers['content-length']??0)>2048){reply(413);req.resume();return;}
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>2048)throw Error('BODY_LIMIT');chunks.push(chunk);}
    const body=Buffer.concat(chunks);
    decryptProtection(body,key,name);
    // No caller-controlled bucket, object namespace, command or write condition.
    await objects.putIfAbsent(name,body);
    reply(201);
   } else {
    if(req.headers['transfer-encoding']||Number(req.headers['content-length']??0)!==0){reply(400);req.resume();return;}
    const body=await objects.read(name);
    decryptProtection(body,key,name);
    reply(200,Buffer.from(body));
   }
  }catch{if(!res.headersSent&&!res.destroyed)reply(503);}
  finally{active--;}
 });
 server.requestTimeout=5000;server.headersTimeout=5000;server.keepAliveTimeout=1000;
 server.maxHeadersCount=32;server.maxRequestsPerSocket=100;
 return server;
}

export function writerConfig(env){
 const endpoint=new URL(env.RESOLUTE_WRITER_ENDPOINT??'');
 const bucket=env.RESOLUTE_WRITER_BUCKET,region=env.RESOLUTE_WRITER_REGION;
 const accessKeyId=env.RESOLUTE_WRITER_ACCESS_KEY_ID,secretAccessKey=env.RESOLUTE_WRITER_SECRET_ACCESS_KEY;
 const hex=env.RESOLUTE_WRITER_KEY_HEX,token=env.RESOLUTE_WRITER_TOKEN;
 if(endpoint.protocol!=='https:'||endpoint.pathname!=='/'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!endpoint.hostname.endsWith('.storageapi.dev')||!bucket||!region||!accessKeyId||!secretAccessKey||!hex||!/^[a-f0-9]{64}$/.test(hex)||!token||!/^[-_A-Za-z0-9]{48,128}$/.test(token))throw Error('INVALID_WRITER_CONFIG');
 return {endpoint:endpoint.origin,bucket,region,credentials:{accessKeyId,secretAccessKey},key:Buffer.from(hex,'hex'),token};
}
export function createBucketObjects(client,bucket){
 const valid=name=>{if(!/^resolute\/protection\/events-v1\/[a-f0-9]{64}\.bin$/.test(name))throw Error('INVALID_OBJECT');};
 return {
  async putIfAbsent(Key,Body){
   valid(Key);if(Body.length<33||Body.length>2048)throw Error('BODY_LIMIT');
   await client.send(new PutObjectCommand({Bucket:bucket,Key,Body,IfNoneMatch:'*',ContentType:'application/octet-stream'}),{abortSignal:AbortSignal.timeout(4000)});
  },
  async read(Key){
   valid(Key);
   const response=await client.send(new GetObjectCommand({Bucket:bucket,Key}),{abortSignal:AbortSignal.timeout(4000)});
   const body=response.Body;
   try{
    if(!body||response.ContentLength===undefined||response.ContentLength<33||response.ContentLength>2048)throw Error('BODY_LIMIT');
    const chunks=[];let size=0;
    for await(const chunk of body){size+=chunk.length;if(size>2048)throw Error('BODY_LIMIT');chunks.push(chunk);}
    if(size!==response.ContentLength)throw Error('BODY_LIMIT');
    return Buffer.concat(chunks);
   }finally{body?.destroy?.();}
  }
 };
}
export async function main(env=process.env){
 if(env.RESOLUTE_WRITER_ENABLED!=='true')return null;
 const config=writerConfig(env);
 const port=Number(env.PORT??3000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('INVALID_WRITER_CONFIG');
 const client=new S3Client({endpoint:config.endpoint,region:config.region,credentials:config.credentials,forcePathStyle:false,maxAttempts:1});
 const server=createWriter({...config,objects:createBucketObjects(client,config.bucket)});
 server.on('close',()=>client.destroy());
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'::',resolve);});
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().then(server=>console.log(JSON.stringify({event:server?'RESOLUTE_WRITER_LISTENING':'RESOLUTE_WRITER_DISABLED'})))
 .catch(()=>{console.error('{"event":"RESOLUTE_WRITER_FAILED"}');process.exitCode=1;});
}
