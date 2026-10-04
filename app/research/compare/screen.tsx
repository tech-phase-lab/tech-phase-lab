"use client";
import { useMemberDisplay } from "../member-display-provider";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { searchStocks } from "@/lib/research/stock-search";
import { comparisonCatalog } from "@/lib/research/comparison-catalog";
import type { ComparisonResult, Fact } from "@/lib/research/comparison";
import styles from "./styles.module.css";
import TickerSearch from "./ticker-search";
import { comparisonScores, comparisonMetric, comparisonLeaders, comparisonAvailability, hasRecentQuarter, radarPoint, quarterlyTakeaway } from "@/lib/research/comparison-scorecard";
import { comparisonChoices, enterChoice, moveChoice } from "@/lib/research/comparison-selection";
import { twelveFactorMethods } from "@/lib/research/twelve-data-factors";
const percent = (n: number | null) => n === null ? "—" : `${n.toFixed(1)}%`;
function money(f: Fact | null, lang: string) { return f ? `${new Intl.NumberFormat(lang === "ja" ? "ja-JP" : "en-US", { notation: "compact", maximumFractionDigits: 2 }).format(f.value)} ${f.unit}` : "—"; }
const companyColors = ["#ddc38a", "#9ed8c3", "#a5badf"];
function StatusChart({companies,lang,now}: {companies:ComparisonResult["companies"];lang:"ja"|"en";now:number}) {
  const sets=companies.map(c=>comparisonScores(c,now)), factors=sets[0];
  const labels=lang==="ja" ? ["財務", "収益", "割安", "安定", "株価", "成長", "資金"] : ["Finance", "Profit", "Value", "Stability", "Momentum", "Growth", "Cash"];
  const available=sets.some(scores=>scores.some(s=>s.value!==null));
  return <div className={styles.statusChart}>
    <div className={styles.statusLegend}>{companies.map((c,i)=><span key={c.ticker} style={{color:companyColors[i]}}>{c.ticker}</span>)}</div>
    <svg viewBox="0 0 300 300" role="img" aria-label={lang==="ja" ? "企業ステータス比較。未取得の項目は描画しません。" : "Company status comparison. Unavailable or unscored factors are not plotted."}>
      {[2,4,6,8,10].map(level=><polygon key={level} points={factors.map((_,i)=>radarPoint(level,i,factors.length)).join(" ")} fill="none" stroke="#435b60" strokeOpacity=".55"/>)}
      {factors.map((f,i)=>{const [x,y]=radarPoint(10,i,factors.length)!.split(","),angle=-Math.PI/2+i*2*Math.PI/factors.length;return <g key={f.id}><line x1="150" y1="150" x2={x} y2={y} stroke="#435b60" strokeOpacity=".5"/><text x={150+Math.cos(angle)*119} y={154+Math.sin(angle)*111} textAnchor="middle" fill="#b3c6c4" fontSize="11">{labels[i]}</text></g>;})}
      {sets.map((scores,cIndex)=>{const points=scores.map((s,i)=>radarPoint(s.value,i,scores.length));return <g key={companies[cIndex].ticker} fill={companyColors[cIndex]} stroke={companyColors[cIndex]}>{points.every(p=>p!==null) && <polygon points={points.join(" ")} fillOpacity=".12" strokeWidth="1.6"/>}{points.map((point,i)=>point!==null && points[(i+1)%points.length]!==null ? <line key={`edge-${i}`} x1={point.split(",")[0]} y1={point.split(",")[1]} x2={points[(i+1)%points.length]!.split(",")[0]} y2={points[(i+1)%points.length]!.split(",")[1]} strokeWidth="1.6"/> : null)}{points.map((point,i)=>point===null ? null : <circle key={scores[i].id} cx={point.split(",")[0]} cy={point.split(",")[1]} r={4+cIndex} fillOpacity=".7" strokeWidth="1"><title>{`${companies[cIndex].ticker} ${scores[i].label[lang]}: ${scores[i].value}/10`}</title></circle>)}</g>;})}
      {!available && <text x="150" y="154" textAnchor="middle" fill="#b2c2c7" fontSize="12">{lang==="ja" ? "データ未取得" : "Data unavailable"}</text>}
    </svg>
    <p className={styles.snapshotNote}>{lang==="ja" ? "未取得・評価保留は描画しません" : "Unavailable or unscored factors are not plotted"}</p>
  </div>;
}
function ScoreOverview({companies,lang,now}: {companies:ComparisonResult["companies"];lang:"ja"|"en";now:number}) {
  const scoreSets=companies.map(c=>comparisonScores(c,now)), factors=scoreSets[0], ja=lang==="ja";
  return <section className={styles.scoreOverview}><div className={styles.scoreHeading}><h2>{ja ? "比較スナップショット" : "Comparison snapshot"}</h2><small>{ja ? "参考スコア / 10" : "Reference score / 10"}</small></div>
    <table className={styles.snapshotTable} style={{"--companies":companies.length} as React.CSSProperties}><caption className={styles.srOnly}>{ja ? "各項目の企業別スコア" : "Company scores by factor"}</caption>
      <thead><tr><th scope="col">{ja ? "項目" : "Factor"}</th>{companies.map((c,i)=><th key={c.ticker} scope="col" data-company={i}><span className={styles.snapshotTicker}>{c.ticker}</span></th>)}</tr></thead>
      <tbody>{factors.map((f,index)=><tr key={f.id}><th scope="row">{f.label[lang]}</th>{companies.map((c,i)=>{const score=scoreSets[i][index];const winner=comparisonLeaders(companies,f.id,now)[i];return <td key={c.ticker} data-winner={winner}><div className={styles.snapshotValue}><span className={styles.scoreTrack} aria-hidden="true">{score.value!==null && <i data-company={i} style={{width:`${score.value*10}%`}}/>}</span><strong>{score.value===null ? "—" : score.value.toFixed(1)}</strong></div><small className={styles.factorMetric}>{comparisonMetric(c,score.id,lang,now)}</small></td>;})}</tr>)}</tbody>
    </table><p className={styles.snapshotNote}>{ja ? "— 未取得・評価保留（0点ではありません）" : "— Unavailable or unscored, not zero"}</p>
  </section>;
}
function CompanyScoreCard({company:c,lang,now}: {company:ComparisonResult["companies"][number];lang:"ja"|"en";now:number}) {
  const items=hasRecentQuarter(c,now) ? c.preparedAnalysis?.items ?? [] : [], ja=lang==="ja";
  const availability=comparisonAvailability(c,lang,now);
  const highlights={strengths:items.filter(i=>i.kind==="strength").slice(0,4).map(i=>i.short[lang]),weaknesses:items.filter(i=>i.kind==="weakness").slice(0,4).map(i=>i.short[lang])};
  return <article className={styles.scoreCard}>
    <header className={styles.companyHeading}><h3 title={`${c.name}（${c.ticker}）`}>{c.name}（{c.ticker}）</h3><span>{c.referenceEvaluation ? `${ja ? "決算発表" : "Released"} ${c.referenceEvaluation.announced}${ja ? "（米国）" : " (US)"}` : c.quarterRevenue ? `${ja ? "決算期末" : "Period ended"} ${c.quarterRevenue.end}` : ja ? "四半期未取得" : "Quarter unavailable"}</span></header>
    {c.quarterRevenue && <p className={styles.periodLine}>{ja ? "対象期間" : "Reporting period"} {c.quarterRevenue.start ? `${c.quarterRevenue.start} – ` : ""}{c.quarterRevenue.end}</p>}
    {availability && <p className={styles.periodLine}>{availability}</p>}
    <div className={styles.companyProfile}>
      <div className={styles.traitBoxes}>
        <section className={styles.traitBox} aria-label={ja ? "長所" : "Strengths"}>
          <h4>{ja ? "長所" : "Strengths"}</h4>
          {highlights.strengths.length ? <ul>{highlights.strengths.map(item=><li key={item} title={item}>{item}</li>)}</ul> : <p>{availability ? "—" : ja ? "確認できた項目なし" : "No points identified"}</p>}
        </section>
        <section className={`${styles.traitBox} ${styles.weaknessBox}`} aria-label={ja ? "短所" : "Weaknesses"}>
          <h4>{ja ? "短所" : "Weaknesses"}</h4>
          {highlights.weaknesses.length ? <ul>{highlights.weaknesses.map(item=><li key={item} title={item}>{item}</li>)}</ul> : <p>{availability ? "—" : ja ? "確認できた項目なし" : "No points identified"}</p>}
        </section>
      </div>
      <section className={styles.companyStatus} aria-label={ja ? `${c.name}のステータス` : `${c.name} status`}>
        <h4>{ja ? "ステータス" : "Status"}<small>{ja ? "参考スコア / 10" : "Reference score / 10"}</small></h4>
        <StatusChart companies={[c]} lang={lang} now={now}/>
      </section>
    </div>
  </article>;
}
export default function ComparisonScreen() {
  const memberPlan = useMemberDisplay();
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const membership = memberPlan ?? "loading";
  const [queries, setQueries] = useState(["", "", ""]);
  const [suggestions, setSuggestions] = useState<{ ticker: string; name: string }[][]>([[], [], []]);
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [validUntil, setValidUntil] = useState(0);
  const request = useRef<AbortController | null>(null);
  const conclusion = useRef<HTMLDivElement | null>(null);
  const picker = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (memberPlan !== "pro") { request.current?.abort(); setResult(null); setBusy(false); }
    return () => { request.current?.abort(); };
  }, [memberPlan]);
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => { setResult(null); }, Math.max(0, Math.min(validUntil - Date.now(), 2147483647)));
    conclusion.current?.scrollIntoView({ block: "start", behavior: "instant" });
    conclusion.current?.focus({ preventScroll: true });
    return () => clearTimeout(timer);
  }, [result, validUntil]);
  useEffect(() => {
    if (openSlot === null || !queries[openSlot].trim()) return;
    const slot = openSlot, query = queries[slot]; const controller = new AbortController();
    setSuggestions(current => current.map((v,index) => index === slot ? searchStocks(comparisonCatalog, query, 10) : v));
    const timer = setTimeout(async () => { try {
      const response = await fetch(`/api/research/stocks?q=${encodeURIComponent(query)}&limit=10`, { signal: controller.signal }); const data = await response.json();
      if (!controller.signal.aborted && data.ok && Array.isArray(data.results)) setSuggestions(current => current.map((v,index) => index === slot ? data.results : v));
    } catch {} }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [queries, openSlot]);
  function selectCompany(slot: number, company: { ticker: string; name: string }) {
    if (selection.some((ticker, index) => index !== slot && ticker === company.ticker)) return;
    setActiveTicker(null);
    request.current?.abort(); setBusy(false); setError(false); setResult(null);
    setSelection(current => { const next = [...current]; next[slot] = company.ticker; return next; });
    setQueries(current => current.map((q,index) => index === slot ? company.ticker : q)); setOpenSlot(null);
  }
  async function compare(trial=false) {
    const tickers = trial ? ["MU","SNDK"] : selection.filter(Boolean);
    if ((!trial && (!selection[0] || !selection[1])) || tickers.length > 3 || membership !== "pro") return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setResult(null); setError(false); setBusy(true);
    try {
      const response = await fetch(`/api/research/compare?tickers=${encodeURIComponent(tickers.join(","))}${trial ? "&trial=mu-sndk-20261004" : ""}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { setResult(null); window.dispatchEvent(new Event("tech-phase:membership-changed")); return; }
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
  return <ResearchToolShell showTools={!result} showHeading={!result} lang={lang} setLang={setLang} title={t("銘柄比較", "Compare stocks")} description={t("最大3社。数字の差から、投資判断の論点へ。", "Up to three companies. Go from numbers to the questions that matter.")}>
    {!result && <div className={styles.eyebrow}>TECH PHASE PRO <span>{t("開発プレビュー · 決算比較", "PREVIEW · FINANCIAL COMPARISON")}</span></div>}
    {membership === "loading" && <p role="status">{t("会員情報を確認中…", "Checking membership…")}</p>}
    {membership === "free" && <section className={styles.lock}><span aria-hidden="true">🔒</span><h2>{t("比較・評価はPRO会員限定", "Comparison is exclusive to PRO")}</h2><p>{t("2〜3社を選び、結論・実績・成長性・注意点をまとめて確認できます。", "Choose two or three companies to explore the conclusion, performance, growth and caveats.")}</p><Link href="/research/account">{t("ログイン・会員情報", "Sign in / Membership")}</Link></section>}
    {membership === "pro" && <>
      {!result && <>
      <section ref={picker} tabIndex={-1} className={styles.picker} aria-label={t("比較する銘柄", "Select companies")}>
        <div className={styles.slots}>{[0,1,2].map(i => {
          const choices = comparisonChoices(suggestions[i], selection, i);
          const expanded = openSlot === i && Boolean(queries[i].trim()) && choices.length > 0;
          return <div key={i} className={styles.stockSlot}>
            <label htmlFor={`stock-${i}`}>{i === 2 ? t("3社目（任意）", "Company 3 (optional)") : t(`${i+1}社目`, `Company ${i+1}`)}</label>
            <div className={styles.stockInput}>
              <input id={`stock-${i}`} name={`comparison-ticker-${i}`} autoCorrect="off" autoCapitalize="characters" spellCheck={false} role="combobox" aria-expanded={expanded} aria-autocomplete="list" aria-controls={expanded ? `stock-options-${i}` : undefined} aria-activedescendant={expanded && choices.some(c => c.ticker === activeTicker) ? `stock-option-${i}-${activeTicker}` : undefined} autoComplete="off" value={queries[i]} placeholder={t("会社名・銘柄コード", "Company or ticker")}
                onFocus={() => { setOpenSlot(i); setActiveTicker(null); }}
                onBlur={() => setTimeout(() => setOpenSlot(current => current === i ? null : current), 150)}
                onChange={event => {
                  const value = event.target.value; setQueries(current => current.map((q,index) => index === i ? value : q)); setOpenSlot(i); setActiveTicker(null);
                  request.current?.abort(); setResult(null); setBusy(false); setSelection(current => { const next = [...current]; next[i] = ""; return next; });
                }}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Escape") { setOpenSlot(null); setActiveTicker(null); }
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault(); setOpenSlot(i); setActiveTicker(moveChoice(choices, activeTicker, event.key === "ArrowDown" ? 1 : -1));
                  }
                  if (event.key === "Enter" && openSlot === i && queries[i].trim()) {
                    event.preventDefault(); const match = enterChoice(choices, queries[i], activeTicker); if (match) selectCompany(i, match);
                  }
                }} />
              {queries[i] && <button type="button" className={styles.clearStock} aria-label={t(`${i+1}社目をクリア`, `Clear Company ${i+1}`)} onMouseDown={event => event.preventDefault()} onClick={() => {
                request.current?.abort(); setBusy(false); setError(false); setResult(null); setActiveTicker(null); setOpenSlot(null);
                setQueries(current => current.map((q,index) => index === i ? "" : q));
                setSelection(current => { const next = [...current]; next[i] = ""; return next; });
                document.getElementById(`stock-${i}`)?.focus();
              }}>×</button>}
            </div>
            {expanded && <div id={`stock-options-${i}`} role="listbox" aria-label={t(`${i+1}社目の候補`, `Company ${i+1} suggestions`)} className={styles.options}>{choices.map(c => <button id={`stock-option-${i}-${c.ticker}`} type="button" role="option" aria-selected={activeTicker === c.ticker} key={c.ticker} ref={element => { if (activeTicker === c.ticker) element?.scrollIntoView({ block: "nearest" }); }} onMouseDown={event => event.preventDefault()} onClick={() => selectCompany(i,c)}><strong>{c.ticker}</strong><span>{c.name}</span></button>)}</div>}
          </div>;
        })}</div>
        <div className={styles.submit}><small>{selection.filter(Boolean).length} / 3 {t("社を選択", "selected")}</small><button disabled={busy || !selection[0] || !selection[1]} onClick={() => void compare()}>{busy ? t("精査中…", "Analyzing…") : t("この銘柄を比較する", "Compare these stocks")}</button></div>
        <p className={styles.note}>{t("SEC開示を比較。割安評価は株価データ接続後に対応。", "Compare SEC filings. Valuation awaits price data.")}</p>
      </section>
      <button type="button" className={styles.trialButton} disabled={busy} onClick={()=>void compare(true)}>{t("MU・SNDK 保存データで試す · 10/4", "MU / SNDK saved snapshot · Oct 4")}</button>
      <TickerSearch lang={lang} selection={selection} onSelect={selectCompany} />
      </>}
      {busy && <div className={styles.loading} role="status"><span className={styles.spinner} aria-hidden="true"/><strong>{t("開示資料と比較条件を精査中…", "Checking filings and comparability…")}</strong><p>{t("期間・通貨・会計基準を確認しています。初回は時間がかかる場合があります。", "Checking periods, currencies and accounting bases. The first request may take longer.")}</p></div>}
      {error && <p role="alert">{t("比較結果を取得できませんでした。選択は残っています。もう一度お試しください。", "Could not retrieve the comparison. Your selection is saved; please try again.")}</p>}
      {result && <div ref={conclusion} tabIndex={-1} className={`${styles.results} ${styles.resultView}`}>
        <button type="button" className={styles.backToCompare} onClick={()=>{setResult(null);requestAnimationFrame(()=>{picker.current?.scrollIntoView({block:"start",behavior:"instant"});picker.current?.focus({preventScroll:true});});}}>{t("▶ 銘柄比較PROに戻る", "▶ Back to Compare PRO")}</button>
        <section className={styles.conclusion} aria-label={t("結果", "Results")}><p className={styles.eyebrow}>{t("結果", "RESULTS")}</p><h2>{result.trial ? result.conclusion[lang] : quarterlyTakeaway(result.companies,lang,Date.parse(result.generatedAt))}</h2><p>{result.trial ? result.trial.description[lang] : result.companies.some(c=>c.twelveData) ? t("各項目の実数値と参考スコアを比較できます。", "Compare the underlying figures and reference scores for each factor.") : t("割安度：最新株価・PER・PEGの接続待ち。", "Valuation awaits current price, P/E and PEG data.")}</p>{result.reasons.length > 0 && <details><summary>{t("比較条件・注意点", "Comparison caveats")}</summary><ul>{result.reasons.map(r => <li key={r.en}>{r[lang]}</li>)}</ul></details>}<small>{result.trial && <>{t("保存データ · 自動更新なし", "Saved snapshot · not auto-updated")} · </>}{t("比較作成", "Compared at")}: {new Date(result.generatedAt).toLocaleString(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo" })} JST</small></section>
        <div className={styles.companyCards}>{result.companies.map(c=><CompanyScoreCard key={c.ticker} company={c} lang={lang} now={Date.parse(result.generatedAt)}/>)}</div><ScoreOverview companies={result.companies} lang={lang} now={Date.parse(result.generatedAt)}/>
        {result.companies.some(c=>c.preparedAnalysis?.items.length) && <details className={styles.analysisDetails}>
          <summary>{t("長所・短所の詳しい根拠", "Evidence behind strengths and weaknesses")}</summary>
          {result.companies.filter(c=>c.preparedAnalysis?.items.length).map(c=><section key={c.ticker}>
            <h3>{c.name}（{c.ticker}）</h3>
            <small>{t("決算期末", "Period ended")} {c.preparedAnalysis!.periodEnd}</small>
            <ul>{c.preparedAnalysis!.items.map(item=><li key={item.id}><strong data-kind={item.kind}>{item.short[lang]}</strong><p>{item.detail[lang]}</p></li>)}</ul>
            <a href={c.preparedAnalysis!.sourceUrl} target="_blank" rel="noreferrer">{c.twelveData ? "Twelve Data" : t("決算資料", "Financial filing")}</a>
          </section>)}
        </details>}
        {result.trial && <details className={styles.scoreMethod}><summary>{t("評価基準・対象期間・出典", "Methodology, periods and sources")}</summary><p>{result.trial.notes[lang]}</p><p>{t("固定した実データを用いる検証です。自動更新・同業順位の採点ではありません。前受金や調整FCFの定義差は長所・短所の根拠に記載しています。", "This trial uses a fixed reviewed dataset, not an auto-updating feed or peer-percentile model. Prepayments and adjusted FCF differences are explained in the evidence.")}</p>{result.companies[0].referenceEvaluation?.factors.map(f=><p key={f.id}><strong>{comparisonScores(result.companies[0]).find(s=>s.id===f.id)?.label[lang]}</strong>：{f.method[lang]}</p>)}<div>{result.companies.map(c=><section key={c.ticker}><h3>{c.name}（{c.ticker}）</h3>{c.referenceEvaluation?.observations?.map(o=><p key={o.en}>{o[lang]}</p>)}</section>)}</div><ul>{result.companies[0].referenceEvaluation?.sources.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label}</a></li>)}</ul></details>}
        {!result.trial && <>
        <details className={styles.scoreMethod}><summary>{t("スコアの見方・計算条件", "Score methodology")}</summary><p>{t("共通の目盛りで比較する参考スコアです。同業順位や売買推奨ではありません。欠損項目は0点にせず、評価を表示しません。成長性は四半期売上前年比0%＝5点・50%＝10点、収益性は営業利益率0%＝0点・50%＝10点、資金創出は簡易FCF率0%＝5点・25%＝10点。0〜10点の範囲に収めています。", "Reference scores use a common scale, not peer ranks or trading recommendations. Missing factors remain unscored. Growth: revenue YoY 0% = 5, 50% = 10; profitability: operating margin 0% = 0, 50% = 10; cash: simple FCF margin 0% = 5, 25% = 10. Scores are bounded to 0–10.")}</p>{result.companies.some(c=>c.twelveData) ? <>{Object.entries(twelveFactorMethods).map(([id,method])=><p key={id}>{method[lang]}</p>)}<p>{t("予想PERは提供元の予想値で、予想利益の集計期間と更新日は応答から確認できない場合があります。取得日時をデータ更新日とは扱いません。", "Forward P/E uses provider estimates; the earnings forecast horizon and update date may not be established by the response. Retrieval time is not the source update time.")}</p>{result.companies.map(c=>c.twelveData && <p key={c.ticker}>{c.ticker} · {t("決算期末", "Period ended")} {c.twelveData.periodEnd}{c.twelveData.momentum && <> · {t("株価対象期間", "Price period")} {c.twelveData.momentum.from} – {c.twelveData.momentum.to}</>}</p>)}</> : <p>{t("財務健全性は同四半期の流動比率と現金・開示債務を使用。割安性・安定性・モメンタムは必要データの接続後に表示します。", "Financial strength uses same-quarter liquidity and cash versus disclosed debt. Valuation, stability and momentum require their respective feeds.")}</p>}</details>
        <details className={styles.detailNumbers}><summary>{t("詳しい数値・出典を見る", "View detailed numbers and sources")}</summary><div className={styles.results}>
        <section className={styles.numbers}><h2>{t("直近の四半期を確認", "Recent quarterly performance")}</h2><p className={styles.note}>{t("取得した決算資料にある3か月実績です。各社の期間を明記します。未取得は — 。", "Standalone quarterly results from retrieved filings. Reporting periods are shown; — means unavailable.")}</p><div className={styles.table} style={{ "--companies": result.companies.length } as React.CSSProperties} role="table" aria-label={t("四半期比較", "Quarterly comparison")}><div role="row" className={styles.tableHead}><span role="columnheader">{t("項目", "Metric")}</span>{result.companies.map(c => <strong role="columnheader" key={c.ticker}>{c.ticker}</strong>)}</div>{([
          [t("対象期間", "Period"), c => c.quarterRevenue ? `${c.quarterRevenue.start ? `${c.quarterRevenue.start} — ` : ""}${c.quarterRevenue.end}` : "—"],
          [t("四半期売上高", "Quarterly revenue"), c => money(c.quarterRevenue, lang)],
          [t("売上増減率 · 前年同期比", "Revenue change · YoY"), c => percent(c.quarterRevenueGrowth)],
          [t("四半期営業利益率", "Quarterly operating margin"), c => percent(c.quarterOperatingMargin)],
        ] as [string, (c: ComparisonResult["companies"][number]) => string][]).map(([label, format]) => <div role="row" className={styles.row} key={label}><span role="rowheader">{label}</span>{result.companies.map(c => <span role="cell" key={c.ticker}>{format(c)}</span>)}</div>)}</div></section>
        <section className={styles.numbers}><h2>{t("年次の数字で比較", "Annual reported numbers")}</h2><p className={styles.note}>{t("各社の年次実績。金額は各社の報告通貨です。— は未確認で、ゼロではありません。", "Annual results in each company's reporting currency. — means unverified, not zero.")}</p><div className={styles.table} style={{ "--companies": result.companies.length } as React.CSSProperties} role="table" aria-label={t("年次財務比較", "Annual financial comparison")}><div role="row" className={styles.tableHead}><span role="columnheader">{t("項目", "Metric")}</span>{result.companies.map(c => <strong role="columnheader" key={c.ticker}>{c.ticker}</strong>)}</div>{rows.map(([label, format]) => <div role="row" className={styles.row} key={label}><span role="rowheader">{label}</span>{result.companies.map(c => <span role="cell" key={c.ticker}>{format(c)}</span>)}</div>)}</div></section>
        <section className={styles.numbers}><h2>{t("負債と資金余力", "Debt and liquidity")}</h2><p className={styles.note}>{t("貸借対照表の数値を取得できた四半期、または年次決算の同一時点で比較。流動比率＝流動資産÷流動負債。— は未確認で、借入ゼロではありません。", "Uses one filing/date per company: a quarter with balance-sheet data, or the annual filing. Current ratio = current assets / current liabilities. — does not mean zero debt.")}</p><div className={styles.table} style={{ "--companies": result.companies.length } as React.CSSProperties} role="table" aria-label={t("負債と流動性の比較", "Debt and liquidity comparison")}><div role="row" className={styles.tableHead}><span role="columnheader">{t("項目", "Metric")}</span>{result.companies.map(c => <strong role="columnheader" key={c.ticker}>{c.ticker}</strong>)}</div>{balanceRows.map(([label, format]) => <div role="row" className={styles.row} key={label}><span role="rowheader">{label}</span>{result.companies.map(c => <span role="cell" key={c.ticker}>{format(c)}</span>)}</div>)}</div><p className={styles.note}>{t("長期債務・短期借入・営業リースはそれぞれの開示項目です。これらだけで有利子負債総額やネットキャッシュを断定しません。ファイナンスリース、金利、返済予定、設備投資の契約は追加確認が必要です。", "Debt, borrowings and operating leases are separate reported concepts, not a verified total-debt or net-cash figure. Finance leases, interest, maturities and capex commitments still need review.")}</p></section>
        <section><h2>{t("成長性と注意点", "Growth and caveats")}</h2><div className={styles.companyCards}>{result.companies.map(c => <article key={c.ticker}><p className={styles.eyebrow}>{c.ticker}</p><h3>{c.name}</h3><p>{c.status === "unavailable" ? t("取得先に接続できません。ほかの会社の結果だけで順位は付けていません。", "The data source was unavailable. No ranking based on the remaining companies.") : c.status === "unsupported" ? t("比較条件を満たす年次データを確認できません。別の公式資料の接続が必要です。", "No qualifying annual data. Another official source needs to be integrated.") : c.revenueGrowth === null ? t("前年比を同じ条件で計算できません。", "A like-for-like year-on-year change is unavailable.") : t(`年次売上の増減率は${percent(c.revenueGrowth)}。買収・為替・低い前年水準による押上げは別途検証が必要です。`, `Annual revenue changed ${percent(c.revenueGrowth)}. Acquisitions, FX and low-base effects need separate review.`)}</p>{c.quarterRevenue && <p>{t(`${c.quarterRevenue.end}終了の四半期は、売上前年比${percent(c.quarterRevenueGrowth)}、営業利益率${percent(c.quarterOperatingMargin)}。年次と四半期の違いも確認してください。`, `For the quarter ended ${c.quarterRevenue.end}: revenue change ${percent(c.quarterRevenueGrowth)}, operating margin ${percent(c.quarterOperatingMargin)}. Review quarterly results alongside the annual trend.`)}</p>}
          {c.quarterRevenue && Date.parse(result.generatedAt) - Date.parse(c.quarterRevenue.end) > 180 * 86400000 && <p className={styles.warning}>{t("取得した四半期の期末から180日超が経過しています。新しい決算がないか確認が必要です。", "The retrieved quarter ended over 180 days ago. Check for a newer release.")}</p>}
          {c.stockCompensationRatio !== null && <p>{t(`CF調整の株式報酬は売上の${percent(c.stockCompensationRatio)}。非現金項目ですが、株主の負担がなくなるわけではありません。`, `Share-based compensation in cash-flow adjustments equals ${percent(c.stockCompensationRatio)} of revenue. Non-cash does not mean cost-free to shareholders.`)}</p>}
          {c.dilutedSharesGrowth !== null && <p>{t(`希薄化後の平均株式数は前年比${percent(c.dilutedSharesGrowth)}。発行・買戻し・潜在株式などの影響が含まれ、将来の希薄化率ではありません。`, `Diluted weighted-average shares changed ${percent(c.dilutedSharesGrowth)} year on year. Issuance, buybacks and potential shares can affect this; it is not a forecast dilution rate.`)}</p>}
          {c.balance?.currentRatio !== null && c.balance?.currentRatio !== undefined && c.balance.currentRatio < 1 && <p className={styles.warning}>{t("流動資産が流動負債を下回っています。入出金の時期や借換え余力を確認する必要があります。これだけで資金不足とは判断しません。", "Current liabilities exceed current assets. Review cash timing and refinancing capacity; this alone does not establish a funding shortfall.")}</p>}
          <p>{c.caution[lang]}</p>{c.operatingIncome && c.operatingIncome.value < 0 && <p className={styles.warning}>{t("営業赤字です。売上成長だけで利益の成長を判断できません。", "Operating loss: revenue growth alone does not establish earnings growth.")}</p>}{c.fcfMargin !== null && c.fcfMargin < 0 && <p className={styles.warning}>{t("営業CFから設備投資を引いた金額はマイナスです。資金調達の必要性を確認します。", "Operating cash flow less capex is negative. Review funding needs.")}</p>}<details><summary>{t("出典と計算条件", "Sources and methodology")}</summary>{c.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noreferrer">{t("SEC提出書類", "SEC filing")} · {c.revenue?.filed}</a>}{c.balance && <p><a href={c.balance.sourceUrl} target="_blank" rel="noreferrer">{t("貸借対照表のSEC提出書類", "Balance-sheet SEC filing")} · {c.balance.filed}</a><br/>{t("基準日", "As of")}: {c.balance.end}</p>}{c.quarterSourceUrl && <p><a href={c.quarterSourceUrl} target="_blank" rel="noreferrer">{c.twelveData ? "Twelve Data" : t("四半期のSEC提出書類", "Quarterly SEC filing")} · {c.quarterRevenue?.filed}</a><br/>{c.quarterRevenue?.tag}</p>}{c.stockCompensation && <p>{c.stockCompensation.tag}</p>}{c.dilutedShares && <p>{c.dilutedShares.tag}<br/>{t("当年／前年の平均株式数", "Current / prior average shares")}: {c.dilutedShares.value.toLocaleString()} / {c.previousDilutedShares?.value.toLocaleString() ?? "—"}</p>}<p>{t("データ取得", "Retrieved")}: {new Date(c.retrievedAt).toLocaleString(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo" })} JST</p>{c.revenue && <p>{c.revenue.start} — {c.revenue.end}<br/>{c.revenue.tag}</p>}<p>{t("簡易FCF＝営業CF−現金支出の設備投資。リース・買収支出などを網羅する指標ではありません。現金残高だけで財務健全性を判定しません。", "Simple FCF = operating cash flow minus cash capex. It does not capture all leases or acquisitions. Cash alone does not establish financial strength.")}</p></details></article>)}</div></section>
        <p className={styles.note}>{t("将来の成長性、正常収益、負債総額・返済予定、事業構成を踏まえた総合評価は次の実装段階です。参考スコアは総合評価や買い推奨ではありません。", "Forward growth, normalized earnings, total debt, maturities and business-mix analysis are not implemented yet. Reference scores are not an overall rating or buy recommendation.")}</p>
        </div></details>
        </>}
      </div>}
    </>}
  </ResearchToolShell>;
}
