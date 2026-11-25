"use client";
import { useState } from "react";
import { STOCK_LOGOS } from "@/lib/research/stock-logos";
import styles from "./watchlist.module.css";
/** `full`: without a logo the whole ticker, sized to the square (割安判別ツール: two letters such as 「IN」 read as the IN badge). */
const fullSize = (ticker: string) => ticker.length <= 3 ? undefined : { fontSize: ticker.length === 4 ? "9px" : "7.5px", letterSpacing: "-.02em" };
/** The ticker's logo (owner, Nov 25): a tile of the same size and padding for every company, made once from the logo sources
 * (scripts/logos/normalize_logos.py) and served from the site itself. A ticker without a readable logo shows its letters in the same square.
 * The old site-icon service drew Micron's and Marvell's black icons on the dark square, where they could not be seen. */
export const hasLogo = (ticker: string) => STOCK_LOGOS.has(ticker);
export const logoSrc = (ticker: string) => `/logos/${encodeURIComponent(ticker)}.png`;
export default function StockLogo({ ticker, className, full = false }: { ticker: string; className?: string; full?: boolean }) {
  const [failed, setFailed] = useState("");
  const usable = hasLogo(ticker) && failed !== ticker;
  return <span className={className ?? styles.logo} aria-hidden="true">{usable ?
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoSrc(ticker)} alt="" width={72} height={72} loading="lazy" decoding="async" onError={() => setFailed(ticker)} /> : full ? <span style={fullSize(ticker)}>{ticker}</span> : ticker.slice(0, 2)}</span>;
}
