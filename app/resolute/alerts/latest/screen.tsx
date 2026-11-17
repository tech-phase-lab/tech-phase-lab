"use client";
import { useEffect, useRef, useState } from "react";
import ToolShell from "../../tool-shell";
import { ReviewLink as Link } from "../../review-context";
import { latestAlertView, parseLatestAlert, type LatestAlert } from "@/lib/resolute/latest-alert";
import s from "./latest.module.css";

/** 「今日のお知らせ」(owner, Nov 17): the page a ③ phone notification opens. The same content as the alert email: heading, date,
 * 「あなたの計画では…」, one card per stock (close, % from the reference price, the line reached), the check sentence, 「計画を開く」
 * 「今夜のひと息」 and the disclaimer. Only the signed-in member's newest delivered alert, read from RESOLUTE. */
export default function LatestAlertScreen({ identityReady = true }: { identityReady?: boolean }) {
  return <ToolShell identityReady={identityReady}>{(locale, deny) => <Latest locale={locale} deny={deny} />}</ToolShell>;
}
type State = { status: "loading" } | { status: "ready"; alert: LatestAlert | null } | { status: "error" };
export function LatestAlertContent({ locale, state, onRetry }: { locale: "ja" | "en"; state: State; onRetry?: () => void }) {
  const en = locale === "en";
  if (state.status !== "ready" || !state.alert) {
    const text = state.status === "loading" ? (en ? "Loading…" : "読み込んでいます…")
      : state.status === "error" ? (en ? "We couldn’t load the alert." : "お知らせを読み込めませんでした。")
      : (en ? "No alerts yet." : "まだお知らせはありません。");
    return <div className={s.root}><div className={s.wrap}>
      <div className={s.brand}>RESOLUTE</div><h1>{en ? "Today's alert" : "今日のお知らせ"}</h1>
      <p className={s.status} role="status">{text}</p>
      {state.status === "error" && onRetry ? <button type="button" className={s.ghost} onClick={onRetry}>{en ? "Try again" : "もう一度読み込む"}</button> : null}
      <Link className={s.ghost} href="/resolute/alerts">{en ? "Closing-price alerts" : "終値アラートの設定"}</Link>
    </div></div>;
  }
  const v = latestAlertView(state.alert, locale);
  return <div className={s.root}><div className={s.wrap}>
    <div className={s.brand}>{v.eyebrow}</div>
    <h1>{v.title}</h1>
    <p className={s.date}>{v.date}</p>
    {v.notes.map(note => <p key={note} className={s.note}>{note}</p>)}
    <ul className={s.cards}>{v.cards.map(card => <li key={card.symbol} className={s.card}>
      <div className={s.cardHead}><b className={s.symbol}>{card.symbol}</b><span className={`${s.chip} ${card.rise ? s.rise : ""}`}>{card.chip}</span></div>
      <p className={s.close}>{card.text}</p>
    </li>)}</ul>
    <p className={s.note}>{v.check}</p>
    <Link className={s.primary} href="/resolute/notebook">{v.openPlan}</Link>
    <Link className={s.ghost} href="/resolute/tonight">{v.tonight}</Link>
    <p className={s.disc}>{v.disclaimer}</p>
  </div></div>;
}
function Latest({ locale, deny }: { locale: "ja" | "en"; deny: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const denyRef = useRef(deny);
  useEffect(() => { denyRef.current = deny; }, [deny]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/resolute/latest-alert", { cache: "no-store", credentials: "same-origin", redirect: "error",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]) });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) { denyRef.current(); return; }
        if (!response.ok) throw new Error("unavailable");
        const text = await response.text();
        if (text.length > 8192) throw new Error("unavailable");
        const { alert } = parseLatestAlert(JSON.parse(text));
        if (!controller.signal.aborted) setState({ status: "ready", alert });
      } catch { if (!controller.signal.aborted) setState({ status: "error" }); }
    })();
    return () => controller.abort();
  }, [attempt]);
  return <LatestAlertContent locale={locale} state={state} onRetry={() => { setState({ status: "loading" }); setAttempt(v => v + 1); }} />;
}
