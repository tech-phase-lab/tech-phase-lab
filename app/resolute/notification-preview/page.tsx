import {auth} from '@clerk/nextjs/server';
import {membershipConfigured} from '@/lib/membership/server';
import {isOwnerAccount} from '@/lib/membership/entitlements';
import {renderAlertMail,renderNextMorningMail,type Locale} from '@/lib/resolute/mail-templates';
import {templateNote,withMorningNote,withProviderCredit} from '@/lib/resolute/morning-note';
import type {AlertEvent} from '@/lib/resolute/alert-judge';
export const dynamic='force-dynamic';
export const metadata={title:'RESOLUTE | Notification preview (owner)',robots:{index:false,follow:false}};

// オーナー専用。実際に配信されるメールと同じ関数で、サンプルの数字から組み立てた見た目を表示する。
// 何も送らず、DB・価格提供元・メール事業者にも触れない。数字は例であり、会員のデータではない。
const sample:AlertEvent[]=[
 {kind:'line_reached',symbol:'NVDA',date:'2027-02-03',close:162.0,referencePrice:180,dropPct:10,newLines:[10]},
 {kind:'surge_cap',symbol:'AMD',date:'2027-02-03',close:150,referencePrice:100,risePct:50},
];
const links={planUrl:'https://techphase.app/resolute',unsubscribeUrl:'https://techphase.app/resolute/unsubscribe?t=(署名付き)'};
function mails(locale:Locale){
 const alert=withProviderCredit(renderAlertMail({locale,date:'2027-02-03',items:sample,...links}),locale);
 const morning=withMorningNote(renderNextMorningMail({locale,...links,doneUrl:'https://techphase.app/resolute/morning#done',skippedUrl:'https://techphase.app/resolute/morning#skipped',unsureUrl:'https://techphase.app/resolute/morning#unsure'}),templateNote(sample,locale));
 const empty=withMorningNote(renderNextMorningMail({locale,...links,doneUrl:'-',skippedUrl:'-',unsureUrl:'-'}),templateNote([],locale));
 return {alert,morning,empty};
}
function Mail({title,mail}:{title:string;mail:{subject:string;text:string}}){
 return <section style={{border:'1px solid #8884',borderRadius:12,padding:16,margin:'16px 0'}}>
  <h3 style={{margin:'0 0 8px'}}>{title}</h3>
  <p style={{margin:'0 0 8px'}}><b>件名:</b> {mail.subject}</p>
  <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',margin:0,font:'inherit',lineHeight:1.7}}>{mail.text}</pre>
 </section>;
}
export default async function Page(){
 if(!membershipConfigured())return <p>ログインを確認できません</p>;
 const {userId}=await auth();
 if(!isOwnerAccount(userId))return <p>オーナー専用です <a href="/research/account">ログイン</a></p>;
 const ja=mails('ja'),en=mails('en');
 return <main style={{maxWidth:720,margin:'0 auto',padding:'24px 16px'}}>
  <h1>通知メールの見た目(オーナー用)</h1>
  <p>サンプルの数字で組み立てた表示です。このページは何も送りません。配信は、オーナーの承認があるまで動きません。数字(NVDA・AMD)は例で、会員のデータではありません。</p>
  <h2>終値アラート(日本語)</h2><Mail title="終値アラート" mail={ja.alert}/>
  <h2>翌朝のひとこと(日本語)</h2>
  <Mail title="ひとことあり(アラートの内容から作成)" mail={ja.morning}/>
  <Mail title="材料がないときの定型文" mail={ja.empty}/>
  <h2>Closing-price alert (English)</h2><Mail title="Alert" mail={en.alert}/>
  <h2>Morning note (English)</h2>
  <Mail title="With a note built from the alert" mail={en.morning}/>
  <Mail title="Fixed fallback when there are no facts" mail={en.empty}/>
 </main>;
}
