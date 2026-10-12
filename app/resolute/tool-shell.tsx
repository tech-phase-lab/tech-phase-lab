"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { validateSnapshot } from "@/lib/resolute/transport";
import { requestPreferences } from "@/lib/resolute/preferences-client";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import styles from "./diagnosis.module.css";
type Access = "loading"|"allowed"|"denied"|"signed-out"|"unavailable";
export default function ToolShell({ identityReady=true, children }: { identityReady?: boolean;
 children: (locale: DiagnosisLocale, deny: () => void) => ReactNode }) {
 const pathname=usePathname();
 const [locale,setLocale]=useState<DiagnosisLocale>("ja"), [access,setAccess]=useState<Access>("loading"), [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!identityReady) return;
  const controller=new AbortController();
  void requestPreferences(undefined,controller.signal).then(p=>{ if(!controller.signal.aborted && p.locale) setLocale(p.locale); },()=>{});
  let inFlight=false;
  async function check() {
   if(inFlight) return; inFlight=true;
   try {
    const r=await fetch("/api/resolute/entitlements",{cache:"no-store",credentials:"same-origin",redirect:"error",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])});
    if(controller.signal.aborted) return;
    if(r.status===401) {setAccess("signed-out");return;}
    if(!r.ok) throw new Error("unavailable");
    const text=await r.text(); if(text.length>8192) throw new Error("unavailable");
    const value=validateSnapshot(JSON.parse(text));
    if(!controller.signal.aborted) setAccess(value.canUseTools ? "allowed" : "denied");
   } catch {if(!controller.signal.aborted) setAccess("unavailable");} finally {inFlight=false;}
  }
  void check(); const timer=setInterval(()=>void check(),60000);
  const focus=()=>void check(); window.addEventListener("focus",focus);
  return()=>{controller.abort();clearInterval(timer);window.removeEventListener("focus",focus);};
 },[identityReady,attempt]);
 const en=locale==="en";
 const message=access==="loading" ? (en?"Checking access…":"利用権を確認しています…") : access==="signed-out" ?
  (en?"Sign in to use RESOLUTE.":"RESOLUTEを使うにはログインしてください。") : access==="denied" ?
  (en?"An active RESOLUTE purchase is required. PRO membership alone does not include access.":"有効なRESOLUTEの購入権限が必要です。PRO会員資格だけでは利用できません。") :
  (en?"We couldn’t verify access. Please try again shortly.":"利用権を確認できませんでした。時間をおいて再確認してください。");
 return <main className={styles.page} lang={locale}><div className={styles.wrap}>
  <header className={styles.top}><Link href="/resolute" className={styles.brand} prefetch={false}>RESOLUTE</Link>
   <div className={styles.languages} aria-label={en?"Display language":"表示言語"}>
    <button type="button" aria-pressed={locale==="ja"} onClick={()=>setLocale("ja")}>日本語</button>
    <button type="button" aria-pressed={en} onClick={()=>setLocale("en")}>English</button>
   </div></header>
  <nav className={styles.toolMenu} aria-label={en?"RESOLUTE tools":"RESOLUTEのツール"}>
   {[["/resolute","① 診断","① Rules"],["/resolute/simulation","② シミュレーション","② Simulation"],["/resolute/alerts","③ アラート","③ Alerts"],["/resolute/morning","④ 翌朝","④ Next morning"]].map(([href,ja,eng])=>
    <Link key={href} href={href} prefetch={false} aria-current={pathname===href?"page":undefined}>{en?eng:ja}</Link>)}
  </nav>
  {identityReady && access==="allowed" ? children(locale,()=>setAccess("denied")) : <section className={styles.card}>
   <h1>{en?"Your investing rules":"自分の投資ルール"}</h1><p role="status">{message}</p>
   {access==="signed-out" ? <Link href="/research/account" prefetch={false}>{en?"Sign in":"ログイン"}</Link> : null}
   <button type="button" className={styles.secondary} disabled={access==="loading"} onClick={()=>setAttempt(n=>n+1)}>{en?"Check again":"再確認"}</button>
  </section>}
  <footer className={styles.footer}><Link href="/resolute/settings" prefetch={false}>{en?"Language and time zone":"言語とタイムゾーン"}</Link>
   <Link href="/research" prefetch={false}>Tech Phase</Link></footer>
 </div></main>;
}
