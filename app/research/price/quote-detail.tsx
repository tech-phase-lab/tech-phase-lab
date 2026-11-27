"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FirstQuote } from "@/lib/research/quote-first-paint";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { useStockFavorites } from "../use-stock-favorites";
import { useFavoriteLists } from "../watchlist/use-favorite-lists";
import { upsertPriceAlert, formatAlertPrice, priceAlertDelivery, type PriceAlertDelivery } from "@/lib/research/price-alert-settings";
import { CompanyIntroductionPanel } from "../stocks/company-introduction";
import { CompanyNetworkMap } from "../stocks/chain-map";
import type { CompanyIntroduction } from "@/lib/research/company-introductions";
import type { CompanyNetwork } from "@/lib/research/company-network";
import { compact, nextEarningsText, plain, rangePosition, signedMoney, signedPercent } from "@/lib/research/market-quote";
import { drawnSeries, isIntradayPeriod, periodInterval } from "@/lib/research/market-board-periods";
import { marketPhase } from "@/lib/research/us-market-session";
import { isChangePeriod, type ChangePeriod, type PeriodBase } from "@/lib/research/period-change";
import PeriodButtons, { DETAIL_DEFAULT_PERIOD, type DetailPeriod } from "./period-buttons";
import PeriodChangeLine from "./period-change-line";
import { Status, Tile, toneOf, type DetailOrigin } from "./quote-card";
import { shortName, useFacts } from "./use-market";
import { useLiveQuote } from "./use-live-quote";
import PriceChart from "./price-chart";
import { useMinute } from "./use-minute";
import { useChartStore } from "./use-chart-store";
import FlashValue from "./flash-value";
import styles from "./detail.module.css";
import chartStyles from "./chart.module.css";

const ORIGINS: Record<DetailOrigin, { ja: string; en: string; href: string }> = {
  watchlist: { ja: "ウォッチリスト", en: "Watchlist", href: "/research/watchlist" },
  watch: { ja: "監視22銘柄", en: "Watched 22", href: "/research/companies" },
  search: { ja: "銘柄検索", en: "Stock search", href: "/research/stocks" },
  market: { ja: "マーケット", en: "Markets", href: "/research/market" },
};
type Profile = { introduction?: CompanyIntroduction | null; network?: CompanyNetwork | null; name?: string };

function AlertSheet({ ticker, currency, ja, onClose }: { ticker: string; currency: string; ja: boolean; onClose: () => void }) {
  const { alerts = [], update, editable } = useFavoriteLists();
  const saved = alerts.filter(a => a.ticker === ticker);
  const [price, setPrice] = useState(saved[0] ? String(saved[0].price) : "");
  const [direction, setDirection] = useState<"above" | "below">(saved[0]?.direction ?? "above");
  const [unit, setUnit] = useState(saved[0]?.currency ?? currency);
  const [error, setError] = useState<"invalid" | "limit" | null>(null);
  // Whether the monitor delivers price alerts to this member (Nov 21): until it says so, the sheet keeps saying delivery is not ready.
  const [delivery, setDelivery] = useState<PriceAlertDelivery | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research/notifications", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(response => response.json().catch(() => null)).then(body => { if (!controller.signal.aborted) setDelivery(priceAlertDelivery(body)); })
      .catch(() => { if (!controller.signal.aborted) setDelivery("not-ready"); });
    return () => controller.abort();
  }, []);
  const t = (a: string, b: string) => ja ? a : b;
  return <div className={styles.sheetBack} onClick={onClose}><div className={styles.sheet} role="dialog" aria-modal="true" aria-label={t("価格通知", "Price alert")} onClick={event => event.stopPropagation()}>
    <h2>{t("価格通知", "Price alert")}</h2>
    {delivery === "live" ? <p>{t("米国市場の取引時間中に5分ごとに確認し、価格がこの水準を超えたとき（下回ったとき）に1回、スマホへ通知します。スマホ通知をオンにした端末に届きます。", "Checked every 5 minutes during U.S. market hours. You get one notification on your phone when the price crosses this level (on devices with notifications turned on).")} <Link href="/research/notifications">{t("通知の設定", "Notification settings")}</Link></p>
      : delivery === "pro-required" ? <p>{t("スマホへの価格通知はPRO会員向けです。設定は保存できます。", "Price alerts on your phone are for PRO members. You can still save your settings.")}</p>
      : delivery === "not-ready" ? <p>{t("設定のみ保存できます。通知配信は準備中です。", "You can save your settings, but alerts aren't being sent yet.")}</p> : null}
    <form onSubmit={event => {
      event.preventDefault();
      let failure: "invalid" | "limit" | null = null;
      const ok = update(current => { const next = upsertPriceAlert(current.alerts ?? [], { ticker, price: Number(price), direction, currency: unit }); if (!next.ok) { failure = next.error; return current; } return { ...current, alerts: next.alerts }; });
      setError(failure); if (ok && !failure) onClose();
    }}>
      <div className={styles.sheetRow}>
        <input inputMode="decimal" type="number" step="any" min="0.000001" placeholder="0.00" aria-label={t("指定価格", "Target price")} value={price} onChange={event => setPrice(event.target.value)} required />
        <select aria-label={t("通貨", "Currency")} value={unit} onChange={event => setUnit(event.target.value)}>{["USD", "KRW", "JPY", "CAD", "EUR", "GBP"].map(c => <option key={c}>{c}</option>)}</select>
      </div>
      <select aria-label={t("通知条件", "Alert condition")} value={direction} onChange={event => setDirection(event.target.value as "above" | "below")}><option value="above">{t("以上になったら", "At or above")}</option><option value="below">{t("以下になったら", "At or below")}</option></select>
      {error && <p role="alert">{error === "limit" ? t("設定は100件までです。", "Up to 100 settings.") : t("有効な価格を入力してください。", "Enter a valid price.")}</p>}
      <div className={styles.sheetActions}><button type="button" onClick={onClose}>{t("閉じる", "Close")}</button><button type="submit" disabled={!editable}>{t("保存", "Save")}</button></div>
    </form>
    {saved.map(a => <div className={styles.saved} key={a.direction}><span>{formatAlertPrice(a.price, ja ? "ja-JP" : "en-US")} {a.currency} {a.direction === "above" ? t("以上", "or higher") : t("以下", "or lower")}</span>
      <button type="button" disabled={!editable} onClick={() => update(current => ({ ...current, alerts: (current.alerts ?? []).filter(v => !(v.ticker === ticker && v.direction === a.direction)) }))}>{t("解除", "Remove")}</button></div>)}
  </div></div>;
}

/** `title` + `plain` make the same page serve an index (no company tabs, no star; the back link says where it came from). */
/** `initial`: the quote and the default period's chart from the server's shared copies (lib/research/quote-first-paint.ts), shown at once. */
export default function QuoteDetail({ ticker, from, title: fixedTitle, plain: bare = false, initial = null }: { ticker: string; from: DetailOrigin; title?: string; plain?: boolean; initial?: FirstQuote | null }) {
  const [lang, setLang] = useResearchLanguage();
  const router = useRouter();
  const ja = lang === "ja", t = (a: string, b: string) => ja ? a : b;
  const origin = ORIGINS[from];
  // Live while U.S. stocks trade: every 15 seconds from the shared copy, paused while the tab is hidden; once outside those hours (owner, Nov 27).
  const { quote, loaded, failed, at: receivedAt } = useLiveQuote(ticker, initial);
  const facts = useFacts(ticker).data;
  const [range, setRange] = useState<DetailPeriod>(DETAIL_DEFAULT_PERIOD);
  const [bases, setBases] = useState<{ ticker: string; today: string; bases: Partial<Record<ChangePeriod, PeriodBase>> } | null>(null);
  const [mode, setMode] = useState<"candles" | "line">("candles");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [tab, setTab] = useState<"price" | "company" | "map">("price");
  const favorites = useStockFavorites();
  const registered = favorites.lists.some(list => list.tickers.includes(ticker));
  const key = `${ticker}:${range}`;
  // Each period's series is kept while the page is open (owner, Nov 15): a period read once comes back at once, and while a new one is on its way the chart
  // on the screen stays, with a small spinner at its top right. A read is not cut off by another switch, so it is kept for when that period is picked again.
  const store = useChartStore(key, initial?.chart ? { [`${ticker}:${initial.chart.period}`]: { bars: initial.chart.bars, before: initial.chart.before } } : null);
  const { put, fresh } = store;
  const reads = useRef(new Map<string, AbortController>());
  useEffect(() => {
    if (fresh(key) || reads.current.has(key)) return;
    const controller = new AbortController();
    reads.current.set(key, controller);
    fetch(`/api/research/market/chart?ticker=${encodeURIComponent(ticker)}&${range === "ytd" ? "range=ytd" : `period=${range}`}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (!controller.signal.aborted) put(key, body?.ok ? { bars: body.bars, before: body.before ?? [] } : { bars: [], before: [], failed: true }); })
      .catch(() => { if (!controller.signal.aborted) put(key, { bars: [], before: [], failed: true }); })
      .finally(() => { reads.current.delete(key); });
  }, [ticker, range, key, put, fresh]);
  useEffect(() => { const running = reads.current; return () => { running.forEach(controller => controller.abort()); running.clear(); }; }, []);
  // The closes the period's change is measured from; the live price is applied to them on every update.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/research/market/period-bases?ticker=${encodeURIComponent(ticker)}`, { signal: controller.signal }).then(r => r.ok ? r.json() : null)
      .then(body => { if (!controller.signal.aborted && body?.ok) setBases({ ticker, today: body.today, bases: body.bases ?? {} }); }).catch(() => { /* no line without a base */ });
    return () => controller.abort();
  }, [ticker]);
  useEffect(() => {
    if (bare) return;
    const controller = new AbortController();
    fetch(`/api/research/stocks?ticker=${encodeURIComponent(ticker)}`, { signal: controller.signal }).then(r => r.ok ? r.json() : null)
      .then(body => { if (!controller.signal.aborted) setProfile(body?.ok ? body.profile : {}); }).catch(() => { if (!controller.signal.aborted) setProfile({}); });
    return () => controller.abort();
  }, [ticker, bare]);
  useEffect(() => {
    if (bare) return;
    const ids = ["price", "company", "map"] as const;
    const observer = new IntersectionObserver(entries => { const hit = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (hit) setTab(hit.target.id as typeof tab); }, { rootMargin: "-20% 0px -65% 0px" });
    ids.forEach(id => { const el = document.getElementById(id); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [profile, bare]);
  // The same chart rules as the market board (owner, Nov 15): the 15-minute chart is the latest trading day only, bad prints are cut back on the intraday
  // charts, the mint band and its one word only while it is pre-market / after-hours now, and the price tag on the right is the big price above.
  // Until a new period's series comes, the one on the screen is drawn with its own period's rules.
  const shownRange = (store.shownKey ? store.shownKey.slice(store.shownKey.lastIndexOf(":") + 1) : range) as DetailPeriod;
  const drawn = useMemo(() => store.shown === null ? null : drawnSeries(shownRange, store.shown), [store.shown, shownRange]);
  const now = useMinute();
  const phase = marketPhase(new Date(now ?? 0));
  const title = fixedTitle ?? shortName(profile?.name ?? quote?.name ?? ticker);
  const toggleStar = () => {
    if (registered) { for (const list of favorites.lists) if (list.tickers.includes(ticker)) favorites.setMembership(list.id, ticker, false); }
    else favorites.toggle(ticker, quote?.name ?? ticker);
  };
  const tone = toneOf(quote?.percentChange ?? null), arrow = tone === "up" ? "▲" : tone === "down" ? "▼" : "–";
  const interval = shownRange === "ytd" ? "daily" : periodInterval(shownRange);
  const intraday = shownRange !== "ytd" && isIntradayPeriod(shownRange);
  const periodBases = bases?.ticker === ticker ? bases : null;
  const tag = quote ? { price: quote.price, text: plain(quote.price), tone } : undefined;
  return <ResearchToolShell lang={lang} setLang={setLang} title={`${title}${bare ? "" : ` ${ticker}`}`} description="" showTools={false} showHeading={false}>
    <div className={styles.page}>
      <button type="button" className={styles.back} onClick={() => window.history.length > 1 ? router.back() : router.push(origin.href)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>{origin[lang]}</button>
      {!bare && <nav className={styles.tabs} aria-label={t("ページ内の移動", "On this page")}>
        {([["price", "株価", "Price"], ["company", "企業情報", "Company"], ["map", "連関マップ", "Relationship map"]] as const).map(([id, a, b]) =>
          <a key={id} href={`#${id}`} aria-current={tab === id} onClick={() => setTab(id)}>{t(a, b)}</a>)}
      </nav>}
      <div className={styles.head}>{!bare && <Tile ticker={ticker} size="detail" />}<div className={styles.who}><h1>{title}</h1></div>
        {!bare && <button type="button" className={styles.star} aria-pressed={registered} disabled={!favorites.editable} onClick={toggleStar}>
          <svg viewBox="0 0 24 24" fill={registered ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" /></svg>{registered ? t("登録済み", "Saved") : t("登録", "Save")}</button>}</div>
      <section id="price" style={{ display: "contents" }}>
        {quote ? <div className={styles.priceBlock}>
          <div className={styles.priceLine}><FlashValue scope={ticker} value={quote.price} className={styles.price} quick>{plain(quote.price)}</FlashValue><span className={styles.usd}>{quote.currency}</span></div>
          <FlashValue scope={ticker} value={quote.change} className={`${styles.changeLine} ${styles[tone]}`} quick><span className={`${styles.chip} ${styles[tone]}`}>{arrow} {quote.percentChange === null ? "—" : signedPercent(quote.percentChange)}</span><span className={styles.amount}>{quote.change === null ? "" : signedMoney(quote.change, quote.currency)}</span></FlashValue>
          <div className={styles.stateRow}><span><Status quote={quote} ja={ja} update updatedAt={receivedAt} /></span>
            <span className={styles.mode} role="group" aria-label={t("チャートの種類", "Chart type")}><button type="button" aria-pressed={mode === "candles"} onClick={() => setMode("candles")}>{t("ローソク足", "Candles")}</button><button type="button" aria-pressed={mode === "line"} onClick={() => setMode("line")}>{t("ライン", "Line")}</button></span></div>
        </div> : <div className={styles.priceHold}><p className={styles.error} role="status">{!loaded ? t("株価を読み込み中…", "Loading the price…") : failed ? t("株価を取得できませんでした。しばらくしてからもう一度お試しください。", "Could not load the price. Please try again shortly.") : ""}</p></div>}
        <div className={styles.chartBlock}>
          {drawn === null ? <div>{mode === "candles" && <div className={chartStyles.legend} aria-hidden="true">&nbsp;</div>}<div className={`${chartStyles.frame} ${chartStyles.detail}`} role="status"><span className={chartStyles.empty}>{t("チャートを読み込み中…", "Loading the chart…")}</span></div></div> : <PriceChart bars={drawn.bars} before={drawn.before} mode={mode} interval={interval} jst={intraday} tag={tag} live={intraday && now !== null ? { phase } : undefined} sessionTicks={shownRange === "15m"} busy={store.busy} ja={ja} />}
          <PeriodButtons period={range} onChange={setRange} ja={ja} />
          {isChangePeriod(range) && periodBases && <PeriodChangeLine period={range} base={periodBases.bases[range]} price={quote?.price ?? null} today={periodBases.today} ja={ja} />}
        </div>
        <div className={styles.alert}><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 17h12l-1.5-2V10a4.5 4.5 0 0 0-9 0v5zM10 20a2 2 0 0 0 4 0" /></svg>{t("価格通知", "Price alert")}</span><button type="button" onClick={() => setAlertOpen(true)}>{t("設定する", "Set up")}</button></div>
        {quote && <dl className={styles.info}>
          <div className={styles.row}><dt>{t("前日終値", "Previous close")}</dt><dd>{quote.previousClose ? plain(quote.previousClose) : "—"}</dd></div>
          <div className={styles.rowGauge}><div className={styles.line}><span>{t("本日の値幅", "Today's range")}</span><span>{quote.low && quote.high ? `${plain(quote.low)} — ${plain(quote.high)}` : "—"}</span></div><GaugeBar low={quote.low ?? null} high={quote.high ?? null} price={quote.price} /></div>
          <div className={styles.rowGauge}><div className={styles.line}><span>{t("52週の値幅", "52-week range")}</span><span>{quote.week52Low && quote.week52High ? `${plain(quote.week52Low)} — ${plain(quote.week52High)}` : "—"}</span></div><GaugeBar low={quote.week52Low ?? null} high={quote.week52High ?? null} price={quote.price} /></div>
          {!bare && <>
            <div className={styles.row} style={{ borderTop: "1px solid rgba(217,180,106,.14)" }}><dt>{t("出来高", "Volume")}</dt><dd>{quote.volume ? compact(quote.volume) : "—"}</dd></div>
            <div className={styles.row}><dt>{t("時価総額", "Market cap")}</dt><dd>{facts?.marketCap ? compact(facts.marketCap) : "—"}</dd></div>
            <div className={styles.row}><dt>EPS</dt><dd>{facts?.eps == null ? "—" : facts.eps < 0 ? `−${plain(Math.abs(facts.eps))}` : plain(facts.eps)}</dd></div>
            <div className={styles.row}><dt>{t("次回決算", "Next earnings")}</dt><dd>{nextEarningsText(facts, ja ? "ja" : "en")}</dd></div></>}
        </dl>}
      </section>
      {!bare && <>
        <section id="company" className={styles.section}>
          <h2>{t("企業情報", "Company")}</h2>
          {profile === null ? <p className={styles.error} style={{ padding: 0 }} role="status">{t("読み込み中…", "Loading…")}</p> : profile.introduction ? <CompanyIntroductionPanel introduction={profile.introduction} network={profile.network} lang={lang} /> : <p className={styles.error} style={{ padding: 0 }}>{t("この銘柄の企業情報は準備中です。", "Company information is not available yet.")}</p>}
        </section>
        <section id="map" className={styles.section}>
          <h2>{t("連関マップ", "Relationship map")}</h2>
          {profile === null ? <p className={styles.error} style={{ padding: 0 }} role="status">{t("読み込み中…", "Loading…")}</p> : profile.network && !profile.introduction ? <CompanyNetworkMap key={profile.network.root} graph={profile.network} lang={lang} /> : profile.network ? <p className={styles.error} style={{ padding: 0 }}>{t("連関マップは上の企業情報の中にあります。", "The relationship map is part of the company information above.")}</p> : <p className={styles.error} style={{ padding: 0 }}>{t("この銘柄の連関マップは準備中です。", "A relationship map is not available yet.")}</p>}
        </section></>}
      <p className={styles.credit}>{t("提供：Twelve Data", "Data: Twelve Data")}</p>
      {alertOpen && <AlertSheet ticker={ticker} currency={quote?.currency ?? "USD"} ja={ja} onClose={() => setAlertOpen(false)} />}
    </div>
  </ResearchToolShell>;
}
function GaugeBar({ low, high, price }: { low: number | null; high: number | null; price: number }) {
  const position = rangePosition(price, low, high);
  return <div className={styles.gaugeBar}>{position !== null && <span className={styles.gaugeMark} style={{ left: `${position}%` }} />}</div>;
}
