"use client";
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {SUMMARY_QUESTION} from '@/lib/resolute/risk';
import {candidateNumbers,editedPicks,numbersNote,pickLine,typedLine,RIZEL_LINES,RIZEL_MAX_CHARS,UNJUDGED,type AddedStory,type OwnerPick,type ShockCandidate} from '@/lib/resolute/shock-picks';
import s from '../../diagnosis.module.css';
import p from './pick.module.css';
/** The day's owner pick as the owner API returns it (risk-store.mjs ownerShockDay). */
export type ShockDay={day:string;state:string;candidates:ShockCandidate[];planned:{id:string;stars:number;rizel?:{ja:string;en:string}}[];added:AddedStory[];picks:OwnerPick[]|null;pickedAt:string|null;revision:number;publishedSource:string|null;publishedAt:string|null;open:boolean;answerUntil:string;publishAt:string;maxStories:number;maxAdded:number};
type Choice={stars:number;rizel:string};
/** A stored note as the page's field text (its line breaks kept). */
const noteOf=(v:unknown)=>pickLine(v)?.ja??'';
const strip=(t:string)=>{const q=SUMMARY_QUESTION.ja,x=t.trim();return (x.endsWith(q)?x.slice(0,-q.length):x).trim();};
const newId=()=>'o'+Array.from(crypto.getRandomValues(new Uint8Array(10)),b=>b.toString(16).padStart(2,'0')).join('');
/** Shrinks a screenshot in the browser (longest side 1600 px, JPEG) so several fit in one request. Nothing is stored. */
async function shrink(file:File):Promise<string>{
 const url=URL.createObjectURL(file);
 try{const img=await new Promise<HTMLImageElement>((ok,ng)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=ng;i.src=url;});
  const k=Math.min(1,1600/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
  c.getContext('2d')!.drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/jpeg',0.85);}finally{URL.revokeObjectURL(url);}
}
/** リゼルの一言: one 一言 input and three 箇条書き inputs (owner, Nov 27: the shape members see). Written text is published as written. */
/** The RIZEL note field (owner, Nov 27: one note, no bullets): wraps and grows with its text so nothing is cut off at 360–390px;
 * up to three lines (line breaks are kept and published), at most RIZEL_MAX_CHARS characters. Written text is published as written. */
function NoteField({value,onChange,disabled}:{value:string;onChange:(v:string)=>void;disabled:boolean}){
 const ref=useRef<HTMLTextAreaElement>(null);
 useLayoutEffect(()=>{const t=ref.current;if(!t)return;t.style.height='auto';t.style.height=`${t.scrollHeight+2}px`;},[value]);
 return <label style={{display:'flex',flexDirection:'column',gap:6}}>リゼルの一言（空欄ならAIが書きます）<textarea ref={ref} rows={2} value={value} maxLength={RIZEL_MAX_CHARS+RIZEL_LINES-1} disabled={disabled} style={{width:'100%',resize:'none',overflow:'hidden',minHeight:0,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}
  onChange={e=>onChange(e.target.value.split('\n').slice(0,RIZEL_LINES).join('\n'))}/></label>;
}
function Stars({value,onChange,label}:{value:number;onChange:(n:number)=>void;label:string}){
 return <span role="radiogroup" aria-label={label} style={{display:'flex',gap:6,margin:'6px 0 10px'}}>{[1,2,3,4,5].map(n=><button key={n} type="button" role="radio" aria-checked={value===n} className={value===n?s.primary:s.secondary} onClick={()=>onChange(n)} style={{flex:1,minWidth:0,padding:'10px 0'}}>★{n}</button>)}</span>;
}
/** The order on the page (owner, Nov 28): the planned stories (or the owner's answer) first, in their order, then the rest by importance
 * (rank, market-wide first on the same rank). Stories without a summary are listed apart. */
export function pageOrder(day:Pick<ShockDay,'candidates'|'planned'|'picks'>):{first:ShockCandidate[];rest:ShockCandidate[];withheld:ShockCandidate[]}{
 const live=day.candidates.filter(c=>!c.withheld),ids=(day.picks??day.planned).map(p=>p.id);
 const first=ids.flatMap(id=>live.filter(c=>c.id===id));
 const rest=live.filter(c=>!ids.includes(c.id)).sort((a,b)=>a.rank-b.rank||(a.group==='market'?0:1)-(b.group==='market'?0:1));
 return {first,rest,withheld:day.candidates.filter(c=>!!c.withheld).sort((a,b)=>a.rank-b.rank||(a.group==='market'?0:1)-(b.group==='market'?0:1))};
}
const GROUP_LABEL={market:'市場全体',company:'個別企業'} as const;
/** The owner's daily pick: tick stories, set each one's ★ (and, optionally, the RIZEL line), add the owner's own news, then 公開. */
export default function OwnerPickSection({day,onSaved}:{day:ShockDay|null;onSaved:()=>Promise<void>}){
 const [order,setOrder]=useState<string[]>([]),[choice,setChoice]=useState<Record<string,Choice>>({}),[added,setAdded]=useState<AddedStory[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [files,setFiles]=useState<File[]>([]),[text,setText]=useState(''),[url,setUrl]=useState(''),[draftNote,setDraftNote]=useState('');
 // Before the owner answers, the service's 3 planned stories are ticked with their ★ and RIZEL line (owner, Nov 27): a correction is a small edit.
 useEffect(()=>{if(!day)return;const picks=day.picks??day.planned.map(p=>({id:p.id,stars:p.stars,rizel:p.rizel}));setOrder(picks.map(p=>p.id));
  setChoice(Object.fromEntries(picks.map(p=>[p.id,{stars:p.stars,rizel:noteOf(p.rizel)}])));setAdded(day.added);},[day]);
 if(!day)return <section className={s.card}><h2>今日の候補</h2><p>候補の保存先がまだ用意されていません。データベースの準備が必要です。</p></section>;
 const max=day.maxStories,closed=!day.open;
 // A story whose ★ is not judged starts with none: the owner must choose one (0 = not chosen).
 const starsOf=(id:string,suggested:number|null)=>choice[id]?.stars??suggested??0;
 function toggle(id:string,suggested:number|null){setOrder(o=>o.includes(id)?o.filter(x=>x!==id):o.length>=max?o:[...o,id]);setChoice(c=>c[id]?c:{...c,[id]:{stars:suggested??0,rizel:''}});}
 const set=(id:string,patch:Partial<Choice>)=>setChoice(c=>({...c,[id]:{stars:c[id]?.stars??0,rizel:c[id]?.rizel??'',...patch}}));
 async function draft(){
  if(busy)return;setBusy(true);setDraftNote('');
  try{const images=await Promise.all(files.map(shrink));
   const r=await fetch('/api/resolute/risk/owner/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({images,text,url}),redirect:'error'});
   if(!r.ok){setDraftNote(r.status===403?'オーナー専用です':r.status===422?'画像や文章からニュースを読み取れませんでした。タイトルと要約を自分で書くこともできます':'下書きを作れませんでした。もう一度お試しください');return;}
   const v=await r.json() as {draft:{ja:{title:string;summary:string};en:{title:string;summary:string};publisher:string|null};issues:string[];url:string|null};
   const item:AddedStory={id:newId(),url:v.url,publisher:v.draft.publisher,ja:v.draft.ja,en:{title:v.draft.en.title||v.draft.ja.title,summary:v.draft.en.summary||v.draft.ja.summary},stars:3,addedAt:new Date().toISOString()};
   add(item);setFiles([]);setText('');setUrl('');
   if(v.issues.length)setDraftNote('下書きに、使えない言い回しか元にない数字が入っているかもしれません。公開前に確かめて直してください');
  }catch{setDraftNote('下書きを作れませんでした。もう一度お試しください');}finally{setBusy(false);}
 }
 // A new item is ticked at once when there is room, so its ★ and RIZEL line can be set right away.
 function add(item:AddedStory){setAdded(a=>[...a,item]);setOrder(o=>o.length<max?[...o,item.id]:o);setChoice(c=>({...c,[item.id]:{stars:item.stars,rizel:''}}));}
 function blank(){add({id:newId(),url:url.trim()||null,publisher:null,ja:{title:'',summary:''},en:{title:'',summary:''},stars:3,addedAt:new Date().toISOString()});}
 const editAdded=(id:string,patch:(a:AddedStory)=>AddedStory)=>setAdded(list=>list.map(a=>a.id===id?patch(a):a));
 async function submit(){
  if(!day||busy||!order.length)return;
  const ready=added.filter(a=>a.ja.title.trim()&&a.ja.summary.trim()).map(a=>({...a,en:{title:a.en.title.trim()||a.ja.title,summary:a.en.summary.trim()||a.ja.summary},stars:starsOf(a.id,a.stars)}));
  const ids=order.filter(id=>day.candidates.some(c=>c.id===id&&!c.withheld)||ready.some(a=>a.id===id));
  const missing=ids.map((id,i)=>({i,stars:choice[id]?.stars??0})).filter(x=>x.stars<1);
  if(missing.length){setMessage(`★を決めていないニュースがあります: ${missing.map(x=>`${x.i+1}番目`).join('、')}。★を選んでから公開してください`);return;}
  setBusy(true);setMessage('');
  try{
   // A line left as stored keeps its English (the planned AI note or the earlier answer).
   const storedLine=(id:string)=>pickLine((day.picks??[]).find(p=>p.id===id)?.rizel??day.planned.find(p=>p.id===id)?.rizel);
   const picks=ids.map(id=>{const c=choice[id],line=typedLine(c?.rizel??'',storedLine(id));return {id,stars:c?.stars??3,...(line?{rizel:line}:{})};});
   if(!picks.length){setMessage('タイトルと要約が入ったニュースを選んでください');return;}
   const r=await fetch('/api/resolute/risk/owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'picks',day:day.day,baseRevision:day.revision,picks,added:ready}),redirect:'error'});
   if(r.status===409){setMessage(`受付は${day.answerUntil}までです。締め切りを過ぎたか、ほかの画面で保存されました。再読み込みしてください`);return;}
   if(!r.ok)throw Error();
   await onSaved();setMessage(`保存しました。${day.publishAt}に、選んだ順に公開します`);
  }catch{setMessage('保存を確認できませんでした。再読み込みして状態を確認してください');}finally{setBusy(false);}
 }
 const planned=new Set(day.planned.map(p=>p.id));
 /** One story as a card: the tick box (48px) on the left, the number and the Japanese headline (the English one small underneath),
  * then the summary (or why there is none), the numbers, the suggested ★, the source; when ticked, its ★ and RIZEL line. */
 const card=(n:number,id:string,o:{title:string;original?:string|null;group?:'market'|'company';body:ReactNode;suggested:number|null;locked?:boolean;planned?:boolean})=>{
  const at=order.indexOf(id),on=at>=0,can=!(closed||o.locked||!on&&order.length>=max);
  return <li key={id} className={p.card} data-on={on} data-story={id}>
   <div className={p.head}>
    {o.locked?null:<button type="button" role="checkbox" aria-checked={on} aria-label={`${n}. ${o.title}を${on?'外す':'選ぶ'}`} className={p.check} disabled={!can} onClick={()=>toggle(id,o.suggested)}>{on?at+1:''}</button>}
    <div className={p.headText} onClick={()=>{if(can)toggle(id,o.suggested);}}>
     <p className={p.meta}><span className={p.num}>{n}</span>{o.group?<span className={p.tag}>{GROUP_LABEL[o.group]}</span>:null}{o.planned?<span className={`${p.tag} ${p.planned}`}>公開予定</span>:null}{on?<span>{at+1}番目に公開</span>:null}</p>
     <h3 className={p.title}>{o.title}</h3>
     {o.original&&o.original!==o.title?<p className={p.original} lang="en">{o.original}</p>:null}
    </div>
   </div>
   {o.body}
   {on?<div className={p.choice}><div>衝撃度{starsOf(id,o.suggested)<1?<span className={p.unjudged}>（{UNJUDGED.ja}）</span>:null}<Stars value={starsOf(id,o.suggested)} onChange={v=>set(id,{stars:v})} label={`${o.title}の★`}/></div>
    <NoteField value={choice[id]?.rizel??''} onChange={rizel=>set(id,{rizel})} disabled={closed}/></div>:null}
  </li>;};
 const storyBody=(c:ShockCandidate)=>{const nums=candidateNumbers(c,'ja');return <>
  {c.withheld?<p className={p.muted}>{strip(c.ja.content)}</p>:<p className={p.summary}>{strip(c.ja.content)}</p>}
  <p className={p.numbers}>{nums.length?<>数字: {nums.join(' ／ ')}</>:<>数字: {numbersNote(c,'ja')}</>}</p>
  <p className={p.suggest}>{c.suggested.stars===null?<span className={p.unjudged}>{UNJUDGED.ja}</span>:<>おすすめ: <b>★{c.suggested.stars}</b></>} <span className={p.muted} style={{display:'inline'}}>{c.suggested.stars===null?'':c.suggested.reason.ja}</span></p>
  <a className={p.source} href={c.url} target="_blank" rel="noreferrer">出典{c.source.publisher?`（${c.source.publisher}）`:''}</a></>;};
 const {first,rest,withheld}=pageOrder(day),listed=[...first,...rest];
 const ruled=day.candidates.some(c=>!c.withheld&&c.suggested.by==='rule');
 return <section className={s.card}><h2>今日の候補（{day.day}）</h2>
  <p className={p.lead}>{closed?(day.publishedAt?`${day.publishedSource==='owner'?'オーナーの選択':'自動の選択'}で公開済みです。`:`受付は${day.answerUntil}で締め切りました。`):`左の□を押して、載せるニュースを${max}つまで選び、★を決めて、いちばん下の「公開」を押してください。${day.answerUntil}まで受け付け、${day.publishAt}に選んだ順に公開します。選ばれていなければ、上の「公開予定」の${day.planned.length}つを公開します。`}</p>
  {ruled?<p className={p.alert} role="note">今日はAIの判定ができませんでした。重要な話題と市場全体のニュースを先に並べています。★は値動きの数字があるものだけに付いています。「{UNJUDGED.ja}」のニュースは、選ぶときに★を決めてください（選ばなければ公開しません）</p>:null}
  {day.state==='ready'?<>
   <ol className={p.list}>{listed.map((c,i)=>card(i+1,c.id,{title:c.ja.title,original:c.source.title,group:c.group,body:storyBody(c),suggested:c.suggested.stars,planned:planned.has(c.id)}))}</ol>
   {withheld.length?<details className={p.more}><summary>要約できなかったニュース（{withheld.length}件）</summary>
    <p className={p.muted}>要約を作れなかったため、このままでは載せられません。載せるときは「ニュースを追加」から本文を入れてください。</p>
    <ol className={p.list}>{withheld.map((c,i)=>card(listed.length+i+1,c.id,{title:c.ja.title,original:c.source.title,group:c.group,body:storyBody(c),suggested:c.suggested.stars,locked:true}))}</ol></details>:null}
  </>:<p>{day.state==='processing'?'候補を作っています。':'今日の候補はまだありません。'}</p>}
  <h3 className={p.groupHead}>ニュースを追加</h3>
  <p className={p.lead}>スクリーンショット（何枚でも）や文章、URLから下書きを作ります。画像は読み取りにだけ使い、保存しません。</p>
  <div className={s.field}><label>スクリーンショット<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e=>setFiles([...(e.target.files??[])].slice(0,4))} disabled={closed}/></label>
   <label>文章<textarea value={text} onChange={e=>setText(e.target.value)} rows={4} maxLength={8000} disabled={closed}/></label>
   <label>URL<input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://" disabled={closed}/></label>
   <button className={s.secondary} type="button" disabled={busy||closed||!files.length&&!text.trim()} onClick={()=>void draft()}>下書きを作る</button>
   <button className={s.secondary} type="button" disabled={closed||added.length>=day.maxAdded} onClick={blank}>自分で書く</button>
   {draftNote?<p role="status">{draftNote}</p>:null}</div>
  {added.length?<ol className={p.list}>{added.map((a,i)=>card(i+1,a.id,{title:a.ja.title||'（タイトル未入力）',suggested:a.stars,body:<div className={s.field}>
   <label>タイトル<input value={a.ja.title} maxLength={100} onChange={e=>editAdded(a.id,x=>({...x,ja:{...x.ja,title:e.target.value}}))} disabled={closed}/></label>
   <label>要約（2〜3文）<textarea value={a.ja.summary} maxLength={400} rows={3} onChange={e=>editAdded(a.id,x=>({...x,ja:{...x.ja,summary:e.target.value}}))} disabled={closed}/></label>
   <label>英語のタイトル（空欄なら日本語）<input value={a.en.title} maxLength={200} onChange={e=>editAdded(a.id,x=>({...x,en:{...x.en,title:e.target.value}}))} disabled={closed}/></label>
   <label>英語の要約<textarea value={a.en.summary} maxLength={400} rows={2} onChange={e=>editAdded(a.id,x=>({...x,en:{...x.en,summary:e.target.value}}))} disabled={closed}/></label>
   {a.url?<p><a href={a.url} target="_blank" rel="noreferrer">出典</a></p>:null}
   <button className={s.secondary} type="button" disabled={closed} onClick={()=>{setAdded(l=>l.filter(x=>x.id!==a.id));setOrder(o=>o.filter(x=>x!==a.id));}}>削除</button></div>}))}</ol>:null}
  <button className={s.primary} type="button" disabled={busy||closed||!order.length} onClick={()=>void submit()}>公開（{order.length}件を選択中）</button>
  <p role="status">{message}</p>
 </section>;
}
/** One story from the morning mail's 「このニュースを直す」 (owner, Nov 27): only that story's ★ and RIZEL line, prefilled; 保存 saves the
 * whole pick set with only this story changed, so the other planned stories stay as they are. */
export function OwnerEditOne({day,id,onSaved}:{day:ShockDay|null;id:string;onSaved:()=>Promise<void>}){
 const base=day?(day.picks??day.planned):[],current=base.find(p=>p.id===id);
 const [stars,setStars]=useState(current?.stars??3),[line,setLine]=useState(()=>noteOf(current?.rizel)),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{if(current){setStars(current.stars);setLine(noteOf(current.rizel));}},[current]);
 const story=day?.candidates.find(c=>c.id===id)??null,added=day?.added.find(a=>a.id===id)??null,title=story?.ja.title??added?.ja.title??'';
 if(!day||!current||!title)return null;
 async function save(){
  if(!day||busy)return;const picks=editedPicks(day,id,stars,line);if(!picks)return;setBusy(true);setMessage('');
  try{const r=await fetch('/api/resolute/risk/owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'picks',day:day.day,baseRevision:day.revision,picks,added:day.added}),redirect:'error'});
   if(r.status===409){setMessage(`受付は${day.answerUntil}までです。締め切りを過ぎたか、ほかの画面で保存されました。再読み込みしてください`);return;}
   if(!r.ok)throw Error();await onSaved();setMessage(`保存しました。${day.publishAt}に公開します`);
  }catch{setMessage('保存を確認できませんでした。再読み込みして状態を確認してください');}finally{setBusy(false);}
 }
 return <section className={s.card} data-owner-edit-one="">
  <h2>{title}</h2>
  {story?<p>{strip(story.ja.content)}</p>:null}
  <div className={s.field}><div>衝撃度 <Stars value={stars} onChange={setStars} label={`${title}の★`}/></div>
   <NoteField value={line} onChange={setLine} disabled={!day.open}/></div>
  <button className={s.primary} type="button" disabled={busy||!day.open} onClick={()=>void save()}>保存</button>
  <p role="status">{message}</p>
  <a href="/resolute/news/owner">すべての候補を見る</a>
 </section>;
}
