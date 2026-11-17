"use client";
import { useId, useState } from "react";
import type { DiveHistory, WatchEarnings } from "@/lib/research/watch-earnings";
import list from "@/lib/research/pro-experience-samples/watch22.json";
import sample from "@/lib/research/pro-experience-samples/watch22-dives.json";
import EarningsDive from "../../companies/earnings-dive";
import styles from "./samples.module.css";

type SampleDive = { ticker: string; name: string; live: WatchEarnings; history: DiveHistory[] };
const companies = list.companies as { ticker: string; name: string }[];
const dives = sample.dives as unknown as SampleDive[];
/** The 20 stocks without a sample deep dive, in the list's order: shown as plain text only. */
export const OTHER_TICKERS = companies.map(company => company.ticker).filter(ticker => !dives.some(dive => dive.ticker === ticker));

/** What the 22 tracked stocks offer is the earnings deep dive (owner, Nov 16: 「一覧だけでは意味がない。決算深掘りをきちんと見せて」), drawn by
 * the real EarningsDive from saved made-up data. Only NVDA and AMD, the two with a deep dive, are buttons (owner's mockups 01/02, Nov 16);
 * 「一覧 ▾」 shows the other 20 tickers as plain text that cannot be tapped, and 「閉じる ▴」 hides them again. */
export default function Watch22Sample({ lang }: { lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const listId = useId();
  const [open, setOpen] = useState<string>(dives[0].ticker);
  const [listOpen, setListOpen] = useState(false);
  const dive = dives.find(item => item.ticker === open) ?? dives[0];
  return <div className={styles.watch}>
    <p className={styles.pickLabel}>{ja ? "決算の深掘りを読む銘柄を選ぶ" : "Pick a stock to read its earnings deep dive"}</p>
    <div className={styles.diveChoice} role="group" aria-label={ja ? "決算の深掘りを読む銘柄" : "Stocks with a deep dive"}>
      {dives.map(item => <button key={item.ticker} type="button" className={styles.diveChip} aria-pressed={item.ticker === open}
        onClick={() => setOpen(item.ticker)}>{item.ticker}</button>)}
    </div>
    <div className={styles.allRow}>
      <span>{ja ? "PROなら22銘柄すべて見られます" : "With PRO, see all 22 stocks"}</span>
      <button type="button" className={styles.listToggle} aria-expanded={listOpen} aria-controls={listId} onClick={() => setListOpen(value => !value)}>
        {listOpen ? (ja ? "閉じる ▴" : "Close ▴") : (ja ? "一覧 ▾" : "List ▾")}
      </button>
    </div>
    {listOpen && <ul id={listId} className={styles.otherList} aria-label={ja ? "そのほかの監視銘柄" : "The other tracked stocks"}>
      {OTHER_TICKERS.map(ticker => <li key={ticker}>{ticker}</li>)}
    </ul>}
    <div className={styles.dive}>
      <EarningsDive key={dive.ticker} lang={lang} name={dive.name} ticker={dive.ticker} live={dive.live} unlocked history={dive.history} failed={false} />
    </div>
  </div>;
}
