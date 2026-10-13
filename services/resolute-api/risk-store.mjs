import {Pool} from 'pg';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {parseRiskFeed,parseRiskArticle,parseQuote,latestRiskDate,riskDate} from '../../lib/resolute/risk.ts';
import {isOwnerAccount} from '../../lib/membership/entitlements.ts';
import {createHash} from 'node:crypto';
let db;
export function riskPool(){if(!db){const config=resoluteDatabaseConfig(process.env.RESOLUTE_RISK_DB_URL);if(new URL(config.connectionString).username!=='resolute_risk_writer')throw Error('Scoped risk role required');db=new Pool({...config,max:2});db.on('error',()=>{});}return db;}
export const hash=text=>createHash('sha256').update(text).digest('hex');
export async function boundedJSON(request,max=40000){const reader=request.body?.getReader();if(!reader)throw Error('INVALID_INPUT');let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error('INVALID_INPUT');text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode());}catch(e){await reader.cancel();throw e;}}
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
export async function riskRequest(request,userId,readEntitlements,pool=riskPool()){
 const owner=new URL(request.url).pathname.endsWith('/owner');
 if(owner&&!isOwnerAccount(userId))return json({error:'FORBIDDEN'},403);
 if(!owner){if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405);const rights=await readEntitlements(userId);if(!rights.canReceiveNotifications)return json({error:'NOTIFICATION_ENTITLEMENT_REQUIRED'},403);return json(await publicRiskFeed(pool));}
 if(request.method==='GET'){const control=(await pool.query('SELECT * FROM resolute.risk_control WHERE id')).rows[0],health=(await pool.query('SELECT * FROM resolute.risk_health WHERE id')).rows[0];return json({control,health,feed:await publicRiskFeed(pool,true),quotes:(await pool.query('SELECT value,revision FROM resolute.risk_quotes ORDER BY id')).rows,budget:(await pool.query('SELECT reserved_usd FROM resolute.risk_budget WHERE month=$1',[riskDate().slice(0,7)])).rows[0]?.reserved_usd??0});}
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 const v=await boundedJSON(request);
 if(v.action==='toggle'&&typeof v.enabled==='boolean'&&Number.isInteger(v.baseRevision)){if(v.enabled&&process.env.RESOLUTE_RISK_PUBLISH_APPROVED!=='true')return json({error:'RUBRIC_APPROVAL_REQUIRED'},409);const r=await pool.query('UPDATE resolute.risk_control SET enabled=$1,revision=revision+1,updated_at=now() WHERE id AND revision=$2 RETURNING revision',[v.enabled,v.baseRevision]);return json(r.rows[0]??{error:'CONFLICT'},r.rows.length?200:409);}
 if(v.action==='hide'&&/^[a-f0-9]{64}$/.test(v.id)){await pool.query('INSERT INTO resolute.risk_hidden(article_id) VALUES($1) ON CONFLICT DO NOTHING',[v.id]);await pool.query('UPDATE resolute.risk_candidates SET hidden=true WHERE id=$1',[v.id]);return json({ok:true});}
 if(v.action==='quote'){const q=parseQuote(v.quote);if(!Number.isInteger(v.baseRevision)||v.baseRevision<0)throw Error('INVALID_INPUT');const r=await pool.query(`INSERT INTO resolute.risk_quotes(id,value,revision) SELECT $1,$2,1 WHERE $3=0 ON CONFLICT(id) DO NOTHING RETURNING revision`,[q.id,JSON.stringify(q),v.baseRevision]);if(r.rows.length)return json(r.rows[0]);const updated=await pool.query('UPDATE resolute.risk_quotes SET value=$2,revision=revision+1 WHERE id=$1 AND revision=$3 RETURNING revision',[q.id,JSON.stringify(q),v.baseRevision]);return json(updated.rows[0]??{error:'CONFLICT'},updated.rows.length?200:409);}
 if(v.action==='paste'){if(typeof v.text!=='string'||v.text.length<20||v.text.length>12000||typeof v.title!=='string'||v.title.length<1||v.title.length>200)throw Error('INVALID_INPUT');const u=new URL(v.url);if(u.protocol!=='https:'||u.username||u.password||u.href.length>2048)throw Error('INVALID_INPUT');const date=new Date(v.publishedAt);if(!Number.isFinite(date.getTime())||date.getTime()>Date.now()+300000||date.getTime()<Date.now()-7*86400000)throw Error('INVALID_INPUT');const id=hash(u.href);await pool.query(`INSERT INTO resolute.risk_candidates(id,url,title,body,published_at,source_kind,fingerprint,manual) VALUES($1,$2,$3,$4,$5,'sns',$6,true) ON CONFLICT(id) DO NOTHING`,[id,u.href,v.title,v.text,date.toISOString(),hash(v.title.normalize('NFKC').replace(/\s/g,''))]);return json({ok:true,id});}
 return json({error:'INVALID_INPUT'},400);
}
export async function publicRiskFeed(pool,owner=false,now=new Date()){
 const enabled=(await pool.query('SELECT enabled FROM resolute.risk_control WHERE id')).rows[0]?.enabled;
 if(!owner&&(!enabled||process.env.RESOLUTE_RISK_PUBLISH_APPROVED!=='true'))return{state:'stopped',date:null,articles:[],quotes:[]};
 const day=latestRiskDate(now),row=(await pool.query('SELECT state,articles FROM resolute.risk_days WHERE day=$1',[day])).rows[0];
 if(!row||row.state!=='ready')return{state:'failed',date:day,articles:[],quotes:[]};
 const hidden=new Set((await pool.query('SELECT article_id FROM resolute.risk_hidden')).rows.map(r=>r.article_id));
 const articles=row.articles.map(parseRiskArticle).filter(a=>!hidden.has(a.id));
 // An editor hiding every story is not proof that there was no relevant news.
 if(row.articles.length&&!articles.length)return{state:'stopped',date:day,articles:[],quotes:[]};
 const quotes=(await pool.query('SELECT value FROM resolute.risk_quotes')).rows.map(r=>parseQuote(r.value)).filter(q=>q.approved);
 return parseRiskFeed({state:'ready',date:day,articles,quotes});
}
