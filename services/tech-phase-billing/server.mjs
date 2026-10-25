import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { billingRuntime } from './runtime.mjs';
import { billingBackend } from './transport.mjs';
import {liveRuntime} from './live-runtime.mjs';
import {liveBackend} from './live-transport.mjs';
const env=process.env,ownerId=env.TECH_PHASE_BILLING_OWNER_ID;
const live=env.TECH_PHASE_BILLING_RUNTIME==='railway-live';
if(!live&&(!ownerId||!/^user_[A-Za-z0-9]+$/.test(ownerId)))throw Error('BILLING_OWNER_REQUIRED');
const runtime=live?liveRuntime(env):billingRuntime(env,ownerId);
const handler=live?liveBackend({env,services:runtime.services}):billingBackend({env,ownerId,services:runtime.services});
const server=createServer({requestTimeout:20000,headersTimeout:10000,maxHeaderSize:16384},async(req,res)=>{
  try {
    // Host is deliberately ignored; never construct trusted URLs from it.
    const url=new URL(req.url,'http://billing.internal');
    if(req.method==='GET'&&url.pathname==='/healthz'&&!url.search){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'up',environment:live?'live':'sandbox'}));return;}
    const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
    const response=await handler(new Request(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Readable.toWeb(req),duplex:'half'}));
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"billing-unavailable"}');}
});
server.listen(Number(env.PORT||8080),'::');
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{server.close(()=>{runtime.close().finally(()=>process.exit(0));});setTimeout(()=>process.exit(1),10000).unref();});
