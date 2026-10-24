"use client";
import { useIdentityRefresh } from "../identity-provider";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { postNames, type EditorialPost, type PostKind } from "@/lib/research/editorial-posts";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import questionStyles from "../qa/styles.module.css";
import styles from "./styles.module.css";
import { scheduleLeaseRenewal } from "@/lib/research/display-lease";
import WeeklyComposer from "../weekly/composer";
import { weeklySections } from "@/lib/research/weekly";
import NoteComposer from "../notes/composer";
import { useMemberDisplay, useOwnerMode } from "../member-display-provider";
type Result = { items: EditorialPost[]; access: string; status: string; validUntil?: number };
export default function ColumnsPage({ initialKind = "all", initial }: { initialKind?: PostKind | "all"; initial?: Result } = {}) {
  const refreshIdentity = useIdentityRefresh();
  const [lang, setLang] = useResearchLanguage();
  const kind = initialKind;
  const memberPlan = useMemberDisplay();
  const ownerMode = useOwnerMode();
  const [result, setResult] = useState<Result>(initial ?? { items: [], access: "", status: "loading" });
  const latest = useRef(result);
  useEffect(() => { latest.current = result; }, [result]);
  const [retry, setRetry] = useState(0);
  const ja = lang === "ja";
  useEffect(() => {
    let stopped = false;
    let controller: AbortController | undefined;
    let cancelLease: (() => void) | undefined;
    function accept(data: Result) {
      cancelLease?.();
      latest.current = data; setResult(data);
      cancelLease = scheduleLeaseRenewal(data.validUntil!, () => { void load(); }, () => {
        latest.current = { items: [], access: "", status: "loading" };
        setResult(latest.current);
      });
    }
    async function load(invalidate = false) {
      if (stopped) return;
      controller?.abort();
      const current = new AbortController(); controller = current;
      // Background renewal keeps the current server-authorized body on screen.
      // Explicit identity changes invalidate it immediately.
      if (invalidate || latest.current.status !== "ready" || !(latest.current.validUntil! > Date.now())) {
        cancelLease?.();
        latest.current = { items: [], access: "", status: "loading" };
        setResult(latest.current);
      }
      try {
        await refreshIdentity();
        const response = await fetch("/api/research/posts", { cache: "no-store", signal: AbortSignal.any([current.signal, AbortSignal.timeout(15_000)]) });
        const data = await response.json();
        if (current.signal.aborted || stopped) return;
        if (!response.ok || !data.ok || !Array.isArray(data.items) || !Number.isFinite(data.validUntil) || data.validUntil <= Date.now()) throw new Error("unavailable");
        accept({ items: data.items, access: data.access, status: "ready", validUntil: data.validUntil });
      } catch { if (!current.signal.aborted && !stopped) {
        cancelLease?.(); latest.current = { items: [], access: "", status: "error" }; setResult(latest.current);
      } }
    }
    // A reused route can carry an older Free projection after the member switches to PRO.
    // Only reuse server data that agrees with the current verified display state.
    const initialMatches = memberPlan === null || (initial?.access === "pro") === (memberPlan === "pro");
    if (initial && retry === 0 && initial.validUntil! > Date.now() && initialMatches) {
      accept(initial);
    }
    else {
      // Re-arm the expiry guard if this effect restarts during a valid lease.
      if (latest.current.status === "ready" && latest.current.validUntil! > Date.now()) accept(latest.current);
      void load();
    }
    const focused = () => { void load(); };
    const changed = () => { void load(true); };
    window.addEventListener("focus", focused); window.addEventListener("tech-phase:membership-changed", changed);
    return () => { stopped = true; controller?.abort(); cancelLease?.(); window.removeEventListener("focus", focused); window.removeEventListener("tech-phase:membership-changed", changed); };
  }, [retry, initial, memberPlan, refreshIdentity]);
  const membershipMismatch = memberPlan !== null && result.status === "ready" && (result.access === "pro") !== (memberPlan === "pro");
  const shown = membershipMismatch ? { items: [], access: "", status: "loading" } : result;
  return <ResearchToolShell desk lang={lang} setLang={setLang} title={initialKind === "all" ? "RIZEL’S DESK" : initialKind === "qa" ? ja ? "リゼルに聞く" : "Ask RIZEL" : postNames[initialKind][lang]} description="">
    {initialKind === "weekly" && ownerMode && <WeeklyComposer onPublished={() => setRetry(value => value + 1)} />}
    {initialKind === "all" && <nav className={styles.writeAction}><Link href="/research/weekly">{ja ? "週刊 Tech Phase PRO" : "Tech Phase PRO Weekly"}</Link></nav>}
    {initialKind === "qa" && <nav className={questionStyles.views} aria-label={ja ? "質問メニュー" : "Question views"}><Link href="/research/qa">{ja ? "みんなの質問" : "Questions"}</Link><span aria-current="page">{ja ? "公開された回答" : "Published answers"}</span></nav>}
    {initialKind === "notes" && ownerMode && <NoteComposer onPublished={() => setRetry(value => value + 1)} />}
    {shown.status === "loading" && <div className={styles.placeholder} aria-busy="true" aria-label={ja ? "記事を読み込んでいます" : "Loading articles"} />}
    {shown.status === "error" && <div role="status"><p>{ja ? "記事を読み込めませんでした。" : "Unable to load articles."}</p><button onClick={() => setRetry(v => v + 1)}>{ja ? "再読み込み" : "Retry"}</button></div>}
    {shown.status === "ready" && !shown.items.filter(item => kind === "all" || item.kind === kind).length && <section className={styles.article}><h2>{kind === "all" ? ja ? "公開記事は準備中です" : "Articles are being prepared" : ja ? "この種類の記事はまだありません" : "No articles in this category yet"}</h2><p>{ja ? "公開された投稿がここに並びます。" : "Published posts will appear here."}</p><Link href="/research/account">{ja ? "会員情報を確認する" : "View membership"}</Link></section>}
    {shown.items.filter(item => kind === "all" || item.kind === kind).map(item => <article className={`${styles.article} ${item.kind === "notes" ? styles.note : item.kind === "qa" ? styles.qaArticle : ""}`} id={item.id} key={item.id}>
      <div className={item.kind === "notes" ? styles.noteHeader : undefined}>
      {item.kind === "notes" && <div className={styles.noteAvatar}><Image src="/rizel-avatar.webp" alt={ja ? "リゼル" : "RIZEL"} width={46} height={46} unoptimized /></div>}
      {item.kind !== "notes" && <p className={styles.meta}>{postNames[item.kind][lang]} · <time dateTime={item.publishedAt!}>{new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { dateStyle: "medium", timeZone: "Asia/Tokyo" }).format(new Date(item.publishedAt!))}</time></p>}
      </div>
      <div className={item.kind === "notes" ? styles.noteBubble : undefined}>
      {item.kind === "notes" && <p className={styles.meta}><time dateTime={item.publishedAt!}>{new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: "Asia/Tokyo" }).format(new Date(item.publishedAt!))}<small className={styles.zone}> JST</small></time></p>}
      {item.kind !== "notes" && <>{item.kind === "qa" && <p className={styles.questionLabel}>{ja ? "質問" : "QUESTION"}</p>}<h2>{ja ? item.titleJa : item.titleEn}</h2><p className={styles.text}>{ja ? item.introJa : item.introEn}</p></>}
      {!ja && item.translationStatus === "pending" ? <p>Translation pending.</p> : shown.access === "pro" ? <>{item.kind === "qa" && <div className={styles.answerLabel}><span>{ja ? "リゼルの回答" : "RIZEL’S ANSWER"}</span><Image src="/rizel-avatar.webp" alt={ja ? "リゼル" : "RIZEL"} width={32} height={32} unoptimized /></div>}<div className={`${styles.text} ${item.kind === "qa" ? styles.qaBody : ""}`}>{item.kind === "weekly" ? weeklySections(ja ? item.bodyJa : item.bodyEn).map((section,index)=><details key={index} className={styles.weeklySection} open={index===0}><summary>{section.title || (ja ? "本文" : "Report")}</summary><p>{section.body}</p></details>) : ja ? item.bodyJa : item.bodyEn}</div>{item.sources.length > 0 && (item.kind === "weekly" ? <footer className={styles.weeklySourceFooter}><details className={styles.weeklySources}><summary>{ja ? "出典" : "Sources"}</summary><ul>{item.sources.map((source, index) => <li key={index}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a></li>)}</ul></details></footer> : <footer><h3>{ja ? "出典" : "Sources"}</h3>{item.sources.map((source, index) => <a key={index} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>)}</footer>)}</> : <aside><p>{ja ? "この先の本文はPRO会員向けです。" : "The full article is available to PRO members."}</p><Link href="/research/account">{ja ? "ログイン・会員情報" : "Sign in / Membership"}</Link></aside>}

      </div>
    </article>)}
  </ResearchToolShell>;
}
