"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { valueHoldings, weights, type Holding, type Quote, type Row } from "@/lib/portfolio/calc";
import { parseStored, readHide, readRaw, subscribeStore, writeHide, writeHoldings } from "@/lib/portfolio/store";
import s from "./portfolio.module.css";

type ReviewRow = { id: number; ticker: string; name?: string; shares: string; avg: string; fx?: number; added?: boolean };
type Review = { rows: ReviewRow[]; warnings: string[]; mode: "replace" | "merge" };
type Market = { quotes: Record<string, Quote>; usdJpy: number | null; asOf: string | null };
type Problem = "unreadable" | "limit" | "config" | "service" | "other";
type Stage = "preparing" | "reading";

const COLORS = ["#e7c982", "#7fa8e0", "#b39af0", "#5de0b0", "#f0a67a", "#e07fa0", "#7fd1d9", "#c5d27a"];
const usd = (n: number, digits = 2) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const yen = (n: number) => Math.round(n).toLocaleString("ja-JP");
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
const MASK = "＊＊＊＊＊";
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const dateJa = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${y}年${m}月${d}日(${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`; };
const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
let nextId = 1;

/** Shrink the screenshot in the browser before it is sent (a phone screenshot is several megabytes). */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

const Icon = {
  image: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="M5 17l4.5-4.5 3 3 2.5-2.5L19 17" /></svg>,
  plus: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>,
  eye: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  eyeOff: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6C11 5.6 11.5 5.5 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.7M6.2 7.4C3.8 9.1 2.5 12 2.5 12S6 18.5 12 18.5c1.5 0 2.9-.4 4.100-1M9.900 9.900a3 3 0 0 0 4.200 4.200" /></svg>,
  lock: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2.500" /><path d="M8 10.500V8a4 4 0 0 1 8 0v2.500" /></svg>,
  warn: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.500L21 19.500H3z" /><path d="M12 10v4.500M12 17.200v.1" /></svg>,
  retry: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.400-5.700M20 4v4.500h-4.500" /></svg>,
  close: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  back: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.500 5.500L8 12l6.500 6.500" /></svg>,
};

function Illustration() {
  return <div className={s.illust} aria-hidden="true">
    <div className={s.phone}><i style={{ width: "46%" }} /><i style={{ width: "62%" }} /><i className={s.bar} /><div><i /><b /></div><div><i /><b /></div><div><i /><b /></div><div><i /><b /></div></div>
    <span className={s.arrow}>→</span>
    <div className={s.table}>{["NVDA", "AVGO", "MU", "MSFT"].map((t, i) => <div key={t}><em style={{ color: COLORS[i] }}>{t}</em><b /></div>)}</div>
  </div>;
}

export default function PortfolioScreen() {
  const [lang, setLang] = useResearchLanguage();
  const raw = useSyncExternalStore(subscribeStore, readRaw, () => "");
  const hide = useSyncExternalStore(subscribeStore, () => (readHide() ? "1" : "0"), () => "0") === "1";
  const holdings = useMemo(() => parseStored(raw), [raw]);
  const [market, setMarket] = useState<Market | null>(null);
  const [marketError, setMarketError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [review, setReview] = useState<Review | null>(null);
  const [reading, setReading] = useState<Stage | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [sheet, setSheet] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const tickers = holdings.map(h => h.ticker).join(",");

  useEffect(() => {
    if (!tickers) return;
    const controller = new AbortController();
    fetch(`/api/research/portfolio/quotes?tickers=${encodeURIComponent(tickers)}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("quotes")))
      .then((data: Market) => { setMarket(data); setMarketError(false); })
      .catch(error => { if (error?.name !== "AbortError") setMarketError(true); });
    return () => controller.abort();
  }, [tickers, retry]);

  const { rows, totals } = useMemo(() => valueHoldings(holdings, market?.quotes ?? {}, market?.usdJpy ?? null), [holdings, market]);
  const shares = useMemo(() => weights(rows), [rows]);
  const colorOf = useCallback((ticker: string) => COLORS[Math.max(0, holdings.findIndex(h => h.ticker === ticker)) % COLORS.length], [holdings]);

  const read = useCallback(async (file: File | undefined, mode: "replace" | "merge") => {
    if (!file) return;
    const controller = new AbortController();
    abort.current = controller;
    setProblem(null); setReason(null); setReading("preparing");
    try {
      const image = await shrink(file);
      if (controller.signal.aborted) return;
      setReading("reading");
      const response = await fetch("/api/research/portfolio/parse", { method: "POST", credentials: "same-origin", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // A failed call to the reading service is told apart from a picture that simply could not be read.
        setProblem(data.error === "limit" ? "limit" : data.error === "not-configured" ? "config" : response.status === 400 ? "unreadable" : "service");
        // Anything else (for example a server error with no reason) is a service failure, shown with its status so it can be told apart.
        setReason(typeof data.reason === "string" ? data.reason : `http-${response.status}${typeof data.error === "string" ? `:${data.error}` : ""}`);
        return;
      }
      const complete: ReviewRow[] = (data.holdings ?? []).map((h: Holding) => ({ id: nextId++, ticker: h.ticker, name: h.name, shares: String(h.shares), avg: String(h.avgCostUsd), fx: h.avgCostFx }));
      const partial: ReviewRow[] = (data.incomplete ?? []).map((r: { ticker: string; name?: string; shares: number | null; avgCostUsd: number | null }) => ({ id: nextId++, ticker: r.ticker, name: r.name, shares: r.shares === null ? "" : String(r.shares), avg: r.avgCostUsd === null ? "" : String(r.avgCostUsd) }));
      if (!complete.length && !partial.length) { setProblem("unreadable"); return; }
      // Keep the order of the screen (rows with a missing number stay where they were).
      const order: string[] = Array.isArray(data.order) ? data.order : [];
      const position = (row: ReviewRow) => { const at = order.indexOf(row.ticker); return at < 0 ? order.length : at; };
      const rowsInOrder = [...complete, ...partial].sort((a, b) => position(a) - position(b));
      setReview({ rows: rowsInOrder, warnings: [...(data.mismatch ? [data.mismatch as string] : []), ...(data.warnings ?? [])], mode });
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") setProblem("unreadable");
    } finally { setReading(null); abort.current = null; }
  }, []);

  const pick = (mode: "replace" | "merge") => (event: React.ChangeEvent<HTMLInputElement>) => { void read(event.target.files?.[0], mode); event.target.value = ""; };
  const mode = holdings.length ? "merge" : "replace";
  const ja = lang === "ja";

  return <ResearchToolShell showTools={false} showHeading={false} lang={lang} setLang={setLang} title={ja ? "米国株の資産管理" : "US stock portfolio"} description="">
    <div className={s.page}>
      {manual ? <ManualForm onCancel={() => setManual(false)} onAdd={h => { writeHoldings([...holdings.filter(x => x.ticker !== h.ticker), h]); setManual(false); setProblem(null); }} />
        : review ? <ReviewScreen review={review} setReview={setReview} existing={holdings} />
        : reading ? <>
          <Head />
          <Reading stage={reading} onCancel={() => abort.current?.abort()} onInfo={() => setSheet(true)} />
        </>
        : <>
          <Head sub={holdings.length > 0} />
          {problem && <ErrorCard kind={problem} reason={reason} onManual={() => setManual(true)} pick={pick(mode)} onClose={() => setProblem(null)} />}
          {!problem && holdings.length === 0 && <Empty pick={pick("replace")} onManual={() => setManual(true)} onInfo={() => setSheet(true)} />}
          {holdings.length > 0 && <List rows={rows} totals={totals} shares={shares} hide={hide} market={market} marketError={marketError} onRetry={() => { setMarketError(false); setRetry(value => value + 1); }}
            pick={pick("merge")} onManual={() => setManual(true)} colorOf={colorOf} onClear={() => { if (window.confirm("この端末に保存した持ち株を、すべて消します。よろしいですか?")) writeHoldings([]); }} />}
        </>}
      <p className={s.disclaimer}>投資助言ではありません。</p>
      <p className={s.back}><Link href="/research/account"><span className={s.backIcon}>{Icon.back}</span>マイアカウントに戻る</Link></p>
    </div>
    {sheet && <div className={s.sheetWrap} role="dialog" aria-modal="true" aria-label="画像の扱い">
      <button type="button" className={s.sheetBackdrop} aria-label="閉じる" onClick={() => setSheet(false)} />
      <div className={s.sheet}><h2>画像の扱いについて</h2>
        <p>読み取りのため、画像を外部のAIサービスへ一時的に送ります。送った画像は、こちらでは保存しません。</p>
        <button type="button" className={s.ghost} onClick={() => setSheet(false)}>閉じる</button></div>
    </div>}
  </ResearchToolShell>;
}

function Head({ sub = false }: { sub?: boolean }) {
  return <header className={s.head}>
    <p className={s.kicker}>PORTFOLIO <span className={s.pro}>PRO</span></p>
    <h1>米国株の資産管理</h1>
    {sub && <p className={s.sub}>持ち株は、この端末の中にだけ保存されています。</p>}
  </header>;
}

function Empty({ pick, onManual, onInfo }: { pick: (event: React.ChangeEvent<HTMLInputElement>) => void; onManual: () => void; onInfo: () => void }) {
  return <>
    <section className={s.drop}>
      <Illustration />
      <h2>スクショを選ぶだけで、<br />持ち株を登録できます。</h2>
      <p>証券会社アプリの、米国株の保有銘柄の画面です。</p>
      <label className={s.cta}><input type="file" accept="image/*" onChange={pick} />{Icon.image}スクショを読み込む</label>
      <button type="button" className={s.outline} onClick={onManual}>{Icon.plus}手入力で追加</button>
    </section>
    <ol className={s.steps}>
      <li><i>1</i>証券会社のアプリで、保有銘柄の画面を開く</li>
      <li><i>2</i>スクリーンショットを撮って、ここで選ぶ</li>
      <li><i>3</i>読み取った内容を確認して、登録する</li>
    </ol>
    <section className={s.lockNote}>{Icon.lock}<div><p>持ち株は、この端末の中にだけ保存されます。<br />スクショは読み取りだけに使い、保存しません。</p>
      <button type="button" onClick={onInfo}>くわしく ›</button></div></section>
  </>;
}

function Reading({ stage, onCancel, onInfo }: { stage: Stage; onCancel: () => void; onInfo: () => void }) {
  return <>
    <section className={s.drop} role="status" aria-live="polite">
      <div className={s.scan} aria-hidden="true"><div className={s.phone}><i style={{ width: "46%" }} /><i style={{ width: "62%" }} /><i className={s.bar} /><div><i /><b /></div><div><i /><b /></div><div><i /><b /></div></div><span className={s.beam} /></div>
      <h2>読み取っています</h2>
      <p>数秒かかります。このまま、お待ちください。</p>
      <ul className={s.progress}>
        <li data-state="done"><i />画像を受け取りました</li>
        <li data-state={stage === "reading" ? "active" : "wait"}><i />銘柄と株数を読み取っています</li>
        <li data-state="wait"><i />終値と為替を取得します<small>(登録のあとに行います)</small></li>
      </ul>
      <button type="button" className={s.outline} onClick={onCancel}>やめる</button>
    </section>
    <section className={s.lockNote}>{Icon.lock}<div><p>読み取りには、外部のAIサービスを使います。画像は保存されません。</p><button type="button" onClick={onInfo}>くわしく ›</button></div></section>
  </>;
}

function ErrorCard({ kind, reason, onManual, pick, onClose }: { kind: Problem; reason: string | null; onManual: () => void; pick: (event: React.ChangeEvent<HTMLInputElement>) => void; onClose: () => void }) {
  if (kind === "limit") return <section className={`${s.drop} ${s.err}`} role="alert">
    <span className={s.errIcon}>{Icon.image}</span>
    <h2>今日の読み込みは<br />上限に達しました</h2>
    <p>明日になると、また読み込めます。<br />手入力なら、いまでも追加できます。</p>
    <button type="button" className={s.cta} onClick={onManual}>手入力で追加</button>
    <button type="button" className={s.outline} onClick={onClose}>閉じる</button>
  </section>;
  const title = kind === "config" ? <>画像の読み取りの設定が<br />まだ完了していません</> : kind === "service" ? <>読み取りのサービスに<br />接続できませんでした</> : <>スクショから持ち株を<br />読み取れませんでした</>;
  const note = kind === "config" ? "手入力なら、いまでも追加できます。" : kind === "service" ? <>時間をおいて、もう一度お試しください。<br />手入力なら、いまでも追加できます。</> : <>保有銘柄の画面全体が写っているか、<br />文字がぼやけていないかを確認してください。</>;
  return <section className={`${s.drop} ${s.err}`} role="alert">
    <span className={s.errIcon}>{Icon.warn}</span>
    <h2>{title}</h2>
    <p>{note}</p>
    {kind !== "config" && <label className={s.cta}><input type="file" accept="image/*" onChange={pick} />{kind === "service" ? "もう一度選ぶ" : "別のスクショを選ぶ"}</label>}
    <button type="button" className={kind === "config" ? s.cta : s.outline} onClick={onManual}>手入力で追加</button>
    {kind === "service" && reason && <small className={s.code}>エラー: {reason}</small>}
  </section>;
}

function List({ rows, totals, shares, hide, market, marketError, onRetry, pick, onManual, colorOf, onClear }: {
  rows: Row[]; totals: ReturnType<typeof valueHoldings>["totals"]; shares: ReturnType<typeof weights>; hide: boolean; market: Market | null; marketError: boolean;
  onRetry: () => void; pick: (event: React.ChangeEvent<HTMLInputElement>) => void; onManual: () => void; colorOf: (ticker: string) => string; onClear: () => void;
}) {
  const unknown = marketError;
  const loading = !market && !marketError;
  const gainClass = (n: number | null) => n === null ? "" : n >= 0 ? s.up : s.down;
  return <>
    {unknown && <div className={s.warnBar} role="alert">{Icon.warn}<div><b>終値を取得できませんでした</b><p>株数と平均取得は保存されています。評価額と損益は、取得できてから表示します。</p>
      <button type="button" className={s.retry} onClick={onRetry}>{Icon.retry}もう一度取得する</button></div></div>}
    <section className={s.total} aria-label="合計">
      <div className={s.totalTop}><span>評価額の合計</span><em>{market?.usdJpy ? `USD/JPY ${usd(market.usdJpy)}` : ""}</em></div>
      {hide ? <b className={`${s.big} ${s.mask}`}>{MASK}</b>
        : unknown ? <b className={`${s.big} ${s.dim}`}>確認できません</b>
        : loading ? <b className={`${s.big} ${s.dim}`}>取得しています…</b>
        : totals.valueUsd !== null ? <><b className={s.big}>${usd(totals.valueUsd)}</b>{totals.valueJpy !== null && <span className={s.yen}>¥{yen(totals.valueJpy)}</span>}</>
        : <b className={`${s.big} ${s.dim}`}>確認できません</b>}
      {!hide && unknown && <span className={s.yen}>円換算も確認できません</span>}
      <div className={s.pl}>
        <div><small>損益(ドル)</small>
          {totals.gainUsd !== null && !unknown
            ? <p className={gainClass(totals.gainUsd)}><b>{hide ? MASK : `${sign(totals.gainUsd)}$${usd(Math.abs(totals.gainUsd))}`}</b>{totals.gainPct !== null && <span>{sign(totals.gainPct)}{Math.abs(totals.gainPct).toFixed(1)}%</span>}</p>
            : <p className={s.dim}><b>確認できません</b></p>}
        </div>
        <div><small>損益(円)</small>
          {totals.gainJpy !== null && !unknown ? <p className={gainClass(totals.gainJpy)}><b>{sign(totals.gainJpy)}¥{yen(Math.abs(totals.gainJpy))}</b></p> : <p className={s.dim}><b>—</b></p>}
          <small className={s.hint}>為替が分かる銘柄のみ</small></div>
      </div>
    </section>
    <div className={s.actions}>
      <label className={s.cta}><input type="file" accept="image/*" onChange={pick} />{Icon.image}スクショを追加</label>
      <button type="button" className={s.outline} onClick={onManual}>{Icon.plus}手入力</button>
    </div>
    <button type="button" className={s.pill} onClick={() => writeHide(!hide)} aria-pressed={hide}>{hide ? Icon.eyeOff : Icon.eye}{hide ? "金額を表示する" : "金額を伏せる"}</button>

    {shares.length > 0 && <section className={s.weights} aria-label="銘柄の割合">
      <h3>銘柄の割合</h3>
      <div className={s.stack} role="img" aria-label="銘柄の割合の帯">{shares.map(w => <i key={w.ticker} style={{ width: `${w.percent}%`, background: colorOf(w.ticker) }} />)}</div>
      <ul>{shares.map(w => <li key={w.ticker}><i style={{ background: colorOf(w.ticker) }} /><b>{w.ticker}</b><span>{w.percent.toFixed(1)}%</span></li>)}</ul>
    </section>}

    <h3 className={s.count}>持ち株 {rows.length}銘柄</h3>
    <div className={s.list}>{rows.map(row => {
      const w = shares.find(x => x.ticker === row.ticker);
      const known = row.valueUsd !== null && !unknown;
      return <article key={row.ticker} className={s.card} style={{ ["--c" as string]: colorOf(row.ticker) }}>
        <header><b>{row.ticker}</b><span>{row.name ?? ""}</span><em>{w ? `${w.percent.toFixed(1)}%` : ""}</em></header>
        <dl className={s.grid3}>
          <div><dt>株数</dt><dd>{usd(row.shares, Number.isInteger(row.shares) ? 0 : 4)}株</dd></div>
          <div><dt>平均取得</dt><dd>${usd(row.avgCostUsd)}</dd></div>
          <div><dt>終値</dt><dd>{known && row.price !== null ? `$${usd(row.price)}` : "—"}</dd></div>
        </dl>
        <div className={s.cardFoot}>
          <div><small>評価額</small><b>{known ? `$${usd(row.valueUsd!)}` : "確認できません"}</b></div>
          <div className={s.right}><small>損益</small>{known && row.gainUsd !== null
            ? <b className={gainClass(row.gainUsd)}>{sign(row.gainUsd)}${usd(Math.abs(row.gainUsd))}{row.gainPct !== null && <span>{sign(row.gainPct)}{Math.abs(row.gainPct).toFixed(1)}%</span>}</b>
            : <b className={s.dim}>—</b>}</div>
        </div>
      </article>;
    })}</div>
    {market?.asOf && !unknown && <p className={s.asof}>終値は{dateJa(market.asOf)}のものです。{market.usdJpy ? `為替は USD/JPY ${usd(market.usdJpy)} で円に換算しています。` : ""}</p>}
    <p className={s.clear}><button type="button" onClick={onClear}>この端末のデータを消す</button></p>
  </>;
}

function ReviewScreen({ review, setReview, existing }: { review: Review; setReview: (value: Review | null) => void; existing: Holding[] }) {
  const [attempted, setAttempted] = useState(false);
  const num = (text: string) => { const value = Number(text.replace(/,/g, "").replace(/^\$/, "")); return text.trim() !== "" && Number.isFinite(value) ? value : null; };
  const bad = (row: ReviewRow) => !TICKER.test(row.ticker.trim().toUpperCase()) || !((num(row.shares) ?? 0) > 0) || !((num(row.avg) ?? 0) > 0);
  const edit = (id: number, patch: Partial<ReviewRow>) => setReview({ ...review, rows: review.rows.map(row => row.id === id ? { ...row, ...patch } : row) });
  const needs = review.rows.filter(bad);
  const save = () => {
    setAttempted(true);
    if (needs.length || !review.rows.length) return;
    const next: Holding[] = review.rows.map(row => ({ ticker: row.ticker.trim().toUpperCase(), ...(row.name ? { name: row.name } : {}), shares: num(row.shares)!, avgCostUsd: num(row.avg)!, ...(row.fx ? { avgCostFx: row.fx } : {}) }));
    writeHoldings(review.mode === "replace" ? next : [...existing.filter(h => !next.some(r => r.ticker === h.ticker)), ...next]);
    setReview(null);
  };
  const warnings = [...review.warnings, ...(attempted && needs.length ? [`${needs.length}行に、足りない数字があります。入力してから、登録してください。`] : [])];
  return <>
    <header className={s.head}><p className={s.kicker}>CHECK</p><h1>内容の確認</h1><p className={s.sub}>{review.rows.length}銘柄を読み取りました。数字は直せます。</p></header>
    {warnings.length > 0 && <div className={s.warnBox} role="alert">{Icon.warn}<div><b>確認が必要な行があります</b>{warnings.map((text, index) => <p key={index}>・{text}</p>)}</div></div>}
    <div className={s.reviewList}>{review.rows.map((row, index) => {
      const flagged = bad(row) && (attempted || row.shares === "" || row.avg === "" || row.added);
      return <section key={row.id} className={`${s.rrow} ${flagged ? s.flag : ""}`}>
        <header>
          {row.added ? <input className={s.tickerInput} aria-label="ティッカー" placeholder="ティッカー" value={row.ticker} onChange={event => edit(row.id, { ticker: event.target.value.toUpperCase() })} autoCapitalize="characters" />
            : <b style={{ color: COLORS[index % COLORS.length] }}>{row.ticker}</b>}
          <span>{row.name ?? ""}</span>{flagged && !row.added && <em>要確認</em>}
          <button type="button" aria-label={`${row.ticker || "この行"}を除く`} onClick={() => setReview({ ...review, rows: review.rows.filter(x => x.id !== row.id) })}>{Icon.close}</button>
        </header>
        <div className={s.fields}>
          <label>株数<input inputMode="decimal" placeholder="入力してください" value={row.shares} onChange={event => edit(row.id, { shares: event.target.value })} /></label>
          <label>平均取得価額(USD)<input inputMode="decimal" placeholder="入力してください" value={row.avg === "" ? "" : `$${row.avg.replace(/^\$/, "")}`} onChange={event => edit(row.id, { avg: event.target.value.replace(/^\$/, "") })} /></label>
        </div>
      </section>;
    })}</div>
    <div className={s.twoBtn}>
      <button type="button" className={s.outline} onClick={() => setReview({ ...review, rows: [...review.rows, { id: nextId++, ticker: "", shares: "", avg: "", added: true }] })}>{Icon.plus}追加する</button>
      <button type="button" className={s.outline} onClick={() => setReview(null)}>やめる</button>
    </div>
    <button type="button" className={`${s.cta} ${s.wide}`} onClick={save}>この内容で登録</button>
  </>;
}

function ManualForm({ onAdd, onCancel }: { onAdd: (holding: Holding) => void; onCancel: () => void }) {
  const [ticker, setTicker] = useState(""), [qty, setQty] = useState(""), [cost, setCost] = useState(""), [fx, setFx] = useState("");
  const [options, setOptions] = useState<{ ticker: string; name: string }[]>([]);
  const [picked, setPicked] = useState(false);
  const symbol = ticker.trim().toUpperCase();
  useEffect(() => {
    if (picked || symbol.length < 1) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/research/stocks?q=${encodeURIComponent(symbol)}&limit=5`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : Promise.reject(new Error("search")))
        .then((data: { results?: { ticker: string; name: string }[] }) => setOptions((data.results ?? []).slice(0, 5)))
        .catch(() => setOptions([]));
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [symbol, picked]);
  const rate = fx.trim() === "" ? undefined : Number(fx);
  const valid = TICKER.test(symbol) && Number(qty) > 0 && Number(cost) > 0 && (rate === undefined || (Number.isFinite(rate) && rate > 50 && rate < 400));
  return <>
    <header className={s.head}><p className={s.kicker}>ADD</p><h1>手入力で追加</h1><p className={s.sub}>ティッカー、株数、平均取得価額を入力します。</p></header>
    <form className={s.form} onSubmit={event => { event.preventDefault(); if (valid) onAdd({ ticker: symbol, shares: Number(qty), avgCostUsd: Number(cost), ...(rate ? { avgCostFx: rate } : {}) }); }}>
      <label>ティッカーまたは会社名<input value={ticker} onChange={event => { setTicker(event.target.value); setPicked(false); if (!event.target.value.trim()) setOptions([]); }} autoCapitalize="characters" placeholder="例: NVDA、エヌビディア" autoComplete="off" /><small>日本語の会社名でも探せます。候補から選んでください。</small></label>
      {!picked && options.length > 0 && <ul className={s.options}>{options.map(option => <li key={option.ticker}><button type="button" onClick={() => { setTicker(option.ticker); setPicked(true); setOptions([]); }}><b>{option.ticker}</b><span>{option.name}</span></button></li>)}</ul>}
      <label>株数<input inputMode="decimal" value={qty} onChange={event => setQty(event.target.value)} /><small>小数点も入力できます。</small></label>
      <label>平均取得価額(USD)<input inputMode="decimal" value={cost} onChange={event => setCost(event.target.value)} placeholder="例: 112.50" /></label>
      <label><span>取得時の為替(USD/JPY)<em>任意</em></span><input inputMode="decimal" value={fx} onChange={event => setFx(event.target.value)} placeholder="例: 150.20" /><small>入力すると、円での損益も表示できます。</small></label>
      <button type="submit" className={`${s.cta} ${s.wide}`} disabled={!valid}>追加する</button>
      <button type="button" className={s.ghost} onClick={onCancel}>やめる</button>
    </form>
  </>;
}
