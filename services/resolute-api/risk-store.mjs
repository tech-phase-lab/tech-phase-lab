import {Pool} from 'pg';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {parseRiskFeed,parseRiskArticle,parseQuote,latestRiskDate,riskDate,isLegacyRiskArticle,dailyRunStart} from '../../lib/resolute/risk.ts';
import {quoteIssues} from '../../lib/resolute/risk-copy-check.ts';
import {parseCandidate,parsePicks,parseAdded,answerOpen,answerDay} from '../../lib/resolute/shock-picks.ts';
import {RISK_POLICY} from '../../lib/resolute/risk-policy.ts';
import {isOwnerAccount} from '../../lib/membership/entitlements.ts';
import {createHash} from 'node:crypto';
let db;
export function riskPool(){if(!db){const config=resoluteDatabaseConfig(process.env.RESOLUTE_RISK_DB_URL);if(new URL(config.connectionString).username!=='resolute_risk_writer')throw Error('Scoped risk role required');db=new Pool({...config,max:2});db.on('error',()=>{});}return db;}
export const hash=text=>createHash('sha256').update(text).digest('hex');
export async function boundedJSON(request,max=40000){const reader=request.body?.getReader();if(!reader)throw Error('INVALID_INPUT');let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error('INVALID_INPUT');text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode());}catch(e){await reader.cancel();throw e;}}
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
/** The owner pick of the day (owner only, owner Nov 27): the candidates, the owner's added stories and picks, and whether answers
 * are still accepted. Null when the table is not there yet (migration 030 not applied) or nothing is stored. */
export async function ownerShockDay(pool,now=new Date()){
 const day=answerDay(now)??riskDate(now);let row;
 try{row=(await pool.query('SELECT state,candidates,planned,added,picks,picked_at,revision,published_source,published_at FROM resolute.shock_candidates WHERE day=$1::date',[day])).rows[0];}catch{return null;}
 const {answerUntilJst,publishRunJst,maxStories,maxAdded}=RISK_POLICY.ownerPicks;
 const candidates=Array.isArray(row?.candidates)?row.candidates.flatMap(c=>{try{return [parseCandidate(c)];}catch{return [];}}):[];
 const added=Array.isArray(row?.added)?row.added.flatMap(a=>{try{return [parseAdded(a)];}catch{return [];}}):[];
 return {day,state:row?.state??'none',candidates,planned:Array.isArray(row?.planned)?row.planned:[],added,picks:Array.isArray(row?.picks)?row.picks:null,pickedAt:row?.picked_at?new Date(row.picked_at).toISOString():null,revision:row?.revision??0,
  publishedSource:row?.published_source??null,publishedAt:row?.published_at?new Date(row.published_at).toISOString():null,open:answerOpen(day,now)&&!row?.published_at,answerUntil:answerUntilJst,publishAt:publishRunJst,maxStories,maxAdded};
}
/** The owner's answer (owner only): the picks (candidates and added stories, each with ★1–5 and optionally the owner's own RIZEL
 * line, in order) and the added stories, saved compare-and-set on the row's revision while answers are accepted. Text the owner
 * writes is published as written (owner, Nov 27): no wording check on it. */
export async function saveOwnerPicks(pool,v,now=new Date()){
 if(typeof v.day!=='string'||!answerOpen(v.day,now))return json({error:'ANSWER_CLOSED'},409);
 if(!Number.isInteger(v.baseRevision)||v.baseRevision<0)throw Error('INVALID_INPUT');
 const rawAdded=v.added??[];if(!Array.isArray(rawAdded)||rawAdded.length>RISK_POLICY.ownerPicks.maxAdded)throw Error('INVALID_INPUT');
 let added;try{added=rawAdded.map(parseAdded);}catch{throw Error('INVALID_INPUT');}
 const row=(await pool.query('SELECT candidates,revision,published_at FROM resolute.shock_candidates WHERE day=$1::date',[v.day])).rows[0];
 if(row?.published_at)return json({error:'ANSWER_CLOSED'},409);
 const candidates=Array.isArray(row?.candidates)?row.candidates.flatMap(c=>{try{return [parseCandidate(c)];}catch{return [];}}):[];
 let picks;try{picks=parsePicks(v.picks,[...candidates,...added]);}catch{throw Error('INVALID_INPUT');}
 const r=row?await pool.query('UPDATE resolute.shock_candidates SET picks=$2::jsonb,added=$3::jsonb,picked_at=$4,revision=revision+1 WHERE day=$1::date AND revision=$5 AND published_at IS NULL RETURNING revision',[v.day,JSON.stringify(picks),JSON.stringify(added),now.toISOString(),v.baseRevision])
  :await pool.query("INSERT INTO resolute.shock_candidates(day,state,added,picks,picked_at,revision) SELECT $1::date,'failed',$3::jsonb,$2::jsonb,$4,1 WHERE $5=0 ON CONFLICT(day) DO NOTHING RETURNING revision",[v.day,JSON.stringify(picks),JSON.stringify(added),now.toISOString(),v.baseRevision]);
 return json(r.rows[0]??{error:'CONFLICT'},r.rows.length?200:409);
}
export async function riskRequest(request,userId,readEntitlements,pool=riskPool()){
 const owner=new URL(request.url).pathname.endsWith('/owner');
 if(owner&&!isOwnerAccount(userId))return json({error:'FORBIDDEN'},403);
 if(!owner){if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405);const rights=await readEntitlements(userId);if(!rights.canReceiveNotifications)return json({error:'NOTIFICATION_ENTITLEMENT_REQUIRED'},403);return json(await publicRiskFeed(pool));}
 if(request.method==='GET'){const control=(await pool.query('SELECT * FROM resolute.risk_control WHERE id')).rows[0],health=(await pool.query('SELECT * FROM resolute.risk_health WHERE id')).rows[0];return json({control,health,approved:process.env.RESOLUTE_RISK_PUBLISH_APPROVED==='true',feed:await publicRiskFeed(pool,true),shock:await ownerShockDay(pool),quotes:(await pool.query('SELECT value,revision FROM resolute.risk_quotes ORDER BY id')).rows,budget:(await pool.query('SELECT reserved_usd FROM resolute.risk_budget WHERE month=$1',[riskDate().slice(0,7)])).rows[0]?.reserved_usd??0});}
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 const v=await boundedJSON(request);
 if(v.action==='picks')return saveOwnerPicks(pool,v);
 if(v.action==='toggle'&&typeof v.enabled==='boolean'&&Number.isInteger(v.baseRevision)){if(v.enabled&&process.env.RESOLUTE_RISK_PUBLISH_APPROVED!=='true')return json({error:'RUBRIC_APPROVAL_REQUIRED'},409);const r=await pool.query('UPDATE resolute.risk_control SET enabled=$1,revision=revision+1,updated_at=now() WHERE id AND revision=$2 RETURNING revision',[v.enabled,v.baseRevision]);return json(r.rows[0]??{error:'CONFLICT'},r.rows.length?200:409);}
 if(v.action==='hide'&&/^[a-f0-9]{64}$/.test(v.id)){await pool.query('INSERT INTO resolute.risk_hidden(article_id) VALUES($1) ON CONFLICT DO NOTHING',[v.id]);await pool.query('UPDATE resolute.risk_candidates SET hidden=true WHERE id=$1',[v.id]);return json({ok:true});}
 if(v.action==='quote'){const q=parseQuote(v.quote);const issues=quoteIssues(q);if(q.approved&&issues.length)return json({error:'COPY_NEEDS_REWRITE',codes:issues},422);if(!Number.isInteger(v.baseRevision)||v.baseRevision<0)throw Error('INVALID_INPUT');const r=await pool.query(`INSERT INTO resolute.risk_quotes(id,value,revision) SELECT $1,$2,1 WHERE $3=0 ON CONFLICT(id) DO NOTHING RETURNING revision`,[q.id,JSON.stringify(q),v.baseRevision]);if(r.rows.length)return json(r.rows[0]);const updated=await pool.query('UPDATE resolute.risk_quotes SET value=$2,revision=revision+1 WHERE id=$1 AND revision=$3 RETURNING revision',[q.id,JSON.stringify(q),v.baseRevision]);return json(updated.rows[0]??{error:'CONFLICT'},updated.rows.length?200:409);}
 if(v.action==='paste'){if(typeof v.text!=='string'||v.text.length<20||v.text.length>12000||typeof v.title!=='string'||v.title.length<1||v.title.length>200)throw Error('INVALID_INPUT');const u=new URL(v.url);if(u.protocol!=='https:'||u.username||u.password||u.href.length>2048)throw Error('INVALID_INPUT');const date=new Date(v.publishedAt);if(!Number.isFinite(date.getTime())||date.getTime()>Date.now()+300000||date.getTime()<Date.now()-7*86400000)throw Error('INVALID_INPUT');const id=hash(u.href);await pool.query(`INSERT INTO resolute.risk_candidates(id,url,title,body,published_at,source_kind,fingerprint,manual) VALUES($1,$2,$3,$4,$5,'sns',$6,true) ON CONFLICT(id) DO NOTHING`,[id,u.href,v.title,v.text,date.toISOString(),hash(v.title.normalize('NFKC').replace(/\s/g,''))]);return json({ok:true,id});}
 return json({error:'INVALID_INPUT'},400);
}
const PREPARING_MS=90*60000;
export async function publicRiskFeed(pool,owner=false,now=new Date()){
 const enabled=(await pool.query('SELECT enabled FROM resolute.risk_control WHERE id')).rows[0]?.enabled;
 // Before the owner approves the criteria nothing is public: say "preparing", never "failed".
 if(!owner&&process.env.RESOLUTE_RISK_PUBLISH_APPROVED!=='true')return{state:'preparing',date:null,articles:[],quotes:[]};
 if(!owner&&!enabled)return{state:'stopped',date:null,articles:[],quotes:[]};
 let day=latestRiskDate(now),row=(await pool.query('SELECT state,articles FROM resolute.risk_days WHERE day=$1',[day])).rows[0];
 // Published every day from the owner pick on (owner, Nov 27). While the morning run still runs on weekdays only, a weekend day
 // without a row shows Friday's day, as before.
 if(!row&&[0,6].includes(new Date(day+'T00:00:00Z').getUTCDay())){
  const d=new Date(day+'T00:00:00Z');while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()-1);
  const prev=d.toISOString().slice(0,10),earlier=(await pool.query('SELECT state,articles FROM resolute.risk_days WHERE day=$1',[prev])).rows[0];
  if(earlier){day=prev;row=earlier;}
 }
 // A missing row inside the morning run window is still being prepared; later it is a real failure.
 if(!row&&now.getTime()-dailyRunStart(day)<PREPARING_MS&&now.getTime()>=dailyRunStart(day))return{state:'preparing',date:day,articles:[],quotes:[]};
 if(!row||row.state!=='ready')return{state:row?.state==='processing'?'preparing':'failed',date:day,articles:[],quotes:[]};
 // Rows from before the Shock Gauge carry rubric stars that no longer apply: never shown (recorded as not updated).
 if(row.articles.some(isLegacyRiskArticle))return{state:'failed',date:day,articles:[],quotes:[]};
 const hidden=new Set((await pool.query('SELECT article_id FROM resolute.risk_hidden')).rows.map(r=>r.article_id));
 const articles=row.articles.map(parseRiskArticle).filter(a=>!hidden.has(a.id));
 // An editor hiding every story is not proof that there was no relevant news.
 if(row.articles.length&&!articles.length)return{state:'stopped',date:day,articles:[],quotes:[]};
 const quotes=(await pool.query('SELECT value FROM resolute.risk_quotes')).rows.map(r=>parseQuote(r.value)).filter(q=>q.approved&&!quoteIssues(q).length);
 // A story's own RIZEL line (owner pick, Nov 27) is served as that story's line, through the same quotes list (so the web app's
 // RESOLUTE_RIZEL_LINE_PUBLISHED gate applies to it too). The AI's line is checked again with the RIZEL wording rules; the owner's
 // own line is shown as the owner wrote it (owner, Nov 27).
 const own=articles.filter(a=>a.rizel&&a.stars!==null).map(a=>({a,q:{id:`ai-${a.id.slice(0,16)}`,ja:{title:a.rizel.ja,reasons:[]},en:{title:a.rizel.en,reasons:[]},minStars:1,maxStars:5,approved:true}})).filter(x=>x.a.rizel.by==='owner'||!quoteIssues(x.q).length);
 const lined=articles.map(a=>{const x=own.find(o=>o.a===a);return x?{...a,quoteId:x.q.id}:a;});
 return parseRiskFeed({state:'ready',date:day,articles:lined,quotes:[...quotes,...own.map(x=>x.q)]},{shownOnly:!owner});
}
