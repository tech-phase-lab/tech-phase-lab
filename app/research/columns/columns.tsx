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
  const kind = initialKind;
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
  return <ResearchToolShell desk lang={lang} setLang={setLang} title={initialKind === "all" ? "RIZEL’S DESK" : initialKind === "qa" ? ja ? "リゼルに聞く" : "Ask RIZEL" : postNames[initialKind][lang]} description="">
    {result.status === "loading" && <p role="status">{ja ? "記事を確認中…" : "Loading articles…"}</p>}
    {result.status === "error" && <div role="status"><p>{ja ? "記事を読み込めませんでした。" : "Unable to load articles."}</p><button onClick={() => setRetry(v => v + 1)}>{ja ? "再読み込み" : "Retry"}</button></div>}
    {result.status === "ready" && !result.items.filter(item => kind === "all" || item.kind === kind).length && <section className={styles.article}><h2>{kind === "all" ? ja ? "公開記事は準備中です" : "Articles are being prepared" : ja ? "この種類の記事はまだありません" : "No articles in this category yet"}</h2><p>{ja ? "公開された投稿がここに並びます。" : "Published posts will appear here."}</p><Link href="/research/account">{ja ? "会員情報を確認する" : "View membership"}</Link></section>}
    {result.items.filter(item => kind === "all" || item.kind === kind).map(item => <article className={styles.article} id={item.id} key={item.id}>
      <p className={styles.meta}>{item.kind !== "notes" && <>{postNames[item.kind][lang]} · </>}{new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { dateStyle: "medium", timeZone: "Asia/Tokyo" }).format(new Date(item.publishedAt!))}</p>
      {item.kind !== "notes" && <><h2>{ja ? item.titleJa : item.titleEn}</h2><p className={styles.text}>{ja ? item.introJa : item.introEn}</p></>}
      {!ja && item.translationStatus === "pending" ? <p>Translation pending.</p> : result.access === "pro" ? <><div className={styles.text}>{ja ? item.bodyJa : item.bodyEn}</div>{item.sources.length > 0 && <footer><h3>{ja ? "出典" : "Sources"}</h3>{item.sources.map((source, index) => <a key={index} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>)}</footer>}</> : <aside><p>{ja ? "この先の本文はPRO会員向けです。" : "The full article is available to PRO members."}</p><Link href="/research/account">{ja ? "ログイン・会員情報" : "Sign in / Membership"}</Link></aside>}
    </article>)}
  </ResearchToolShell>;
}
