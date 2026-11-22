"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import StockLogo from "../watchlist/stock-logo";
import StockRowLink from "../stock-row-link";
import { useMemberDisplay, useMemberSettled, useOwnerAccount } from "../member-display-provider";
import { useResearchLanguage } from "../use-research-language";
import { FIRST_ROWS, VALUE_UNIVERSES, aboutText, footerLine, growth, parseValueSnapshot, periodNote, ratio, stockHref, type ValueItem, type ValueList, type ValueSnapshot, type ValueUniverse } from "@/lib/research/value-check";
import styles from "./value-check.module.css";

/** トレジャーハント / Treasure Hunt (owner, Nov 22; formerly 割安判別ツール / Value Check). Internal names (value-check, VALUE_CHECK_ENABLED) stay. */
export const TREASURE_HUNT = { ja: "トレジャーハント", en: "Treasure Hunt" } as const;

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

/** After the ticker: IN (filled) first, then 5年最安 (a thin gold outline, so the two never look alike). */
const Marks = ({ item, ja }: { item: ValueItem; ja: boolean }) => <>
  {item.in && <i className={styles.inMini}>IN</i>}
  {item.low && <i className={styles.lowMini}>{ja ? "5年最安" : "5Y Low"}</i>}
</>;

const Metrics = ({ item, ja, inline }: { item: ValueItem; ja: boolean; inline?: boolean }) => {
  // English uses the US names (P/E, P/S) and a spaced middle dot; PER / PSR and 「・」 are Japanese usage.
  const dot = ja ? "・" : " · ";
  const multiples = ja ? `PER ${ratio(item.pe)}・PSR ${ratio(item.ps)}` : `P/E ${ratio(item.pe)} · P/S ${ratio(item.ps)}`;
  const sales = (lead: string) => <span className={styles.keep}>{lead}{ja ? "売上" : "Revenue"} <b className={styles.up}>{growth(item.revenueGrowth)}</b></span>;
  return inline
    ? <span className={styles.metrics}><span className={styles.keep}>{multiples}</span>{sales(dot)}</span>
    : <span className={styles.podiumMetrics}><span>{multiples}</span>{sales("")}</span>;
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
      <StockRowLink href={stockHref(item.ticker)} className={styles.podiumLink} aria-label={ja ? `${place[index]}位 ${item.ticker} 割安度 ${item.score}%${item.period ? ` ${periodNote(item.period, ja)}` : ""}` : `No. ${place[index]}, ${item.ticker}, Value Score ${item.score}%${item.period ? `, ${periodNote(item.period, ja)}` : ""}`} title={periodNote(item.period, ja) ?? undefined}>
        <StockLogo ticker={item.ticker} className={styles.logo} full />
        <b className={styles.podiumTicker}>{item.ticker}<Marks item={item} ja={ja} /></b>
        <span className={styles.label}>{ja ? "割安度" : "Value Score"}</span>
        <span className={styles.podiumScore}>{item.score}<small>%</small></span>
        <Metrics item={item} ja={ja} />
        <span className={styles.step} aria-hidden="true">{place[index]}</span>
      </StockRowLink>
    </li> : <li key={`empty-${index}`} aria-hidden="true" />)}
  </ol>;
}

function Row({ item, rank, ja }: { item: ValueItem; rank: number; ja: boolean }) {
  return <li>
    <StockRowLink href={stockHref(item.ticker)} className={styles.row}>
      <span className={styles.rank} aria-label={ja ? `${rank}位` : `No. ${rank}`}>{rank}</span>
      <StockLogo ticker={item.ticker} className={styles.logo} full />
      <span className={styles.names}>
        <b className={styles.ticker}>{item.ticker}<Marks item={item} ja={ja} /></b>
        <span className={styles.company}>{ja ? item.ja : item.en}</span>
        <Metrics item={item} ja={ja} inline />
        {item.period && <span className={styles.period}>{periodNote(item.period, ja)}</span>}
      </span>
      <span className={styles.value}><span className={styles.label}>{ja ? "割安度" : "Value Score"}</span><b>{item.score}<small>%</small></b></span>
    </StockRowLink>
  </li>;
}

/** The card: TREASURE HUNT over the heading, no line under it (owner, Nov 22, the same as クジラの足あと), and the 「i」 text.
 * The page and the PRO feature tour's sample share it. */
export function TreasureHuntCard({ ja, basis, children }: { ja: boolean; basis: ValueSnapshot["basis"]; children: ReactNode }) {
  const [about, setAbout] = useState(false);
  return <section className={styles.card} aria-labelledby="treasure-hunt-title">
    <header className={styles.head}>
      <div>
        <p className={styles.eyebrow}><span aria-hidden="true" />TREASURE HUNT</p>
        <h1 id="treasure-hunt-title">{ja ? TREASURE_HUNT.ja : TREASURE_HUNT.en}</h1>
      </div>
      <button type="button" className={styles.info} aria-expanded={about} aria-controls="treasure-hunt-about" aria-label={ja ? "割安度について" : "About the Value Score"} onClick={() => setAbout(open => !open)}>i</button>
    </header>
    {about && <p id="treasure-hunt-about" className={styles.about}>{aboutText(basis, ja)}</p>}
    {children}
  </section>;
}

export function UniverseSwitch({ universe, onChange, ja }: { universe: ValueUniverse; onChange: (universe: ValueUniverse) => void; ja: boolean }) {
  return <div className={styles.switch} role="group" aria-label={ja ? "対象" : "Universe"}>
    {VALUE_UNIVERSES.map(option => <button key={option.id} type="button" aria-pressed={universe === option.id} onClick={() => onChange(option.id)}>{ja ? option.ja : option.en}</button>)}
  </div>;
}

/** One universe's day: the IN / OUT band, the podium, the list down to 7th (すべて見る for the rest) and the footer line.
 * Rendered with key={universe}, so すべて見る closes again when the universe changes. */
export function ValueRanking({ data, universe, ja }: { data: ValueSnapshot; universe: ValueUniverse; ja: boolean }) {
  const [all, setAll] = useState(false);
  const list = data.universes[universe];
  const items = list.items;
  const shown = all ? items : items.slice(0, FIRST_ROWS);
  return <>
    <Band list={list} ja={ja} />
    {items.length ? <>
      <Podium items={items.slice(0, 3)} ja={ja} />
      <ol className={styles.list} start={4}>{shown.slice(3).map((item, index) => <Row key={item.ticker} item={item} rank={index + 4} ja={ja} />)}</ol>
      {!all && items.length > FIRST_ROWS && <button type="button" className={styles.more} onClick={() => setAll(true)}>{ja ? `すべて見る（${items.length}銘柄）` : `See all (${items.length} stocks)`}</button>}
    </> : <p className={styles.note}>{ja ? "表示できる銘柄がありません。" : "No stocks to show."}</p>}
    <p className={styles.fine}>{footerLine(data.asOf, data.basis, ja)}</p>
  </>;
}

export default function TreasureHuntScreen() {
  const memberPlan = useMemberDisplay();
  const settled = useMemberSettled();
  const owner = useOwnerAccount();
  const plan = owner ? "pro" : memberPlan ?? (settled ? "free" : null);
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const [universe, setUniverse] = useState<ValueUniverse>("tech");
  const { state, data, retry } = useValueCheck(plan === "pro");

  return <ResearchToolShell lang={lang} setLang={setLang} title={t(TREASURE_HUNT.ja, TREASURE_HUNT.en)} showHeading={false} description="">
    <TreasureHuntCard ja={ja} basis={data?.basis ?? "trailing"}>
      {plan === null && <p role="status" className={styles.note}>{t("会員情報を確認中…", "Checking membership…")}</p>}
      {plan === "free" && <div className={styles.lock}>
        <p>{t("トレジャーハントはPRO会員限定です", "Treasure Hunt is available to PRO members")}</p>
        <Link href="/research#tech-phase-pro">{t("Tech Phase PROを見る", "Learn about Tech Phase PRO")}</Link>
      </div>}

      {plan === "pro" && <>
        <UniverseSwitch universe={universe} onChange={setUniverse} ja={ja} />
        {state === "loading" && <p role="status" className={styles.note}>{t("データを読み込み中…", "Loading data…")}</p>}
        {state === "not-ready" && <p role="status" className={styles.note}>{t("株価と決算のデータを準備中です。準備ができ次第、ここに順位が入ります。", "Price and earnings data is being prepared. The ranking will appear here once it's ready.")}</p>}
        {(state === "error" || state === "sign-in" || state === "pro-required") && <p role="alert" className={styles.note}>
          {state === "sign-in" ? t("ログインしてください。", "Please sign in.") : state === "pro-required" ? t("PRO会員の期間を確認できませんでした。", "We couldn't confirm your PRO membership.") : t("データを読み込めませんでした。", "Couldn't load the data.")}
          {state === "error" && <button type="button" className={styles.retry} onClick={retry}>{t("再読み込み", "Retry")}</button>}
        </p>}
        {state === "ready" && data && <ValueRanking key={universe} data={data} universe={universe} ja={ja} />}
      </>}
    </TreasureHuntCard>
    {plan === "pro" && state === "ready" && <p className={styles.credit}>{t("提供：Twelve Data", "Data: Twelve Data")}</p>}
  </ResearchToolShell>;
}
