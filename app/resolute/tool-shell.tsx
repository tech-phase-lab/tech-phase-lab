"use client";
import { ReviewLink as Link, useReview } from "./review-context";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { validateSnapshot } from "@/lib/resolute/transport";
import { requestPreferences } from "@/lib/resolute/preferences-client";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import styles from "./diagnosis.module.css";
type Access = "loading"|"allowed"|"denied"|"signed-out"|"unavailable";
export default function ToolShell({ identityReady=true, home=false, children }: { identityReady?: boolean; home?: boolean;
 children: (locale: DiagnosisLocale, deny: () => void, entitlement: ReturnType<typeof validateSnapshot> | null) => ReactNode }) {
 const [entitlement,setEntitlement]=useState<ReturnType<typeof validateSnapshot>|null>(null);
 const pathname=usePathname();
 const review=useReview(), reviewing=review !== null;
 const [normalLocale,setNormalLocale]=useState<DiagnosisLocale>("ja"), [access,setAccess]=useState<Access>("loading"), [attempt,setAttempt]=useState(0);
 const locale=review?.locale ?? normalLocale, setLocale=review?.setLocale ?? setNormalLocale;
 useEffect(()=>{
  if(!identityReady || reviewing) return;
  const controller=new AbortController();
  void requestPreferences(undefined,controller.signal).then(p=>{ if(!controller.signal.aborted && p.locale) setNormalLocale(p.locale); },()=>{});
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
    if(!controller.signal.aborted) {setEntitlement(value);setAccess(value.canUseTools ? "allowed" : "denied");}
   } catch {if(!controller.signal.aborted) setAccess("unavailable");} finally {inFlight=false;}
  }
  void check(); const timer=setInterval(()=>void check(),60000);
  const focus=()=>void check(); window.addEventListener("focus",focus);
  return()=>{controller.abort();clearInterval(timer);window.removeEventListener("focus",focus);};
 },[identityReady,attempt,reviewing]);
 const [menuOpen,setMenuOpen]=useState(false);
 const en=locale==="en";
 const message=access==="loading" ? (en?"Checking access…":"利用権を確認しています…") : access==="signed-out" ?
  (en?"Sign in to use RESOLUTE.":"RESOLUTEを使うにはログインしてください。") : access==="denied" ?
  (en?"You need to have purchased RESOLUTE to use it. PRO membership alone doesn’t include access.":"有効なRESOLUTEの購入権限が必要です。PRO会員資格だけでは利用できません。") :
  (en?"We couldn’t check your access. Please try again in a moment.":"利用権を確認できませんでした。時間をおいて再確認してください。");
 return <main className={`${styles.page} ${home?styles.homePage:""}`} lang={locale}><div className={home?styles.homeWrap:styles.wrap}>
  <header className={home?`${styles.top} ${styles.homeControls}`:styles.top}><button type="button" className={styles.menuToggle} aria-expanded={menuOpen} aria-controls="resolute-tools" onClick={()=>setMenuOpen(open=>!open)}>
   <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>{en?"Menu":"メニュー"}</button><Link href="/resolute" className={styles.brand} prefetch={false}>RESOLUTE</Link>
   <div className={styles.languages} aria-label={en?"Display language":"表示言語"}>
    <button type="button" aria-pressed={locale==="ja"} onClick={()=>setLocale("ja")}>日本語</button>
    <button type="button" aria-pressed={en} onClick={()=>setLocale("en")}>English</button>
   </div></header>
  {menuOpen ? <nav id="resolute-tools" className={styles.toolMenu} aria-label={en?"RESOLUTE tools":"RESOLUTEのツール"}>
   {[["/resolute/diagnosis","① 診断","① Quiz"],["/resolute/simulation","② シミュレーション","② Simulator"],["/resolute/alerts","③ アラート","③ Alerts"],["/resolute/morning","④ 翌朝","④ Morning note"],["/resolute/thermometer","⑤ 温度計","⑤ Gauge"],["/resolute/tax","⑥ 税金","⑥ Tax"],["/resolute/notebook","マイルール","My rulebook"],["/resolute/wall","ルールのお守り","Rules wallpaper"],["/resolute/tonight","今夜のひと息","A moment to breathe"],["/resolute/news","危険度チェッカー","News risk checker"]].map(([href,ja,eng])=>
    <Link key={href} href={href} onClick={()=>setMenuOpen(false)} prefetch={false} aria-current={(review?.path ?? pathname)===href?"page":undefined}>{en?eng:ja}</Link>)}
  </nav> : null}
  {identityReady && (reviewing || access==="allowed") ? children(locale,()=>setAccess("denied"),entitlement) : <section className={styles.card}>
   <h1>{en?"Your investing rules":"自分の投資ルール"}</h1><p role="status">{message}</p>
   {access==="signed-out" ? <Link href="/research/account" prefetch={false}>{en?"Sign in":"ログイン"}</Link> : null}
   <button type="button" className={styles.secondary} disabled={access==="loading"} onClick={()=>setAttempt(n=>n+1)}>{en?"Check again":"再確認"}</button>
  </section>}
  {review ? <p className={styles.reviewNote}>{en ? "Owner preview · You can choose to save on this device. No emails are sent." : "運営者専用の確認画面です。端末への保存は上の設定で選べます。メールは送信しません。"}</p> : null}
  <footer className={styles.footer}>{!reviewing ? <Link href="/resolute/settings" prefetch={false}>{en?"Language and time zone":"言語とタイムゾーン"}</Link> : null}
   <Link href="/research" prefetch={false}>Tech Phase</Link></footer>
 </div></main>;
}
