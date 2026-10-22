"use client";
import { useEffect, useState } from "react";
import type { Language } from "@/lib/research/data";
import type { Freshness } from "@/lib/research/freshness";
import { observePageActivity } from "@/lib/research/page-activity";
import styles from "./freshness-notice.module.css";

const POLL_MS = 60_000;
const jst = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));

/** Shown only while new information is not arriving; says when the page was last updated (owner, Oct 22). */
export default function FreshnessNotice({ lang }: { lang: Language }) {
  const [freshness, setFreshness] = useState<Freshness | null>(null);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      try {
        const response = await fetch("/api/research/freshness", { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as Freshness;
        if (alive && ["ok", "delayed", "unreachable"].includes(body.status)) setFreshness({ status: body.status, lastCycleAt: typeof body.lastCycleAt === "string" ? body.lastCycleAt : undefined });
      } catch { /* Offline or interrupted: say nothing rather than guess. */ }
    };
    const stop = observePageActivity(() => { void load(); timer ??= setInterval(load, POLL_MS); }, () => { clearInterval(timer); timer = undefined; });
    void load(); timer = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(timer); stop(); };
  }, []);
  if (!freshness || freshness.status === "ok") return null;
  const ja = lang === "ja";
  const at = freshness.lastCycleAt ? jst(freshness.lastCycleAt) : null;
  const text = freshness.status === "delayed"
    ? (ja ? `情報の取得に遅れが出ています。${at ? `最新の更新は${at}（日本時間）です。` : ""}` : `Updates are running behind.${at ? ` Latest update: ${at} JST.` : ""}`)
    : (ja ? "情報の取得先に接続できていません。表示は保存済みの内容です。" : "We can't reach the data source right now. Showing saved content.");
  return <p className={styles.notice} role="status" lang={lang}>{text}</p>;
}
