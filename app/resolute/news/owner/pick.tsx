"use client";
import {useEffect,useState,type ReactNode} from 'react';
import {SUMMARY_QUESTION} from '@/lib/resolute/risk';
import {candidateNumbers,type AddedStory,type OwnerPick,type ShockCandidate} from '@/lib/resolute/shock-picks';
import s from '../../diagnosis.module.css';
/** The day's owner pick as the owner API returns it (risk-store.mjs ownerShockDay). */
export type ShockDay={day:string;state:string;candidates:ShockCandidate[];added:AddedStory[];picks:OwnerPick[]|null;pickedAt:string|null;revision:number;publishedSource:string|null;publishedAt:string|null;open:boolean;answerUntil:string;publishAt:string;maxStories:number;maxAdded:number};
type Choice={stars:number;rizel:string};
const strip=(t:string)=>{const q=SUMMARY_QUESTION.ja,x=t.trim();return (x.endsWith(q)?x.slice(0,-q.length):x).trim();};
const newId=()=>'o'+Array.from(crypto.getRandomValues(new Uint8Array(10)),b=>b.toString(16).padStart(2,'0')).join('');
/** Shrinks a screenshot in the browser (longest side 1600 px, JPEG) so several fit in one request. Nothing is stored. */
async function shrink(file:File):Promise<string>{
 const url=URL.createObjectURL(file);
 try{const img=await new Promise<HTMLImageElement>((ok,ng)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=ng;i.src=url;});
  const k=Math.min(1,1600/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
  c.getContext('2d')!.drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/jpeg',0.85);}finally{URL.revokeObjectURL(url);}
}
function Stars({value,onChange,label}:{value:number;onChange:(n:number)=>void;label:string}){
 return <span role="radiogroup" aria-label={label}>{[1,2,3,4,5].map(n=><button key={n} type="button" role="radio" aria-checked={value===n} className={value===n?s.primary:s.secondary} onClick={()=>onChange(n)} style={{minWidth:40,marginRight:4}}>★{n}</button>)}</span>;
}
/** The owner's daily pick: tick stories, set each one's ★ (and, optionally, the RIZEL line), add the owner's own news, then 公開. */
export default function OwnerPickSection({day,onSaved}:{day:ShockDay|null;onSaved:()=>Promise<void>}){
 const [order,setOrder]=useState<string[]>([]),[choice,setChoice]=useState<Record<string,Choice>>({}),[added,setAdded]=useState<AddedStory[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [files,setFiles]=useState<File[]>([]),[text,setText]=useState(''),[url,setUrl]=useState(''),[draftNote,setDraftNote]=useState('');
 useEffect(()=>{if(!day)return;const picks=day.picks??[];setOrder(picks.map(p=>p.id));setChoice(Object.fromEntries(picks.map(p=>[p.id,{stars:p.stars,rizel:p.rizel?.ja??''}])));setAdded(day.added);},[day]);
 if(!day)return <section className={s.card}><h2>今日の候補</h2><p>候補の保存先がまだ用意されていません。データベースの準備が必要です。</p></section>;
 const max=day.maxStories,closed=!day.open;
 const starsOf=(id:string,suggested:number)=>choice[id]?.stars??suggested;
 function toggle(id:string,suggested:number){setOrder(o=>o.includes(id)?o.filter(x=>x!==id):o.length>=max?o:[...o,id]);setChoice(c=>c[id]?c:{...c,[id]:{stars:suggested,rizel:''}});}
 const set=(id:string,patch:Partial<Choice>)=>setChoice(c=>({...c,[id]:{stars:c[id]?.stars??1,rizel:c[id]?.rizel??'',...patch}}));
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
  if(!day||busy||!order.length)return;setBusy(true);setMessage('');
  try{
   const ready=added.filter(a=>a.ja.title.trim()&&a.ja.summary.trim()).map(a=>({...a,en:{title:a.en.title.trim()||a.ja.title,summary:a.en.summary.trim()||a.ja.summary},stars:starsOf(a.id,a.stars)}));
   const picks=order.filter(id=>day.candidates.some(c=>c.id===id)||ready.some(a=>a.id===id)).map(id=>{const c=choice[id],line=c?.rizel.trim();return {id,stars:c?.stars??3,...(line?{rizel:{ja:line}}:{})};});
   if(!picks.length){setMessage('タイトルと要約が入ったニュースを選んでください');return;}
   const r=await fetch('/api/resolute/risk/owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'picks',day:day.day,baseRevision:day.revision,picks,added:ready}),redirect:'error'});
   if(r.status===409){setMessage(`受付は${day.answerUntil}までです。締め切りを過ぎたか、ほかの画面で保存されました。再読み込みしてください`);return;}
   if(!r.ok)throw Error();
   await onSaved();setMessage(`保存しました。${day.publishAt}に、選んだ順に公開します`);
  }catch{setMessage('保存を確認できませんでした。再読み込みして状態を確認してください');}finally{setBusy(false);}
 }
 const story=(id:string,title:string,body:ReactNode,suggested:number)=>{const n=order.indexOf(id),on=n>=0;
  return <li key={id} className={s.field} style={{listStyle:'none',marginBottom:16}}>
   <label><input type="checkbox" checked={on} disabled={closed||!on&&order.length>=max} onChange={()=>toggle(id,suggested)}/> {on?`${n+1}番目 `:''}<b>{title}</b></label>
   {body}
   {on?<div><div>衝撃度 <Stars value={starsOf(id,suggested)} onChange={v=>set(id,{stars:v})} label={`${title}の★`}/></div>
    <label>リゼルの一言（空欄ならAIが書きます。書いた文はそのまま載ります）<input value={choice[id]?.rizel??''} maxLength={80} onChange={e=>set(id,{rizel:e.target.value})} disabled={closed}/></label></div>:null}
  </li>;};
 const group=(g:'market'|'company',head:string)=>{const list=day.candidates.filter(c=>c.group===g);return <><h3>{head}（{list.length}件）</h3><ol style={{padding:0}}>{list.map(c=>story(c.id,c.ja.title,<>
  <p>{strip(c.ja.content)}</p>
  {candidateNumbers(c,'ja').length?<p>{candidateNumbers(c,'ja').join(' ／ ')}</p>:<p>数字: まだありません</p>}
  <p>おすすめ: ★{c.suggested.stars} {c.suggested.reason.ja}</p>
  <p><a href={c.url} target="_blank" rel="noreferrer">出典{c.source.publisher?`（${c.source.publisher}）`:''}</a></p></>,c.suggested.stars))}</ol></>;};
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
