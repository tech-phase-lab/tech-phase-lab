"use client";
import { useState } from "react";
import styles from "./watchlist.module.css";
/** `full`: without a logo the whole ticker, sized to the square (割安判別ツール: two letters such as 「IN」 read as the IN badge). */
const fullSize = (ticker: string) => ticker.length <= 3 ? undefined : { fontSize: ticker.length === 4 ? "9px" : "7.5px", letterSpacing: "-.02em" };
/** The ticker's logo from the site's own logo route (owner, Nov 25: MU, MRVL and others showed none). That route answers with the provider's
 * (Twelve Data's) square logo or a ticker-keyed one, and 404 when no source has it; then the letters show in the square as before.
 * The old site-icon service drew Micron's and Marvell's black icons on the dark square, where they could not be seen. */
export const logoSrc = (ticker: string) => `/api/research/market/logo/${encodeURIComponent(ticker)}`;
export default function StockLogo({ ticker, className, full = false }: { ticker: string; className?: string; full?: boolean }) {
  const [failed, setFailed] = useState("");
  const usable = /^[A-Z0-9.-]{1,10}$/.test(ticker) && failed !== ticker;
  return <span className={className ?? styles.logo} aria-hidden="true">{usable ?
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoSrc(ticker)} alt="" width={28} height={28} loading="lazy" decoding="async" onError={() => setFailed(ticker)} /> : full ? <span style={fullSize(ticker)}>{ticker}</span> : ticker.slice(0, 2)}</span>;
}
