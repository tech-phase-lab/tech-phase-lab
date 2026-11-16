"use client";
import { useMemo, useState } from "react";
import { THEMES, groupOf, themeById, themesOf, type GroupFilter } from "@/lib/research/theme-definitions";
import { rankThemes, type StockReturns } from "@/lib/research/theme-ranking";
import sample from "@/lib/research/pro-experience-samples/themes.json";
import namesFile from "@/lib/research/theme-stock-names.json";
import { GenreWheel } from "../../themes/screen";
import { ThemeCard } from "../../themes/detail";
import { BasisLine, DivergingChart, PeriodPills, usePeriod, type ThemeData } from "../../themes/parts";
import themeStyles from "../../themes/themes.module.css";
import { useProOnly } from "./frame";
import styles from "./samples.module.css";

const names = namesFile as Record<string, { ja: string; en: string }>;
const data: ThemeData = { stocks: sample.stocks as StockReturns[], asOf: sample.asOf, fetchedAt: 0, marketOpen: false, validUntil: 0 };

/** The ranking at one fixed moment, drawn by the PRO screen's own parts. A theme opens its stocks in place; a stock goes nowhere. */
export default function ThemeRankingSample({ lang }: { lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const proOnly = useProOnly();
  const [period, setPeriod] = usePeriod();
  const [group, setGroup] = useState<GroupFilter>("tech");
  const [open, setOpen] = useState<string | null>(null);
  const themes = useMemo(() => group === "all" ? THEMES : themesOf(group), [group]);
  const rows = useMemo(() => rankThemes(data.stocks, period, themes), [period, themes]);
  const theme = open ? themeById(open) : undefined;
  const row = useMemo(() => theme ? rankThemes(data.stocks, period, [theme])[0] : undefined, [theme, period]);
  const note = <p className={styles.fineNote}>{ja ? "サンプルの数値です。実際の株価ではありません。" : "Sample figures, not real prices."}</p>;
  if (theme) {
    const priced = row?.members.filter((member): member is { ticker: string; value: number } => member.value !== null) ?? [];
    return <div className={styles.themes}>
      <button type="button" className={styles.backButton} onClick={() => setOpen(null)}><span aria-hidden="true">‹</span>{ja ? "テーマランキング" : "Theme Ranking"}</button>
      <ThemeCard theme={theme} row={row} ja={ja} />
      <PeriodPills period={period} onChange={setPeriod} ja={ja} />
      <BasisLine data={data} period={period} ja={ja} />
      <DivergingChart ja={ja} mono onSelect={() => proOnly()} rows={priced.map(member => ({ id: member.ticker, value: member.value, href: "", name: member.ticker, sub: names[member.ticker]?.[ja ? "ja" : "en"] }))} />
      {note}
    </div>;
  }
  return <div className={styles.themes}>
    <GenreWheel value={group} onChange={setGroup} ja={ja} />
    <PeriodPills period={period} onChange={setPeriod} ja={ja} />
    <BasisLine data={data} period={period} ja={ja} />
    <DivergingChart ja={ja} onSelect={setOpen} rows={rows.map(item => ({ id: item.id, rank: item.rank, value: item.value, href: "", name: ja ? item.ja : item.en, tag: ja ? groupOf(item.group)?.ja : groupOf(item.group)?.en }))} />
    <div className={themeStyles.fine}><p>{ja ? "強い順に、上から並びます。" : "Ranked from the strongest, top to bottom."}</p></div>
    {note}
  </div>;
}
