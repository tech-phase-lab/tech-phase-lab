"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { reactionState, shortCount, type ReactionCounts } from "./reaction-state";
import styles from "./format.module.css";
const choices = [{ key: "like", emoji: "👍", ja: "いいね", en: "Like" }, { key: "smile", emoji: "😊", ja: "うれしい", en: "Happy" }, { key: "sad", emoji: "😢", ja: "悲しい", en: "Sad" }, { key: "angry", emoji: "😠", ja: "怒り", en: "Angry" }, { key: "fire", emoji: "🔥", ja: "炎", en: "Fire" }] as const;
const empty = { count: 0, selected: false };
export type Reactions = { counts: ReactionCounts | null; error: boolean; react: (key: string) => void };

/** Loads one note's reactions and keeps the toggle (reactionState) for the face button and the badge. */
export function useReactions(postId: string, enabled: boolean): Reactions {
  const [counts, setCounts] = useState<ReactionCounts | null>(null), [error, setError] = useState(false);
  const control = useRef<ReturnType<typeof reactionState> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    async function request(key?: string, selected?: boolean) {
      const response = await fetch(key ? "/api/research/desk-reactions" : `/api/research/desk-reactions?postId=${encodeURIComponent(postId)}`, { cache: "no-store", ...(key ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId, emoji: key, selected }) } : {}), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
      const data = await response.json(); if (!response.ok || !data.ok) throw Error();
      return Object.fromEntries(choices.map(choice => [choice.key, data.reactions[choice.key] ?? empty])) as ReactionCounts;
    }
    request().then(data => {
      if (controller.signal.aborted) return;
      control.current = reactionState(data, value => { if (!controller.signal.aborted) setCounts(value); }, request, () => { if (!controller.signal.aborted) setError(true); });
      setCounts(data);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); control.current = null; };
  }, [postId, enabled]);
  function react(key: string) {
    if (!control.current) return;
    setError(false); control.current.toggle(key);
    // iOS does not provide the Vibration API; the visual response still runs.
    if (typeof navigator.vibrate === "function") navigator.vibrate(8);
  }
  return { counts: enabled ? counts : null, error: enabled && error, react };
}

/**
 * Nov 17 design (owner): a PRO member reacts through one round face button at the right end of the date line.
 * It opens a small popover right under it with the five emoji in a row; choosing one adds it (or removes it when it
 * is already the member's own, shown with a gold border) and closes. A tap outside or Escape also closes.
 */
export function ReactionFace({ reactions, ja, children }: { reactions: Reactions; ja: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null), face = useRef<HTMLButtonElement>(null);
  const popover = useId();
  const { counts, react } = reactions;
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); face.current?.focus(); } };
    document.addEventListener("pointerdown", outside, true); document.addEventListener("touchstart", outside, true); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("touchstart", outside, true); document.removeEventListener("keydown", key); };
  }, [open]);
  return <div className={styles.postHeader}>{children}<span className={styles.reactionFace} ref={wrap}>
    <button type="button" ref={face} className={styles.faceButton} aria-label={ja ? "リアクションする" : "Add a reaction"} aria-expanded={open} aria-controls={open ? popover : undefined} onClick={() => setOpen(value => !value)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2" /><circle className={styles.faceEye} cx="9" cy="10" r=".8" /><circle className={styles.faceEye} cx="15" cy="10" r=".8" /></svg>
    </button>
    {open && <span id={popover} className={styles.reactionPopover} role="group" aria-label={ja ? "リアクションを選ぶ" : "Choose a reaction"}>
      {choices.map(choice => {
        const value = counts?.[choice.key] ?? empty;
        const label = ja ? choice.ja : choice.en;
        return <button type="button" key={choice.key} className={styles.reactionChoice} aria-label={value.count > 0 ? `${label} ${value.count}` : label} aria-pressed={value.selected} disabled={!counts} onClick={() => { react(choice.key); setOpen(false); face.current?.focus(); }}><span aria-hidden="true">{choice.emoji}</span></button>;
      })}
    </span>}
  </span></div>;
}

/** The counts as a small badge over the bottom-right edge of the post: only emoji with at least one, most first. Shown to the owner too. */
export function ReactionBadge({ reactions, ja }: { reactions: Reactions; ja: boolean }) {
  const { counts, error } = reactions;
  const shown = choices.map(choice => ({ ...choice, count: counts?.[choice.key]?.count ?? 0 })).filter(choice => choice.count > 0).sort((a, b) => b.count - a.count);
  return <>
    {shown.length > 0 && <div className={styles.reactionBadge} role="img" aria-label={`${ja ? "リアクション" : "Reactions"}: ${shown.map(choice => `${ja ? choice.ja : choice.en} ${choice.count}`).join(ja ? "、" : ", ")}`}>
      {shown.map(choice => <span key={choice.key} className={styles.badgeItem} aria-hidden="true"><span className={styles.reactionEmoji}>{choice.emoji}</span><span className={styles.reactionCount} key={`count-${choice.count}`}>{shortCount(choice.count)}</span></span>)}
    </div>}
    {error && <small className={styles.reactionError} role="status">{ja ? "通信に失敗しました。もう一度お試しください。" : "Could not sync reactions. Please try again."}</small>}
  </>;
}
