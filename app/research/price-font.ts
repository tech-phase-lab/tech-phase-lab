import localFont from "next/font/local";
/** Noto Serif JP (the same file RESOLUTE already ships) for the price figures of the plan cards (owner's design: Noto Serif JP, 700).
 * Not preloaded: the file is fetched only when a page that shows a plan card is drawn, so every other page is unaffected. */
export const priceFont = localFont({ src: "../resolute/fonts/noto-serif-jp.woff2", weight: "200 900", display: "swap", preload: false, variable: "--font-price-serif" });
