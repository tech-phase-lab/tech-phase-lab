import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { S3Client } from '@aws-sdk/client-s3';
import { validAudioUpload, maxDeskAudioBytes, hasMp3Frames, mp3Start } from '../lib/research/desk-audio.ts';
const file='12345678-1234-4123-8123-123456789abc.mp3';
function mp3(){const b=new Uint8Array(1024);b.set([255,251,144,0],0);b.set([255,251,144,0],417);return b;}
async function load(path,replacements={}){
 let source=readFileSync(new URL(path,import.meta.url),'utf8');
 for(const [from,to] of Object.entries(replacements))source=source.replace(from,to);
 source=source.replace(/from "([^"]+)"/g,(_,id)=>`from ${JSON.stringify(id.startsWith('file:')?id:id==='./desk-audio'?new URL('../lib/research/desk-audio.ts',import.meta.url).href:import.meta.resolve(id))}`);
 return import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
}
const storage=await load('../lib/research/desk-audio-storage.ts');
test('MP3 upload accepts only bounded .mp3 files and verifies Layer III frames beyond valid ID3 tags',()=>{
 assert.equal(validAudioUpload('録音.MP3',1024),true);
 for(const [name,size] of [['movie.mp4',1024],['voice.m4a',1024],['a.mp3',0],['a.mp3',maxDeskAudioBytes+1],['a.mp3','1024']])assert.equal(validAudioUpload(name,size),false);
 assert.equal(hasMp3Frames(mp3()),true);assert.equal(hasMp3Frames(Buffer.from('ftypmp42'+'.'.repeat(1024))),false);
 const single=mp3();single[417]=0;assert.equal(hasMp3Frames(single),false);
 assert.equal(mp3Start(new Uint8Array([73,68,51,4,0,0,0,0,0,10]),1024),20);
 assert.throws(()=>mp3Start(new Uint8Array([73,68,51,4,0,0,255,0,0,10]),1024));
 assert.throws(()=>mp3Start(new Uint8Array([73,68,51,4,0,0,0,0,127,127]),1024));
});
test('R2 upload binds type/size, verifies the immutable source before promotion, and never signs expired access',async()=>{
 const keys=['DESK_MEDIA_R2_ACCOUNT_ID','DESK_MEDIA_R2_BUCKET','DESK_MEDIA_R2_ACCESS_KEY_ID','DESK_MEDIA_R2_SECRET_ACCESS_KEY'];
 const original=Object.fromEntries(keys.map(k=>[k,process.env[k]])),send=S3Client.prototype.send;
 keys.forEach(k=>delete process.env[k]);assert.throws(()=>storage.audioStorage(),/not-configured/);
 Object.assign(process.env,{DESK_MEDIA_R2_ACCOUNT_ID:'a'.repeat(32),DESK_MEDIA_R2_BUCKET:'desk-audio-test',DESK_MEDIA_R2_ACCESS_KEY_ID:'b'.repeat(32),DESK_MEDIA_R2_SECRET_ACCESS_KEY:'c'.repeat(64)});
 const calls=[];let bytes=mp3(),length=1024;
 S3Client.prototype.send=async function(command){
  calls.push({type:command.constructor.name,input:command.input});
  if(command.constructor.name==='HeadObjectCommand')return {ContentLength:length,ContentType:'audio/mpeg',ETag:'"test"',Metadata:{verified:'mp3'}};
  if(command.constructor.name==='GetObjectCommand') {const [,a,b]=/bytes=(\d+)-(\d+)/.exec(command.input.Range);const part=bytes.slice(+a,+b+1);return {ContentLength:part.length,Body:{transformToByteArray:async()=>part}};}
  return {};
 };
 try {
  const started=await storage.beginAudioUpload(1024),url=new URL(started.uploadUrl);
  assert.match(url.pathname,/pending\/.+\.mp3$/);assert.match(url.searchParams.get('X-Amz-SignedHeaders'),/content-length/);assert.match(url.searchParams.get('X-Amz-SignedHeaders'),/content-type/);
  assert.equal(await storage.finishAudioUpload(file),`/api/research/desk-media/${file}`);
  assert.equal(calls.find(c=>c.type==='CopyObjectCommand').input.CopySourceIfMatch,'"test"');
  assert.equal(calls.find(c=>c.type==='CopyObjectCommand').input.Metadata.verified,'mp3');
  assert.equal(calls.at(-1).type,'DeleteObjectCommand');
  calls.length=0;bytes=new Uint8Array(1024);
  await assert.rejects(storage.finishAudioUpload(file),/invalid-mp3/);assert.equal(calls.some(c=>c.type==='CopyObjectCommand'),false);assert.equal(calls.at(-1).type,'DeleteObjectCommand');
  calls.length=0;length=maxDeskAudioBytes+1;
  await assert.rejects(storage.finishAudioUpload(file),/invalid-mp3/);assert.equal(calls.some(c=>c.type==='GetObjectCommand'),false);
  length=1024;await assert.rejects(storage.audioPlaybackUrl(file,Date.now()-1),/access-expired/);
  const playback=new URL(await storage.audioPlaybackUrl(file,Date.now()+30000));assert.ok(+playback.searchParams.get('X-Amz-Expires')<=30);assert.match(playback.pathname,/audio\//);
 }finally{S3Client.prototype.send=send;for(const k of keys)if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}
});
const memberImport='import { getMembership } from "@/lib/membership/server";';
const audioImport='import { deskAudioFile, validAudioUpload, maxDeskAudioBytes } from "@/lib/research/desk-audio";';
const api=await load('../app/api/research/desk-media/route.ts',{
 [memberImport]:'const getMembership=async()=>globalThis.__audio.member;',
 [audioImport]:`import { deskAudioFile, validAudioUpload, maxDeskAudioBytes } from ${JSON.stringify(new URL('../lib/research/desk-audio.ts',import.meta.url).href)};`,
 'import { audioStorage, beginAudioUpload, finishAudioUpload } from "@/lib/research/desk-audio-storage";':'const audioStorage=()=>globalThis.__audio.config(); const beginAudioUpload=async size=>{globalThis.__audio.calls++;return {file:"test.mp3",uploadUrl:"https://r2.test/upload"}};const finishAudioUpload=async file=>{globalThis.__audio.calls++;return "/api/research/desk-media/"+file};'
});
const playback=await load('../app/api/research/desk-media/[file]/route.ts',{
 [memberImport]:'const getMembership=async()=>globalThis.__audio.member;',
 'import { audioPlaybackUrl } from "@/lib/research/desk-audio-storage";':'const audioPlaybackUrl=async(file,deadline)=>{globalThis.__audio.calls++;return "https://r2.test/audio?expires="+deadline;};',
 'import { deskAudioFile } from "@/lib/research/desk-audio";':`import { deskAudioFile } from ${JSON.stringify(new URL('../lib/research/desk-audio.ts',import.meta.url).href)};`,
 'import { GET as getPosts } from "../../posts/route";':'const getPosts=async()=>{if(globalThis.__audio.expire)globalThis.__audio.member.accessExpiresAt=0;return Response.json(globalThis.__audio.posts)};'
});
test('upload endpoints reject cross-origin, non-owner, MP4, oversized bodies and missing setup',async()=>{
 globalThis.__audio={calls:0,member:{status:'signed-in',isAdmin:true},config:()=>{throw Error();}};
 const request=(body,origin='https://example.test')=>new Request('https://example.test/api/research/desk-media',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try {
  assert.equal((await (await api.GET()).json()).enabled,false);
  assert.equal((await api.POST(request({action:'start',name:'a.mp3',size:1024},'https://evil.test'))).status,403);
  globalThis.__audio.member.isAdmin=false;assert.equal((await api.POST(request({action:'start',name:'a.mp3',size:1024}))).status,403);
  globalThis.__audio.member.isAdmin=true;
  assert.equal((await api.POST(request({action:'start',name:'a.mp4',size:1024}))).status,400);
  assert.equal((await api.POST(request({action:'start',name:'a.mp3',size:maxDeskAudioBytes+1}))).status,400);
  assert.equal((await api.POST(request({body:'x'.repeat(5000)}))).status,413);
  assert.equal(globalThis.__audio.calls,0);
  assert.equal((await api.POST(request({action:'start',name:'a.mp3',size:1024}))).status,200);
  assert.equal((await api.POST(request({action:'finish',file:'../../other'}))).status,400);
  assert.equal((await api.POST(request({action:'finish',file}))).status,200);
 }finally{delete globalThis.__audio;}
});
test('playback needs PRO plus exact published attachment; owner can preview; private redirects never cache',async()=>{
 const attachment=`[audio](/api/research/desk-media/${file})`,post='synthetic-note-0001';
 globalThis.__audio={calls:0,member:{status:'signed-out'},posts:{ok:true,access:'pro',items:[{id:post,kind:'notes',status:'published',bodyJa:attachment,bodyEn:''}]}};
 const request=new Request(`https://example.test/api/research/desk-media/${file}?post=${post}`),context={params:Promise.resolve({file})};
 try{
  assert.equal((await playback.GET(request,context)).status,401);
  globalThis.__audio.member={status:'signed-in',isAdmin:false,plan:'free',accessExpiresAt:Date.now()+60000};assert.equal((await playback.GET(request,context)).status,403);
  globalThis.__audio.member.plan='pro';globalThis.__audio.posts.items[0].bodyJa='unrelated';assert.equal((await playback.GET(request,context)).status,404);
  globalThis.__audio.posts.items[0].bodyJa=attachment;globalThis.__audio.posts.items[0].status='withdrawn';assert.equal((await playback.GET(request,context)).status,404);
  assert.equal(globalThis.__audio.calls,0);
  globalThis.__audio.posts.items[0].status='published';const response=await playback.GET(request,context);assert.equal(response.status,307);assert.match(response.headers.get('cache-control'),/private, no-store/);
  globalThis.__audio.expire=true;assert.equal((await playback.GET(request,context)).status,403);
  globalThis.__audio.member.isAdmin=true;globalThis.__audio.posts.items=[];assert.equal((await playback.GET(new Request(`https://example.test/api/research/desk-media/${file}`),context)).status,307);
 }finally{delete globalThis.__audio;}
});
test('Clerk middleware covers upload status, writes and playback',()=>{
 assert.match(readFileSync(new URL('../proxy.ts',import.meta.url),'utf8'),/"\/api\/research\/desk-media\/:path\*"/);
});
