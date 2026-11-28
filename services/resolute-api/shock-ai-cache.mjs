import {hash} from './risk-store.mjs';
/** Per-article AI results of the Shock Gauge candidates (Nov 28, AI cost): the summary (or why it was withheld), the Japanese headline
 * and the ranking, kept in resolute.shock_candidates.ai_cache (migration 031) of the day they were paid for, so the 06:30 run after a
 * failed 06:00 run, the 08:20 fallback build and the next day's runs never pay twice for the same article. An entry is used only for
 * the same article text (content key). Summaries and headlines are reused for CACHE_DAYS days; a ranking only on its own day (its
 * order is relative to that day's stories). Without the column (migration not applied) the cache lives for one run only. */
export const CACHE_DAYS=3;
export const CACHE_KINDS=Object.freeze(['summary','title','rank']);
export const contentKey=c=>hash(`${c.title}\n${c.body??''}`).slice(0,16);
const KEY=/^(summary|title|rank):[a-f0-9]{64}$/;
export function aiCache({pool=null,day=null,entries={}}={}){
 const own=new Map(),pending=new Map();let persist=!!(pool&&day);
 for(const [k,e] of Object.entries(entries&&typeof entries==='object'?entries:{}))if(KEY.test(k)&&e&&typeof e==='object'&&typeof e.h==='string'&&e.v!==undefined)own.set(k,e);
 const stats={summary:0,title:0,rank:0,stored:0};
 return {
  stats,
  /** The cached value for this article (undefined when none, or the article's text changed, or a ranking of another day). */
  get(kind,c){
   const e=own.get(`${kind}:${c.id}`);if(!e||e.h!==contentKey(c)||kind==='rank'&&e.d!==day)return undefined;
   stats[kind]++;return e.v;
  },
  put(kind,c,v){if(!CACHE_KINDS.includes(kind))return;const k=`${kind}:${c.id}`,e={h:contentKey(c),d:day,v};own.set(k,e);pending.set(k,e);},
  /** Stores what was added since the last flush (one UPDATE). Never throws: a failed write only ends the persistence. */
  async flush(){
   if(!persist||!pending.size)return;
   const batch=Object.fromEntries(pending);pending.clear();
   try{await pool.query("UPDATE resolute.shock_candidates SET ai_cache=COALESCE(ai_cache,'{}'::jsonb)||$2::jsonb WHERE day=$1::date",[day,JSON.stringify(batch)]);stats.stored+=Object.keys(batch).length;}
   catch{persist=false;}
  },
 };
}
/** The cache of `day` (JST): the entries stored on that day and the CACHE_DAYS-1 days before (the newest wins). Never throws. */
export async function loadAiCache(pool,day){
 let rows=null;
 try{rows=(await pool.query(`SELECT day::text AS day,ai_cache FROM resolute.shock_candidates WHERE day BETWEEN $1::date-${CACHE_DAYS-1} AND $1::date ORDER BY day`,[day])).rows;}
 catch{return aiCache({day});}
 const entries={};
 for(const r of Array.isArray(rows)?rows:[])if(r&&typeof r.ai_cache==='object'&&r.ai_cache&&!Array.isArray(r.ai_cache))Object.assign(entries,r.ai_cache);
 return aiCache({pool,day,entries});
}
