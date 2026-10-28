"use client";

import { capitalRows, type CapitalPortfolio, type CapitalSnapshot } from "@/lib/research/capital-map";
import styles from "./capital-map.module.css";

export default function HoldingDetail({ portfolio, securityId, instrument, baseline, lang, sample, onBack }: {
  portfolio?: CapitalPortfolio; securityId: string; instrument: string; baseline?: CapitalSnapshot;
  lang: string; sample: boolean; onBack: () => void;
}) {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const row = portfolio && capitalRows(portfolio.current, baseline).find(h => h.securityId === securityId && h.instrument === instrument);
  const old = baseline?.holdings.find(h => h.securityId === securityId && h.instrument === instrument);
  const previousShares = old?.shares ?? (baseline?.complete ? 0 : null);
  const delta = row && previousShares !== null ? row.shares - previousShares : null;
  const number = (value: number) => value.toLocaleString(lang === "ja" ? "ja-JP" : "en-US", { maximumFractionDigits: 6 });
  const money = (value: number) => `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return <section className={styles.detailPage} aria-label={t("保有の詳細", "Holding details")}>
    <div className={styles.detailBack}><button onClick={onBack}>← {t("保有一覧に戻る", "Back to holdings")}</button></div>
    {sample && <p className={styles.notice}>{t("架空データの表示サンプルです。", "Display sample using fictional data.")}</p>}
    {!row || !portfolio ? <p>{t("この保有情報は見つかりませんでした。", "This holding was not found.")}</p> : <>
      <p className={styles.detailOwner}>{portfolio.name}</p>
      <h1 tabIndex={-1} data-detail-title>{row.name}</h1>
      <p className={styles.detailTicker}>{row.ticker || `CUSIP ${row.securityId}`}{row.shareClass ? ` · ${row.shareClass}` : ""}{row.instrument !== "stock" ? ` · ${row.instrument.toUpperCase()}` : ""}</p>
      <div className={styles.detailMetrics}>
        <div><small>{t("保有評価額", "Holding value")}</small><strong>{portfolio.current.source?.type === "issuer" && portfolio.current.source.totalValue === 0 ? "—" : money(row.value)}</strong><span>USD · {portfolio.current.asOf}</span></div>
        <div><small>{t("構成比", "Portfolio weight")}</small><strong>{row.weight > 0 && row.weight < .01 ? "<0.01" : row.weight.toFixed(2)}%</strong><span>{portfolio.name}</span></div>
      </div>
      <h2>{row.instrument === "bond" ? t("保有元本の変化", "Change in principal held") : t("保有株数の変化", "Change in shares held")}</h2>
      <div className={styles.detailShares}>
        <div><small>{baseline?.asOf ?? t("比較データなし", "No comparison data")}</small><strong>{previousShares === null ? "—" : number(previousShares)}</strong></div>
        <span aria-hidden="true">→</span>
        <div><small>{portfolio.current.asOf}</small><strong>{number(row.shares)}</strong></div>
      </div>
      <p className={styles.detailDelta} data-change={row.change}>{delta === null ? t("増減は未確認", "Change unavailable") : `${delta > 0 ? "+" : ""}${number(delta)} ${row.instrument === "bond" ? t("USD（元本）", "USD principal") : t("株", "shares")}`}{row.shareChangePercent !== null && <span> ({row.shareChangePercent > 0 ? "+" : ""}{row.shareChangePercent.toFixed(2)}%)</span>}{row.change === "new" && <span> · {t("新規保有", "New holding")}</span>}{row.change === "exited" && <span> · {t("保有解消", "Position exited")}</span>}</p>
      {old && <p className={styles.detailOwner}>{t("前回の保有評価額", "Previous holding value")}: {baseline?.source?.type === "issuer" && baseline.source.totalValue === 0 ? "—" : money(old.value)}</p>}
      {portfolio.current.source && <div className={styles.source}><a href={portfolio.current.source.url} target="_blank" rel="noreferrer">{t("今回の開示", "Current source")}</a>{baseline?.source && <a href={baseline.source.url} target="_blank" rel="noreferrer">{t("比較元の開示", "Comparison source")}</a>}</div>}
    </>}
  </section>;
}
