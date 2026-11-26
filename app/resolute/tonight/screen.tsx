"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import ToolShell from '../tool-shell';
import {useNotificationClient} from '../review-context';
import {useSavedPlan} from '../features/use-plan';
import {useRisk} from '../features/use-risk';
import {useDesktop} from '../use-desktop';
import {TONIGHT_VIDEOS} from '@/lib/resolute/tonight-videos';
import {browserLandscapeEnvironment,enterLandscape,exitLandscape,LANDSCAPE_VIEW_QUERY} from '@/lib/resolute/tonight-landscape';
import {thermometerSession} from '@/lib/resolute/thermometer-runtime';
import {expireThermometerSnapshot,type ThermometerSnapshot} from '@/lib/resolute/thermometer-view';
import {dayLabel,periodLabel,periodRange,type BigDrop,type SimilarHistory} from '@/lib/resolute/similar-days';
import {ANSWER_LABEL,alertLines,fixedTonightQuestions,money,nearestLine,recordView,TONIGHT_INDEX_NAME,tonightFacts,tonightIndex,tonightMove,tonightVideo,
 type TonightLine,type TonightQuestions,type TonightRecord} from '@/lib/resolute/tonight';
import {parseTonightResponse,requestTonight} from '@/lib/resolute/tonight-transport';
import {usableFavoriteQuote,type FavoriteQuote} from '@/lib/research/favorite-lists';
import type {NotificationSettings} from '@/lib/resolute/notification-settings';
import SectionHeading from '../section-heading';
import styles from '../diagnosis.module.css';
import pc from '../pc.module.css';
import s from './reference.module.css';

export default function TonightScreen({identityReady=true,snapshot}:{identityReady?:boolean;snapshot?:ThermometerSnapshot}){return <ToolShell identityReady={identityReady} pc>{locale=><Tonight locale={locale} snapshot={snapshot}/>}</ToolShell>;}
const FIRST_KEY='resolute:tonight-opened:v1';
/** Read and marked once per page load, so a remount (another tab of the menu, React's checks) does not lose the first open. */
let firstOpenCache:boolean|undefined;
function firstOpen(){
 if(firstOpenCache===undefined){try{firstOpenCache=localStorage.getItem(FIRST_KEY)===null;localStorage.setItem(FIRST_KEY,'1');}catch{firstOpenCache=false;}}
 return firstOpenCache;
}
type Loaded<T>={state:'loading'}|{state:'ready';value:T}|{state:'failed'};

function Tonight({locale,snapshot:initial}:{locale:'ja'|'en';snapshot?:ThermometerSnapshot}){
 const en=locale==='en',t=(ja:string,eng:string)=>en?eng:ja,desktop=useDesktop();
 const {plan}=useSavedPlan(),{feed,status:riskState}=useRisk(),requestSettings=useNotificationClient();
 const [snapshot]=useState(()=>expireThermometerSnapshot(initial,Date.now()));
 const index=tonightIndex(plan),move=tonightMove(snapshot,index);
 const night=snapshot?.asOf||thermometerSession(new Date())||'';
 const [chosen,setChosen]=useState<number|null>(null),[videoLanguage,setVideoLanguage]=useState<'ja'|'en'|null>(null);
 const picked=tonightVideo(move?.direction??null),videoIndex=chosen??picked,language=videoLanguage??locale,video=TONIGHT_VIDEOS[videoIndex][language];
 const [settings,setSettings]=useState<NotificationSettings|null>(null),[prices,setPrices]=useState<Record<string,number>>({});
 const [answer,setAnswer]=useState<Loaded<{record:TonightRecord|null;questions:TonightQuestions|null}>>({state:'loading'});
 const [wait,setWait]=useState(false);
 // First open on this device (owner: only the very first time the page is opened, the list of past big falls).
 const [first]=useState(firstOpen);
 useEffect(()=>{
  const c=new AbortController();
  void requestSettings(undefined,c.signal).then(async v=>{
   if(c.signal.aborted)return;setSettings(v.settings);
   const tickers=[...new Set(v.settings.watchItems.map(i=>i.symbol))];
   if(!tickers.length)return;
   const r=await fetch(`/api/research/market/quotes?tickers=${encodeURIComponent(tickers.join(','))}`,{signal:c.signal});
   if(!r.ok)return;
   const body=await r.json() as {quotes?:Record<string,FavoriteQuote>},out:Record<string,number>={};
   for(const k of tickers){const q=body.quotes?.[k];if(usableFavoriteQuote(q,k))out[k]=q.price;}
   if(!c.signal.aborted)setPrices(out);
  }).catch(()=>{});
  return()=>c.abort();
 },[requestSettings]);
 // Tonight's stars: the strongest story in today's Shock Gauge. Sent once the feed has answered (or failed).
 const stars=feed?.state==='ready'&&feed.articles.some(a=>a.stars!==null)?Math.max(...feed.articles.flatMap(a=>a.stars===null?[]:[a.stars])):null;
 const feedSettled=riskState!=='loading';
 useEffect(()=>{
  if(!feedSettled||!night)return;
  const c=new AbortController();
  requestTonight({action:'open',night,stars,direction:move?.direction??null,index,movePct:move?Math.round(move.changePercent*100)/100:null},c.signal)
   .then(raw=>{if(!c.signal.aborted){const v=parseTonightResponse(raw);setAnswer({state:'ready',value:v});}})
   .catch(()=>{if(!c.signal.aborted)setAnswer({state:'failed'});});
  return()=>c.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one record per page view, once tonight's stars are known
 },[feedSettled,night]);
 const facts=move?tonightFacts({direction:move.direction,index,movePct:move.changePercent,plan,settings}):null;
 // The fixed three (with the member's own numbers) whenever the AI's questions are not there; while the record is on its way, nothing.
 const questions=answer.state==='ready'&&answer.value.questions?answer.value.questions:answer.state!=='loading'?fixedTonightQuestions(night,facts??tonightFacts({direction:'down',index,movePct:0,plan,settings})):null;
 const record=answer.state==='ready'?answer.value.record:null;
 const lines=useMemo(()=>alertLines(settings,plan),[settings,plan]);
 const next=nearestLine(lines,prices);
 const history=snapshot?.history?.[index]??null,drops=snapshot?.drops?.[index]??null;

 const videoPanel=<section className={`${s.card} ${s.videoCard}`}>
  <TonightVideo key={video.url} url={video.url!} poster={video.poster} title={video.title} en={en}/>
  <div className={s.picks} role="group" aria-label={t('動画','Videos')}>{TONIGHT_VIDEOS.map((v,i)=><button key={v.id} type="button" className={s.pick} aria-pressed={videoIndex===i} onClick={()=>setChosen(i)}><span>{v[language].title}</span><small>{clock(v[language].seconds)}</small></button>)}</div>
  <div className={s.pickFoot}>{videoIndex===picked&&move?<p className={s.picked}>{t('今夜はこの1本を選んでいます','We picked this one for tonight')}</p>:<span/>}
   <div className={s.lang} role="group" aria-label={t('動画の言語','Video language')}>{(['ja','en'] as const).map(l=><button key={l} type="button" className={`${styles.pill} ${s.chip}`} aria-pressed={language===l} onClick={()=>setVideoLanguage(l)}>{l==='ja'?'日本語':'English'}</button>)}</div></div>
 </section>;

 const questionPanel=<section className={s.card}>
  <div className={s.eyebrow}>TONIGHT’S QUESTIONS</div><h2>{t('今夜の3つの質問','Three questions for tonight')}</h2>
  {questions?<ol className={s.qs}>{questions.questions.map((q,i)=><li key={i}><span>{q.ask[locale]}</span>{q.note?<small>{q.note[locale]}</small>:null}</li>)}</ol>:<ol className={s.qs} aria-busy="true">{[0,1,2].map(i=><li key={i} className={s.skeleton}/>)}</ol>}
  <div className={s.qFoot}><button className={`${styles.primary} ${s.primary}`} onClick={()=>setWait(true)}>{t('今夜は決めない','Leave the decision until tomorrow')}</button>
   <p aria-live="polite" className={`${s.after} ${wait?s.on:''}`}>{t('決めなくて大丈夫です。','You don’t have to decide now.')}<br/>{t('ルールは、明日も同じです。','Your rules will still be here tomorrow.')}</p></div>
 </section>;

 const similarPanel=<section className={s.card}>
  <div className={s.eyebrow}>SIMILAR DAYS</div><h2>{t('今日と似た日','Days like today')}</h2>
  {first&&drops?<BigDrops drops={drops} locale={locale} index={index}/>:history?<Similar h={history} locale={locale} index={index}/>:<p className={s.muted}>{snapshot?t('まだ今日の数字がそろっていません。','Today’s numbers are not ready yet.'):t('準備中です。','Coming soon.')}</p>}
  <p className={s.small}>{t('これからの値動きを約束するものではありません','This does not promise anything about future prices.')}</p>
 </section>;

 const view=record?recordView(record,locale):null;
 const recordPanel=<section className={s.card}>
  <div className={s.eyebrow}>YOUR RECORD</div><h2>{t('これまでのあなた','Your record so far')}</h2>
  {view?<>
   {view.count>0?<p className={s.count}><b>{view.count}</b><span>{view.ordinal?t('回目の荒れた夜','rough nights, tonight included'):t('回の荒れた夜','rough nights so far')}</span></p>:null}
   <p className={s.sentence}>{view.sentence}</p>
   {record!.nights.length?<ul className={s.nights}>{record!.nights.map(n=><li key={n.night}><span>{n.night.replaceAll('-','/')}</span><span>{n.stars!==null&&n.stars>=4?t(`★${n.stars}の夜`,`★${n.stars} night`):t('アラートの夜','Alert night')}</span><b data-answer={n.answer??'none'}>{n.answer?ANSWER_LABEL[n.answer][locale]:'—'}</b></li>)}</ul>:null}
  </>:answer.state==='loading'?<div className={s.skeleton} aria-busy="true"/>:null}
  {next?<NextLine line={next} en={en}/>:null}
 </section>;

 const header=desktop?<header><p className={pc.eyebrow}><b>TONIGHT</b>{t('今夜のひと息','A moment to breathe')}</p><h1 className={pc.title}>{t('今夜のひと息','A moment to breathe')}</h1><p className={pc.lead}>{t('お知らせの内容はもう読みましたね。ひと息つきましょう。','You’ve read the alert. Now take a breath.')}</p></header>
  :<SectionHeading title={t('今夜のひと息','A moment to breathe')} description={en?'You’ve read the alert. Now take a breath.':<><span className={s.phrase}>お知らせの内容はもう読みましたね。</span><wbr/><span className={s.phrase}>ひと息つきましょう。</span></>}/>;
 return <div className={`${s.root} ${desktop?s.pc:''}`}><div className={desktop?pc.content:s.wrap}>
  {header}
  <div className={s.grid}>{videoPanel}{questionPanel}{similarPanel}{recordPanel}</div>
  <p className={s.disc}>{t('あなたが事前に決めた内容を再掲しています。特定の売買をすすめるものではありません。','These are the rules you set in advance, not recommendations to make any particular trade.')}</p>
 </div></div>;
}
const clock=(sec:number)=>`${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`;
const sign=(v:number)=>`${v>0?'+':v<0?'−':''}${Math.abs(v).toFixed(1)}%`;

function Similar({h,locale,index}:{h:SimilarHistory;locale:'ja'|'en';index:'nas100'|'sox'}){
 const en=locale==='en',name=TONIGHT_INDEX_NAME[index][locale],down=h.direction==='down';
 const lead=en?<>Today {name} moved <em className={down?s.down:s.up}>{sign(h.changePercent)}</em> in one day. These are the days in the past 10 years it {down?'fell':'rose'} about this much.</>
  :<>今日、{name}は1日で<em className={down?s.down:s.up}>{sign(h.changePercent)}</em>。過去10年で、1日にこれくらい{down?'下がった':'上がった'}日です</>;
 const tiles:[string,string][]=down?[[en?'Similar days':'似た日',en?`${h.count}`:`${h.count}回`],[en?'Back to where they were':'元の高さに戻った',en?`${h.recovered}`:`${h.recovered}回`],
  [en?'Time to recover':'戻るまで',h.minDays!==null&&h.maxDays!==null?periodRange(h.minDays,h.maxDays,locale):'—']]
  :[[en?'Similar days':'似た日',en?`${h.count}`:`${h.count}回`],[en?'Higher a month later':'1か月後に上だった',en?`${h.higherAfterMonth} of ${h.monthCount}`:`${h.monthCount}回中${h.higherAfterMonth}回`],
  [en?'The month after':'その後1か月の動き',h.monthMin!==null&&h.monthMax!==null?(h.monthMin===h.monthMax?sign(h.monthMin):`${sign(h.monthMin)}〜${sign(h.monthMax)}`):'—']];
 return <><p className={s.leadSmall}>{lead}</p>
  <div className={s.tiles}>{tiles.map(([k,v])=><div key={k} className={s.tile}><small>{k}</small><b>{v}</b></div>)}</div>
  {h.recent.length?<ul className={s.days}>{h.recent.map(d=><li key={d.date}><span>{dayLabel(d.date,locale)}</span>{down?(d.days!==null?<b>{periodLabel(d.days,locale)}</b>:<b className={s.notYet}>{en?'Not back yet':'まだ戻っていない'}</b>)
   :(d.monthAfterPercent!==null?<b>{en?`A month later ${sign(d.monthAfterPercent)}`:`1か月後 ${sign(d.monthAfterPercent)}`}</b>:<b className={s.notYet}>{en?'Less than a month ago':'まだ1か月たっていない'}</b>)}</li>)}</ul>:null}
 </>;
}
function BigDrops({drops,locale,index}:{drops:BigDrop[];locale:'ja'|'en';index:'nas100'|'sox'}){
 const en=locale==='en',name=TONIGHT_INDEX_NAME[index][locale];
 return <><p className={s.leadSmall}>{en?`The big falls of ${name} in the past 10 years, and how long it took to get back to where each began.`:`過去10年の${name}の大きな下落と、元の高さに戻るまでの期間です`}</p>
  <ul className={`${s.days} ${s.bigDays}`}>{drops.map(d=><li key={d.peak}><span>{dayLabel(d.trough,locale)}</span>{d.days!==null?<b>{periodLabel(d.days,locale)}</b>:<b className={s.notYet}>{en?'Not back yet':'まだ戻っていない'}</b>}</li>)}</ul></>;
}
function NextLine({line,en}:{line:TonightLine;en:boolean}){
 return <div className={s.next}><small>{en?'When you act next':'次にあなたが動くとき'}</small>
  <p>{en?<>When {line.symbol} reaches <b>{money(line.price)}</b>. Until then, you decided yourself that you don’t need to do anything.</>:<><span>{line.symbol}が <b>{money(line.price)}</b> に届いたとき。</span><span>それまでは何もしなくていいと、あなた自身が決めています。</span></>}</p></div>;
}

/** Owner, Nov 25: click the video to play; a play button in the middle (gone while playing); a bar below with play/pause, seek,
 * time and full screen. The old small mark at the bottom right was a page overlay (not in the cover image or the video) and is gone.
 * Owner, Nov 26: on a phone the video has to be landscape without touching the phone's rotation lock. Starting the video or the
 * full-screen button opens the landscape view (lib/resolute/tonight-landscape.ts); closing it, or the end of the video, returns to
 * the page. PCs are unchanged. Switching video or language remounts this (key). */
function TonightVideo({url,poster,title,en}:{url:string;poster:string|null;title:string;en:boolean}){
 const ref=useRef<HTMLVideoElement>(null),box=useRef<HTMLDivElement>(null);
 const [playing,setPlaying]=useState(false),[time,setTime]=useState(0),[duration,setDuration]=useState(0),[landscape,setLandscape]=useState(false);
 const play=()=>{const v=ref.current;if(!v)return;const p=v.play();if(p)p.catch(()=>{});};
 const phone=()=>typeof window!=='undefined'&&window.matchMedia(LANDSCAPE_VIEW_QUERY).matches;
 const openLandscape=()=>{const el=box.current;if(!el)return;setLandscape(true);void enterLandscape(el,browserLandscapeEnvironment()).then(mode=>{
  // Closed while full screen was still opening: undo it instead of leaving the phone locked sideways.
  if(el.hasAttribute('data-landscape'))el.dataset.landscapeMode=mode;else void exitLandscape(browserLandscapeEnvironment());});};
 const closeLandscape=()=>setLandscape(false);
 const toggle=()=>{const v=ref.current;if(!v)return;if(v.paused){if(!landscape&&phone())openLandscape();play();}else v.pause();};
 const fullscreen=()=>{if(landscape){closeLandscape();return;}if(phone()){openLandscape();return;}
  const el=box.current as (HTMLDivElement&{webkitRequestFullscreen?:()=>void})|null,v=ref.current as (HTMLVideoElement&{webkitEnterFullscreen?:()=>void})|null;
  if(document.fullscreenElement){void document.exitFullscreen();return;}
  if(el?.requestFullscreen)void el.requestFullscreen().catch(()=>v?.webkitEnterFullscreen?.());else if(el?.webkitRequestFullscreen)el.webkitRequestFullscreen();else v?.webkitEnterFullscreen?.();};
 // While the view is open: the page behind does not scroll, and leaving full screen by the phone's own back gesture closes it too.
 useEffect(()=>{const el=box.current;if(!landscape||!el)return;
  const root=document.documentElement,overflow=root.style.overflow;root.style.overflow='hidden';
  const change=()=>{if(!document.fullscreenElement&&el.dataset.landscapeMode==='locked')setLandscape(false);};
  document.addEventListener('fullscreenchange',change);
  // Closing, or a remount (another video or language) while open, gives the phone back its own rotation and leaves full screen.
  return ()=>{root.style.overflow=overflow;document.removeEventListener('fullscreenchange',change);delete el.dataset.landscapeMode;void exitLandscape(browserLandscapeEnvironment());};},[landscape]);
 const ended=()=>{setPlaying(false);if(landscape)closeLandscape();};
 return <div ref={box} className={`${s.player} ${landscape?s.landscape:''}`} data-tonight-video data-landscape={landscape?'':undefined}>
  <video ref={ref} src={url} poster={poster??undefined} playsInline preload="metadata" onClick={toggle} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={ended}
   onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onLoadedMetadata={e=>setDuration(e.currentTarget.duration)} aria-label={title}/>
  {landscape?<button type="button" className={s.closeView} onClick={closeLandscape} aria-label={en?'Close':'閉じる'} data-tonight-close><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" strokeWidth="2" strokeLinecap="round"/></svg></button>:null}
  {!playing?<button type="button" className={s.bigPlay} onClick={toggle} aria-label={en?`Play “${title}”`:`「${title}」を再生`} data-tonight-play><i/></button>:null}
  <div className={`${s.bar} ${playing?s.barHide:''}`}>
   <button type="button" className={s.barBtn} onClick={toggle} aria-label={playing?(en?'Pause':'一時停止'):(en?'Play':'再生')}>{playing?<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>:<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>}</button>
   <input type="range" min={0} max={duration||0} step={0.1} value={Math.min(time,duration||0)} aria-label={en?'Seek':'再生位置'} onChange={e=>{const v=ref.current;if(v){v.currentTime=Number(e.target.value);setTime(v.currentTime);}}} style={{['--p' as string]:`${duration?time/duration*100:0}%`}}/>
   <span className={s.time}>{clock(time)} / {clock(Math.round(duration||0))}</span>
   <button type="button" className={s.barBtn} onClick={fullscreen} aria-label={en?'Full screen':'全画面'} aria-pressed={landscape} data-tonight-fullscreen><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" strokeWidth="2"/></svg></button>
  </div>
 </div>;
}
