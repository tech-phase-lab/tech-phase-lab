"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { valueHoldings, weights, type Holding, type Quote } from "@/lib/portfolio/calc";
import { parseStored, readHide, readRaw, subscribeStore, writeHide, writeHoldings } from "@/lib/portfolio/store";
import s from "./portfolio.module.css";

type Review = { holdings: Holding[]; warnings: string[]; mismatch: string | null };
type Market = { quotes: Record<string, Quote>; usdJpy: number | null; asOf: string | null };

const usd = (n: number, digits = 2) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const yen = (n: number) => Math.round(n).toLocaleString("ja-JP");
const signed = (n: number, text: string) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${text}`;
const HIDDEN = "••••••";

/** Shrink the screenshot in the browser before it is sent (a phone screenshot is several megabytes). */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

export default function PortfolioScreen() {
  const [lang, setLang] = useResearchLanguage();
  const raw = useSyncExternalStore(subscribeStore, readRaw, () => "");
  const hide = useSyncExternalStore(subscribeStore, () => (readHide() ? "1" : "0"), () => "0") === "1";
  const holdings = useMemo(() => parseStored(raw), [raw]);
  const [market, setMarket] = useState<Market | null>(null);
  const [marketError, setMarketError] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const tickers = holdings.map(h => h.ticker).join(",");

  useEffect(() => {
    if (!tickers) return;
    const controller = new AbortController();
    fetch(`/api/research/portfolio/quotes?tickers=${encodeURIComponent(tickers)}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("quotes")))
      .then((data: Market) => { setMarket(data); setMarketError(false); })
      .catch(error => { if (error?.name !== "AbortError") setMarketError(true); });
    return () => controller.abort();
  }, [tickers]);

  const { rows, totals } = useMemo(() => valueHoldings(holdings, market?.quotes ?? {}, market?.usdJpy ?? null), [holdings, market]);
  const shares = useMemo(() => weights(rows), [rows]);
  const money = (text: string) => hide ? HIDDEN : text;

  const read = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setReading(true); setProblem(null);
    try {
      const image = await shrink(file);
      const response = await fetch("/api/research/portfolio/parse", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblem(data.error === "limit" ? "今日の読み取りの回数の上限に達しました。明日、もう一度お試しください。" : data.error === "not-configured" ? "画像の読み取りの設定が、まだ完了していません。下の「手入力で追加」をお使いください。" : "読み取れませんでした。画面全体が写っているか確認して、もう一度お試しください。");
        return;
      }
      if (!data.holdings?.length) { setProblem("銘柄を読み取れませんでした。米国株の保有銘柄の画面を、撮り直してください。"); return; }
      setReview({ holdings: data.holdings, warnings: data.warnings ?? [], mismatch: data.mismatch ?? null });
    } catch { setProblem("画像を読み込めませんでした。別のスクリーンショットでお試しください。"); }
    finally { setReading(false); }
  }, []);

  function save(mode: "replace" | "merge") {
    if (!review) return;
    const next = mode === "replace" ? review.holdings : [...holdings.filter(h => !review.holdings.some(r => r.ticker === h.ticker)), ...review.holdings];
    writeHoldings(next); setReview(null);
  }
  const edit = (index: number, patch: Partial<Holding>) => setReview(current => current && { ...current, holdings: current.holdings.map((h, i) => i === index ? { ...h, ...patch } : h) });
  const asOf = market?.asOf ? `${market.asOf}の終値` : null;
  const ja = lang === "ja";

  return <ResearchToolShell showTools={false} lang={lang} setLang={setLang} title={ja ? "米国株の資産管理" : "US stock portfolio"} description={ja ? "持ち株のデータは、この端末の中にだけ保存します。サーバーには置きません。" : "Your holdings are kept only on this device."}>
    <div className={s.bar}>
      <label className={s.pick}>
        <input type="file" accept="image/*" disabled={reading} onChange={event => { void read(event.target.files?.[0]); event.target.value = ""; }} />
        {reading ? "読み取っています…" : "スクショを読み込む"}
      </label>
      <button type="button" className={s.ghost} onClick={() => writeHide(!hide)} aria-pressed={hide}>{hide ? "金額を表示する" : "金額を伏せる"}</button>
    </div>
    <p className={s.note}>楽天証券などの、米国株の「保有銘柄」の画面を、スクリーンショットで選びます。読み取りのため、画像は、一時的にAIのサービスへ送られます。保存はされません。</p>
    {problem && <p className={s.error} role="alert">{problem}</p>}

    {review && <section className={s.review} aria-label="読み取り結果の確認">
      <h2>読み取り結果を確認してください</h2>
      {review.mismatch && <p className={s.warn} role="alert">{review.mismatch}</p>}
      {review.warnings.map((warning, index) => <p key={index} className={s.warn}>{warning}</p>)}
      <div className={s.rows}>{review.holdings.map((h, index) => <div key={h.ticker} className={s.reviewRow}>
        <b>{h.ticker}</b><span>{h.name ?? ""}</span>
        <label>株数<input inputMode="decimal" value={h.shares} onChange={event => { const v = Number(event.target.value); if (v >= 0) edit(index, { shares: v }); }} /></label>
        <label>平均取得(ドル)<input inputMode="decimal" value={h.avgCostUsd} onChange={event => { const v = Number(event.target.value); if (v >= 0) edit(index, { avgCostUsd: v }); }} /></label>
        <button type="button" aria-label={`${h.ticker}を除く`} onClick={() => setReview(current => current && { ...current, holdings: current.holdings.filter((_, i) => i !== index) })}>×</button>
      </div>)}</div>
      <div className={s.actions}>
        <button type="button" className={s.primary} disabled={!review.holdings.some(h => h.shares > 0 && h.avgCostUsd > 0)} onClick={() => save("replace")}>この内容で登録(いまの内容を置き換え)</button>
        {holdings.length > 0 && <button type="button" className={s.ghost} onClick={() => save("merge")}>追加する(同じ銘柄は上書き)</button>}
        <button type="button" className={s.ghost} onClick={() => setReview(null)}>やめる</button>
      </div>
    </section>}

    {holdings.length === 0 && !review && <section className={s.empty}>
      <b>まだ持ち株が登録されていません。</b>
      <p>「スクショを読み込む」を押して、証券会社の米国株の保有銘柄の画面を選んでください。数秒で、銘柄の一覧と、評価額が出ます。</p>
    </section>}

    {holdings.length > 0 && <>
      <section className={s.summary} aria-label="合計">
        <small>評価額(円){asOf ? ` ・ ${asOf}` : ""}</small>
        <b className={s.big}>{totals.valueJpy !== null ? money(`${yen(totals.valueJpy)}円`) : marketError ? "価格を取得できません" : "計算しています…"}</b>
        {totals.valueUsd !== null && <span>{money(`${usd(totals.valueUsd)}ドル`)}{market?.usdJpy ? ` ・ 1ドル=${usd(market.usdJpy)}円` : ""}</span>}
        {totals.gainUsd !== null && <div className={`${s.gain} ${totals.gainUsd >= 0 ? s.up : s.down}`}>
          <span>損益(ドル)</span><b>{money(`${signed(totals.gainUsd, usd(Math.abs(totals.gainUsd)))}ドル`)}{totals.gainPct !== null ? ` (${signed(totals.gainPct, Math.abs(totals.gainPct).toFixed(1))}%)` : ""}</b></div>}
        {totals.gainJpy !== null
          ? <div className={`${s.gain} ${totals.gainJpy >= 0 ? s.up : s.down}`}><span>損益(円・取得時の為替で計算)</span><b>{money(`${signed(totals.gainJpy, yen(Math.abs(totals.gainJpy)))}円`)}</b></div>
          : <p className={s.note}>円での損益は、取得したときの為替が画面から分かる銘柄だけで計算できます。いまは、ドルでの損益を表示しています。</p>}
        {totals.missingPrices > 0 && !marketError && <p className={s.note}>{totals.missingPrices}銘柄の価格を、まだ取得できていません。</p>}
      </section>

      {shares.length > 0 && <section className={s.weights} aria-label="割合">
        <div className={s.stack} role="img" aria-label="銘柄の割合">{shares.map((w, index) => <i key={w.ticker} style={{ width: `${w.percent}%`, opacity: Math.max(0.35, 1 - index * 0.12) }} title={`${w.ticker} ${w.percent.toFixed(1)}%`} />)}</div>
        <p>{shares.slice(0, 4).map(w => `${w.ticker} ${w.percent.toFixed(1)}%`).join(" ・ ")}</p>
      </section>}

      <section className={s.list} aria-label="持ち株">
        {rows.map(row => <article key={row.ticker} className={s.card}>
          <header><b>{row.ticker}</b><span>{row.name ?? ""}</span></header>
          <dl>
            <div><dt>株数</dt><dd>{money(usd(row.shares, Number.isInteger(row.shares) ? 0 : 4))}</dd></div>
            <div><dt>平均取得</dt><dd>{usd(row.avgCostUsd, 2)}ドル</dd></div>
            <div><dt>終値</dt><dd>{row.price !== null ? `${usd(row.price)}ドル` : "—"}</dd></div>
            <div><dt>評価額</dt><dd>{row.valueUsd !== null ? money(`${usd(row.valueUsd)}ドル`) : "—"}</dd></div>
            <div><dt>損益</dt><dd className={row.gainUsd === null ? undefined : row.gainUsd >= 0 ? s.up : s.down}>{row.gainUsd !== null ? money(`${signed(row.gainUsd, usd(Math.abs(row.gainUsd)))}ドル`) : "—"}{row.gainPct !== null ? ` (${signed(row.gainPct, Math.abs(row.gainPct).toFixed(1))}%)` : ""}</dd></div>
          </dl>
        </article>)}
      </section>
    </>}

    <section className={s.tools}>
      <button type="button" className={s.ghost} onClick={() => setAdding(value => !value)}>{adding ? "手入力を閉じる" : "手入力で追加"}</button>
      {holdings.length > 0 && <button type="button" className={s.ghost} onClick={() => { if (window.confirm("この端末に保存した持ち株を、すべて消します。よろしいですか?")) writeHoldings([]); }}>データを消す</button>}
      {adding && <ManualAdd onAdd={h => { writeHoldings([...holdings.filter(x => x.ticker !== h.ticker), h]); setAdding(false); }} />}
    </section>
    <p className={s.note}><Link href="/research/account">マイアカウントに戻る</Link></p>
  </ResearchToolShell>;
}

function ManualAdd({ onAdd }: { onAdd: (holding: Holding) => void }) {
  const [ticker, setTicker] = useState(""), [qty, setQty] = useState(""), [cost, setCost] = useState("");
  const valid = /^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker.trim().toUpperCase()) && Number(qty) > 0 && Number(cost) > 0;
  return <form className={s.manual} onSubmit={event => { event.preventDefault(); if (valid) onAdd({ ticker: ticker.trim().toUpperCase(), shares: Number(qty), avgCostUsd: Number(cost) }); }}>
    <input aria-label="ティッカー" placeholder="ティッカー(例: NVDA)" value={ticker} onChange={event => setTicker(event.target.value)} autoCapitalize="characters" />
    <input aria-label="株数" placeholder="株数" inputMode="decimal" value={qty} onChange={event => setQty(event.target.value)} />
    <input aria-label="平均取得価額(ドル)" placeholder="平均取得価額(ドル)" inputMode="decimal" value={cost} onChange={event => setCost(event.target.value)} />
    <button type="submit" className={s.primary} disabled={!valid}>追加する</button>
  </form>;
}
