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
  // One slow answer (the monitor is busy catching up) is not an outage: say so only after two bad answers in a row.
  const [bad, setBad] = useState(0);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      try {
        const response = await fetch("/api/research/freshness", { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as Freshness;
        if (alive && ["ok", "delayed", "unreachable"].includes(body.status)) {
          setFreshness({ status: body.status, lastCycleAt: typeof body.lastCycleAt === "string" ? body.lastCycleAt : undefined });
          setBad(count => body.status === "ok" ? 0 : count + 1);
        }
      } catch { /* Offline or interrupted: say nothing rather than guess. */ }
    };
    const stop = observePageActivity(() => { void load(); timer ??= setInterval(load, POLL_MS); }, () => { clearInterval(timer); timer = undefined; });
    void load(); timer = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(timer); stop(); };
  }, []);
  if (!freshness || freshness.status === "ok" || bad < 2) return null;
  const ja = lang === "ja";
  const at = freshness.lastCycleAt ? jst(freshness.lastCycleAt) : null;
  // One short line (owner, Oct 22): the kind of problem first, the last update time in the same line.
  const text = freshness.status === "delayed"
    ? (ja ? `更新が遅れています${at ? `（最終 ${at}）` : ""}` : `Updates are delayed${at ? ` (last ${at} JST)` : ""}`)
    : (ja ? "最新情報を取得できていません" : "Can't fetch the latest updates");
  return <p className={styles.notice} role="status" lang={lang}>{text}</p>;
}
