"use client";
import { recoverMember } from "@/lib/research/member-recovery";
import { useIdentityRefresh } from "../identity-provider";
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
  const refreshIdentity = useIdentityRefresh();
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const [membership, setMembership] = useState("loading");
  const [queries, setQueries] = useState(["", "", ""]);
  const [suggestions, setSuggestions] = useState<{ ticker: string; name: string }[][]>([[], [], []]);
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
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
        const { response, member: m } = await recoverMember(refreshIdentity, AbortSignal.any([current.signal, AbortSignal.timeout(10000)]));
        if (!active || current.signal.aborted) return;
        const state = !response.ok || m.status === "unavailable" ? "error" : m.status !== "signed-in" ? "signed-out" : m.plan === "pro" ? "pro" : "free";
        setMembership(state);
        if (state !== "pro") { request.current?.abort(); setResult(null); setBusy(false); }
      } catch { if (active && !current.signal.aborted) { setMembership("error"); setResult(null); request.current?.abort(); setBusy(false); } }
    }
    void check(); window.addEventListener("focus", check); const timer = setInterval(check, 60000);
    return () => { active = false; controller?.abort(); request.current?.abort(); window.removeEventListener("focus", check); clearInterval(timer); };
  }, [refreshIdentity]);
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => { setResult(null); setMembership("free"); }, Math.max(0, Math.min(validUntil - Date.now(), 2147483647)));
    conclusion.current?.scrollIntoView({ block: "start", behavior: "instant" });
    conclusion.current?.focus({ preventScroll: true });
    return () => clearTimeout(timer);
  }, [result, validUntil]);
  useEffect(() => {
    if (openSlot === null || !queries[openSlot].trim()) return;
    const slot = openSlot, query = queries[slot]; const controller = new AbortController();
    setSuggestions(current => current.map((v,index) => index === slot ? comparisonCatalog.filter(c => `${c.ticker} ${c.name}`.toLowerCase().includes(query.toLowerCase())) : v));
    const timer = setTimeout(async () => { try {
      const response = await fetch(`/api/research/stocks?q=${encodeURIComponent(query)}&limit=10`, { signal: controller.signal }); const data = await response.json();
      if (!controller.signal.aborted && data.ok && Array.isArray(data.results)) setSuggestions(current => current.map((v,index) => index === slot ? data.results : v));
    } catch {} }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [queries, openSlot]);
  function selectCompany(slot: number, company: { ticker: string; name: string }) {
    request.current?.abort(); setBusy(false); setError(false); setResult(null);
    setSelection(current => { const next = [...current]; next[slot] = company.ticker; return next; });
    setQueries(current => current.map((q,index) => index === slot ? company.ticker : q)); setOpenSlot(null);
  }
  async function compare() {
    const tickers = selection.filter(Boolean);
    if (!selection[0] || !selection[1] || tickers.length > 3 || membership !== "pro") return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setResult(null); setError(false); setBusy(true);
    try {
      const response = await fetch(`/api/research/compare?tickers=${encodeURIComponent(tickers.join(","))}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { setMembership(response.status === 401 ? "signed-out" : "free"); return; }
      if (!response.ok || !data.ok || !data.result || !Number.isFinite(data.validUntil) || data.validUntil <= Date.now()) throw Error();
      setValidUntil(data.validUntil); setResult(data.result);
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
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
    [t("株式報酬 · CF調整額", "Share-based compensation · CF adjustment"), c => money(c.stockCompensation, lang)],
    [t("株式報酬／売上高", "Share-based compensation / revenue"), c => percent(c.stockCompensationRatio)],
    [t("希薄化後の平均株式数 · 前年比", "Diluted weighted-average shares · YoY"), c => percent(c.dilutedSharesGrowth)],
    [t("会計基準", "Accounting basis"), c => c.revenue?.basis === "us-gaap" ? "US GAAP" : c.revenue?.basis === "ifrs-full" ? "IFRS" : "—"],
  ];
  const balanceRows: [string, (c: ComparisonResult["companies"][number]) => string][] = [
    [t("貸借対照表の日付", "Balance-sheet date"), c => c.balance?.end ?? "—"],
    [t("現金・現金同等物", "Cash & equivalents"), c => money(c.balance?.cash ?? null, lang)],
    [t("流動資産", "Current assets"), c => money(c.balance?.currentAssets ?? null, lang)],
    [t("流動負債", "Current liabilities"), c => money(c.balance?.currentLiabilities ?? null, lang)],
    [t("流動比率", "Current ratio"), c => c.balance?.currentRatio == null ? "—" : `${(c.balance.currentRatio * 100).toFixed(1)}%`],
    [t("短期借入金 · 開示項目", "Short-term borrowings · reported"), c => money(c.balance?.shortBorrowings ?? null, lang)],
    [t("長期債務の1年内返済分", "Current maturities of long-term debt"), c => money(c.balance?.debtCurrent ?? null, lang)],
    [t("長期債務 · 非流動分", "Long-term debt · noncurrent"), c => money(c.balance?.debtNoncurrent ?? null, lang)],
    [t("営業リース負債 · 流動分", "Operating lease liability · current"), c => money(c.balance?.leaseCurrent ?? null, lang)],
    [t("営業リース負債 · 非流動分", "Operating lease liability · noncurrent"), c => money(c.balance?.leaseNoncurrent ?? null, lang)],
  ];
  return <ResearchToolShell lang={lang} setLang={setLang} title={t("銘柄比較", "Compare stocks")} description={t("最大3社。数字の差から、投資判断の論点へ。", "Up to three companies. Go from numbers to the questions that matter.")}>
    <div className={styles.eyebrow}>TECH PHASE PRO <span>{t("開発プレビュー · 決算比較", "PREVIEW · FINANCIAL COMPARISON")}</span></div>
    {membership === "loading" && <p role="status">{t("会員情報を確認中…", "Checking membership…")}</p>}
    {membership === "error" && <p role="alert">{t("会員情報を確認できません。再読み込みしてください。", "Membership could not be verified. Please reload.")}</p>}
    {(membership === "free" || membership === "signed-out") && <section className={styles.lock}><span aria-hidden="true">🔒</span><h2>{t("比較・評価はPRO会員限定", "Comparison is exclusive to PRO")}</h2><p>{t("2〜3社を選び、結論・実績・成長性・注意点をまとめて確認できます。", "Choose two or three companies to explore the conclusion, performance, growth and caveats.")}</p><Link href="/research/account">{t("ログイン・会員情報", "Sign in / Membership")}</Link></section>}
    {membership === "pro" && <>
      <section className={styles.picker} aria-label={t("比較する銘柄", "Select companies")}>
        <div className={styles.slots}>{[0,1,2].map(i => <div key={i} className={styles.stockSlot}><label htmlFor={`stock-${i}`}>{i === 2 ? t("3社目（任意）", "Third (optional)") : t(`${i+1}社目`, `Company ${i+1}`)}</label><input id={`stock-${i}`} name={`comparison-ticker-${i}`} autoCorrect="off" autoCapitalize="characters" spellCheck={false} role="combobox" aria-expanded={openSlot === i} aria-controls={`stock-options-${i}`} autoComplete="off" value={queries[i]} placeholder={t("会社名・銘柄コード", "Company or ticker")} onFocus={() => setOpenSlot(i)} onBlur={() => setTimeout(() => setOpenSlot(current => current === i ? null : current), 150)} onChange={event => {
          const value = event.target.value; setQueries(current => current.map((q,index) => index === i ? value : q)); setOpenSlot(i);
          request.current?.abort(); setResult(null); setBusy(false); setSelection(current => { const next = [...current]; next[i] = ""; return next; });
        }} onKeyDown={event => { if (event.key === "Escape") setOpenSlot(null); if (event.key === "Enter") { event.preventDefault(); const match = suggestions[i].find(c => c.ticker.toLowerCase() === queries[i].trim().toLowerCase()) || suggestions[i][0]; if (match) selectCompany(i,match); } }} />{openSlot === i && <div id={`stock-options-${i}`} role="listbox" className={styles.options}>{(queries[i].trim() ? suggestions[i] : comparisonCatalog).filter(c => !selection.some((ticker,index) => index !== i && ticker === c.ticker)).slice(0,10).map(c => <button type="button" role="option" aria-selected={selection[i] === c.ticker} key={c.ticker} onMouseDown={event => event.preventDefault()} onClick={() => selectCompany(i,c)}><strong>{c.ticker}</strong><span>{c.name}</span></button>)}</div>}</div>)}</div>
        <div className={styles.submit}><small>{selection.filter(Boolean).length} / 3 {t("社を選択", "selected")}</small><button disabled={busy || !selection[0] || !selection[1]} onClick={() => void compare()}>{busy ? t("精査中…", "Analyzing…") : t("この銘柄を比較する", "Compare these stocks")}</button></div>
        <p className={styles.note}>{t("SEC開示を比較。割安評価は株価データ接続後に対応。", "Compare SEC filings. Valuation awaits price data.")}</p>
      </section>
      {busy && <div className={styles.loading} role="status"><span className={styles.spinner} aria-hidden="true"/><strong>{t("開示資料と比較条件を精査中…", "Checking filings and comparability…")}</strong><p>{t("期間・通貨・会計基準を確認しています。初回は時間がかかる場合があります。", "Checking periods, currencies and accounting bases. The first request may take longer.")}</p></div>}
      {error && <p role="alert">{t("比較結果を取得できませんでした。選択は残っています。もう一度お試しください。", "Could not retrieve the comparison. Your selection is saved; please try again.")}</p>}
      {result && <div className={styles.results}>
        <section ref={conclusion} tabIndex={-1} className={styles.conclusion} aria-label={t("比較の結論", "Comparison conclusion")}><p className={styles.eyebrow}>{t("比較の結論", "THE TAKEAWAY")}</p><h2>{result.conclusion[lang]}</h2><p>{t("割安さ：判定保留。価格・予想利益・成長の持続性を確認してから評価します。", "Valuation: pending. Price, forecast earnings and sustainable growth must be verified first.")}</p>{result.reasons.length > 0 && <details><summary>{t("比較条件・注意点", "Comparison caveats")}</summary><ul>{result.reasons.map(r => <li key={r.en}>{r[lang]}</li>)}</ul></details>}<small>{t("比較作成", "Compared at")}: {new Date(result.generatedAt).toLocaleString(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo" })} JST</small></section>
        <div className={styles.companyCards}>{result.companies.map(c => <article key={c.ticker}>
          <p className={styles.eyebrow}>{c.ticker}</p><h3>{c.name}</h3>
          <p className={styles.note}>{c.quarterRevenue ? t("四半期", "Quarter") : t("年次", "Annual")} · {(c.quarterRevenue ?? c.revenue)?.end ?? "—"}</p>
          <p>{t("売上成長", "Revenue growth")} <strong>{percent(c.quarterRevenue ? c.quarterRevenueGrowth : c.revenueGrowth)}</strong> · {t("前年同期比", "YoY")}</p>
          <p>{t("営業利益率", "Operating margin")} <strong>{percent(c.quarterRevenue ? c.quarterOperatingMargin : c.operatingMargin)}</strong></p>
          <p>{c.caution[lang]}</p>
          {Date.parse(result.generatedAt) - Date.parse((c.quarterRevenue ?? c.revenue)?.end ?? "") > (c.quarterRevenue ? 180 : 450) * 86400000 && <p className={styles.warning}>{t("決算データが古いため、新しい開示の確認が必要です。", "These results are dated. Check for newer filings.")}</p>}
          {c.status !== "ready" && <p className={styles.warning}>{t("比較に必要なデータが不足しています。", "Insufficient data for comparison.")}</p>}
        </article>)}</div>
        <details className={styles.detailNumbers}><summary>{t("詳しい数値・出典を見る", "View detailed numbers and sources")}</summary><div className={styles.results}>
        <section className={styles.numbers}><h2>{t("直近の四半期を確認", "Recent quarterly performance")}</h2><p className={styles.note}>{t("年次決算より後の10-Qにある3か月実績です。累計値を四半期として使わず、各社の期間を明記します。未取得は — 。", "Standalone quarters reported in 10-Q filings after the annual period. YTD totals are excluded. Periods may differ; — means unavailable.")}</p><div className={styles.table} style={{ "--companies": result.companies.length } as React.CSSProperties} role="table" aria-label={t("四半期比較", "Quarterly comparison")}><div role="row" className={styles.tableHead}><span role="columnheader">{t("項目", "Metric")}</span>{result.companies.map(c => <strong role="columnheader" key={c.ticker}>{c.ticker}</strong>)}</div>{([
          [t("対象期間", "Period"), c => c.quarterRevenue ? `${c.quarterRevenue.start} — ${c.quarterRevenue.end}` : "—"],
          [t("四半期売上高", "Quarterly revenue"), c => money(c.quarterRevenue, lang)],
          [t("売上増減率 · 前年同期比", "Revenue change · YoY"), c => percent(c.quarterRevenueGrowth)],
          [t("四半期営業利益率", "Quarterly operating margin"), c => percent(c.quarterOperatingMargin)],
        ] as [string, (c: ComparisonResult["companies"][number]) => string][]).map(([label, format]) => <div role="row" className={styles.row} key={label}><span role="rowheader">{label}</span>{result.companies.map(c => <span role="cell" key={c.ticker}>{format(c)}</span>)}</div>)}</div></section>
        <section className={styles.numbers}><h2>{t("年次の数字で比較", "Annual reported numbers")}</h2><p className={styles.note}>{t("各社の年次実績。金額は各社の報告通貨です。— は未確認で、ゼロではありません。", "Annual results in each company's reporting currency. — means unverified, not zero.")}</p><div className={styles.table} style={{ "--companies": result.companies.length } as React.CSSProperties} role="table" aria-label={t("年次財務比較", "Annual financial comparison")}><div role="row" className={styles.tableHead}><span role="columnheader">{t("項目", "Metric")}</span>{result.companies.map(c => <strong role="columnheader" key={c.ticker}>{c.ticker}</strong>)}</div>{rows.map(([label, format]) => <div role="row" className={styles.row} key={label}><span role="rowheader">{label}</span>{result.companies.map(c => <span role="cell" key={c.ticker}>{format(c)}</span>)}</div>)}</div></section>
        <section className={styles.numbers}><h2>{t("負債と資金余力", "Debt and liquidity")}</h2><p className={styles.note}>{t("取得できた四半期決算、なければ年次決算の同一時点で比較。流動比率＝流動資産÷流動負債。— は未確認で、借入ゼロではありません。", "Uses one filing/date per company: the retrieved quarter, or annual filing if unavailable. Current ratio = current assets / current liabilities. — does not mean zero debt.")}</p><div className={styles.table} style={{ "--companies": result.companies.length } as React.CSSProperties} role="table" aria-label={t("負債と流動性の比較", "Debt and liquidity comparison")}><div role="row" className={styles.tableHead}><span role="columnheader">{t("項目", "Metric")}</span>{result.companies.map(c => <strong role="columnheader" key={c.ticker}>{c.ticker}</strong>)}</div>{balanceRows.map(([label, format]) => <div role="row" className={styles.row} key={label}><span role="rowheader">{label}</span>{result.companies.map(c => <span role="cell" key={c.ticker}>{format(c)}</span>)}</div>)}</div><p className={styles.note}>{t("長期債務・短期借入・営業リースはそれぞれの開示項目です。これらだけで有利子負債総額やネットキャッシュを断定しません。ファイナンスリース、金利、返済予定、設備投資の契約は追加確認が必要です。", "Debt, borrowings and operating leases are separate reported concepts, not a verified total-debt or net-cash figure. Finance leases, interest, maturities and capex commitments still need review.")}</p></section>
        <section><h2>{t("成長性と注意点", "Growth and caveats")}</h2><div className={styles.companyCards}>{result.companies.map(c => <article key={c.ticker}><p className={styles.eyebrow}>{c.ticker}</p><h3>{c.name}</h3><p>{c.status === "unavailable" ? t("取得先に接続できません。ほかの会社の結果だけで順位は付けていません。", "The data source was unavailable. No ranking based on the remaining companies.") : c.status === "unsupported" ? t("比較条件を満たす年次データを確認できません。別の公式資料の接続が必要です。", "No qualifying annual data. Another official source needs to be integrated.") : c.revenueGrowth === null ? t("前年比を同じ条件で計算できません。", "A like-for-like year-on-year change is unavailable.") : t(`年次売上の増減率は${percent(c.revenueGrowth)}。買収・為替・低い前年水準による押上げは別途検証が必要です。`, `Annual revenue changed ${percent(c.revenueGrowth)}. Acquisitions, FX and low-base effects need separate review.`)}</p>{c.quarterRevenue && <p>{t(`${c.quarterRevenue.end}終了の四半期は、売上前年比${percent(c.quarterRevenueGrowth)}、営業利益率${percent(c.quarterOperatingMargin)}。年次と四半期の違いも確認してください。`, `For the quarter ended ${c.quarterRevenue.end}: revenue change ${percent(c.quarterRevenueGrowth)}, operating margin ${percent(c.quarterOperatingMargin)}. Review quarterly results alongside the annual trend.`)}</p>}
          {c.quarterRevenue && Date.parse(result.generatedAt) - Date.parse(c.quarterRevenue.end) > 180 * 86400000 && <p className={styles.warning}>{t("取得した四半期の期末から180日超が経過しています。新しい決算がないか確認が必要です。", "The retrieved quarter ended over 180 days ago. Check for a newer release.")}</p>}
          {c.stockCompensationRatio !== null && <p>{t(`CF調整の株式報酬は売上の${percent(c.stockCompensationRatio)}。非現金項目ですが、株主の負担がなくなるわけではありません。`, `Share-based compensation in cash-flow adjustments equals ${percent(c.stockCompensationRatio)} of revenue. Non-cash does not mean cost-free to shareholders.`)}</p>}
          {c.dilutedSharesGrowth !== null && <p>{t(`希薄化後の平均株式数は前年比${percent(c.dilutedSharesGrowth)}。発行・買戻し・潜在株式などの影響が含まれ、将来の希薄化率ではありません。`, `Diluted weighted-average shares changed ${percent(c.dilutedSharesGrowth)} year on year. Issuance, buybacks and potential shares can affect this; it is not a forecast dilution rate.`)}</p>}
          {c.balance?.currentRatio !== null && c.balance?.currentRatio !== undefined && c.balance.currentRatio < 1 && <p className={styles.warning}>{t("流動資産が流動負債を下回っています。入出金の時期や借換え余力を確認する必要があります。これだけで資金不足とは判断しません。", "Current liabilities exceed current assets. Review cash timing and refinancing capacity; this alone does not establish a funding shortfall.")}</p>}
          <p>{c.caution[lang]}</p>{c.operatingIncome && c.operatingIncome.value < 0 && <p className={styles.warning}>{t("営業赤字です。売上成長だけで利益の成長を判断できません。", "Operating loss: revenue growth alone does not establish earnings growth.")}</p>}{c.fcfMargin !== null && c.fcfMargin < 0 && <p className={styles.warning}>{t("営業CFから設備投資を引いた金額はマイナスです。資金調達の必要性を確認します。", "Operating cash flow less capex is negative. Review funding needs.")}</p>}<details><summary>{t("出典と計算条件", "Sources and methodology")}</summary>{c.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noreferrer">{t("SEC提出書類", "SEC filing")} · {c.revenue?.filed}</a>}{c.balance && <p><a href={c.balance.sourceUrl} target="_blank" rel="noreferrer">{t("貸借対照表のSEC提出書類", "Balance-sheet SEC filing")} · {c.balance.filed}</a><br/>{t("基準日", "As of")}: {c.balance.end}</p>}{c.quarterSourceUrl && <p><a href={c.quarterSourceUrl} target="_blank" rel="noreferrer">{t("四半期のSEC提出書類", "Quarterly SEC filing")} · {c.quarterRevenue?.filed}</a><br/>{c.quarterRevenue?.tag}</p>}{c.stockCompensation && <p>{c.stockCompensation.tag}</p>}{c.dilutedShares && <p>{c.dilutedShares.tag}<br/>{t("当年／前年の平均株式数", "Current / prior average shares")}: {c.dilutedShares.value.toLocaleString()} / {c.previousDilutedShares?.value.toLocaleString() ?? "—"}</p>}<p>{t("データ取得", "Retrieved")}: {new Date(c.retrievedAt).toLocaleString(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo" })} JST</p>{c.revenue && <p>{c.revenue.start} — {c.revenue.end}<br/>{c.revenue.tag}</p>}<p>{t("簡易FCF＝営業CF−現金支出の設備投資。リース・買収支出などを網羅する指標ではありません。現金残高だけで財務健全性を判定しません。", "Simple FCF = operating cash flow minus cash capex. It does not capture all leases or acquisitions. Cash alone does not establish financial strength.")}</p></details></article>)}</div></section>
        <p className={styles.note}>{t("将来の成長性、正常収益、負債総額・返済予定、事業構成を踏まえた総合評価は次の実装段階です。点数や買い推奨を機械的に出していません。", "Forward growth, normalized earnings, total debt, maturities and business-mix analysis are not implemented yet. No automatic overall score or buy recommendation is issued.")}</p>
        </div></details>
      </div>}
    </>}
  </ResearchToolShell>;
}
