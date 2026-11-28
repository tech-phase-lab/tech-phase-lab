"use client";

import { useState } from "react";
import type { ResultBrief, ResultFact } from "@/lib/research/market-results";
import { buildXPost, type EpsConsensus, type XPostMode } from "@/lib/research/x-post-copy";
import { postable } from "@/lib/research/earnings-table";
import calendarStyles from "./event-calendar.module.css";

/** Copy-ready X post (Japanese) built only from the flash's own figures, the company's previous outlook when held, and the EPS consensus
 * when it matches (same quarter, same EPS basis: `consensusKey`). Every line carries ⭕️ ❌ ⚠️ or ✅ (owner, Nov 28). Shown only for a
 * result with revenue, EPS and the company's guidance (owner, Nov 23), to the owner accounts. */
export default function XPostCopyButton({ brief, lang, consensus = null, consensusKey = null, facts = brief.facts }: {
  brief: ResultBrief; lang: "ja" | "en"; consensus?: EpsConsensus | null; consensusKey?: string | null; facts?: ResultFact[];
}) {
  const [mode, setMode] = useState<XPostMode>("short");
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const text = postable(facts) ? buildXPost({ ...brief, facts }, consensus, mode, consensusKey) : null;
  if (!text) return null;
  const ja = lang === "ja";
  const copy = async () => { try { await navigator.clipboard.writeText(text); setState("copied"); } catch { setState("failed"); } setTimeout(() => setState("idle"), 2500); };
  return <details className={calendarStyles.xPost}>
    <summary>{ja ? "X投稿用にコピー" : "Copy for X"}</summary>
    <div role="group" aria-label={ja ? "投稿文の形式" : "Post format"}>
      <button type="button" aria-pressed={mode === "short"} onClick={() => setMode("short")}>{ja ? "短い形" : "Short"}</button>
      <button type="button" aria-pressed={mode === "consensus"} onClick={() => setMode("consensus")}>{ja ? "すべての数字" : "All figures"}</button>
    </div>
    <pre>{text}</pre>
    <button type="button" onClick={copy}>{state === "copied" ? (ja ? "コピーしました" : "Copied") : state === "failed" ? (ja ? "コピーできませんでした" : "Copy failed") : (ja ? "コピー" : "Copy")}</button>
  </details>;
}
