"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import PageHeading from "../page-heading";
import { useMemberDisplay, useMemberSettled, useOwnerAccount, useResearchOwner } from "../member-display-provider";
import { useResearchLanguage } from "../use-research-language";
import { GROUPS, THEMES, groupOf, themesOf, tickersOf, type GroupFilter } from "@/lib/research/theme-definitions";
import { rankThemes, sampleStockReturns } from "@/lib/research/theme-ranking";
import { DivergingChart, PeriodPills, updateNote, usePeriod, useThemeData, type ThemeData } from "./parts";
import styles from "./themes.module.css";

const OPTIONS: { id: GroupFilter; ja: string; en: string }[] = [{ id: "all", ja: "すべて", en: "All" }, ...GROUPS];

/** Vibration when the wheel settles on a new genre: Android through vibrate(); on iPhone Safari (no vibrate) a hidden switch input is
 * clicked, which makes iOS 17.4+ tick. Neither is guaranteed, so a failure is silent. */
function tick(probe: HTMLInputElement | null) {
  try { if (typeof navigator.vibrate === "function") { navigator.vibrate(8); return; } } catch { /* not supported */ }
  try { probe?.click(); } catch { /* not supported */ }
}

export function GenreWheel({ value, onChange, ja }: { value: GroupFilter; onChange: (group: GroupFilter) => void; ja: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLInputElement>(null);
  const programmatic = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [atEnd, setAtEnd] = useState(false);
  const index = OPTIONS.findIndex(option => option.id === value);

  const measureEnd = useCallback(() => {
    const element = scroller.current;
    if (element) setAtEnd(element.scrollLeft + element.clientWidth >= element.scrollWidth - 3);
  }, []);
  useEffect(() => { measureEnd(); }, [measureEnd]);

  const choose = (next: GroupFilter, fromScroll: boolean) => {
    if (next !== value) { tick(probe.current); onChange(next); }
    if (!fromScroll) {
      const element = scroller.current, button = element?.querySelector<HTMLElement>(`[data-id="${next}"]`);
      if (element && button) {
        programmatic.current = true;
        element.scrollTo({ left: button.offsetLeft - 7, behavior: "smooth" });
        setTimeout(() => { programmatic.current = false; measureEnd(); }, 450);
      }
    }
  };
  const onScroll = () => {
    measureEnd();
    if (programmatic.current) return;
    clearTimeout(settle.current);
    // The item that has come to rest at the left edge becomes the chosen one.
    settle.current = setTimeout(() => {
      const element = scroller.current;
      if (!element) return;
      const left = element.scrollLeft + 7;
      let best = OPTIONS[0].id, distance = Infinity;
      for (const button of element.querySelectorAll<HTMLElement>("[data-id]")) {
        const gap = Math.abs(button.offsetLeft - left);
        if (gap < distance) { distance = gap; best = button.dataset.id as GroupFilter; }
      }
      choose(best, true);
    }, 110);
  };
  useEffect(() => () => clearTimeout(settle.current), []);

  return <div className={styles.wheelCard}>
    <div ref={scroller} className={styles.wheel} role="group" aria-label={ja ? "ジャンル" : "Category"} onScroll={onScroll}>
      {OPTIONS.map((option, position) => {
        const gap = Math.min(3, Math.max(0, position - index));
        return <button key={option.id} type="button" data-id={option.id} data-far={gap || undefined} aria-pressed={option.id === value} onClick={() => choose(option.id, false)}>{ja ? option.ja : option.en}</button>;
      })}
      <span className={styles.wheelEnd} aria-hidden="true" />
    </div>
    {!atEnd && <span className={styles.hint} aria-hidden="true">››</span>}
    <input ref={probe} type="checkbox" {...{ switch: "" }} tabIndex={-1} aria-hidden="true" className={styles.switchProbe} />
  </div>;
}

export default function ThemeRankingScreen() {
  const memberPlan = useMemberDisplay();
  const settled = useMemberSettled();
  // Signed-out visitors and an unreachable membership service both read as "not PRO" once the check has answered.
  const plan = memberPlan ?? (settled ? "free" : null);
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const [period, setPeriod] = usePeriod();
  const [group, setGroup] = useState<GroupFilter>("all");
  const { state, data } = useThemeData(group, plan);
  // Owner-only: look at the finished screen with clearly labelled sample numbers while the price feed is not connected.
  const ownerAccount = useOwnerAccount();
  const ownerRole = useResearchOwner();
  const owner = ownerAccount || ownerRole;
  const [sample, setSample] = useState(false);
  const themes = useMemo(() => group === "all" ? THEMES : themesOf(group), [group]);
  const shown = useMemo<ThemeData | null>(() => sample ? { stocks: sampleStockReturns(group === "all" ? THEMES.flatMap(theme => theme.tickers) : tickersOf(group)), asOf: "SAMPLE", fetchedAt: 0, marketOpen: false, validUntil: 0 } : data, [sample, data, group]);
  const rows = useMemo(() => shown ? rankThemes(shown.stocks, period, themes) : [], [shown, period, themes]);

  return <ResearchToolShell lang={lang} setLang={setLang} title={t("テーマランキング", "Theme Ranking")} showHeading={!ja}
    description={t("米国株をジャンルごとに、値動きの強弱で並べます。", "See how U.S. stock themes rank by performance.")}>
    {ja && <PageHeading eyebrow="THEME RANKING" title="テーマランキング" description="米国株をジャンルごとに、値動きの強弱で並べます。" />}

    {plan === null && <p role="status" className={styles.note}>{t("会員情報を確認中…", "Checking membership…")}</p>}

    {plan === "free" && <section className={styles.lock} aria-labelledby="theme-lock">
      <svg className={styles.gem} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 9-7 9-7-9z" /></svg>
      <h2 id="theme-lock">{t("テーマランキングはPRO会員限定です", "Theme Ranking is exclusive to PRO")}</h2>
      <p>{t("AI半導体、メモリ、光・フォトニクスなどのハイテクをはじめ、資源・金融・ヘルスケアなど6ジャンルのテーマを、期間ごとの強さ順に確認できます。", "Explore stock themes across six categories, from AI chips, memory and optics to resources, financials and healthcare, ranked by strength over each period.")}</p>
      <ol className={styles.teaser} aria-label={t("対象のテーマ", "Themes covered")}>{themesOf("tech").map(theme => <li key={theme.id}><span aria-hidden="true">◇</span>{ja ? theme.ja : theme.en}<b aria-hidden="true">••••</b></li>)}</ol>
      <Link className={styles.cta} href="/research#tech-phase-pro">{t("Tech Phase PROを見る", "See Tech Phase PRO")}</Link>
    </section>}

    {plan === "pro" && <section aria-label={t("テーマ別ランキング", "Theme ranking")}>
      <GenreWheel value={group} onChange={next => { setGroup(next); setSample(false); }} ja={ja} />
      <PeriodPills period={period} onChange={setPeriod} ja={ja} />
      {state === "loading" && !sample && <p role="status" className={styles.note}>{t("データを読み込み中…", "Loading data…")}</p>}
      {state === "not-connected" && !sample && <>
        <p role="status" className={styles.note}>{t("株価データの接続を準備中です。接続でき次第、順位と騰落率がここに入ります。", "The price data is not connected yet. Ranks and returns will appear here once it is.")}</p>
        {owner && <button type="button" className={styles.sampleButton} onClick={() => setSample(true)}>{t("見本の数字で見た目を確認（運営者のみ・実際の株価ではありません）", "Preview with sample numbers (owner only · not real prices)")}</button>}
      </>}
      {state === "error" && !sample && <p role="alert" className={styles.note}>{t("データを取得できませんでした。しばらくしてからもう一度お試しください。", "We couldn't load the data. Please try again in a moment.")}</p>}
      {((state === "ready" && data) || sample) && shown && <>
        {sample && <p role="status" className={styles.sample}><b>SAMPLE</b>{t("見た目の確認用の見本です。実際の株価ではありません（運営者のみに表示）。", "A look at the finished screen with made-up numbers — not real prices (owner only).")}<button type="button" onClick={() => setSample(false)}>{t("閉じる", "Close")}</button></p>}
        {rows.length ? <DivergingChart ja={ja} rows={rows.map(row => ({ id: row.id, rank: row.rank, value: row.value, href: `/research/themes/${row.id}`, name: ja ? row.ja : row.en, tag: ja ? groupOf(row.group)?.ja : groupOf(row.group)?.en }))} />
          : <p className={styles.empty}>{t("この期間のランキングを作れるだけのデータがありません。", "There is not enough data to rank this period.")}</p>}
        <div className={styles.fine}>
          <p>{t("強い順に、上から並びます。", "Ranked from the strongest, top to bottom.")}</p>
          {!sample && <p>{updateNote(shown, ja)}</p>}
          <p>{t("提供：Twelve Data", "Data: Twelve Data")}</p>
        </div>
      </>}
    </section>}
  </ResearchToolShell>;
}
