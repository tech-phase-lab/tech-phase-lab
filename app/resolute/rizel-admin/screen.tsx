'use client';
import {useCallback,useEffect,useState} from 'react';
import s from './style.module.css';
type Locale='ja'|'en';
type Copy={id:string;revision:number;text:string;english:{revision:number;text:string}};
type Article={article_id:string;article_revision:string;result:{audit:{article:{text:string;stars:number}};copy:{id:string;ja:string;en:string}[]};reviews:{locale:Locale;state:string;revision:number}[]};
type Data={pending:number;articles:Article[];copies:Copy[]};
export default function Screen(){
 const [data,setData]=useState<Data|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [locale,setLocale]=useState<Locale>('ja'),[id,setId]=useState(''),[draft,setDraft]=useState(''),[preview,setPreview]=useState(false);
 const load=useCallback(async()=>{try{const r=await fetch('/api/resolute/rizel/owner',{cache:'no-store'});if(!r.ok){if(r.status===401||r.status===403)setData(null);throw Error();}setData(await r.json());}catch{setMessage('接続を確認できませんでした。再読み込みしてください。');}},[]);
 useEffect(()=>{void load();},[load]);
 async function mutate(value:Record<string,unknown>){setBusy(true);setMessage('');try{const r=await fetch('/api/resolute/rizel/owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(!r.ok)throw Error();setMessage('保存しました。公開は保留中です。');setPreview(false);await load();}catch{setMessage('保存できませんでした。更新された内容を再読み込みして確認してください。');}finally{setBusy(false);}}
 const selected=data?.copies.find(c=>c.id===id);
 return <main className={s.root}><a href="/resolute/review">確認用ホームへ</a><h1>RIZELの一言</h1>
 <p>記事ごとの確認・承認</p><p className={s.notice}>公開は保留中です。承認しても、現在は一般の画面に表示されません。</p>
 <div className={s.controls}><button disabled={busy} onClick={()=>void load()}>再読み込み</button><strong role="status">確認待ち {data?.pending??'—'}件</strong></div>
 <p role="status">{message}</p>
 {data?.articles.length===0&&<p>まだAIで選んだ記事はありません。文章の保存と記事の選択は別です。</p>}
 {data?.articles.map(a=><section key={a.article_id+a.article_revision} className={s.card}>
  <h2>{'★'.repeat(a.result.audit.article.stars)} 記事</h2><p>{a.result.audit.article.text}</p>
  {(['ja','en'] as const).map(lang=>{const review=a.reviews.find(r=>r.locale===lang);return <div key={lang}><h3>{lang==='ja'?'日本語':'English'} · {review?.state==='approved'?'承認済み':review?.state==='rejected'?'見送り':'確認待ち'}</h3>
   {a.result.copy.map((c,i)=><p key={c.id}>{i===0?<strong>{c[lang]}</strong>:c[lang]}</p>)}
   <div className={s.controls}><button disabled={busy||!review||!a.result.copy.length} onClick={()=>void mutate({action:'review',articleId:a.article_id,articleRevision:a.article_revision,locale:lang,baseRevision:review?.revision,decision:'approved'})}>承認して非公開保存</button>
   <button disabled={busy||!review} onClick={()=>void mutate({action:'review',articleId:a.article_id,articleRevision:a.article_revision,locale:lang,baseRevision:review?.revision,decision:'rejected'})}>今回は見送る</button></div></div>;})}
 </section>)}
 <section className={s.card}><h2>承認済みの文章を差し替える</h2><p>文章と言語を選ぶ → 貼り付け → プレビュー → 承認して非公開保存</p>
 <label>言語<select value={locale} onChange={e=>{setLocale(e.target.value as Locale);setPreview(false);setDraft('');}}><option value="ja">日本語</option><option value="en">English</option></select></label>
 <label>文章<select value={id} onChange={e=>{setId(e.target.value);setDraft('');setPreview(false);}}><option value="">選んでください</option>{data?.copies.map(c=><option key={c.id} value={c.id}>{c.id}</option>)}</select></label>
 {selected&&<><p>現在の承認済み文章</p><blockquote>{locale==='ja'?selected.text:selected.english.text}</blockquote><label>新しい下書き<textarea value={draft} maxLength={1000} onChange={e=>{setDraft(e.target.value);setPreview(false);}}/></label>
 <button disabled={!draft.trim()||busy} onClick={()=>setPreview(true)}>プレビュー</button>
 {preview&&<div className={s.notice}><p>{draft}</p><p>この言語だけを新しい版として保存します。過去の記事の文章は書き換えません。</p><button disabled={busy} onClick={()=>void mutate({action:'approve-copy',id,locale,text:draft,baseRevision:locale==='ja'?selected.revision:selected.english.revision})}>承認して非公開保存</button></div>}</>}
 </section></main>;
}
