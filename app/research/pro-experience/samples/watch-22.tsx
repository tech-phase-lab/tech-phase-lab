"use client";
import { useState } from "react";
import type { DiveHistory, WatchEarnings } from "@/lib/research/watch-earnings";
import list from "@/lib/research/pro-experience-samples/watch22.json";
import sample from "@/lib/research/pro-experience-samples/watch22-dives.json";
import EarningsDive from "../../companies/earnings-dive";
import { PRO_ONLY_VIEW, useProOnly } from "./frame";
import styles from "./samples.module.css";

type SampleDive = { ticker: string; name: string; live: WatchEarnings; history: DiveHistory[] };
const companies = list.companies as { ticker: string; name: string }[];
const dives = sample.dives as unknown as SampleDive[];

/** What the 22 tracked stocks offer is the earnings deep dive (owner, Nov 16: 「一覧だけでは意味がない。決算深掘りをきちんと見せて」). So the
 * sample opens on NVDA's deep dive, drawn by the real EarningsDive from saved made-up data, and the 22 stocks are a compact row above it
 * as the entry: NVDA and AMD switch the dive; any other stock says 「PROで見られます」. */
export default function Watch22Sample({ lang }: { lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const proOnly = useProOnly();
  const [open, setOpen] = useState<string>(dives[0].ticker);
  const dive = dives.find(item => item.ticker === open) ?? dives[0];
  return <div className={styles.watch}>
    <p className={styles.pickLabel}>{ja ? "監視22銘柄から、決算の深掘りを読む銘柄を選ぶ" : "Pick one of the 22 tracked stocks to read its earnings deep dive"}</p>
    <div className={styles.tickers} role="group" aria-label={ja ? "監視22銘柄" : "22 tracked stocks"}>
      {companies.map(company => {
        const has = dives.some(item => item.ticker === company.ticker);
        return <button key={company.ticker} type="button" className={styles.ticker} data-open={has || undefined} aria-pressed={has ? company.ticker === open : undefined}
          onClick={() => has ? setOpen(company.ticker) : proOnly(PRO_ONLY_VIEW)}>{company.ticker}</button>;
      })}
    </div>
    <div className={styles.dive}>
      <EarningsDive key={dive.ticker} lang={lang} name={dive.name} ticker={dive.ticker} live={dive.live} unlocked history={dive.history} failed={false} />
    </div>
  </div>;
}
