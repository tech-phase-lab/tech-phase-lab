"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { postNames, type EditorialPost, type PostKind } from "@/lib/research/editorial-posts";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import styles from "./styles.module.css";
type Result = { items: EditorialPost[]; access: string; status: string };
export default function ColumnsPage({ initialKind = "all" }: { initialKind?: PostKind | "all" } = {}) {
  const [lang, setLang] = useResearchLanguage();
  const [kind, setKind] = useState<PostKind | "all">(initialKind);
  const [result, setResult] = useState<Result>({ items: [], access: "", status: "loading" });
  const [retry, setRetry] = useState(0);
  const ja = lang === "ja";
  useEffect(() => {
    let stopped = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      if (stopped) return;
      controller?.abort(); clearTimeout(timer);
      const current = new AbortController(); controller = current;
      setResult({ items: [], access: "", status: "loading" });
      try {
        const response = await fetch("/api/research/posts", { cache: "no-store", signal: AbortSignal.any([current.signal, AbortSignal.timeout(15_000)]) });
        const data = await response.json();
        if (current.signal.aborted || stopped) return;
        if (!response.ok || !data.ok || !Array.isArray(data.items) || !Number.isFinite(data.validUntil) || data.validUntil <= Date.now()) throw new Error("unavailable");
        setResult({ items: data.items, access: data.access, status: "ready" });
        // Never retain a premium body beyond the server's short entitlement lease.
        timer = setTimeout(() => { setResult({ items: [], access: "", status: "loading" }); void load(); }, Math.max(0, Math.min(data.validUntil - Date.now(), 60_000)));
      } catch { if (!current.signal.aborted && !stopped) setResult({ items: [], access: "", status: "error" }); }
    }
    void load();
    window.addEventListener("focus", load); window.addEventListener("tech-phase:membership-changed", load);
    return () => { stopped = true; controller?.abort(); clearTimeout(timer); window.removeEventListener("focus", load); window.removeEventListener("tech-phase:membership-changed", load); };
  }, [retry]);
  return <ResearchToolShell lang={lang} setLang={setLang} title={initialKind === "all" ? ja ? "PROリサーチ・コラム" : "PRO Research & Columns" : postNames[initialKind][lang]} description={initialKind === "qa" ? ja ? "いただいた質問から、テーマを選んでお答えします。" : "RIZEL answers selected topics from your questions." : ja ? "変化と展望、会員の疑問、リゼルの着眼点。" : "Outlooks, member questions, and RIZEL’s perspectives."}>
    <div className={styles.tabs} aria-label={ja ? "記事の種類" : "Article category"}>{(["all", "weekly", "qa", "notes"] as const).map(value => <button aria-pressed={kind === value} key={value} onClick={() => setKind(value)}>{value === "all" ? ja ? "すべて" : "All" : postNames[value][lang]}</button>)}{initialKind !== "notes" && <button disabled={result.status === "loading"} onClick={() => setRetry(v => v + 1)} aria-label={ja ? "投稿を更新" : "Refresh posts"}>↻ {ja ? "更新" : "Refresh"}</button>}</div>
    {result.status === "loading" && <p role="status">{ja ? "記事を確認中…" : "Loading articles…"}</p>}
    {result.status === "error" && <div role="status"><p>{ja ? "記事を読み込めませんでした。" : "Unable to load articles."}</p><button onClick={() => setRetry(v => v + 1)}>{ja ? "再読み込み" : "Retry"}</button></div>}
    {result.status === "ready" && !result.items.filter(item => kind === "all" || item.kind === kind).length && <section className={styles.article}><h2>{kind === "all" ? ja ? "公開記事は準備中です" : "Articles are being prepared" : ja ? "この種類の記事はまだありません" : "No articles in this category yet"}</h2><p>{ja ? "週刊PRO・リサーチQ&A・リゼルのひとりごとは、公開後にここへ掲載されます。非公開の編集見本は、PRO会員にも表示されません。" : "PRO Weekly, Research Q&A and RIZEL’s Notes will appear here once published. Private editorial samples are not visible to PRO members."}</p><Link href="/research/account">{ja ? "会員情報を確認する" : "View membership"}</Link></section>}
    {result.items.filter(item => kind === "all" || item.kind === kind).map(item => <article className={styles.article} id={item.id} key={item.id}>
      <p className={styles.meta}>{postNames[item.kind][lang]} · {new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { dateStyle: "medium", timeZone: "Asia/Tokyo" }).format(new Date(item.publishedAt!))}</p>
      {item.kind !== "notes" && <><h2>{ja ? item.titleJa : item.titleEn}</h2><p className={styles.text}>{ja ? item.introJa : item.introEn}</p></>}
      {!ja && item.translationStatus === "pending" ? <p>Translation pending.</p> : result.access === "pro" ? <><div className={styles.text}>{ja ? item.bodyJa : item.bodyEn}</div>{item.sources.length > 0 && <footer><h3>{ja ? "出典" : "Sources"}</h3>{item.sources.map((source, index) => <a key={index} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>)}</footer>}</> : <aside><p>{ja ? "この先の本文はPRO会員向けです。" : "The full article is available to PRO members."}</p><Link href="/research/account">{ja ? "ログイン・会員情報" : "Sign in / Membership"}</Link></aside>}
    </article>)}
  </ResearchToolShell>;
}
