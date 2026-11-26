import {PRODUCTION_OWNER_ACCOUNT_ID} from '../../lib/membership/entitlements.ts';
import {parseRiskArticle,readingParts,isShownStory,byStars} from '../../lib/resolute/risk.ts';

/** The owner's morning mail (owner, Nov 26): at 08:20 JST on each market day, right after the daily selection, the production
 * owner account receives the day's Shock Gauge in plain Japanese: each story, its ★ and the AI's reason, the index lines exactly
 * as the card shows them, the リゼルの一言, and whether the numeric fallback was used. Off unless RESOLUTE_SHOCK_OWNER_MAIL_ENABLED
 * is 'true'. The address is looked up through Clerk at send time (never stored); Resend sends it (RESOLUTE_RESEND_API_KEY,
 * RESOLUTE_MAIL_FROM, as the other mail). One mail per day: Resend's idempotency key is the day. */
const EMAIL=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
export function ownerShockMailText({day,articles,quotes,fallback}){
 const shown=byStars(articles.filter(isShownStory));
 const lines=[`衝撃度チェッカー ${day}`,''];
 if(!shown.length)lines.push('今日は、★をつけるニュースはありませんでした。会員には「今日は、気にするニュースはありません」と表示されます。','');
 shown.forEach((a,i)=>{
  const q=a.quoteId?quotes.find(x=>x.id===a.quoteId):null;
  lines.push(`${i+1}. ${a.ja.title}`,`★${a.stars}（${'★'.repeat(a.stars)}${'☆'.repeat(5-a.stars)}）`);
  if(a.judge)lines.push(`選んだ理由: ${a.judge.reason.ja}`);
  lines.push('使った数字:');for(const l of readingParts(a.market,'ja'))lines.push(`  ${l.text}`);
  lines.push(`リゼルの一言: ${q?q.ja.title:'なし'}`,'');
 });
 lines.push('★は、終値の動きと取引中のいちばん大きな動きのうち大きいほうを決まった表に当てはめて付けています。AIは★を変えません。',fallback?'※ 今日はAIによるニュースの選定に失敗したため、★の多い順に選びました。':'載せるニュースは、AIがその日の市場のまとめ記事とニュースを読んで選びました。');
 return lines.join('\n');
}
/** Reads the stored day and sends the mail. Returns a fixed-code state; never throws the address or the provider's text. */
export async function sendOwnerShockMail({env=process.env,pool,day,clerk,fetcher=fetch}){
 if(env.RESOLUTE_SHOCK_OWNER_MAIL_ENABLED!=='true')return {state:'off'};
 const apiKey=env.RESOLUTE_RESEND_API_KEY??'',from=env.RESOLUTE_MAIL_FROM??'';
 if(!/^re_[A-Za-z0-9_-]{10,200}$/.test(apiKey)||!EMAIL.test(from)||!clerk)return {state:'not-configured'};
 const row=(await pool.query("SELECT state,articles FROM resolute.risk_days WHERE day=$1::date",[day])).rows[0];
 if(row?.state!=='ready'||!Array.isArray(row.articles))return {state:'no-ready-day'};
 const articles=row.articles.map(parseRiskArticle),quotes=(await pool.query('SELECT value FROM resolute.risk_quotes')).rows.map(r=>r.value).filter(q=>q?.approved===true);
 const user=await clerk.users.getUser(PRODUCTION_OWNER_ACCOUNT_ID);
 const to=user?.primaryEmailAddress?.emailAddress??user?.emailAddresses?.find(e=>e.id===user.primaryEmailAddressId)?.emailAddress;
 if(typeof to!=='string'||!EMAIL.test(to))return {state:'no-owner-address'};
 const fallback=articles.some(a=>a.judge?.source==='rule');
 const response=await fetcher('https://api.resend.com/emails',{method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':'resolute-shock-owner-'+day},
  body:JSON.stringify({from,to:[to],subject:`衝撃度チェッカー ${day}${fallback?'（AIの選定なし）':''}`,text:ownerShockMailText({day,articles,quotes,fallback}),tags:[{name:'resolute_shock_owner',value:day}]})});
 if(!response.ok){await response.body?.cancel();return {state:'provider-error',status:response.status};}
 await response.body?.cancel();
 return {state:'sent',stories:articles.filter(isShownStory).length,fallback};
}
