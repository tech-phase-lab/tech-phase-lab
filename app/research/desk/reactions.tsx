"use client";
import { useEffect, useRef, useState } from "react";
import { reactionState, type ReactionCounts } from "./reaction-state";
import styles from "./format.module.css";
const choices = [{ key: "like", emoji: "👍", ja: "いいね", en: "Like" }, { key: "smile", emoji: "😊", ja: "うれしい", en: "Happy" }, { key: "sad", emoji: "😢", ja: "悲しい", en: "Sad" }, { key: "angry", emoji: "😠", ja: "怒り", en: "Angry" }, { key: "fire", emoji: "🔥", ja: "炎", en: "Fire" }] as const;
export default function Reactions({ postId, ja }: { postId: string; ja: boolean }) {
  const [counts, setCounts] = useState<ReactionCounts | null>(null), [error, setError] = useState(false), [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  // Only the reactions that were pressed are shown, as "emoji + count" chips; the dotted round button opens the five choices.
  const pressed = choices.filter(choice => (counts?.[choice.key]?.count ?? 0) > 0);
  return <div className={styles.reactions} ref={box} aria-label={ja ? "リアクション" : "Reactions"}>
    {pressed.map(choice => {
      const value = counts![choice.key];
      return <button type="button" key={choice.key} className={styles.reactionChip} aria-label={`${ja ? choice.ja : choice.en} ${value.count}`} aria-pressed={value.selected} onClick={() => react(choice.key)}><span className={styles.reactionEmoji} key={`emoji-${value.selected}`} aria-hidden="true">{choice.emoji}</span><span className={styles.reactionCount} key={`count-${value.count}`} aria-live="polite">{value.count}</span></button>;
    })}
    <span className={styles.reactionAdd}>
      <button type="button" className={styles.reactionPlus} aria-label={ja ? "リアクションを選ぶ" : "Add a reaction"} aria-expanded={open} aria-haspopup="true" disabled={!counts} onClick={() => setOpen(value => !value)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="12" r="8" /><path d="M8 14c.8 1.3 1.8 2 3 2s2.200-.7 3-2M8.800 10v.2M13.200 10v.2M19 3v4M17 5h4" /></svg>
      </button>
      {open && counts && <div className={styles.reactionPicker} role="group" aria-label={ja ? "リアクションの種類" : "Reaction choices"}>{choices.map(choice => <button type="button" key={choice.key} aria-label={ja ? choice.ja : choice.en} aria-pressed={counts[choice.key].selected} onClick={() => { react(choice.key); setOpen(false); }}><span aria-hidden="true">{choice.emoji}</span></button>)}</div>}
    </span>
    {error && <small role="status">{ja ? "通信に失敗しました。もう一度お試しください。" : "Could not sync reactions. Please try again."}</small>}
  </div>;
}
