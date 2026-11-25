"use client";
import { useEffect, useRef, useState } from "react";
import ToolShell from "../../tool-shell";
import { ReviewLink as Link, useNotificationClient, usePlanClient } from "../../review-context";
import { latestAlertView, parseLatestAlert, type LatestAlert, type LatestAlertContext } from "@/lib/resolute/latest-alert";
import { ruleFacts } from "@/lib/resolute/plan-rules";
import type { PlanSnapshot } from "@/lib/resolute/plan-data";
import type { NotificationSnapshot } from "@/lib/resolute/notification-settings";
import { useRemembered } from "../../features/use-remembered";
import { useDesktop } from "../../use-desktop";
import styles from "../../diagnosis.module.css";
import pc from "../../pc.module.css";
import s from "./latest.module.css";

/** 「今日のお知らせ」(owner, Nov 17; wording Nov 25): the page a ③ phone notification opens. Heading, the sentence 「…の終値で、
 * あなたのラインに届いた銘柄です。」, one card per stock (close, % from the reference price, the line reached, the member's own rule),
 * 「今日やること」, 「計画を開く」「今夜のひと息」. Only the signed-in member's newest delivered alert, read from RESOLUTE.
 * On PC (02_終値アラート_PC 2) the cards are on the left (two per row from three stocks) and 「今日やること」 on the right. */
export default function LatestAlertScreen({ identityReady = true }: { identityReady?: boolean }) {
  return <ToolShell identityReady={identityReady} pc>{(locale, deny) => <Latest locale={locale} deny={deny} />}</ToolShell>;
}
type State = { status: "loading" } | { status: "ready"; alert: LatestAlert | null } | { status: "error" };
export function LatestAlertContent({ locale, state, onRetry, context, wide = false }: { locale: "ja" | "en"; state: State; onRetry?: () => void; context?: LatestAlertContext; wide?: boolean }) {
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
  const v = latestAlertView(state.alert, locale, context);
  if (wide) return <div className={pc.content}>
    <header className={pc.head}><div><p className={pc.eyebrow}><b>TODAY&apos;S NOTICE</b>{v.title}</p><h1 className={pc.title}>{v.title}</h1><p className={pc.lead}>{v.lead}</p></div></header>
    <div className={pc.noticePair}>
      <section className={`${styles.card} ${pc.panel}`}><h2 className={pc.panelHeading}>{en ? "Stocks that reached your levels" : "ラインに届いた銘柄"}</h2>
        <ul className={`${pc.notices} ${v.cards.length > 1 ? pc.noticesTwo : ""}`}>{v.cards.map(card => <li key={card.symbol} className={`${pc.notice} ${card.rise ? pc.noticeRise : ""}`}>
          <div className={pc.noticeHead}><b>{card.symbol}</b><span>{card.label}</span></div>
          <p className={pc.noticePrice}>{card.price}</p><p className={pc.noticeChange}>{card.change}</p>
          {card.rule ? <div className={pc.noticeRule}><small>{v.rulesLabel}</small><p>{card.rule}</p></div> : null}
        </li>)}</ul>
      </section>
      <section className={`${styles.card} ${pc.panel} ${pc.todo}`}>
        <p className={pc.todoLabel}>{v.todoLabel}</p><h2 className={pc.todoTitle}>{v.todo.title}</h2>
        <p className={pc.todoText}>{v.todo.sentences.map(text => <span key={text}>{text}</span>)}</p>
        <div className={pc.todoActions}><Link className={s.primary} href="/resolute/notebook">{v.openBook} →</Link><Link className={s.ghost} href="/resolute/tonight">{v.tonight}</Link></div>
      </section>
    </div>
  </div>;
  return <div className={s.root}><div className={s.wrap}>
    <div className={s.brand}>{v.eyebrow}</div>
    <h1>{v.title}</h1>
    <p className={s.date}>{v.lead}</p>
    <ul className={s.cards}>{v.cards.map(card => <li key={card.symbol} className={s.card}>
      <div className={s.cardHead}><b className={s.symbol}>{card.symbol}</b><span className={`${s.chip} ${card.rise ? s.rise : ""}`}>{card.chip}</span></div>
      <p className={s.close}>{card.text}</p>
      {card.rule ? <p className={s.rule}><small>{v.rulesLabel}</small>{card.rule}</p> : null}
    </li>)}</ul>
    <div className={s.todo}><small>{v.todoLabel}</small><b>{v.todo.title}</b><p>{v.todo.sentences.join("")}</p></div>
    <Link className={s.primary} href="/resolute/notebook">{v.openPlan}</Link>
    <Link className={s.ghost} href="/resolute/tonight">{v.tonight}</Link>
  </div></div>;
}
function Latest({ locale, deny }: { locale: "ja" | "en"; deny: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const desktop = useDesktop();
  // The member's own rules and saved reference prices, for the rule on each card and 「今日やること」. Shown without them if unavailable.
  const requestPlan = usePlanClient(), requestSettings = useNotificationClient();
  const knownPlan = useRemembered<PlanSnapshot>("plan"), knownSettings = useRemembered<NotificationSnapshot>("notifications");
  const [plan, setPlan] = useState(knownPlan?.plan ?? null), [settings, setSettings] = useState(knownSettings?.settings ?? null);
  const denyRef = useRef(deny);
  useEffect(() => { denyRef.current = deny; }, [deny]);
  useEffect(() => {
    const controller = new AbortController();
    void requestPlan(undefined, controller.signal).then(p => { if (!controller.signal.aborted) setPlan(p.plan); }, () => {});
    void requestSettings(undefined, controller.signal).then(n => { if (!controller.signal.aborted) setSettings(n.settings); }, () => {});
    return () => controller.abort();
  }, [requestPlan, requestSettings]);
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
  const context: LatestAlertContext = { rules: plan ? ruleFacts(plan) : null,
    references: Object.fromEntries((settings?.watchItems ?? []).map(i => [i.symbol, i.referencePrice])) };
  return <LatestAlertContent locale={locale} state={state} context={context} wide={desktop} onRetry={() => { setState({ status: "loading" }); setAttempt(v => v + 1); }} />;
}
