"use client";
import { useEffect, useRef, useState } from "react";
import { requestReviewAccess, type ReviewAccess, type ReviewSessionToken } from "@/lib/resolute/review-client";
import { createReviewStore } from "@/lib/resolute/review-store";
import { ReviewContext, type ReviewPath } from "../review-context";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
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
 const [store] = useState(createReviewStore);
 const [path,setPath] = useState<ReviewPath>("/resolute");
 const [notificationsVisited,setNotificationsVisited]=useState(false);
 const [locale,setLocale] = useState<DiagnosisLocale>("ja");
 function navigate(next: ReviewPath) {
  if(next==="/resolute/alerts"||next==="/resolute/morning")setNotificationsVisited(true);
  setPath(next);
  window.scrollTo({top:0});
 }
 return <ReviewContext.Provider value={{...store,path,navigate,locale,setLocale}}>
  <div hidden={path !== "/resolute"}><DiagnosisScreen/></div>
  {path === "/resolute/simulation" ? <SimulationScreen/> : path === "/resolute/tax" ? <TaxScreen/> :
   path === "/resolute/wall" ? <WallScreen/> : path === "/resolute/tonight" ? <TonightScreen/> : path === "/resolute/news" ? <NewsScreen/> : path === "/resolute/notebook" ? <NotebookScreen/> : path === "/resolute/thermometer" ? <ThermometerScreen/> : null}
  {notificationsVisited?<div hidden={path!=="/resolute/alerts"&&path!=="/resolute/morning"}><NotificationScreen mode={path==="/resolute/morning"?"morning":"alerts"}/></div>:null}
 </ReviewContext.Provider>;
}
