import {PRODUCTION_OWNER_ACCOUNT_ID} from '../../lib/membership/entitlements.ts';
import {parseRiskArticle,readingParts,isShownStory,byStars,SUMMARY_QUESTION} from '../../lib/resolute/risk.ts';

/** The owner's morning mail (owner, Nov 26): at 08:20 JST on each market day, right after the daily selection, the production
 * owner account receives the day's Shock Gauge in plain Japanese: each story, its ★ and the AI's reason, the index lines exactly
 * as the card shows them, the リゼルの一言, and whether the numeric fallback was used. Off unless RESOLUTE_SHOCK_OWNER_MAIL_ENABLED
 * is 'true'. The address is looked up through Clerk at send time (never stored); Resend sends it (RESOLUTE_RESEND_API_KEY,
 * RESOLUTE_MAIL_FROM, as the other mail). One mail per day: Resend's idempotency key is the day. */
const EMAIL=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
/** Why a story's summary was withheld, in plain Japanese (owner, Nov 27), by the worker's fixed reason code. */
export const WITHHELD_REASON_JA=Object.freeze({
 'not-publishable':'要約なし：元の記事の本文が短く、事実だけで書けなかったため',
 'new-number':'要約なし：元の記事にない数字が入り、書き直しても直らなかったため',
 'japanese-amount':'要約なし：金額を日本語の単位に正しく直せなかったため',
 'banned-wording':'要約なし：使えない言い回しが残り、書き直しても直らなかったため',
 shape:'要約なし：要約の形が決まりに合わなかったため',
 unknown:'要約なし：要約を確かめられなかったため',
});
/** The summary as the card shows it, without the fixed closing question. */
const summaryOf=a=>{const q=SUMMARY_QUESTION.ja,t=a.ja.content.trim();return (t.endsWith(q)?t.slice(0,-q.length):t).trim();};
export function ownerShockMailText({day,articles,quotes,fallback,withheld=[]}){
 const shown=byStars(articles.filter(isShownStory));
 const lines=[`衝撃度チェッカー ${day}`,''];
 if(!shown.length)lines.push('今日は、★をつけるニュースはありませんでした。会員には「今日は、気にするニュースはありません」と表示されます。','');
 shown.forEach((a,i)=>{
  const q=a.quoteId?quotes.find(x=>x.id===a.quoteId):null;
  lines.push(`${i+1}. ${a.ja.title}`);
  // The summary under the title (owner, Nov 27), or why there is none.
  const summary=summaryOf(a);lines.push(summary?`要約: ${summary.replace(/\s*\n\s*/g,' ')}`:WITHHELD_REASON_JA.unknown);
  lines.push(`★${a.stars}（${'★'.repeat(a.stars)}${'☆'.repeat(5-a.stars)}）`);
  if(a.pick)lines.push(a.pick.source==='owner'?'選んだ人: オーナー（★もオーナーが決めました）':'選んだ人: AI（期限までに返事がなかったため、おすすめの★で公開しました）');
  if(a.judge)lines.push(`${a.pick?'AIのおすすめの理由':'選んだ理由'}: ${a.judge.reason.ja}`);
  lines.push('使った数字:');for(const l of readingParts(a.market,'ja'))lines.push(`  ${l.text}`);
  lines.push(`リゼルの一言: ${q?q.ja.title:a.rizel?.ja??'なし'}`,...(q?q.ja.reasons:a.rizel?.reasons?.ja??[]).slice(0,3).map(t=>`  ・${t}`),'');
 });
 // Stories the AI picked whose summary was withheld (not shown to members), each with the reason in plain Japanese.
 const skipped=withheld.filter(w=>w&&typeof w.title==='string'&&w.title.trim()).slice(0,10);
 if(skipped.length){lines.push('要約できず、載せなかったニュース:');for(const w of skipped)lines.push(`・${w.title.trim().slice(0,200)}`,`  ${WITHHELD_REASON_JA[w.reason]??WITHHELD_REASON_JA.unknown}`);lines.push('');}
 // On a day the owner picked, the ★ are the owner's: the table sentence is left out (owner, Nov 27; owner-only mail).
 const ownerDay=shown.some(a=>a.pick?.source==='owner');
 if(!ownerDay)lines.push('★は、終値の動きと取引中のいちばん大きな動きのうち大きいほうを決まった表に当てはめて付けています。AIは★を変えません。');
 lines.push(shown.some(a=>a.pick?.source==='owner')?'載せるニュースと★は、オーナーが選びました。':shown.some(a=>a.pick)?'期限までにオーナーの返事がなかったため、AIのおすすめのニュースと★で公開しました。':fallback?'※ 今日はAIによるニュースの選定に失敗したため、★の多い順に選びました。':'載せるニュースは、AIがその日の市場のまとめ記事とニュースを読んで選びました。');
 return lines.join('\n');
}
/** One mail to the production owner (Clerk lookup at send time, Resend; off unless RESOLUTE_SHOCK_OWNER_MAIL_ENABLED is 'true').
 * `key` is Resend's idempotency key (one mail per key). Returns a fixed-code state; never the address or the provider's text. */
export async function sendOwnerMail({env=process.env,clerk,fetcher=fetch,subject,text,key,tag}){
 if(env.RESOLUTE_SHOCK_OWNER_MAIL_ENABLED!=='true')return {state:'off'};
 const apiKey=env.RESOLUTE_RESEND_API_KEY??'',from=env.RESOLUTE_MAIL_FROM??'';
 if(!/^re_[A-Za-z0-9_-]{10,200}$/.test(apiKey)||!EMAIL.test(from)||!clerk)return {state:'not-configured'};
 const user=await clerk.users.getUser(PRODUCTION_OWNER_ACCOUNT_ID);
 const to=user?.primaryEmailAddress?.emailAddress??user?.emailAddresses?.find(e=>e.id===user.primaryEmailAddressId)?.emailAddress;
 if(typeof to!=='string'||!EMAIL.test(to))return {state:'no-owner-address'};
 const response=await fetcher('https://api.resend.com/emails',{method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),
  headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':key},
  body:JSON.stringify({from,to:[to],subject,text,tags:[{name:'resolute_shock_owner',value:tag}]})});
 await response.body?.cancel();
 return response.ok?{state:'sent'}:{state:'provider-error',status:response.status};
}
/** Reads the stored day and sends the mail. Returns a fixed-code state; never throws the address or the provider's text. */
export async function sendOwnerShockMail({env=process.env,pool,day,clerk,fetcher=fetch,withheld=[]}){
 if(env.RESOLUTE_SHOCK_OWNER_MAIL_ENABLED!=='true')return {state:'off'};
 const apiKey=env.RESOLUTE_RESEND_API_KEY??'',from=env.RESOLUTE_MAIL_FROM??'';
 if(!/^re_[A-Za-z0-9_-]{10,200}$/.test(apiKey)||!EMAIL.test(from)||!clerk)return {state:'not-configured'};
 const row=(await pool.query("SELECT state,articles FROM resolute.risk_days WHERE day=$1::date",[day])).rows[0];
 if(row?.state!=='ready'||!Array.isArray(row.articles))return {state:'no-ready-day'};
 const articles=row.articles.map(parseRiskArticle),quotes=(await pool.query('SELECT value FROM resolute.risk_quotes')).rows.map(r=>r.value).filter(q=>q?.approved===true);
 const fallback=articles.some(a=>a.judge?.source==='rule'&&!a.pick);
 const sent=await sendOwnerMail({env,clerk,fetcher,subject:`衝撃度チェッカー ${day}${fallback?'（AIの選定なし）':''}`,text:ownerShockMailText({day,articles,quotes,fallback,withheld}),key:'resolute-shock-owner-'+day,tag:day});
 return sent.state==='sent'?{state:'sent',stories:articles.filter(isShownStory).length,fallback}:sent;
}
