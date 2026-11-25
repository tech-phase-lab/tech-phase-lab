"use client";
import {writeBarState} from '@/lib/research/resolute-bar-state';
import { ReviewLink as Link, useReview } from "./review-context";
import { usePathname } from "next/navigation";
import { useLinkStatus } from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useOpenAtTop } from "./use-open-at-top";
import AddToHomeCard from "./add-to-home-card";
import h from "./tool-shell.module.css";
import { validateSnapshot } from "@/lib/resolute/transport";
import { requestPreferences } from "@/lib/resolute/preferences-client";
import { requestPlan } from "@/lib/resolute/plan-client";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
import styles from "./diagnosis.module.css";
import { forget, recall, remember } from "@/lib/resolute/view-memory";
import HomeLink from "./home-link";
import pc_ from "./pc.module.css";
import { useDesktop } from "./use-desktop";
type Access = "loading"|"allowed"|"denied"|"signed-out"|"unavailable"|"mfa";
const STEPS: [string,string,string][] = [["/resolute/diagnosis","投資ルール診断","Rules quiz"],["/resolute/simulation","シミュレーション","Simulator"],["/resolute/alerts","終値アラート","Closing-price alerts"],["/resolute/morning","翌朝のひとこと","Morning note"],["/resolute/thermometer","相場の温度計","Market gauge"],["/resolute/tax","税金の目安","Tax estimate"]];
const TOOLS: [string,string,string,ReactNode][] = [
 ["/resolute/notebook","マイルール","My rulebook",<path key="a" d="M7 4h10v16l-5-4-5 4z"/>],
 ["/resolute/wall","ルールのお守り","Rules wallpaper",<path key="b" d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>],
 ["/resolute/tonight","今夜のひと息","A moment to breathe",<path key="c" d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>],
 ["/resolute/news","衝撃度チェッカー","Shock Gauge",<path key="d" d="M12 4l9 16H3zM12 10v4M12 17v.5"/>]];
export default function ToolShell({ identityReady=true, home=false, pc=false, children }: { identityReady?: boolean; home?: boolean;
 /** The page has a PC layout (owner, Nov 25): at 1024px and wider it is drawn in the PC shell with the menu on the left. */
 pc?: boolean;
 children: (locale: DiagnosisLocale, deny: () => void, entitlement: ReturnType<typeof validateSnapshot> | null) => ReactNode }) {
 useOpenAtTop();
 const desktop=useDesktop();
 // Moving between RESOLUTE pages draws the new page once with the access already confirmed in this tab, and checks again quietly
 // behind it, instead of "Checking…" first (owner, Nov 17). See lib/resolute/view-memory.ts.
 const [entitlement,setEntitlement]=useState<ReturnType<typeof validateSnapshot>|null>(()=>recall("entitlement")??null);
 const pathname=usePathname();
 const review=useReview(), reviewing=review !== null;
 const [normalLocale,setNormalLocale]=useState<DiagnosisLocale>(()=>recall<DiagnosisLocale>("locale")??"ja"), [access,setAccess]=useState<Access>(()=>recall("entitlement")?"allowed":"loading"), [attempt,setAttempt]=useState(0);
 const chooseLocale=(next:DiagnosisLocale)=>{remember("locale",next);setNormalLocale(next);};
 const locale=review?.locale ?? normalLocale, setLocale=review?.setLocale ?? chooseLocale;
 // A link that names the language (?lang=en / ?lang=ja) opens the page in it and keeps it, like tapping EN/JA (production QA, Nov 24).
 // Declared before the preferences read below, so the saved preference does not override it.
 useEffect(()=>{
  if(reviewing) return;
  const asked=new URLSearchParams(window.location.search).get("lang");
  if(asked==="en" || asked==="ja") { remember("locale",asked); setNormalLocale(asked); }
 },[reviewing]);
 // The page language follows the language shown.
 useEffect(()=>{ document.documentElement.lang=locale; },[locale]);
 useEffect(()=>{
  if(!identityReady || reviewing) return;
  const controller=new AbortController();
  // A language already shown in this tab (saved or just tapped) stays; the saved one is used when nothing is known yet.
  if(recall("locale")===undefined) void requestPreferences(undefined,controller.signal).then(p=>{ if(!controller.signal.aborted && p.locale && recall("locale")===undefined) { remember("locale",p.locale); setNormalLocale(p.locale); } },()=>{});
  let inFlight=false, failures=0, retry:ReturnType<typeof setTimeout>|undefined;
  // Right after the app is reopened the sign-in cookie may still be refreshing: ask again a few times before saying anything.
  const retryLater=()=>{ if(failures>=3) return false; failures++; retry=setTimeout(()=>void check(),1200*failures); return true; };
  async function check() {
   if(inFlight) return; inFlight=true;
   try {
    const r=await fetch("/api/resolute/entitlements",{cache:"no-store",credentials:"same-origin",redirect:"error",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])});
    if(controller.signal.aborted) return;
    if(r.status===401) {if(!retryLater()) {forget();setAccess("signed-out");}return;}
    if(r.status===403) {
     // The owner's access needs two-step verification in THIS sign-in; turning it on in settings is not enough.
     let code=""; try { const body=await r.json(); code=typeof body?.error==="string"?body.error:""; } catch { /* not JSON */ }
     forget("entitlement");
     if(!controller.signal.aborted) setAccess(code==="OWNER_MFA_REQUIRED" ? "mfa" : "unavailable");
     return;
    }
    if(!r.ok) throw new Error("unavailable");
    const text=await r.text(); if(text.length>8192) throw new Error("unavailable");
    const value=validateSnapshot(JSON.parse(text));
    failures=0; writeBarState({owned:value.canUseTools,anon:false});
    if(value.canUseTools) remember("entitlement",value); else forget("entitlement");
    // The saved plan is fetched once in the background, so the first rules page opened from here does not show "Loading…".
    if(value.canUseTools && recall("plan")===undefined) void requestPlan(undefined,controller.signal).catch(()=>{});
    if(!controller.signal.aborted) {setEntitlement(value);setAccess(value.canUseTools ? "allowed" : "denied");}
   } catch {if(!controller.signal.aborted && !retryLater()) {forget("entitlement");setAccess("unavailable");}} finally {inFlight=false;}
  }
  void check(); const timer=setInterval(()=>void check(),60000);
  const focus=()=>void check(); window.addEventListener("focus",focus);
  return()=>{controller.abort();clearInterval(timer);clearTimeout(retry);window.removeEventListener("focus",focus);};
 },[identityReady,attempt,reviewing]);
 const [menuOpen,setMenuOpen]=useState(false);
 const en=locale==="en";
 const message=access==="signed-out" ?
  (en?"Sign in to use RESOLUTE.":"RESOLUTEを使うにはログインしてください。") : access==="mfa" ?
  (en?"Owner access needs two-step verification in this sign-in. Sign out, sign in again and enter the code from your authenticator app, then check again.":"運営者として使うには、今回のログインで2段階認証のコード入力が必要です。ログアウトして入り直し、認証アプリのコードを入力してから、もう一度確認してください。") : access==="denied" ?
  (en?"You need to have purchased RESOLUTE to use it. PRO membership alone doesn’t include access.":"有効なRESOLUTEの購入権限が必要です。PRO会員資格だけでは利用できません。") :
  (en?"We couldn’t check your access. Please try again in a moment.":"利用権を確認できませんでした。時間をおいて再確認してください。");
 const current=review?.path ?? pathname;
 const close=()=>setMenuOpen(false);
 // Going to another page keeps the menu up until that page replaces this one: closing it first showed the old page again
 // for a moment, one more flip on every move (owner, Nov 17). The owner preview changes pages in place, so it closes there.
 const leave=(href:string)=>reviewing || current===href ? close : undefined;
 const shown=reviewing ? identityReady : access==="allowed";
 // While access is being checked the page shows only the RESOLUTE loader: the disclaimer belongs under real content (owner, Nov 18).
 const checking=!shown && (!identityReady || access==="loading");
 const body=shown ? children(locale,()=>{forget("entitlement");setAccess("denied");},entitlement) : checking ? <section className={styles.loadingBrand} role="status" aria-live="polite">
   <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="9" r="4" /><path d="M24 13v28M17 19h14M9 31c0 7 7 11 15 11s15-4 15-11M5 33l4-4 4 4M35 33l4-4 4 4" /></svg>
   <b>RESOLUTE</b><span>{en?"Checking…":"確認中…"}</span></section> : <section className={styles.card}>
   <h1>{en?"Your investing rules":"自分の投資ルール"}</h1><p role="status">{message}</p>
   {access==="signed-out" ? <Link href="/research/account" prefetch={false}>{en?"Sign in":"ログイン"}</Link> : null}
   {access==="mfa" ? <Link href="/research/account/security" prefetch={false}>{en?"Open security settings":"セキュリティ設定を開く"}</Link> : null}
   <button type="button" className={styles.secondary} onClick={()=>setAttempt(n=>n+1)}>{en?"Check again":"再確認"}</button>
  </section>;
 const reviewNote=review ? <p className={styles.reviewNote}>{en ? "Owner preview · You can choose to save on this device. No notifications are sent." : "運営者専用の確認画面です。端末への保存は上の設定で選べます。通知は送信しません。"}</p> : null;
 // PC (owner, Nov 25): the menu stays open on the left (ホーム, the six steps, the tools) and the page fills the rest.
 if(pc && desktop) return <main className={`${styles.page} ${pc_.page}`} lang={locale}><div className={pc_.frame}>
  <aside className={pc_.side}>
   <Link href="/resolute" prefetch className={pc_.logo} aria-label="RESOLUTE">
    <span className={pc_.logoMark}><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="9" r="4" /><path d="M24 13v28M17 19h14M9 31c0 7 7 11 15 11s15-4 15-11M5 33l4-4 4 4M35 33l4-4 4 4" /></svg>RESOLUTE</span>
    <small>YOUR PERSONAL KIT</small></Link>
   <nav className={pc_.nav} aria-label={en?"RESOLUTE menu":"RESOLUTEのメニュー"}>
    <Link href="/resolute" prefetch className={pc_.item} aria-current={current==="/resolute"?"page":undefined}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/></svg><span>{en?"Home":"ホーム"}</span></Link>
    <h2 className={pc_.sec}>{en?"Six steps":"6つのステップ"}</h2>
    {STEPS.map(([href,ja,eng],index)=><Link key={href} href={href} prefetch={false} className={`${pc_.item} ${pc_.stepItem}`} aria-current={current===href?"page":undefined}><i>{index+1}</i><span>{en?eng:ja}</span><Pending /></Link>)}
    <h2 className={pc_.sec}>{en?"Tools":"道具"}</h2>
    {TOOLS.map(([href,ja,eng,icon])=><Link key={href} href={href} prefetch={false} className={pc_.item} aria-current={current===href?"page":undefined}><svg viewBox="0 0 24 24" aria-hidden="true">{icon}</svg><span>{en?eng:ja}</span><Pending /></Link>)}
   </nav>
   <div className={pc_.langs} role="group" aria-label={en?"Display language":"表示言語"}>
    <button type="button" aria-pressed={locale==="ja"} onClick={()=>setLocale("ja")}>JA</button>
    <button type="button" aria-pressed={en} onClick={()=>setLocale("en")}>EN</button>
   </div>
  </aside>
  <div className={pc_.main}>{body}{reviewNote}</div>
 </div></main>;
 return <main className={`${styles.page} ${home?styles.homePage:""}`} lang={locale}><div className={`${home?styles.homeWrap:styles.wrap} ${h.shell}`}>
  <header className={`${h.bar} ${home?h.inHome:""}`}>
   <button type="button" className={h.menuBtn} aria-expanded={menuOpen} aria-controls="resolute-tools" onClick={()=>setMenuOpen(open=>!open)}>
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d={menuOpen?"M4 4l12 12M16 4L4 16":"M3 5h14M3 10h14M3 15h14"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>{menuOpen?(en?"Close":"閉じる"):(en?"Menu":"メニュー")}</button>
   {home ? <span /> : <Link href="/resolute" className={h.brand} prefetch>RESOLUTE</Link>}
   <div className={h.langs} role="group" aria-label={en?"Display language":"表示言語"}>
    <button type="button" aria-pressed={locale==="ja"} onClick={()=>setLocale("ja")}>JA</button>
    <button type="button" aria-pressed={en} onClick={()=>setLocale("en")}>EN</button>
   </div></header>
  {home ? null : <HomeLink en={en} />}
  {menuOpen ? <nav id="resolute-tools" className={h.menu} aria-label={en?"RESOLUTE menu":"RESOLUTEのメニュー"}>
   <h2 className={h.sec}>{en?"Six steps":"6つのステップ"}</h2>
   <div className={h.steps}>{STEPS.map(([href,ja,eng],index)=>
    <Link key={href} href={href} onClick={leave(href)} prefetch={false} className={h.step} aria-current={current===href?"page":undefined}><i>{index+1}</i><span>{en?eng:ja}</span><Pending /></Link>)}</div>
   <h2 className={h.sec}>{en?"Tools":"道具"}</h2>
   <div className={h.tools}>{TOOLS.map(([href,ja,eng,icon])=>
    <Link key={href} href={href} onClick={leave(href)} prefetch={false} className={h.tool} aria-current={current===href?"page":undefined}><svg viewBox="0 0 24 24" aria-hidden="true">{icon}</svg><span>{en?eng:ja}</span><Pending /><svg className={h.chev} viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></Link>)}</div>
   {!reviewing ? <div className={h.foot}>
    <Link href="/resolute/settings#home-screen" prefetch={false}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2.5"/><path d="M12 9v6M9 12h6"/></svg>{en?"Add to Home Screen":"ホーム画面に追加する方法"}</Link>
    <Link href="/research" prefetch={false}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>{en?"Tech Phase":"Tech Phaseへ"}</Link>
    <Link href="/resolute/settings" prefetch={false} className={h.lang}>{en?"Language and time zone":"言語とタイムゾーン"} ›</Link>
   </div> : null}
  </nav> : null}
  {body}
  {reviewNote}
  {home && !reviewing ? <AddToHomeCard en={en} /> : null}
 </div></main>;
}
/** A small gold dot on the tapped menu item while its page is on the way, so the tap is seen to have worked. */
function Pending() { const { pending } = useLinkStatus(); return <i className={`${h.pending} ${pending?h.on:""}`} aria-hidden="true" />; }
