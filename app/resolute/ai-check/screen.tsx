'use client';
import {useRef,useState} from 'react';
type Check={state?:string;enabled?:boolean;keyConfigured?:boolean;error?:string;ok?:boolean;reply?:string;result?:{ok?:boolean;reply?:string;error?:string}|null};
const messages:Record<string,string>={CHECK_DISABLED:'確認機能はまだ無効です。',KEY_NOT_CONFIGURED:'実行環境にキーが設定されていません。',CHECK_STORAGE_UNAVAILABLE:'確認用DBを利用できません。',ALREADY_ATTEMPTED:'実行済み、または結果未確認です。再実行せず結果を読み直してください。',OPENAI_AUTH_REJECTED:'OpenAIがキーの認証を拒否しました。',OPENAI_ACCESS_DENIED:'OpenAIへのアクセスが拒否されました。',OPENAI_RATE_OR_QUOTA_LIMIT:'OpenAIの利用上限または頻度制限に達しました。',RESPONSE_UNCONFIRMED:'応答を確認できませんでした。重複を避けるため再実行しません。',RESULT_NOT_RECORDED:'呼び出し結果の記録を確認できません。再実行しません。',BUDGET_UNAVAILABLE:'予算を確保できず、AIは呼び出していません。'};
export default function Screen(){
 const [check,setCheck]=useState<Check|null>(null),[message,setMessage]=useState('まず実行状況を確認してください。'),[busy,setBusy]=useState(false);
 const lock=useRef(false);
 async function run(execute:boolean){
  if(lock.current)return;lock.current=true;setBusy(true);
  if(execute)setCheck(null);
  try{
   const response=await fetch('/api/resolute/ai-check',{method:execute?'POST':'GET',cache:'no-store',redirect:'error',credentials:'same-origin',signal:AbortSignal.timeout(25000),
    ...(execute?{headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check'})}:{})});
   const value:Check=await response.json();setCheck(value);
   const result=value.result??value;
   setMessage(result.ok&&result.reply==='RESOLUTE_OK'?'AIから RESOLUTE_OK の応答を確認しました。':result.error?(messages[result.error]??`確認できませんでした（${result.error}）。`):value.state==='not-started'?(!value.enabled?'確認機能はまだ無効です。':!value.keyConfigured?'実行環境にキーが設定されていません。':'未実行です。'):value.state==='claimed'?'実行開始が記録されています。結果未確認のため再実行しません。':'保存された結果を確認してください。');
  }catch{setCheck(null);setMessage('応答を確認できません。実行状況の読み取りだけ行ってください。');}
  finally{lock.current=false;setBusy(false);}
 }
 return <main style={{maxWidth:640,margin:'48px auto',padding:24}}><h1>AI接続確認</h1>
  <p>運営者用。固定の短い確認文を1回だけ送信します。ニュースや承認済み文章は変更しません。</p>
  <p>通信が途中で切れた場合も自動で再実行しません。応答成功は、この確認時点のキーとモデルへの接続を示します。</p>
  <button disabled={busy} onClick={()=>void run(false)}>実行状況を確認する（AIは呼び出しません）</button>
  <p><button disabled={busy||check?.state!=='not-started'||!check.enabled||!check.keyConfigured} onClick={()=>void run(true)}>AI接続を1回だけ確認する</button></p>
  <p role="status">{message}</p><a href="/resolute">RESOLUTEに戻る</a></main>;
}
