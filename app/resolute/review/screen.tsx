"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { requestReviewAccess, type ReviewAccess, type ReviewSessionToken } from "@/lib/resolute/review-client";
import { createReviewSamplePlan } from "@/lib/resolute/review-sample";
import controls from "./controls.module.css";
import { createReviewStore } from "@/lib/resolute/review-store";
import { ReviewContext, type ReviewPath } from "../review-context";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import HomeScreen from "../home/screen";
import DiagnosisScreen from "../screen";
import SimulationScreen from "../simulation/screen";
import NotificationScreen from "../notifications-screen";
import NotebookScreen from "../notebook/screen";
import TaxScreen from "../tax/screen";
import ThermometerScreen from "../thermometer/screen";
import WallScreen from "../wall/screen";
import TonightScreen from "../tonight/screen";
import NewsScreen from "../news/screen";
import styles from "../diagnosis.module.css";
export default function ReviewScreen({getSessionToken}:{getSessionToken?:ReviewSessionToken}) {
 const [access, setAccess] = useState<{status:ReviewAccess|"loading"; authorized:boolean}>({status:"loading",authorized:false});
 const {status,authorized}=access;
 const tokenRef=useRef(getSessionToken);
 useEffect(()=>{tokenRef.current=getSessionToken;},[getSessionToken]);
 const [attempt,setAttempt] = useState(0);
 useEffect(() => {
  const controller = new AbortController(); let busy = false;
  async function check() {
   if (busy) return; busy = true;
   try {
    const next = await requestReviewAccess(tokenRef.current,controller.signal);
    if (!controller.signal.aborted) setAccess(previous=>({status:next,
     authorized:next === "allowed" || next === "unavailable" && previous.authorized}));
   } finally { busy = false; }
  }
  void check(); const timer = setInterval(() => void check(),60000);
  const focus = () => void check(); window.addEventListener("focus",focus);
  return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus",focus); };
 },[attempt]);
 return <>{authorized ? <div hidden={status !== "allowed"}><Workspace/></div> : null}
 {status !== "allowed" ? <main className={styles.page}><div className={styles.wrap}><section className={styles.card}>
  <h1>RESOLUTE</h1><p role="status">{status === "loading" ? "運営者のログインを確認しています…" : status === "denied" ?
   "この入口はRIZELさんの運営者アカウント専用です。Tech Phaseと同じアカウントでログインしてください。" : authorized ? "接続を確認できませんでした。入力は保持しています。「再確認」を押してください。" : "接続を確認できませんでした。もう一度お試しください。"}</p>
  <button className={styles.secondary} onClick={()=>setAttempt(n=>n+1)}>再確認</button>
  <a href="/research/account">ログイン中のアカウントを確認する</a>
 </section></div></main> : null}</>;
}
function Workspace() {
 const [store] = useState(() => {
  try { return createReviewStore(window.localStorage); } catch { return createReviewStore(); }
 });
 const persistence = useSyncExternalStore(store.subscribe,store.getPersistence,store.getPersistence);
 const [planVersion,setPlanVersion] = useState(0);
 const [opening,setOpening] = useState(false);
 const [scenario,setScenario] = useState<import("@/lib/resolute/review-scenarios").ReviewScenario>("sample");
 const [showRizel,setShowRizel] = useState(false);
 const [path,setPath] = useState<ReviewPath>("/resolute");
 const [notificationsVisited,setNotificationsVisited]=useState(false);
 const [locale,setLocale] = useState<DiagnosisLocale>("ja");
 function navigate(next: ReviewPath) {
  if(next==="/resolute/alerts"||next==="/resolute/morning")setNotificationsVisited(true);
  setPath(next);
  window.scrollTo({top:0});
 }
 async function openFeature(next: ReviewPath) {
  if (opening) return;
  setOpening(true);
  try {
   const current = await store.requestPlan();
   if (!current.plan) {
    await store.requestPlan({plan:createReviewSamplePlan(),baseRevision:current.revision});
    setPlanVersion(v=>v+1);
   }
   navigate(next);
  } finally { setOpening(false); }
 }
 const en = locale === "en";
 return <ReviewContext.Provider value={{...store,path,navigate,locale,setLocale,scenario,setScenario,showRizel}}>
  <aside className={controls.panel} aria-label={en?"Owner preview shortcuts":"運営者用の確認ショートカット"}>
   <p>{en?"Skip the quiz and preview any tool. Your saved rules are used when available. Otherwise, a fictional sample plan is loaded.":"30問に答えずに各画面を確認できます。保存済みのルールがあれば使い、なければ架空のサンプル計画で開きます"}</p>
   <p>{en?"Display tests only. These do not change real ratings, access or publication.":"表示確認専用です。実際の危険度・利用権・公開状態は変わりません。"}</p>
   <div className={controls.links} aria-label={en?"Preview state":"確認する状態"}>
    {([['sample','ニュース見本','News sample'],['low','★1〜2の日','★1–2 day'],['medium','★3の日','★3 day'],['high','★4〜5の日','★4–5 day'],['expired','1年がすぎた後','After one year'],['failed','ニュース取得失敗','News unavailable'],['live','実際の接続状態','Live feed status']] as const).map(([value,ja,eng])=><button key={value} aria-pressed={scenario===value} onClick={()=>setScenario(value)}>{en?eng:ja}</button>)}
   </div>
   <label><input type="checkbox" checked={showRizel} onChange={e=>{setShowRizel(e.target.checked);if(e.target.checked){if(scenario==='failed'||scenario==='expired')setScenario('sample');void openFeature('/resolute/news');}}}/>{en?'Show RIZEL’s comment (private preview only)':'RIZELの一言を表示（確認用のみ・非公開）'}</label>
   <div className={controls.links}>
    {([["/resolute/news",en?"News risk checker":"危険度チェッカーを見る"],["/resolute/wall",en?"Rules wallpaper":"お守りを見る"],["/resolute/notebook",en?"My rulebook":"一冊を見る"],["/resolute/tonight",en?"A moment to breathe":"今夜のひと息を見る"]] as [ReviewPath,string][]).map(([target,label])=>
     <button key={target} disabled={opening} onClick={()=>void openFeature(target)}>{label}</button>)}
   </div>
   <p><a href={`/resolute/checkout?lang=${locale}`}>{en?"Test checkout (Sandbox)":"テスト購入（Sandbox）"}</a></p>
   <label><input type="checkbox" checked={persistence.remembered} onChange={event=>store.setRemembered(event.target.checked)}/>
    {en?"Keep saved preview rules and settings on this device":"保存した確認用ルールと設定をこの端末に残す"}</label>
   <p className={controls.note}>{en?"This includes your financial amounts and answers. Use only on your own device. Uncheck to remove the saved copy. Unfinished quiz answers won’t be kept.":"資産額や回答も含まれます。自分専用の端末でご利用ください。チェックを外すと端末の保存データを消します。診断途中の未保存の回答は残りません"}</p>
   {persistence.error?<p role="status">{en?"We couldn’t save or remove the copy on this device. Your changes are still here in this tab.":"端末への保存・削除を確認できませんでした。この画面内の入力は保持しています"}</p>:null}
  </aside>
  {path === "/resolute" ? <HomeScreen/> : null}
  <div hidden={path !== "/resolute/diagnosis"}><DiagnosisScreen key={planVersion}/></div>
  {path === "/resolute/simulation" ? <SimulationScreen/> : path === "/resolute/tax" ? <TaxScreen/> :
   path === "/resolute/wall" ? <WallScreen/> : path === "/resolute/tonight" ? <TonightScreen/> : path === "/resolute/news" ? <NewsScreen/> : path === "/resolute/notebook" ? <NotebookScreen/> : path === "/resolute/thermometer" ? <ThermometerScreen/> : null}
  {notificationsVisited?<div hidden={path!=="/resolute/alerts"&&path!=="/resolute/morning"}><NotificationScreen mode={path==="/resolute/morning"?"morning":"alerts"}/></div>:null}
 </ReviewContext.Provider>;
}
