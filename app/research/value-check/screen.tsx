"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import StockLogo from "../watchlist/stock-logo";
import { useMemberDisplay, useMemberSettled, useOwnerAccount } from "../member-display-provider";
import { useResearchLanguage } from "../use-research-language";
import { FIRST_ROWS, VALUE_UNIVERSES, aboutText, footerLine, growth, parseValueSnapshot, ratio, stockHref, type ValueItem, type ValueList, type ValueSnapshot, type ValueUniverse } from "@/lib/research/value-check";
import styles from "./value-check.module.css";

type State = "loading" | "ready" | "not-ready" | "error" | "sign-in" | "pro-required";

function useValueCheck(allowed: boolean) {
  const [state, setState] = useState<State>("loading");
  const [data, setData] = useState<ValueSnapshot | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    fetch("/api/research/value-check", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
        if (response.ok && body?.ok) { setData(parseValueSnapshot(body)); setState("ready"); return; }
        const error = body?.error;
        setState(error === "sign-in" ? "sign-in" : error === "pro-required" ? "pro-required" : error === "not-ready" || error === "not-connected" ? "not-ready" : "error");
      })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [allowed, attempt]);
  return { state, data, retry: () => { setState("loading"); setAttempt(n => n + 1); } };
}

const Metrics = ({ item, ja, inline }: { item: ValueItem; ja: boolean; inline?: boolean }) => {
  const sales = <>{ja ? "売上" : "Revenue"} <b className={styles.up}>{growth(item.revenueGrowth)}</b></>;
  return inline
    ? <span className={styles.metrics}>PER {ratio(item.pe)}・PSR {ratio(item.ps)}・{sales}</span>
    : <span className={styles.podiumMetrics}><span>PER {ratio(item.pe)}・PSR {ratio(item.ps)}</span><span>{sales}</span></span>;
};

function Band({ list, ja }: { list: ValueList; ja: boolean }) {
  const moves = [...list.changes.in.map(c => ({ ...c, kind: "IN" as const })), ...list.changes.out.map(c => ({ ...c, kind: "OUT" as const }))];
  if (!moves.length) return <div className={styles.band}><p className={styles.bandEmpty}>{ja ? "今日の変化はありません" : "No changes today"}</p></div>;
  const run = (copy: number) => moves.map(move => <span key={`${copy}-${move.kind}-${move.ticker}`} className={styles.move} aria-hidden={copy ? true : undefined}>
    <b className={move.kind === "IN" ? styles.inTag : styles.outTag}>{move.kind}</b><b className={styles.moveTicker}>{move.ticker}</b><span className={styles.moveNumbers}>{move.from}→{move.to}</span>
  </span>);
  // Slow, like the news band: the duration grows with the number of entries so the speed stays the same.
  return <div className={styles.band} aria-label={ja ? "今日の変化" : "Today's changes"}>
    <div className={styles.track} style={{ animationDuration: `${Math.max(14, moves.length * 5)}s` }}>{run(0)}{run(1)}</div>
  </div>;
}

function Podium({ items, ja }: { items: ValueItem[]; ja: boolean }) {
  const order = [items[1], items[0], items[2]];
  const place = [2, 1, 3];
  const tone = ["silver", "gold", "bronze"] as const;
  return <ol className={styles.podium} aria-label={ja ? "1〜3位" : "Top three"}>
    {order.map((item, index) => item ? <li key={item.ticker} className={styles[tone[index]]} value={place[index]}>
      <Link href={stockHref(item.ticker)} className={styles.podiumLink} aria-label={`${place[index]}${ja ? "位" : ""} ${item.ticker} ${ja ? "割安度" : "Value Score"} ${item.score}%`}>
        <StockLogo ticker={item.ticker} className={styles.logo} />
        <b className={styles.podiumTicker}>{item.ticker}{item.in && <i className={styles.inMini}>IN</i>}</b>
        <span className={styles.label}>{ja ? "割安度" : "Value Score"}</span>
        <span className={styles.podiumScore}>{item.score}<small>%</small></span>
        <Metrics item={item} ja={ja} />
        <span className={styles.step} aria-hidden="true">{place[index]}</span>
      </Link>
    </li> : <li key={`empty-${index}`} aria-hidden="true" />)}
  </ol>;
}

function Row({ item, rank, ja }: { item: ValueItem; rank: number; ja: boolean }) {
  return <li>
    <Link href={stockHref(item.ticker)} className={styles.row}>
      <span className={styles.rank} aria-label={`${rank}${ja ? "位" : ""}`}>{rank}</span>
      <StockLogo ticker={item.ticker} className={styles.logo} />
      <span className={styles.names}>
        <b className={styles.ticker}>{item.ticker}{item.in && <i className={styles.inMini}>IN</i>}</b>
        <span className={styles.company}>{ja ? item.ja : item.en}</span>
        <Metrics item={item} ja={ja} inline />
      </span>
      <span className={styles.value}><span className={styles.label}>{ja ? "割安度" : "Value Score"}</span><b>{item.score}<small>%</small></b></span>
    </Link>
  </li>;
}

export default function ValueCheckScreen() {
  const memberPlan = useMemberDisplay();
  const settled = useMemberSettled();
  const owner = useOwnerAccount();
  const plan = owner ? "pro" : memberPlan ?? (settled ? "free" : null);
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const [universe, setUniverse] = useState<ValueUniverse>("tech");
  const [all, setAll] = useState(false);
  const [about, setAbout] = useState(false);
  const { state, data, retry } = useValueCheck(plan === "pro");
  const list = data?.universes[universe];
  const items = list?.items ?? [];
  const shown = all ? items : items.slice(0, FIRST_ROWS);

  return <ResearchToolShell lang={lang} setLang={setLang} title={t("割安判別ツール", "Value Check")} showHeading={false} description="">
    <section className={styles.card} aria-labelledby="value-check-title">
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}><span aria-hidden="true" />VALUE CHECK</p>
          <h1 id="value-check-title">{t("割安判別ツール", "Value Check")}</h1>
        </div>
        <button type="button" className={styles.info} aria-expanded={about} aria-controls="value-check-about" aria-label={t("割安度について", "About the Value Score")} onClick={() => setAbout(open => !open)}>i</button>
      </header>
      {about && <p id="value-check-about" className={styles.about}>{aboutText(data?.basis ?? "trailing", ja)}</p>}

      {plan === null && <p role="status" className={styles.note}>{t("会員情報を確認中…", "Checking membership…")}</p>}
      {plan === "free" && <div className={styles.lock}>
        <p>{t("割安判別ツールはPRO会員限定です", "Value Check is for PRO members")}</p>
        <Link href="/research#tech-phase-pro">{t("Tech Phase PROを見る", "See Tech Phase PRO")}</Link>
      </div>}

      {plan === "pro" && <>
        <div className={styles.switch} role="group" aria-label={t("対象", "Universe")}>
          {VALUE_UNIVERSES.map(option => <button key={option.id} type="button" aria-pressed={universe === option.id} onClick={() => { setUniverse(option.id); setAll(false); }}>{ja ? option.ja : option.en}</button>)}
        </div>
        {state === "loading" && <p role="status" className={styles.note}>{t("データを読み込み中…", "Loading data…")}</p>}
        {state === "not-ready" && <p role="status" className={styles.note}>{t("株価と決算のデータを準備中です。準備ができ次第、ここに順位が入ります。", "The price and earnings data is being prepared. The ranking will appear here once it is ready.")}</p>}
        {(state === "error" || state === "sign-in" || state === "pro-required") && <p role="alert" className={styles.note}>
          {state === "sign-in" ? t("ログインしてください。", "Please sign in.") : state === "pro-required" ? t("PRO会員の期間を確認できませんでした。", "Your PRO membership could not be confirmed.") : t("データを読み込めませんでした。", "The data could not be loaded.")}
          {state === "error" && <button type="button" className={styles.retry} onClick={retry}>{t("再読み込み", "Retry")}</button>}
        </p>}
        {state === "ready" && data && list && <>
          <Band list={list} ja={ja} />
          {items.length ? <>
            <Podium items={items.slice(0, 3)} ja={ja} />
            <ol className={styles.list} start={4}>{shown.slice(3).map((item, index) => <Row key={item.ticker} item={item} rank={index + 4} ja={ja} />)}</ol>
            {!all && items.length > FIRST_ROWS && <button type="button" className={styles.more} onClick={() => setAll(true)}>{t(`すべて見る（${items.length}銘柄）`, `See all (${items.length} stocks)`)}</button>}
          </> : <p className={styles.note}>{t("表示できる銘柄がありません。", "There are no stocks to show.")}</p>}
          <p className={styles.fine}>{footerLine(data.asOf, data.basis, ja)}</p>
        </>}
      </>}
    </section>
    {plan === "pro" && state === "ready" && <p className={styles.credit}>{t("提供：Twelve Data", "Data: Twelve Data")}</p>}
  </ResearchToolShell>;
}
