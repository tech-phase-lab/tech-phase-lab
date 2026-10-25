"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./format.module.css";
const choices = [{ key: "like", emoji: "👍", ja: "いいね", en: "Like" }, { key: "smile", emoji: "😊", ja: "スマイル", en: "Smile" }, { key: "fire", emoji: "🔥", ja: "炎", en: "Fire" }] as const;
type Counts = Record<string, { count: number; selected: boolean }>;
export default function Reactions({ postId, ja }: { postId: string; ja: boolean }) {
  const [counts, setCounts] = useState<Counts | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/research/desk-reactions?postId=${encodeURIComponent(postId)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }).then(async response => { const data = await response.json(); if (!response.ok || !data.ok) throw Error(); if (!controller.signal.aborted) setCounts(data.reactions); }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [postId]);
  async function react(key: string) {
    if (!counts || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(false);
    try {
      const response = await fetch("/api/research/desk-reactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId, emoji: key, selected: !counts[key].selected }), signal: AbortSignal.timeout(10000) });
      const data = await response.json(); if (!response.ok || !data.ok) throw Error(); setCounts(data.reactions);
    } catch { setError(true); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className={styles.reactions} aria-label={ja ? "リアクション" : "Reactions"}>{choices.map(choice => <button type="button" key={choice.key} aria-label={ja ? choice.ja : choice.en} aria-pressed={counts?.[choice.key]?.selected ?? false} disabled={!counts || busy} onClick={() => void react(choice.key)}><span aria-hidden="true">{choice.emoji}</span><span>{counts?.[choice.key]?.count ?? "–"}</span></button>)}{error && <small role="status">{ja ? "リアクションを取得・保存できませんでした。" : "Could not load or save reactions."}</small>}</div>;
}
