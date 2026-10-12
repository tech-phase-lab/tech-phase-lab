"use client";
import { useEffect, useState } from "react";
import { createReviewStore } from "@/lib/resolute/review-store";
import { ReviewContext, reviewPaths, type ReviewPath } from "../review-context";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import DiagnosisScreen from "../screen";
import SimulationScreen from "../simulation/screen";
import NotificationScreen from "../notifications-screen";
import TaxScreen from "../tax/screen";
import ThermometerScreen from "../thermometer/screen";
import styles from "../diagnosis.module.css";
export default function ReviewScreen() {
 const [status, setStatus] = useState<"loading"|"allowed"|"denied"|"unavailable">("loading");
 const [attempt,setAttempt] = useState(0);
 useEffect(() => {
  const controller = new AbortController(); let busy = false;
  async function check() {
   if (busy) return; busy = true;
   try {
    const response = await fetch("/api/resolute/review-access", { cache:"no-store",credentials:"same-origin",redirect:"error",
     signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]) });
    const allowed = response.ok && (await response.json()).allowed === true;
    if (!controller.signal.aborted) setStatus(allowed ? "allowed" : [401,403].includes(response.status) ? "denied" : "unavailable");
   } catch { if (!controller.signal.aborted) setStatus("unavailable"); } finally { busy = false; }
  }
  void check(); const timer = setInterval(() => void check(),60000);
  const focus = () => void check(); window.addEventListener("focus",focus);
  return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus",focus); };
 },[attempt]);
 if (status === "allowed") return <Workspace/>;
 return <main className={styles.page}><div className={styles.wrap}><section className={styles.card}>
  <h1>RESOLUTE</h1><p role="status">{status === "loading" ? "運営者のログインを確認しています…" : status === "denied" ?
   "この入口はRIZELさんの運営者アカウント専用です。Tech Phaseと同じアカウントでログインしてください。" : "ログインを確認できませんでした。もう一度お試しください。"}</p>
  <button className={styles.secondary} onClick={()=>setAttempt(n=>n+1)}>再確認</button>
  <a href="/research/account">ログイン中のアカウントを確認する</a>
 </section></div></main>;
}
function Workspace() {
 const [store] = useState(createReviewStore);
 const [path,setPath] = useState<ReviewPath>(() => {
  const candidate = typeof window === "undefined" ? "" : `/resolute/${window.location.hash.slice(1)}`;
  return reviewPaths.includes(candidate as ReviewPath) ? candidate as ReviewPath : "/resolute";
 });
 const [locale,setLocale] = useState<DiagnosisLocale>("ja");
 function navigate(next: ReviewPath) {
  setPath(next); window.history.replaceState(null,"",`#${next === "/resolute" ? "diagnosis" : next.split("/").pop()}`);
  window.scrollTo({top:0});
 }
 return <ReviewContext.Provider value={{...store,path,navigate,locale,setLocale}}>
  {path === "/resolute/simulation" ? <SimulationScreen/> : path === "/resolute/alerts" ? <NotificationScreen key="alerts" mode="alerts"/> :
   path === "/resolute/morning" ? <NotificationScreen key="morning" mode="morning"/> : path === "/resolute/tax" ? <TaxScreen/> :
   path === "/resolute/thermometer" ? <ThermometerScreen/> : <DiagnosisScreen/>}
 </ReviewContext.Provider>;
}
