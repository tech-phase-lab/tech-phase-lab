"use client";
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {useDesktop} from '../use-desktop';
import ToolShell from '../tool-shell';
import {RISK_PREVIEW_DETAILS} from '@/lib/resolute/risk-preview';
import {ReviewLink as Link,useReview} from '../review-context';
import {useRisk,riskStatus} from '../features/use-risk';
import {riskAction,parseQuote,type RizelQuote} from '@/lib/resolute/risk';
import {ShockGaugeTitle,ShockStars,StarInfo,STAR_COLORS} from '../features/shock-gauge';
import {RISK_POLICY} from '@/lib/resolute/risk-policy';
import {FirstLineMeter,useFirstLine} from './first-line-meter';
import {renewalHref} from '@/lib/resolute/renewal-link';
import s from './reference.module.css';
export default function NewsScreen({identityReady=true}:{identityReady?:boolean}){return <ToolShell identityReady={identityReady}>{locale=><News locale={locale}/>}</ToolShell>;}
function News({locale}:{locale:'ja'|'en'}){const en=locale==='en',live=useRisk(),review=useReview(),feed=live.feed,status=live.status,[selected,setSelected]=useState('');
 // A PC has no detail page: the home opens each story under its cards (owner, Nov 25). The owner preview keeps this page.
 const desktop=useDesktop(),router=useRouter();
 useEffect(()=>{if(desktop&&!review)router.replace('/resolute#shock-gauge');},[desktop,review,router]);
 // Expired access (the feed answers 403) gets the same renewal link as the account screen, not a dead end.
 const sample=!!review&&review.scenario!=='live',locked=review?.scenario==='expired'||!review&&status==='denied';
 const article=feed?.articles.find(a=>a.id===selected)??feed?.articles[0],copy=article?.[locale],high=article?riskAction(article.stars)==='review':false;
 // 最初のラインまで: the member's own first purchase level and the shared price copy; left out entirely until all of it is real.
 const firstLine=useFirstLine(!sample&&!locked&&!!article);
 const [privateQuote,setPrivateQuote]=useState<{stars:number;quote:RizelQuote}|null>(null),[previewError,setPreviewError]=useState(false);
 const previewStars=review?.showRizel&&!locked&&article?article.stars:null;
 useEffect(()=>{if(previewStars===null)return;const c=new AbortController();void fetch(`/api/resolute/rizel-preview?stars=${previewStars}`,{cache:'no-store',signal:c.signal}).then(async r=>{if(!r.ok)throw Error();const q=parseQuote((await r.json()).quote);if(!c.signal.aborted){setPrivateQuote({stars:previewStars,quote:q});setPreviewError(false);}}).catch(()=>{if(!c.signal.aborted){setPrivateQuote(null);setPreviewError(true);}});return()=>c.abort();},[previewStars]);
 // The owner's private preview supplies its own copy. Otherwise the line is the approved quote the feed assigned to this story;
 // the frontend proxy only passes approved quotes to members once RESOLUTE_RIZEL_LINE_PUBLISHED is on (owner accounts always).
 const preview=previewStars!==null&&privateQuote?.stars===previewStars?privateQuote.quote:undefined;
 const assigned=!sample&&!locked&&article?.quoteId?feed?.quotes.find(q=>q.id===article.quoteId&&q.approved):undefined;
 const quote=preview??assigned;

 return <div className={s.root}><div className={s.wrap}>{review?<div className={s.rfoot}><p>{en?'Display test. Ratings and access are simulated. This is not an automatic news update.':'表示確認用です。★・利用期限はテスト状態で、自動更新ではありません。'}</p></div>:null}<div className={s.brand}>RESOLUTE</div><h1><ShockGaugeTitle locale={locale} compact center/></h1><p className={s.lead}>{en?'Put unsettling news in perspective with facts and your own rules.':'気になるニュースを、事実とあなたのルールで整理します。'}</p>{feed?.date?<div className={s.date}>{new Intl.DateTimeFormat(en?'en-US':'ja-JP',{dateStyle:'long',timeZone:'UTC'}).format(new Date(feed.date+'T12:00:00Z'))}{review&&review.scenario!=='live'?<small> · {en?'Display sample':'表示見本'}</small>:null}</div>:null}
 {locked?<div className={s.card}><p>🔒 {en?'Renew to use the Shock Gauge.':'衝撃度チェッカーを使うには更新が必要です。'}</p><Link className={s.renew} href={renewalHref(locale)}>{en?'Renew for one year':'1年分を更新する'}</Link></div>:article&&copy?<><div className={s.tabs} role="tablist" aria-label={en?'News':'ニュース'}>{feed!.articles.map((a,i)=><button className={s.tab} role="tab" key={a.id} aria-selected={a.id===article.id} aria-controls="risk-panel" onClick={()=>setSelected(a.id)}>{review&&sample?RISK_PREVIEW_DETAILS[a.id]?.[locale]??`${en?'News':'ニュース'} ${i+1}`:`${en?'News':'ニュース'} ${i+1}`}</button>)}</div><div id="risk-panel" role="tabpanel" className={s.card}><div className={s.eyebrow}>NEWS</div><h2 className={s.head}>{copy.title}</h2><div className={s.risk}><span className={s.k}>{en?'Shock':'衝撃度'}<StarInfo locale={locale}/></span><ShockStars article={article} locale={locale} className={s.s} starStyle={article.stars?{color:STAR_COLORS[article.stars]}:undefined} wide/></div><dl className={s.kv}>{[[en?'Source':'出どころ',copy.source],[en?'What happened':'内容',copy.content],[en?'Date':'日付',copy.date]].map(([k,v])=><div key={k}><dt>{k}</dt><dd style={{whiteSpace:'pre-line'}}>{v}</dd></div>)}</dl>{sample?<div className={s.meter}><div className={s.t}><span>{en?'Until your first price level':'最初のラインまで'}</span><b>{en?'20% away':'あと20%'}</b></div><div className={s.track} aria-hidden="true"><i style={{width:'40%'}}/><u style={{left:'40%'}}/></div><div className={s.scale}><span>{en?'Current price $100':'現在 $100'}</span><span>{en?'First level $80':'最初のライン $80'}</span></div><small className={s.rnote}>{en?'Display sample · fictional prices':'表示見本・価格は架空の数値です'}</small></div>:firstLine?<FirstLineMeter view={firstLine} locale={locale}/>:null}<div className={s.today}><div className={s.k}>{en?'What to do today':'今日やること'}</div><div className={s.v} style={high||sample?{fontSize:26}:undefined}>{high?<Link href="/resolute/notebook">{en?'Reread your rules':'ルールを読み返す'}</Link>:sample?<Link href="/resolute/notebook">{en?'Check your first price level':'最初のラインを確認する'}</Link>:(en?'Nothing for now':'なし')}</div><p className={s.m}>{en?'Follow your rules when the price reaches a level you’ve set. A headline alone doesn’t change them.':'あなたのルールが動くのは、価格がラインに届いたときだけです。ニュースでは動きません。'}</p></div></div>{quote?<div className={s.say}><div className={s.who}>{en?'A word from RIZEL':'リゼルの一言'}{preview?<span className={s.draft}>{en?'Private layout preview · not AI-selected':'非公開の表示見本・AI選択ではありません'}</span>:null}</div><p className={s.q}>{quote[locale].title}</p><ul>{quote[locale].reasons.slice(0,3).map((t,i)=><li key={i}>{t}</li>)}</ul></div>:null}</>:<p role="status" className={s.status}>{riskStatus(en,status,feed?.state)}</p>}
 {previewStars!==null&&previewError?<p role="status">{en?"The private copy bank is not connected yet.":"承認済み文章の非公開保存先は、まだ接続されていません。"}</p>:null}
 <p className={s.rfoot}>{RISK_POLICY.note[en?'en':'ja']}</p></div></div>;
}
