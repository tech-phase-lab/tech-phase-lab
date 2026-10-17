import {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {isOwnerAccount} from '../../lib/membership/entitlements.ts';
import {boundedJSON} from './risk-store.mjs';
let db;
export function rizelPool(){
 if(!db){const config=resoluteDatabaseConfig(process.env.RESOLUTE_RIZEL_DB_URL);
  if(new URL(config.connectionString).username!=='resolute_rizel_writer')throw Error('Scoped RIZEL role required');
  db=new Pool({...config,max:2});db.on('error',()=>{});}
 return db;
}
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
export async function readApprovedBank(pool){
 const {rows}=await pool.query(`SELECT DISTINCT ON(id,locale) id,locale,revision,value FROM resolute_rizel_copy_versions WHERE approval='approved' ORDER BY id,locale,revision DESC`);
 const ja=rows.filter(r=>r.locale==='ja');
 return ja.flatMap(r=>{const en=rows.find(e=>e.id===r.id&&e.locale==='en');return en?[{...r.value,id:r.id,revision:r.revision,approval:'approved',publication:'withheld',english:{...en.value,revision:en.revision,approval:'approved',publication:'withheld'}}]:[];});
}
export async function rizelReviewRequest(request,userId,_read,pool){
 if(!isOwnerAccount(userId))return json({error:'FORBIDDEN'},403);
 pool??=rizelPool();
 if(request.method==='GET'){
  const rows=await pool.query(`SELECT s.article_id,s.article_revision,s.created_at,jsonb_build_object('copy',s.result->'copy','audit',jsonb_build_object('article',s.result->'audit'->'article')) AS result,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('locale',r.locale,'state',r.state,'revision',r.revision)) FROM resolute_rizel_reviews r WHERE r.article_id=s.article_id AND r.article_revision=s.article_revision),'[]'::jsonb) AS reviews
   FROM resolute_rizel_selections s WHERE NOT EXISTS (SELECT 1 FROM resolute_rizel_selections n WHERE n.article_id=s.article_id AND n.created_at>s.created_at) ORDER BY s.created_at DESC LIMIT 30`);
  const count=await pool.query(`SELECT count(*)::int AS count FROM resolute_rizel_reviews r JOIN resolute_rizel_selections s USING(article_id,article_revision) WHERE r.state='pending' AND NOT EXISTS(SELECT 1 FROM resolute_rizel_selections n WHERE n.article_id=s.article_id AND n.created_at>s.created_at)`);
  return json({mode:'manual',publication:'withheld',pending:count.rows[0].count,articles:rows.rows,
   copies:await readApprovedBank(pool)});
 }
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 const v=await boundedJSON(request,40000);
 if(!['ja','en'].includes(v.locale)||!Number.isInteger(v.baseRevision)||v.baseRevision<0)return json({error:'INVALID_INPUT'},400);
 if(v.action==='approve-copy'){
  if(typeof v.id!=='string'||!/^[A-D]-[a-z-]+-\d{2}$/.test(v.id)||v.id==='D-executive-03'||typeof v.text!=='string'||!v.text.trim()||v.text.length>1000)return json({error:'INVALID_INPUT'},400);
  const c=await pool.connect();try{
   await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(70773191)');
   const old=(await c.query('SELECT value,revision FROM resolute_rizel_copy_versions WHERE id=$1 AND locale=$2 ORDER BY revision DESC LIMIT 1',[v.id,v.locale])).rows[0];
   if(!old||old.revision!==v.baseRevision){await c.query('ROLLBACK');return json({error:'CONFLICT'},409);}
   const value={...old.value,text:v.text,textSha256:createHash('sha256').update(v.text).digest('hex')};
   await c.query(`INSERT INTO resolute_rizel_copy_versions(id,locale,revision,value,approval,approved_by,approved_at) VALUES($1,$2,$3,$4,'approved',$5,now())`,[v.id,v.locale,v.baseRevision+1,JSON.stringify(value),userId]);
   await c.query('COMMIT');return json({ok:true,publication:'withheld'});
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 if(v.action!=='review'||!['approved','rejected'].includes(v.decision)||typeof v.articleId!=='string'||typeof v.articleRevision!=='string'||v.articleId.length>200||v.articleRevision.length>200)return json({error:'INVALID_INPUT'},400);
 const c=await pool.connect();try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(70773190)');
  const selected=(await c.query('SELECT result FROM resolute_rizel_selections WHERE article_id=$1 AND article_revision=$2',[v.articleId,v.articleRevision])).rows[0];
  if(!selected?.result?.copy?.length){await c.query('ROLLBACK');return json({error:'NO_SELECTION'},409);}
  // A newer revision must be reviewed independently; old approval cannot leak forward.
  const newer=(await c.query('SELECT 1 FROM resolute_rizel_selections WHERE article_id=$1 AND created_at>(SELECT created_at FROM resolute_rizel_selections WHERE article_id=$1 AND article_revision=$2) LIMIT 1',[v.articleId,v.articleRevision])).rows.length;
  if(newer){await c.query('ROLLBACK');return json({error:'STALE_ARTICLE'},409);}
  const r=await c.query(`UPDATE resolute_rizel_reviews SET state=$4,reviewer=$5,reviewed_at=now(),revision=revision+1 WHERE article_id=$1 AND article_revision=$2 AND locale=$3 AND revision=$6 RETURNING revision`,[v.articleId,v.articleRevision,v.locale,v.decision,userId,v.baseRevision]);
  if(!r.rows.length){await c.query('ROLLBACK');return json({error:'CONFLICT'},409);}
  await c.query(`INSERT INTO resolute_rizel_review_events(article_id,article_revision,locale,decision,reviewer) VALUES($1,$2,$3,$4,$5)`,[v.articleId,v.articleRevision,v.locale,v.decision,userId]);
  await c.query('COMMIT');return json({ok:true,publication:'withheld'});
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
