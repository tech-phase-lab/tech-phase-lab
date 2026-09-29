"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { comparisonCatalog } from "@/lib/research/comparison-catalog";
import type { ComparisonResult, Fact } from "@/lib/research/comparison";
import styles from "./styles.module.css";
const percent = (n: number | null) => n === null ? "—" : `${n.toFixed(1)}%`;
function money(f: Fact | null, lang: string) { return f ? `${new Intl.NumberFormat(lang === "ja" ? "ja-JP" : "en-US", { notation: "compact", maximumFractionDigits: 2 }).format(f.value)} ${f.unit}` : "—"; }
export default function ComparisonScreen() {
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const [membership, setMembership] = useState("loading");
  const [selection, setSelection] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [validUntil, setValidUntil] = useState(0);
  const request = useRef<AbortController | null>(null);
  const conclusion = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let active = true; let controller: AbortController | null = null;
    async function check() {
      controller?.abort(); controller = new AbortController(); const current = controller;
      try {
        const response = await fetch("/api/research/member", { cache: "no-store", signal: AbortSignal.any([current.signal, AbortSignal.timeout(10000)]) });
        const m = await response.json();
        if (!active || current.signal.aborted) return;
        const state = !response.ok || m.status === "unavailable" ? "error" : m.status !== "signed-in" ? "signed-out" : m.plan === "pro" ? "pro" : "free";
        setMembership(state);
        if (state !== "pro") { request.current?.abort(); setResult(null); setBusy(false); }
      } catch { if (active && !current.signal.aborted) { setMembership("error"); setResult(null); request.current?.abort(); setBusy(false); } }
    }
    void check(); window.addEventListener("focus", check); const timer = setInterval(check, 60000);
    return () => { active = false; controller?.abort(); request.current?.abort(); window.removeEventListener("focus", check); clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => { setResult(null); setMembership("free"); }, Math.max(0, Math.min(validUntil - Date.now(), 2147483647)));
    conclusion.current?.scrollIntoView({ block: "start", behavior: "instant" });
    conclusion.current?.focus({ preventScroll: true });
    return () => clearTimeout(timer);
  }, [result, validUntil]);
  function choose(ticker: string) {
    request.current?.abort(); setBusy(false); setError(false); setResult(null);
    setSelection(current => current.includes(ticker) ? current.filter(x => x !== ticker) : current.length < 3 ? [...current, ticker] : current);
    setQuery("");
  }
  async function compare() {
    if (selection.length < 2 || selection.length > 3 || membership !== "pro") return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setResult(null); setError(false); setBusy(true);
    try {
      const response = await fetch(`/api/research/compare?tickers=${encodeURIComponent(selection.join(","))}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { setMembership(response.status === 401 ? "signed-out" : "free"); return; }
      if (!response.ok || !data.ok || !data.result || !Number.isFinite(data.validUntil) || data.validUntil <= Date.now()) throw Error();
      setValidUntil(data.validUntil); setResult(data.result);
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const matches = comparisonCatalog.filter(c => `${c.ticker} ${c.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const rows: [string, (c: ComparisonResult["companies"][number]) => string][] = [
    [t("決算期末（年次）", "Fiscal year end"), c => c.revenue?.end || "—"],
    [t("売上高", "Revenue"), c => money(c.revenue, lang)],
    [t("前年売上高", "Prior-year revenue"), c => money(c.previousRevenue, lang)],
    [t("売上増減率 · 前年比", "Revenue change · YoY"), c => percent(c.revenueGrowth)],
    [t("営業利益率", "Operating margin"), c => percent(c.operatingMargin)],
    [t("営業キャッシュフロー", "Operating cash flow"), c => money(c.operatingCash, lang)],
    [t("現金支出の設備投資", "Cash capital expenditure"), c => money(c.capex, lang)],
    [t("簡易FCFマージン", "Simple FCF margin"), c => percent(c.fcfMargin)],
    [t("現金・現金同等物", "Cash & equivalents"), c => money(c.cash, lang)],
    [t("会計基準", "Accounting basis"), c => c.revenue?.basis === "us-gaap" ? "US GAAP" : c.revenue?.basis === "ifrs-full" ? "IFRS" : "—"],
  ];
  return <ResearchToolShell lang={lang} setLang={setLang} title={t("銘柄比較", "Compare stocks")} description={t("最大3社。数字の差から、投資判断の論点へ。", "Up to three companies. Go from numbers to the questions that matter.")}>
    <div className={styles.eyebrow}>TECH PHASE PRO <span>{t("開発プレビュー · 年次実績比較", "PREVIEW · ANNUAL FINANCIALS")}</span></div>
    {membership === "loading" && <p role="status">{t("会員情報を確認中…", "Checking membership…")}</p>}
    {membership === "error" && <p role="alert">{t("会員情報を確認できません。再読み込みしてください。", "Membership could not be verified. Please reload.")}</p>}
    {(membership === "free" || membership === "signed-out") && <section className={styles.lock}><span aria-hidden="true">🔒</span><h2>{t("比較・評価はPRO会員限定", "Comparison is exclusive to PRO")}</h2><p>{t("2〜3社を選び、結論・実績・成長性・注意点をまとめて確認できます。", "Choose two or three companies to explore the conclusion, performance, growth and caveats.")}</p><Link href="/research/account">{t("ログイン・会員情報", "Sign in / Membership")}</Link></section>}
    {membership === "pro" && <>
      <section className={styles.picker} aria-label={t("比較する銘柄", "Select companies")}>
        <div className={styles.slots}>{[0,1,2].map(i => <div key={i}>{selection[i] ? <><strong>{selection[i]}</strong><button onClick={() => choose(selection[i])} aria-label={`${selection[i]} ${t("を外す", "Remove")}`}>×</button></> : <span>{i === 2 ? t("3社目 · 任意", "Third · optional") : t(`${i+1}社目を選択`, `Choose company ${i+1}`)}</span>}</div>)}</div>
        <label className={styles.search}>{t("銘柄コード・会社名", "Ticker or company name")}<input value={query} onChange={e => setQuery(e.target.value)} placeholder={t("例：MU、NVIDIA、Nebius", "e.g. MU, NVIDIA, Nebius")} autoComplete="off" maxLength={50} /></label>
        <div className={styles.choices}>{matches.map(c => <button key={c.ticker} aria-pressed={selection.includes(c.ticker)} disabled={selection.length === 3 && !selection.includes(c.ticker)} onClick={() => choose(c.ticker)}><strong>{c.ticker}</strong><span>{c.name}</span></button>)}</div>
        {!matches.length && <p>{t("対象銘柄が見つかりません。現在は監視対象の22社から選べます。", "No match. Choose from the 22 companies currently covered.")}</p>}
        <div className={styles.submit}><small>{selection.length} / 3 {t("社を選択", "selected")}</small><button disabled={busy || selection.length < 2} onClick={() => void compare()}>{busy ? t("精査中…", "Analyzing…") : t("この銘柄を比較する", "Compare these stocks")}</button></div>
        <p className={styles.note}>{t("現段階はSEC年次開示の実績比較です。株価・予想利益・最新四半期の分析は未接続のため、割安判定は保留します。", "This preview compares SEC annual filings. Valuation is pending price, forecast and latest-quarter integrations.")}</p>
      </section>
      {busy && <div className={styles.loading} role="status"><span className={styles.spinner} aria-hidden="true"/><strong>{t("開示資料と比較条件を精査中…", "Checking filings and comparability…")}</strong><p>{t("期間・通貨・会計基準を確認しています。初回は時間がかかる場合があります。", "Checking periods, currencies and accounting bases. The first request may take longer.")}</p></div>}
      {error && <p role="alert">{t("比較結果を取得できませんでした。選択は残っています。もう一度お試しください。", "Could not retrieve the comparison. Your selection is saved; please try again.")}</p>}
      {result && <div className={styles.results}>
        <section ref={conclusion} tabIndex={-1} className={styles.conclusion} aria-label={t("比較の結論", "Comparison conclusion")}><p className={styles.eyebrow}>{t("比較の結論", "THE TAKEAWAY")}</p><h2>{result.conclusion[lang]}</h2><p>{t("割安さ：判定保留。価格・予想利益・成長の持続性を確認してから評価します。", "Valuation: pending. Price, forecast earnings and sustainable growth must be verified first.")}</p>{result.reasons.length > 0 && <ul>{result.reasons.map(r => <li key={r.en}>{r[lang]}</li>)}</ul>}<small>{t("比較作成", "Compared at")}: {new Date(result.generatedAt).toLocaleString(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo" })} JST</small></section>
        <section className={styles.numbers}><h2>{t("数字で比較", "Reported numbers")}</h2><p className={styles.note}>{t("各社の年次実績。金額は各社の報告通貨です。— は未確認で、ゼロではありません。", "Annual results in each company's reporting currency. — means unverified, not zero.")}</p><div className={styles.table} style={{ "--companies": result.companies.length } as React.CSSProperties} role="table" aria-label={t("年次財務比較", "Annual financial comparison")}><div role="row" className={styles.tableHead}><span role="columnheader">{t("項目", "Metric")}</span>{result.companies.map(c => <strong role="columnheader" key={c.ticker}>{c.ticker}</strong>)}</div>{rows.map(([label, format]) => <div role="row" className={styles.row} key={label}><span role="rowheader">{label}</span>{result.companies.map(c => <span role="cell" key={c.ticker}>{format(c)}</span>)}</div>)}</div></section>
        <section><h2>{t("成長性と注意点", "Growth and caveats")}</h2><div className={styles.companyCards}>{result.companies.map(c => <article key={c.ticker}><p className={styles.eyebrow}>{c.ticker}</p><h3>{c.name}</h3><p>{c.status === "unavailable" ? t("取得先に接続できません。ほかの会社の結果だけで順位は付けていません。", "The data source was unavailable. No ranking based on the remaining companies.") : c.status === "unsupported" ? t("比較条件を満たす年次データを確認できません。別の公式資料の接続が必要です。", "No qualifying annual data. Another official source needs to be integrated.") : c.revenueGrowth === null ? t("前年比を同じ条件で計算できません。", "A like-for-like year-on-year change is unavailable.") : t(`年次売上の増減率は${percent(c.revenueGrowth)}。買収・為替・低い前年水準による押上げは別途検証が必要です。`, `Annual revenue changed ${percent(c.revenueGrowth)}. Acquisitions, FX and low-base effects need separate review.`)}</p><p>{c.caution[lang]}</p>{c.operatingIncome && c.operatingIncome.value < 0 && <p className={styles.warning}>{t("営業赤字です。売上成長だけで利益の成長を判断できません。", "Operating loss: revenue growth alone does not establish earnings growth.")}</p>}{c.fcfMargin !== null && c.fcfMargin < 0 && <p className={styles.warning}>{t("営業CFから設備投資を引いた金額はマイナスです。資金調達の必要性を確認します。", "Operating cash flow less capex is negative. Review funding needs.")}</p>}<details><summary>{t("出典と計算条件", "Sources and methodology")}</summary>{c.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noreferrer">{t("SEC提出書類", "SEC filing")} · {c.revenue?.filed}</a>}<p>{t("データ取得", "Retrieved")}: {new Date(c.retrievedAt).toLocaleString(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo" })} JST</p>{c.revenue && <p>{c.revenue.start} — {c.revenue.end}<br/>{c.revenue.tag}</p>}<p>{t("簡易FCF＝営業CF−現金支出の設備投資。リース・買収支出などを網羅する指標ではありません。現金残高だけで財務健全性を判定しません。", "Simple FCF = operating cash flow minus cash capex. It does not capture all leases or acquisitions. Cash alone does not establish financial strength.")}</p></details></article>)}</div></section>
        <p className={styles.note}>{t("将来の成長性、正常収益、株式報酬・希薄化、負債、事業構成を踏まえた総合評価は次の実装段階です。点数や買い推奨を機械的に出していません。", "Forward growth, normalized earnings, dilution, debt and business-mix analysis are not implemented yet. No automatic overall score or buy recommendation is issued.")}</p>
      </div>}
    </>}
  </ResearchToolShell>;
}
