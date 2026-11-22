/** 「この銘柄の速報を通知する」 (the bell in 監視22銘柄, PRO; Nov 21). It is a shortcut to the same per-device setting as the
 * notification page's 監視株ニュース: the device's news switch and its list of news tickers. Nothing new is stored anywhere.
 * Pure: no network, no storage, so it can be tested directly. */
export type NewsChoice = { news: boolean; newsTickers: string[] };

export type BellState =
  /** Not PRO (and not the owner): the bell leads to the PRO page. */
  | "free"
  /** This browser cannot receive notifications at all (no service worker / push). */
  | "unsupported"
  /** Notifications are not on for this device yet: the bell leads to the notification page. */
  | "no-device"
  | "checking" | "on" | "off" | "error";

/** The bell is lit when this device gets news notifications and this ticker is one it chose. */
export function bellOn(choice: NewsChoice, ticker: string): boolean {
  return choice.news && choice.newsTickers.includes(ticker);
}

/** What to save when the bell is pressed. Turning it on while the device's news switch is off sends news for this stock only (the
 * tickers chosen before, while the switch was off, are not silently switched back on). Turning it off removes this ticker and leaves the
 * switch and the other stocks as they are. Tickers keep the order of `monitored`. */
export function bellPatch(choice: NewsChoice, ticker: string, monitored: readonly string[]): Partial<NewsChoice> | null {
  if (!monitored.includes(ticker)) return null;
  if (bellOn(choice, ticker)) return { newsTickers: choice.newsTickers.filter(t => t !== ticker) };
  if (!choice.news) return { news: true, newsTickers: [ticker] };
  return { newsTickers: monitored.filter(t => t === ticker || choice.newsTickers.includes(t)) };
}
