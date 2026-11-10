"use client";
import { useMemo } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useMemberDisplay, useMemberSettled } from "../member-display-provider";
import { useResearchLanguage } from "../use-research-language";
import { groupOf, themeById } from "@/lib/research/theme-definitions";
import { rankThemes } from "@/lib/research/theme-ranking";
import namesFile from "@/lib/research/theme-stock-names.json";
import { DivergingChart, PeriodPills, arrow, signed, toneClass, updateNote, usePeriod, useThemeData } from "./parts";
import styles from "./themes.module.css";

const names = namesFile as Record<string, { ja: string; en: string }>;

export default function ThemeDetailScreen({ id }: { id: string }) {
  const theme = themeById(id)!;
  const memberPlan = useMemberDisplay();
  const settled = useMemberSettled();
  const plan = memberPlan ?? (settled ? "free" : null);
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const [period, setPeriod] = usePeriod();
  const { state, data } = useThemeData(theme.group, plan);
  const row = useMemo(() => data ? rankThemes(data.stocks, period, [theme])[0] : undefined, [data, period, theme]);
  const group = groupOf(theme.group);
  const priced = row?.members.filter((member): member is { ticker: string; value: number } => member.value !== null) ?? [];
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? theme.ja : theme.en} showHeading={false} description="">
    <Link href="/research/themes" className={styles.back}><span aria-hidden="true">‹</span>{t("テーマランキング", "Theme Ranking")}</Link>
    {plan === null && <p role="status" className={styles.note}>{t("会員情報を確認中…", "Checking membership…")}</p>}
    {plan === "free" && <p className={styles.note}>{t("テーマランキングはPRO会員限定です。", "Theme Ranking is exclusive to PRO.")} <Link href="/research#tech-phase-pro">{t("Tech Phase PROを見る", "See Tech Phase PRO")}</Link></p>}
    {plan === "pro" && <>
      <section className={styles.themeCard} aria-label={ja ? theme.ja : theme.en}>
        <p className={styles.label}>THEME</p>
        <h2>{ja ? theme.ja : theme.en}</h2>
        <div className={styles.themeMeta}>{group && <em className={styles.tag}>{ja ? group.ja : group.en}</em>}<span>{t(`${theme.tickers.length}銘柄`, `${theme.tickers.length} stocks`)}</span></div>
        {row && <div className={styles.themeBig}><strong className={toneClass(row.value)}>{arrow(row.value)} {signed(row.value)}</strong><span>{t(`テーマ内${row.covered}銘柄の平均`, `Average of ${row.covered} stocks`)}</span></div>}
      </section>
      <PeriodPills period={period} onChange={setPeriod} ja={ja} />
      {state === "loading" && <p role="status" className={styles.note}>{t("データを読み込み中…", "Loading data…")}</p>}
      {state === "not-connected" && <p role="status" className={styles.note}>{t("株価データの接続を準備中です。", "The price data is not connected yet.")}</p>}
      {state === "error" && <p role="alert" className={styles.note}>{t("データを取得できませんでした。しばらくしてからもう一度お試しください。", "We couldn't load the data. Please try again in a moment.")}</p>}
      {state === "ready" && data && (priced.length
        ? <DivergingChart ja={ja} mono rows={priced.map(member => ({ id: member.ticker, value: member.value, href: `/research/stocks?q=${encodeURIComponent(member.ticker)}`, name: member.ticker, sub: names[member.ticker]?.[ja ? "ja" : "en"] }))} />
        : <p className={styles.empty}>{t("この期間の株価データがありません。", "No price data for this period.")}</p>)}
      {state === "ready" && data && <div className={styles.fine}>
        <p>{t("強い順に、上から並びます。銘柄を押すと、その銘柄のページが開きます。", "Ranked from the strongest. Select a stock to open its page.")}</p>
        <p>{updateNote(data, ja)}</p>
        <p>{t("提供：Twelve Data", "Data: Twelve Data")}</p>
      </div>}
    </>}
  </ResearchToolShell>;
}
