import { createHash, timingSafeEqual } from 'node:crypto';
export const table = 'public.tech_phase_financial_radar';
export const columns = ['genre','ticker','ocf_margin','cover','revenue_growth','revenue_usd','period_end','previous_ocf_margin','previous_cover','needs_review','calculated_at','fcf_margin','basis','previous_period_end'];
export const upsert = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_,i)=>`$${i+1}`).join(',')}) ON CONFLICT (genre,ticker) DO UPDATE SET ${columns.slice(2).map(c=>`${c}=EXCLUDED.${c}`).join(',')} WHERE EXCLUDED.calculated_at > tech_phase_financial_radar.calculated_at RETURNING ticker`;
const genreOK = x => typeof x === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(x);
const tickerOK = x => typeof x === 'string' && /^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(x);
const numberOK = x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1e20;
const dateOK = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,10) === x;
export function validate(row, now = Date.now()) {
  if (!row || Array.isArray(row) || typeof row !== 'object' || Object.keys(row).some(k=>!columns.includes(k))) return false;
  if (!genreOK(row.genre) || !tickerOK(row.ticker)) return false;
  if (!['ocf_margin','cover','revenue_usd'].every(k=>numberOK(row[k])) || row.cover < 0 || row.revenue_usd < 0) return false;
  if (!['revenue_growth','previous_ocf_margin','previous_cover','fcf_margin'].every(k=>row[k] === null || numberOK(row[k]))) return false;
  if ((row.previous_ocf_margin === null) !== (row.previous_cover === null) || (row.previous_cover !== null && row.previous_cover < 0)) return false;
  if (!dateOK(row.period_end) || !(row.previous_period_end === null || dateOK(row.previous_period_end))) return false;
  if (typeof row.needs_review !== 'boolean' || !['annual','ttm',null].includes(row.basis)) return false;
  return typeof row.calculated_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(row.calculated_at) && Number.isFinite(Date.parse(row.calculated_at)) && Date.parse(row.calculated_at) > 0 && Date.parse(row.calculated_at) <= now + 300000;
}
export function tokens(env) {
  const write = env.TECH_PHASE_RADAR_WRITE_TOKEN, read = env.TECH_PHASE_RADAR_READ_TOKEN;
  if (![write,read].every(v=>typeof v==='string' && /^[A-Za-z0-9_-]{32,256}$/.test(v)) || write === read) throw Error('RADAR_AUTH_CONFIG_INVALID');
  return { write, read };
}
export function authorized(header, token) {
  if (typeof header !== 'string' || header.length > 300 || !header.startsWith('Bearer ')) return false;
  const digest = x=>createHash('sha256').update(x).digest();
  return timingSafeEqual(digest(header.slice(7)),digest(token));
}
export function databaseConfig(env, provision = false) {
  const expected=env.TECH_PHASE_RADAR_DATABASE_NAME;
  if (!expected || !/^[A-Za-z0-9_-]{1,63}$/.test(expected)) throw Error('RADAR_DATABASE_NAME_REQUIRED');
  const url=new URL(env[provision?'TECH_PHASE_RADAR_PROVISION_DATABASE_URL':'TECH_PHASE_RADAR_DATABASE_URL'] ?? '');
  if (!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname || !url.password || url.hash || decodeURIComponent(url.pathname)!=='/'+expected || [...url.searchParams].some(([k,v])=>k!=='sslmode'||v!=='verify-full')) throw Error('RADAR_DATABASE_INVALID');
  if (!provision && decodeURIComponent(url.username)!=='tech_phase_radar_writer') throw Error('RADAR_ROLE_INVALID');
  const internal=url.hostname.endsWith('.railway.internal');
  const tls=!internal || url.searchParams.has('sslmode'); url.search='';
  return {connectionString:url.href,ssl:tls?{rejectUnauthorized:true}:false,max:3,connectionTimeoutMillis:3000,idleTimeoutMillis:10000,statement_timeout:5000,query_timeout:6000,application_name:'tech-phase-financial-radar'};
}
function json(res,status,body) {res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));}
export function handler(pool, auth, {now=Date.now, log=()=>{}}={}) {
  return async (req,res)=>{
    try {
      const url=new URL(req.url,'http://radar.internal');
      if (url.pathname==='/livez' && req.method==='GET') return json(res,200,{ok:true});
      if (url.pathname!=='/v1/financial-radar') return json(res,404,{error:'not_found'});
      if (!['GET','POST'].includes(req.method)) return json(res,405,{error:'method_not_allowed'});
      if (!authorized(req.headers.authorization,req.method==='POST'?auth.write:auth.read)) return json(res,401,{error:'unauthorized'});
      if (req.headers.origin) return json(res,403,{error:'server_only'});
      if(req.method==='GET') {
        const genre=url.searchParams.get('genre'), ticker=url.searchParams.get('ticker');
        if(!genreOK(genre) || (ticker!==null && !tickerOK(ticker)) || [...url.searchParams.keys()].some(k=>!['genre','ticker'].includes(k)) || url.searchParams.getAll('genre').length!==1 || url.searchParams.getAll('ticker').length>1) return json(res,400,{error:'invalid_query'});
        // Cast numeric columns for pg (which otherwise returns NUMERIC as strings).
        const numeric=['ocf_margin','cover','revenue_growth','revenue_usd','previous_ocf_margin','previous_cover','fcf_margin'];
        const selected=columns.map(c=>numeric.includes(c)?`${c}::double precision AS ${c}`:c.endsWith('period_end')?`to_char(${c},'YYYY-MM-DD') AS ${c}`:c).join(',');
        const result=await pool.query(`SELECT ${selected} FROM ${table} WHERE genre=$1${ticker?' AND ticker=$2':''} ORDER BY ticker LIMIT 100`,ticker?[genre,ticker]:[genre]);
        return json(res,200,{ok:true,items:result.rows});
      }
      if(url.search) return json(res,400,{error:'invalid_query'});
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')) return json(res,415,{error:'json_required'});
      if(req.headers['content-encoding'] || Number(req.headers['content-length']??0)>16384) return json(res,413,{error:'body_too_large'});
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>16384)return json(res,413,{error:'body_too_large'});chunks.push(chunk);}
      let row;try{row=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return json(res,400,{error:'invalid_json'});}
      if(!validate(row,now()))return json(res,400,{error:'invalid_result'});
      const result=await pool.query(upsert,columns.map(c=>row[c]));
      return json(res,200,{ok:true,saved:result.rows.length===1});
    }catch{log('RADAR_REQUEST_FAILED');if(!res.headersSent)json(res,503,{error:'unavailable'});else res.end();}
  };
}
