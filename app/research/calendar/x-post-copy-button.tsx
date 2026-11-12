"use client";

import { useEffect, useState } from "react";
import type { ResultBrief } from "@/lib/research/market-results";
import { buildXPost, parseAmount, type EpsConsensus, type XPostMode } from "@/lib/research/x-post-copy";
import calendarStyles from "./event-calendar.module.css";

/** Copy-ready X post (Japanese) built only from the flash's own figures; the EPS consensus is attached only when it matches (same quarter, same EPS basis). */
export default function XPostCopyButton({ brief, lang }: { brief: ResultBrief; lang: "ja" | "en" }) {
  const [mode, setMode] = useState<XPostMode>("short");
  const [consensus, setConsensus] = useState<EpsConsensus | null>(null);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const eps = brief.facts.find(fact => fact.key === "eps");
  const epsValue = eps ? parseAmount(eps.value) : null;
  useEffect(() => {
    if (epsValue === null) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ ticker: brief.ticker, at: brief.publishedAt, eps: String(epsValue) });
    fetch(`/api/research/earnings-consensus?${query}`, { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(body => setConsensus(body?.consensus ?? null)).catch(() => {});
    return () => controller.abort();
  }, [brief.ticker, brief.publishedAt, epsValue]);
  const text = buildXPost(brief, consensus, mode);
  if (!text) return null;
  const ja = lang === "ja";
  const copy = async () => { try { await navigator.clipboard.writeText(text); setState("copied"); } catch { setState("failed"); } setTimeout(() => setState("idle"), 2500); };
  return <div className={calendarStyles.xPost}>
    <div role="group" aria-label={ja ? "投稿文の形式" : "Post format"}>
      <button type="button" aria-pressed={mode === "short"} onClick={() => setMode("short")}>{ja ? "短い形" : "Short"}</button>
      <button type="button" aria-pressed={mode === "consensus"} onClick={() => setMode("consensus")}>{ja ? "予想つき" : "With forecast"}</button>
    </div>
    <pre>{text}</pre>
    {mode === "consensus" && !consensus && <small>{ja ? "予想なし（取得できた予想がないか、実績と基準が合いません）。売上高の予想は取得していません。" : "No forecast available (none found, or its basis differs). Revenue forecasts are not available."}</small>}
    <button type="button" onClick={copy}>{state === "copied" ? (ja ? "コピーしました" : "Copied") : state === "failed" ? (ja ? "コピーできませんでした" : "Copy failed") : (ja ? "X投稿用にコピー" : "Copy for X")}</button>
  </div>;
}
