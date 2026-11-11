"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { useStockFavorites } from "../use-stock-favorites";
import { useFavoriteLists } from "../watchlist/use-favorite-lists";
import { upsertPriceAlert, formatAlertPrice } from "@/lib/research/price-alert-settings";
import { CompanyIntroductionPanel } from "../stocks/company-introduction";
import { CompanyNetworkMap } from "../stocks/chain-map";
import type { CompanyIntroduction } from "@/lib/research/company-introductions";
import type { CompanyNetwork } from "@/lib/research/company-network";
import { CHART_RANGES, compact, dateJa, plain, rangeChange, signedPercent, type Bar, type ChartRange } from "@/lib/research/market-quote";
import { Change, Extended, Status, Tile, type DetailOrigin } from "./quote-card";
import { shortName, useFacts, useQuotes } from "./use-market";
import PriceChart from "./price-chart";
import styles from "./detail.module.css";
import card from "./price.module.css";

const ORIGINS: Record<DetailOrigin, { ja: string; en: string; href: string }> = {
  watchlist: { ja: "ウォッチリスト", en: "Watchlist", href: "/research/watchlist" },
  watch: { ja: "監視22銘柄", en: "Watched 22", href: "/research/companies" },
  search: { ja: "銘柄検索", en: "Stock search", href: "/research/stocks" },
};
const RANGE_LABEL: Record<ChartRange, [string, string, string]> = {
  "1d": ["1日", "1D", "1日の騰落"], "1w": ["1週", "1W", "1週の騰落"], "1m": ["1ヵ月", "1M", "1ヵ月の騰落"], "3m": ["3ヵ月", "3M", "3ヵ月の騰落"], "6m": ["6ヵ月", "6M", "6ヵ月の騰落"],
  ytd: ["年初来", "YTD", "年初来の騰落"], "1y": ["1年", "1Y", "1年の騰落"], "3y": ["3年", "3Y", "3年の騰落"], "5y": ["5年", "5Y", "5年の騰落"],
};
type Profile = { introduction?: CompanyIntroduction | null; network?: CompanyNetwork | null; name?: string };

function AlertSheet({ ticker, currency, ja, onClose }: { ticker: string; currency: string; ja: boolean; onClose: () => void }) {
  const { alerts = [], update, editable } = useFavoriteLists();
  const saved = alerts.filter(a => a.ticker === ticker);
  const [price, setPrice] = useState(saved[0] ? String(saved[0].price) : "");
  const [direction, setDirection] = useState<"above" | "below">(saved[0]?.direction ?? "above");
  const [unit, setUnit] = useState(saved[0]?.currency ?? currency);
  const [error, setError] = useState<"invalid" | "limit" | null>(null);
  const t = (a: string, b: string) => ja ? a : b;
  return <div className={styles.sheetBack} onClick={onClose}><div className={styles.sheet} role="dialog" aria-modal="true" aria-label={t("価格通知", "Price alert")} onClick={event => event.stopPropagation()}>
    <h2>{t("価格通知", "Price alert")}</h2>
    <p>{t("設定のみ保存できます。通知配信は準備中です。", "You can save your settings, but alerts aren't being sent yet.")}</p>
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

export default function QuoteDetail({ ticker, from }: { ticker: string; from: DetailOrigin }) {
  const [lang, setLang] = useResearchLanguage();
  const router = useRouter();
  const ja = lang === "ja", t = (a: string, b: string) => ja ? a : b;
  const origin = ORIGINS[from];
  const { data: quotes, loaded, failed } = useQuotes([ticker]);
  const quote = quotes?.[ticker];
  const facts = useFacts(ticker).data;
  const [range, setRange] = useState<ChartRange>("1m");
  const [mode, setMode] = useState<"candles" | "line">("candles");
  const [chart, setChart] = useState<{ key: string; bars: Bar[] | null }>({ key: "", bars: null });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [tab, setTab] = useState<"price" | "company" | "map">("price");
  const favorites = useStockFavorites();
  const registered = favorites.lists.some(list => list.tickers.includes(ticker));
  const key = `${ticker}:${range}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/research/market/chart?ticker=${encodeURIComponent(ticker)}&range=${range}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (!controller.signal.aborted) setChart({ key, bars: body?.ok ? body.bars : [] }); })
      .catch(() => { if (!controller.signal.aborted) setChart({ key, bars: [] }); });
    return () => controller.abort();
  }, [ticker, range, key]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/research/stocks?ticker=${encodeURIComponent(ticker)}`, { signal: controller.signal }).then(r => r.ok ? r.json() : null)
      .then(body => { if (!controller.signal.aborted) setProfile(body?.ok ? body.profile : {}); }).catch(() => { if (!controller.signal.aborted) setProfile({}); });
    return () => controller.abort();
  }, [ticker]);
  useEffect(() => {
    const ids = ["price", "company", "map"] as const;
    const observer = new IntersectionObserver(entries => { const hit = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (hit) setTab(hit.target.id as typeof tab); }, { rootMargin: "-20% 0px -65% 0px" });
    ids.forEach(id => { const el = document.getElementById(id); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [profile]);
  const bars = chart.key === key ? chart.bars : null;
  const change = bars?.length && quote ? rangeChange(bars, quote.previousClose ?? null, range) : null;
  const title = shortName(profile?.name ?? quote?.name ?? ticker);
  const toggleStar = () => {
    if (registered) { for (const list of favorites.lists) if (list.tickers.includes(ticker)) favorites.setMembership(list.id, ticker, false); }
    else favorites.toggle(ticker, quote?.name ?? ticker);
  };
  return <ResearchToolShell lang={lang} setLang={setLang} title={`${title} ${ticker}`} description="" showTools={false} showHeading={false}>
    <div className={styles.page}>
      <button type="button" className={styles.back} onClick={() => window.history.length > 1 ? router.back() : router.push(origin.href)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>{origin[lang]}</button>
      <nav className={styles.tabs} aria-label={t("ページ内の移動", "On this page")}>
        {([["price", "株価", "Price"], ["company", "企業情報", "Company"], ["map", "連関マップ", "Relationship map"]] as const).map(([id, a, b]) =>
          <a key={id} href={`#${id}`} aria-current={tab === id} onClick={() => setTab(id)}>{t(a, b)}</a>)}
      </nav>
      <section id="price" className={styles.section} style={{ marginTop: 0 }}>
        <div className={styles.head}><Tile ticker={ticker} /><div className={styles.who}><h1>{title}</h1><b>{ticker}</b></div>
          <button type="button" className={styles.star} aria-pressed={registered} disabled={!favorites.editable} onClick={toggleStar}>
            <svg viewBox="0 0 24 24" fill={registered ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2l-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg>{registered ? t("登録済み", "Saved") : t("登録", "Save")}</button></div>
        {quote ? <>
          <div className={styles.price}>{plain(quote.price)}<small>{quote.currency}</small></div>
          <Change quote={quote} inline />
          <Extended quote={quote} ja={ja} />
          <div className={styles.state}><span><Status quote={quote} ja={ja} />{t(" 更新", " updated")}</span>
            <div className={styles.mode} role="group" aria-label={t("チャートの種類", "Chart type")}><button type="button" aria-pressed={mode === "candles"} onClick={() => setMode("candles")}>{t("ローソク足", "Candles")}</button><button type="button" aria-pressed={mode === "line"} onClick={() => setMode("line")}>{t("ライン", "Line")}</button></div></div>
        </> : <p className={styles.error} role="status">{!loaded ? t("株価を読み込み中…", "Loading the price…") : failed ? t("株価を取得できませんでした。しばらくしてからもう一度お試しください。", "Could not load the price. Please try again shortly.") : ""}</p>}
        <div className={styles.chartWrap}>{bars === null ? <div className={styles.chartEmpty} role="status">{t("チャートを読み込み中…", "Loading the chart…")}</div> : <PriceChart bars={bars} mode={mode} intraday={range === "1d" || range === "1w"} ja={ja} />}</div>
        <div className={styles.ranges} role="group" aria-label={t("チャートの期間", "Chart range")}>{CHART_RANGES.map(r => <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{RANGE_LABEL[r][ja ? 0 : 1]}</button>)}</div>
        <div className={styles.alert}><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15L6 17Z" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>{t("価格通知", "Price alert")}</span><button type="button" onClick={() => setAlertOpen(true)}>{t("設定する", "Set up")}</button></div>
        {quote && <dl className={styles.info}>
          <div className={styles.row}><dt>{RANGE_LABEL[range][2] && (ja ? RANGE_LABEL[range][2] : `${RANGE_LABEL[range][1]} change`)}</dt><dd className={change ? (change.percent >= 0 ? styles.up : styles.down) : undefined}>{change ? `${change.percent >= 0 ? "▲" : "▼"} ${signedPercent(change.percent)}` : "—"}</dd></div>
          <div className={styles.row}><dt>{t("前日終値", "Previous close")}</dt><dd>{quote.previousClose ? plain(quote.previousClose) : "—"}</dd></div>
          <div className={styles.rowGauge}><div className={styles.line}><span>{t("本日の値幅", "Today's range")}</span><span>{quote.low && quote.high ? `${plain(quote.low)} — ${plain(quote.high)}` : "—"}</span></div><GaugeBar low={quote.low ?? null} high={quote.high ?? null} price={quote.price} /></div>
          <div className={styles.rowGauge}><div className={styles.line}><span>{t("52週の値幅", "52-week range")}</span><span>{quote.week52Low && quote.week52High ? `${plain(quote.week52Low)} — ${plain(quote.week52High)}` : "—"}</span></div><GaugeBar low={quote.week52Low ?? null} high={quote.week52High ?? null} price={quote.price} /></div>
          <div className={styles.row}><dt>{t("出来高", "Volume")}</dt><dd>{quote.volume ? compact(quote.volume) : "—"}</dd></div>
          <div className={styles.row}><dt>{t("時価総額", "Market cap")}</dt><dd>{facts?.marketCap ? compact(facts.marketCap) : "—"}</dd></div>
          <div className={styles.row}><dt>EPS</dt><dd>{facts?.eps == null ? "—" : facts.eps < 0 ? `−${plain(Math.abs(facts.eps))}` : plain(facts.eps)}</dd></div>
          <div className={styles.row}><dt>{t("次回決算", "Next earnings")}</dt><dd>{dateJa(facts?.nextEarnings ?? null, ja ? "ja" : "en")}</dd></div>
        </dl>}
      </section>
      <section id="company" className={styles.section}>
        <h2>{t("企業情報", "Company")}</h2>
        {profile === null ? <p className={styles.error} role="status">{t("読み込み中…", "Loading…")}</p> : profile.introduction ? <CompanyIntroductionPanel introduction={profile.introduction} network={profile.network} lang={lang} /> : <p className={styles.error}>{t("この銘柄の企業情報は準備中です。", "Company information is not available yet.")}</p>}
      </section>
      <section id="map" className={styles.section}>
        <h2>{t("連関マップ", "Relationship map")}</h2>
        {profile === null ? <p className={styles.error} role="status">{t("読み込み中…", "Loading…")}</p> : profile.network && !profile.introduction ? <CompanyNetworkMap key={profile.network.root} graph={profile.network} lang={lang} /> : profile.network ? <p className={styles.error}>{t("連関マップは上の企業情報の中にあります。", "The relationship map is part of the company information above.")}</p> : <p className={styles.error}>{t("この銘柄の連関マップは準備中です。", "A relationship map is not available yet.")}</p>}
      </section>
      <p className={styles.credit}>{t("提供：Twelve Data", "Data: Twelve Data")}</p>
      {alertOpen && <AlertSheet ticker={ticker} currency={quote?.currency ?? "USD"} ja={ja} onClose={() => setAlertOpen(false)} />}
    </div>
  </ResearchToolShell>;
}
function GaugeBar({ low, high, price }: { low: number | null; high: number | null; price: number }) {
  const position = low !== null && high !== null && high > low ? Math.max(0, Math.min(100, (price - low) / (high - low) * 100)) : null;
  return <div className={card.bar}>{position !== null && <span className={card.mark} style={{ left: `${position}%` }} />}</div>;
}
