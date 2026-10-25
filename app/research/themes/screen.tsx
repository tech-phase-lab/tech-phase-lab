"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useMemberDisplay, useMemberSettled } from "../member-display-provider";
import { useResearchLanguage } from "../use-research-language";
import { THEMES } from "@/lib/research/theme-definitions";
import { PERIODS, rankThemes, type Period, type StockReturns } from "@/lib/research/theme-ranking";
import styles from "./themes.module.css";

type Data = { stocks: StockReturns[]; asOf: string; validUntil: number };
type State = "loading" | "ready" | "not-connected" | "error";
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`;
const tone = (value: number | null) => value === null ? "" : value > 0 ? styles.up : value < 0 ? styles.down : "";

export default function ThemeRankingScreen() {
  const memberPlan = useMemberDisplay();
  const settled = useMemberSettled();
  // Signed-out visitors and an unreachable membership service both read as "not PRO" once the check has answered.
  const plan = memberPlan ?? (settled ? "free" : null);
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const [period, setPeriod] = useState<Period>("1w");
  const [state, setState] = useState<State>("loading");
  const [data, setData] = useState<Data | null>(null);
  const periodLabel: Record<Period, string> = { "1d": t("1日", "1D"), "1w": t("1週間", "1W"), "1m": t("1か月", "1M"), "3m": t("3か月", "3M") };

  useEffect(() => {
    if (plan !== "pro") { setData(null); return; }
    const controller = new AbortController();
    setState("loading");
    (async () => {
      try {
        const response = await fetch("/api/research/themes", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) { setData(null); window.dispatchEvent(new Event("tech-phase:membership-changed")); return; }
        if (body?.error === "not-connected") { setState("not-connected"); return; }
        if (!response.ok || !body.ok || !Array.isArray(body.stocks)) throw Error();
        setData({ stocks: body.stocks, asOf: body.asOf, validUntil: body.validUntil }); setState("ready");
      } catch { if (!controller.signal.aborted) setState("error"); }
    })();
    return () => controller.abort();
  }, [plan]);

  // The access window can close while the page is open: drop the numbers then.
  useEffect(() => {
    if (!data?.validUntil) return;
    const timer = setTimeout(() => setData(null), Math.max(0, Math.min(data.validUntil - Date.now(), 2147483647)));
    return () => clearTimeout(timer);
  }, [data]);

  const rows = useMemo(() => data ? rankThemes(data.stocks, period) : [], [data, period]);
  const widest = Math.max(1, ...rows.map(row => Math.abs(row.value)));

  return <ResearchToolShell lang={lang} setLang={setLang} title={t("テーマランキング", "Theme Ranking")}
    description={t("ハイテクのテーマごとに、値動きの強さを並べます。", "High-tech themes, ranked by how strongly they are moving.")}>
    <div className={styles.eyebrow}><span>TECH PHASE PRO</span><i aria-hidden="true" /><span>THEME RANKING</span></div>

    {plan === null && <p role="status" className={styles.note}>{t("会員情報を確認中…", "Checking membership…")}</p>}

    {plan === "free" && <section className={styles.lock} aria-labelledby="theme-lock">
      <svg className={styles.gem} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 9-7 9-7-9z" /></svg>
      <h2 id="theme-lock">{t("テーマランキングはPRO会員限定です", "Theme Ranking is exclusive to PRO")}</h2>
      <p>{t("AI半導体、メモリ、光通信など、ハイテクの主要テーマを、期間ごとの強さ順に確認できます。", "See the main high-tech themes — AI chips, memory, optical links and more — ranked by strength over 1 day to 3 months.")}</p>
      <ol className={styles.teaser} aria-label={t("対象のテーマ", "Themes covered")}>{THEMES.map(theme => <li key={theme.id}><span aria-hidden="true">◇</span>{ja ? theme.ja : theme.en}<b aria-hidden="true">••••</b></li>)}</ol>
      <Link className={styles.cta} href="/research#tech-phase-pro">{t("Tech Phase PROを見る", "See Tech Phase PRO")}</Link>
    </section>}

    {plan === "pro" && <section aria-label={t("テーマ別ランキング", "Theme ranking")}>
      <div className={styles.tabs} role="group" aria-label={t("期間", "Period")}>
        {PERIODS.map(key => <button key={key} type="button" aria-pressed={key === period} onClick={() => setPeriod(key)}>{periodLabel[key]}</button>)}
      </div>
      {state === "loading" && <p role="status" className={styles.note}>{t("データを読み込み中…", "Loading data…")}</p>}
      {state === "not-connected" && <p role="status" className={styles.note}>{t("株価データの接続を準備中です。接続でき次第、ここに表示します。", "The price data feed is being connected. The ranking will appear here once it is.")}</p>}
      {state === "error" && <p role="alert" className={styles.note}>{t("データを取得できませんでした。しばらくしてからもう一度お試しください。", "The data could not be loaded. Please try again shortly.")}</p>}
      {state === "ready" && data && <>
        <p className={styles.meta}>{t(`${data.asOf} 終値ベース・各テーマの構成銘柄の等ウェイト平均`, `Closing prices as of ${data.asOf} · equal-weighted average of each theme's stocks`)}</p>
        {!rows.length && <p className={styles.note}>{t("この期間のランキングを作れるだけのデータがありません。", "There is not enough data to rank this period.")}</p>}
        <ol className={styles.list}>{rows.map(row => <li key={row.id} className={row.rank <= 3 ? styles.podium : undefined}>
          <details>
            <summary>
              <span className={styles.rank} aria-label={t(`${row.rank}位`, `Rank ${row.rank}`)}>{row.rank}</span>
              <span className={styles.name}><strong>{ja ? row.ja : row.en}</strong><small>{t(`構成 ${row.covered}/${row.total}銘柄`, `${row.covered}/${row.total} stocks`)}</small></span>
              <span className={`${styles.value} ${tone(row.value)}`}>{signed(row.value)}</span>
              <span className={styles.bar} aria-hidden="true"><i className={tone(row.value)} style={{ width: `${Math.max(3, Math.round(Math.abs(row.value) / widest * 100))}%` }} /></span>
            </summary>
            <div className={styles.detail}>
              <p><span>{t("先頭", "Leader")}</span><b>{row.leader.ticker}</b><em className={tone(row.leader.value)}>{signed(row.leader.value)}</em>
                <span>{t("後尾", "Laggard")}</span><b>{row.laggard.ticker}</b><em className={tone(row.laggard.value)}>{signed(row.laggard.value)}</em></p>
              <ul>{row.members.map(member => <li key={member.ticker}><Link href={`/research/stocks?q=${encodeURIComponent(member.ticker)}`}>{member.ticker}</Link><em className={tone(member.value)}>{member.value === null ? "—" : signed(member.value)}</em></li>)}</ul>
            </div>
          </details>
        </li>)}</ol>
        <p className={styles.fine}>{t("情報の提供であり、投資の勧誘や助言ではありません。", "For information only. Not investment advice or a solicitation.")}</p>
      </>}
    </section>}
  </ResearchToolShell>;
}
