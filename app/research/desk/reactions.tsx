"use client";
import { useEffect, useRef, useState } from "react";
import { reactionState, shortCount, type ReactionCounts } from "./reaction-state";
import styles from "./format.module.css";
const choices = [{ key: "like", emoji: "👍", ja: "いいね", en: "Like" }, { key: "smile", emoji: "😊", ja: "うれしい", en: "Happy" }, { key: "sad", emoji: "😢", ja: "悲しい", en: "Sad" }, { key: "angry", emoji: "😠", ja: "怒り", en: "Angry" }, { key: "fire", emoji: "🔥", ja: "炎", en: "Fire" }] as const;
export default function Reactions({ postId, ja }: { postId: string; ja: boolean }) {
  const [counts, setCounts] = useState<ReactionCounts | null>(null), [error, setError] = useState(false);
  const control = useRef<ReturnType<typeof reactionState> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function request(key?: string, selected?: boolean) {
      const response = await fetch(key ? "/api/research/desk-reactions" : `/api/research/desk-reactions?postId=${encodeURIComponent(postId)}`, { cache: "no-store", ...(key ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId, emoji: key, selected }) } : {}), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
      const data = await response.json(); if (!response.ok || !data.ok) throw Error();
      return Object.fromEntries(choices.map(choice => [choice.key, data.reactions[choice.key] ?? { count: 0, selected: false }])) as ReactionCounts;
    }
    request().then(data => {
      if (controller.signal.aborted) return;
      control.current = reactionState(data, value => { if (!controller.signal.aborted) setCounts(value); }, request, () => { if (!controller.signal.aborted) setError(true); });
      setCounts(data);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); control.current = null; };
  }, [postId]);
  function react(key: string) {
    if (!control.current) return;
    setError(false); control.current.toggle(key);
    // iOS does not provide the Vibration API; the visual response still runs.
    if (typeof navigator.vibrate === "function") navigator.vibrate(8);
  }
  // All five choices sit in one row from the start, in this order. A count appears only once someone has pressed it.
  return <div className={styles.reactions} aria-label={ja ? "リアクション" : "Reactions"} role="group">
    <div className={styles.reactionRow}>
      {choices.map(choice => {
        const value = counts?.[choice.key] ?? { count: 0, selected: false };
        const label = ja ? choice.ja : choice.en;
        return <button type="button" key={choice.key} className={styles.reactionChip} aria-label={value.count > 0 ? `${label} ${value.count}` : label} aria-pressed={value.selected} disabled={!counts} onClick={() => react(choice.key)}><span className={styles.reactionEmoji} key={`emoji-${value.selected}`} aria-hidden="true">{choice.emoji}</span>{value.count > 0 && <span className={styles.reactionCount} key={`count-${value.count}`} aria-hidden="true">{shortCount(value.count)}</span>}</button>;
      })}
    </div>
    {error && <small role="status">{ja ? "通信に失敗しました。もう一度お試しください。" : "Could not sync reactions. Please try again."}</small>}
  </div>;
}
