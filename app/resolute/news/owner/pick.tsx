"use client";
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {SUMMARY_QUESTION} from '@/lib/resolute/risk';
import {candidateNumbers,editedPicks,pickLine,typedLine,type AddedStory,type OwnerPick,type ShockCandidate} from '@/lib/resolute/shock-picks';
import s from '../../diagnosis.module.css';
/** The day's owner pick as the owner API returns it (risk-store.mjs ownerShockDay). */
export type ShockDay={day:string;state:string;candidates:ShockCandidate[];planned:{id:string;stars:number;rizel?:{ja:string;en:string;reasons?:{ja:string[];en:string[]}}}[];added:AddedStory[];picks:OwnerPick[]|null;pickedAt:string|null;revision:number;publishedSource:string|null;publishedAt:string|null;open:boolean;answerUntil:string;publishAt:string;maxStories:number;maxAdded:number};
type Choice={stars:number;rizel:string;bullets:string[]};
const EMPTY3=['','',''];
/** A stored line as the page's fields: the title and three bullet inputs. */
const fieldsOf=(v:unknown)=>{const l=pickLine(v);return {rizel:l?.ja??'',bullets:[0,1,2].map(i=>l?.reasons?.[i]??'')};};
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
/** A one-line text that wraps and grows with its text (owner, Nov 27: nothing cut off at 360–390px). Line breaks are not kept. */
function GrowText({value,maxLength,onChange,disabled}:{value:string;maxLength:number;onChange:(v:string)=>void;disabled:boolean}){
 const ref=useRef<HTMLTextAreaElement>(null);
 useLayoutEffect(()=>{const t=ref.current;if(!t)return;t.style.height='auto';t.style.height=`${t.scrollHeight+2}px`;},[value]);
 return <textarea ref={ref} rows={1} value={value} maxLength={maxLength} disabled={disabled} style={{resize:'none',overflow:'hidden',minHeight:0,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}
  onChange={e=>onChange(e.target.value.replace(/[\r\n]+/g,' '))}/>;
}
function LineFields({title,bullets,onChange,disabled}:{title:string;bullets:string[];onChange:(title:string,bullets:string[])=>void;disabled:boolean}){
 return <><label>リゼルの一言（空欄ならAIが書きます）<GrowText value={title} maxLength={80} onChange={v=>onChange(v,bullets)} disabled={disabled}/></label>
  {[0,1,2].map(i=><label key={i}>箇条書き{i+1}<GrowText value={bullets[i]??''} maxLength={120} onChange={v=>onChange(title,bullets.map((b,j)=>j===i?v:b))} disabled={disabled}/></label>)}</>;
}
function Stars({value,onChange,label}:{value:number;onChange:(n:number)=>void;label:string}){
 return <span role="radiogroup" aria-label={label} style={{display:'flex',gap:6,margin:'6px 0 10px'}}>{[1,2,3,4,5].map(n=><button key={n} type="button" role="radio" aria-checked={value===n} className={value===n?s.primary:s.secondary} onClick={()=>onChange(n)} style={{flex:1,minWidth:0,padding:'10px 0'}}>★{n}</button>)}</span>;
}
/** The owner's daily pick: tick stories, set each one's ★ (and, optionally, the RIZEL line), add the owner's own news, then 公開. */
export default function OwnerPickSection({day,onSaved}:{day:ShockDay|null;onSaved:()=>Promise<void>}){
 const [order,setOrder]=useState<string[]>([]),[choice,setChoice]=useState<Record<string,Choice>>({}),[added,setAdded]=useState<AddedStory[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [files,setFiles]=useState<File[]>([]),[text,setText]=useState(''),[url,setUrl]=useState(''),[draftNote,setDraftNote]=useState('');
 // Before the owner answers, the service's 3 planned stories are ticked with their ★ and RIZEL line (owner, Nov 27): a correction is a small edit.
 useEffect(()=>{if(!day)return;const picks=day.picks??day.planned.map(p=>({id:p.id,stars:p.stars,rizel:p.rizel}));setOrder(picks.map(p=>p.id));
  setChoice(Object.fromEntries(picks.map(p=>[p.id,{stars:p.stars,...fieldsOf(p.rizel)}])));setAdded(day.added);},[day]);
 if(!day)return <section className={s.card}><h2>今日の候補</h2><p>候補の保存先がまだ用意されていません。データベースの準備が必要です。</p></section>;
 const max=day.maxStories,closed=!day.open;
 const starsOf=(id:string,suggested:number)=>choice[id]?.stars??suggested;
 function toggle(id:string,suggested:number){setOrder(o=>o.includes(id)?o.filter(x=>x!==id):o.length>=max?o:[...o,id]);setChoice(c=>c[id]?c:{...c,[id]:{stars:suggested,rizel:'',bullets:EMPTY3}});}
 const set=(id:string,patch:Partial<Choice>)=>setChoice(c=>({...c,[id]:{stars:c[id]?.stars??1,rizel:c[id]?.rizel??'',bullets:c[id]?.bullets??EMPTY3,...patch}}));
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
 function add(item:AddedStory){setAdded(a=>[...a,item]);setOrder(o=>o.length<max?[...o,item.id]:o);setChoice(c=>({...c,[item.id]:{stars:item.stars,rizel:'',bullets:EMPTY3}}));}
 function blank(){add({id:newId(),url:url.trim()||null,publisher:null,ja:{title:'',summary:''},en:{title:'',summary:''},stars:3,addedAt:new Date().toISOString()});}
 const editAdded=(id:string,patch:(a:AddedStory)=>AddedStory)=>setAdded(list=>list.map(a=>a.id===id?patch(a):a));
 async function submit(){
  if(!day||busy||!order.length)return;setBusy(true);setMessage('');
  try{
   const ready=added.filter(a=>a.ja.title.trim()&&a.ja.summary.trim()).map(a=>({...a,en:{title:a.en.title.trim()||a.ja.title,summary:a.en.summary.trim()||a.ja.summary},stars:starsOf(a.id,a.stars)}));
   // A line left as stored keeps its English (the planned AI note or the earlier answer).
   const storedLine=(id:string)=>pickLine((day.picks??[]).find(p=>p.id===id)?.rizel??day.planned.find(p=>p.id===id)?.rizel);
   const picks=order.filter(id=>day.candidates.some(c=>c.id===id&&!c.withheld)||ready.some(a=>a.id===id)).map(id=>{const c=choice[id],line=typedLine(c?.rizel??'',c?.bullets??[],storedLine(id));return {id,stars:c?.stars??3,...(line?{rizel:line}:{})};});
   if(!picks.length){setMessage('タイトルと要約が入ったニュースを選んでください');return;}
   const r=await fetch('/api/resolute/risk/owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'picks',day:day.day,baseRevision:day.revision,picks,added:ready}),redirect:'error'});
   if(r.status===409){setMessage(`受付は${day.answerUntil}までです。締め切りを過ぎたか、ほかの画面で保存されました。再読み込みしてください`);return;}
   if(!r.ok)throw Error();
   await onSaved();setMessage(`保存しました。${day.publishAt}に、選んだ順に公開します`);
  }catch{setMessage('保存を確認できませんでした。再読み込みして状態を確認してください');}finally{setBusy(false);}
 }
 const story=(id:string,title:string,body:ReactNode,suggested:number,locked=false)=>{const n=order.indexOf(id),on=n>=0;
  return <li key={id} className={s.field} style={{listStyle:'none',marginBottom:16}}>
   <label style={{display:'flex',flexDirection:'row',alignItems:'flex-start',gap:10}}><input type="checkbox" style={{width:22,height:22,flex:'none',margin:'2px 0 0'}} checked={on} disabled={closed||locked||!on&&order.length>=max} onChange={()=>toggle(id,suggested)}/><span>{on?`${n+1}番目 `:''}<b>{title}</b></span></label>
   {body}
   {on?<div><div>衝撃度 <Stars value={starsOf(id,suggested)} onChange={v=>set(id,{stars:v})} label={`${title}の★`}/></div>
    <LineFields title={choice[id]?.rizel??''} bullets={choice[id]?.bullets??EMPTY3} onChange={(rizel,bullets)=>set(id,{rizel,bullets})} disabled={closed}/></div>:null}
  </li>;};
 const group=(g:'market'|'company',head:string)=>{const list=day.candidates.filter(c=>c.group===g);return <><h3>{head}（{list.length}件）</h3><ol style={{padding:0}}>{list.map(c=>story(c.id,c.ja.title,<>
  <p>{c.withheld?`${strip(c.ja.content)}。載せるときは「ニュースを追加」から本文を入れてください`:strip(c.ja.content)}</p>
  {candidateNumbers(c,'ja').length?<p>{candidateNumbers(c,'ja').join(' ／ ')}</p>:<p>数字: まだありません</p>}
  <p>おすすめ: ★{c.suggested.stars} {c.suggested.reason.ja}</p>
  <p><a href={c.url} target="_blank" rel="noreferrer">出典{c.source.publisher?`（${c.source.publisher}）`:''}</a></p></>,c.suggested.stars,!!c.withheld))}</ol></>;};
 return <section className={s.card}><h2>今日の候補（{day.day}）</h2>
  <p>{closed?(day.publishedAt?`${day.publishedSource==='owner'?'オーナーの選択':'自動の選択'}で公開済みです。`:`受付は${day.answerUntil}で締め切りました。`):`載せるニュースを${max}つまで選び、★を決めて「公開」を押してください。${day.answerUntil}まで受け付け、${day.publishAt}に選んだ順に公開します。選ばれていなければ、AIのおすすめを公開します。`}</p>
  {day.state==='ready'?<>{group('market','市場全体のニュース')}{group('company','個別企業のニュース')}</>:<p>{day.state==='processing'?'候補を作っています。':'今日の候補はまだありません。'}</p>}
  <h3>ニュースを追加</h3>
  <p>スクリーンショット（何枚でも）や文章、URLから下書きを作ります。画像は読み取りにだけ使い、保存しません。</p>
  <div className={s.field}><label>スクリーンショット<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e=>setFiles([...(e.target.files??[])].slice(0,4))} disabled={closed}/></label>
   <label>文章<textarea value={text} onChange={e=>setText(e.target.value)} rows={4} maxLength={8000} disabled={closed}/></label>
   <label>URL<input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://" disabled={closed}/></label>
   <button className={s.secondary} type="button" disabled={busy||closed||!files.length&&!text.trim()} onClick={()=>void draft()}>下書きを作る</button>
   <button className={s.secondary} type="button" disabled={closed||added.length>=day.maxAdded} onClick={blank}>自分で書く</button>
   {draftNote?<p role="status">{draftNote}</p>:null}</div>
  <ol style={{padding:0}}>{added.map(a=>story(a.id,a.ja.title||'（タイトル未入力）',<div className={s.field}>
   <label>タイトル<input value={a.ja.title} maxLength={100} onChange={e=>editAdded(a.id,x=>({...x,ja:{...x.ja,title:e.target.value}}))} disabled={closed}/></label>
   <label>要約（2〜3文）<textarea value={a.ja.summary} maxLength={400} rows={3} onChange={e=>editAdded(a.id,x=>({...x,ja:{...x.ja,summary:e.target.value}}))} disabled={closed}/></label>
   <label>英語のタイトル（空欄なら日本語）<input value={a.en.title} maxLength={200} onChange={e=>editAdded(a.id,x=>({...x,en:{...x.en,title:e.target.value}}))} disabled={closed}/></label>
   <label>英語の要約<textarea value={a.en.summary} maxLength={400} rows={2} onChange={e=>editAdded(a.id,x=>({...x,en:{...x.en,summary:e.target.value}}))} disabled={closed}/></label>
   {a.url?<p><a href={a.url} target="_blank" rel="noreferrer">出典</a></p>:null}
   <button className={s.secondary} type="button" disabled={closed} onClick={()=>{setAdded(l=>l.filter(x=>x.id!==a.id));setOrder(o=>o.filter(x=>x!==a.id));}}>削除</button></div>,a.stars))}</ol>
  <button className={s.primary} type="button" disabled={busy||closed||!order.length} onClick={()=>void submit()}>公開</button>
  <p role="status">{message}</p>
 </section>;
}
/** One story from the morning mail's 「このニュースを直す」 (owner, Nov 27): only that story's ★ and RIZEL line, prefilled; 保存 saves the
 * whole pick set with only this story changed, so the other planned stories stay as they are. */
export function OwnerEditOne({day,id,onSaved}:{day:ShockDay|null;id:string;onSaved:()=>Promise<void>}){
 const base=day?(day.picks??day.planned):[],current=base.find(p=>p.id===id);
 const [stars,setStars]=useState(current?.stars??3),[line,setLine]=useState(()=>fieldsOf(current?.rizel)),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{if(current){setStars(current.stars);setLine(fieldsOf(current.rizel));}},[current]);
 const story=day?.candidates.find(c=>c.id===id)??null,added=day?.added.find(a=>a.id===id)??null,title=story?.ja.title??added?.ja.title??'';
 if(!day||!current||!title)return null;
 async function save(){
  if(!day||busy)return;const picks=editedPicks(day,id,stars,line.rizel,line.bullets);if(!picks)return;setBusy(true);setMessage('');
  try{const r=await fetch('/api/resolute/risk/owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'picks',day:day.day,baseRevision:day.revision,picks,added:day.added}),redirect:'error'});
   if(r.status===409){setMessage(`受付は${day.answerUntil}までです。締め切りを過ぎたか、ほかの画面で保存されました。再読み込みしてください`);return;}
   if(!r.ok)throw Error();await onSaved();setMessage(`保存しました。${day.publishAt}に公開します`);
  }catch{setMessage('保存を確認できませんでした。再読み込みして状態を確認してください');}finally{setBusy(false);}
 }
 return <section className={s.card} data-owner-edit-one="">
  <h2>{title}</h2>
  {story?<p>{strip(story.ja.content)}</p>:null}
  <div className={s.field}><div>衝撃度 <Stars value={stars} onChange={setStars} label={`${title}の★`}/></div>
   <LineFields title={line.rizel} bullets={line.bullets} onChange={(rizel,bullets)=>setLine({rizel,bullets})} disabled={!day.open}/></div>
  <button className={s.primary} type="button" disabled={busy||!day.open} onClick={()=>void save()}>保存</button>
  <p role="status">{message}</p>
  <a href="/resolute/news/owner">すべての候補を見る</a>
 </section>;
}
