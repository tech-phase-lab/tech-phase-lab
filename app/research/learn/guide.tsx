"use client";

import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import styles from "./styles.module.css";

const sections = [
  {
    number: "01",
    ja: "口座を開く前に",
    en: "Before opening an account",
    jaIntro: "日本居住者向けサービスか、金融庁の登録を確認し、次の条件を同じ表で比べます。ランキングではなく、自分の利用条件を確認するための項目です。",
    enIntro: "Confirm that the service accepts residents of Japan and check its FSA registration. Compare the terms below side by side rather than relying on a ranking.",
    jaItems: ["米国株の取扱銘柄・取引時間・注文方法", "売買手数料、為替手数料、口座維持費", "円決済と外貨決済、入出金方法", "特定口座・一般口座・NISAの対象範囲と税務上の扱い", "二要素認証、端末管理、問い合わせ窓口"],
    enItems: ["US stock coverage, trading sessions and supported orders", "Trading, FX and account fees", "JPY or foreign-currency settlement and funding methods", "Tax-account and NISA eligibility; confirm your own tax treatment", "Two-factor authentication, device controls and support channels"],
  },
  {
    number: "02",
    ja: "注文画面で止まって確認",
    en: "Pause before placing an order",
    jaIntro: "成行は約定価格を指定せず、指値は価格を指定します。指値は価格条件を満たさなければ約定しません。利用できる注文種類や時間外取引は証券会社ごとに異なります。",
    enIntro: "A market order does not set an execution price. A limit order sets a price but may not fill. Available order types and extended-hours access differ by broker.",
    jaItems: ["銘柄コードと売買の向き", "株数と概算金額", "成行か指値か、指値なら価格", "当日中など注文の有効期間", "通常時間か時間外か", "為替・手数料を含む余力"],
    enItems: ["Ticker and buy/sell direction", "Share quantity and estimated value", "Market or limit; the limit price if used", "Order duration", "Regular or extended session", "Available funds including FX and fees"],
  },
  {
    number: "03",
    ja: "決算を読む順番",
    en: "A practical earnings sequence",
    jaIntro: "まず発表日時・期間・会社の一次資料を確かめます。数字、会社の説明、自分の解釈を分けると、値動きだけに引っ張られにくくなります。",
    enIntro: "Start with the release time, fiscal period and first-party filings. Separate reported numbers, management commentary and your own interpretation.",
    jaItems: ["売上高と前年同期比", "粗利益率・営業利益率と変化", "EPSと発行株式数・希薄化", "営業キャッシュフロー、設備投資、フリーキャッシュフロー", "次期見通しと、その前提", "10-Q・10-K・8-K、決算資料、説明会の整合"],
    enItems: ["Revenue and year-over-year change", "Gross and operating margins", "EPS, share count and dilution", "Operating cash flow, capex and free cash flow", "Guidance and its assumptions", "Consistency across 10-Q, 10-K, 8-K, releases and calls"],
  },
  {
    number: "04",
    ja: "次に学ぶこと",
    en: "What to learn next",
    jaIntro: "一つの指標で結論を出さず、事業の質、価格、保有リスクを一緒に見ます。買う理由だけでなく、見方を変える条件も先に書きます。",
    enIntro: "Avoid making a decision from one metric. Consider business quality, valuation and portfolio risk together, including what would change your view.",
    jaItems: ["売上構成、顧客集中、競争優位", "成長率と利益率に対するバリュエーション", "株式報酬、増資、自社株買い", "景気・金利・為替・規制への感応度", "保有比率、分散、許容できる損失", "強気・基本・弱気のシナリオ"],
    enItems: ["Revenue mix, customer concentration and competitive advantage", "Valuation relative to growth and margins", "Stock-based compensation, issuance and buybacks", "Sensitivity to the economy, rates, FX and regulation", "Position size, diversification and tolerable loss", "Bull, base and bear scenarios"],
  },
] as const;

export default function Guide() {
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "はじめての米国株" : "Getting started with US stocks"} description={ja ? "日本居住者向けの無料ガイド。口座、注文、決算、次の学びを順番に確認します。" : "A free guide for residents of Japan: accounts, orders, earnings and the next concepts to learn."}>
    <nav className={styles.localNav} aria-label={ja ? "学習メニュー" : "Learning menu"}>
      <span aria-current="page">{ja ? "投資の基礎" : "Investing basics"}</span>
      <Link href="/research/faq">{ja ? "ご利用ガイド" : "Service guide"}</Link>
    </nav>
    <aside className={styles.notice}><strong>{ja ? "一般情報です" : "General information only"}</strong><p>{ja ? "個別の投資・税務・法務の助言ではありません。制度、手数料、対象商品は変わるため、取引前に金融庁・証券会社・税務当局などの最新情報を確認してください。" : "This is not personalized investment, tax or legal advice. Rules, fees and eligible products can change; check current information from regulators, brokers and tax authorities before acting."}</p></aside>
    <div className={styles.steps}>{sections.map(section => <section key={section.number} className={styles.card} aria-labelledby={`learn-${section.number}`}>
      <span className={styles.number}>{section.number}</span><div><h2 id={`learn-${section.number}`}>{ja ? section.ja : section.en}</h2><p>{ja ? section.jaIntro : section.enIntro}</p><ul>{(ja ? section.jaItems : section.enItems).map(item => <li key={item}>{item}</li>)}</ul></div>
    </section>)}</div>
    <section className={styles.sources}><h2>{ja ? "一次情報を確認する" : "Check primary sources"}</h2><ul>
      <li><a href="https://www.fsa.go.jp/menkyo/menkyo.html" target="_blank" rel="noreferrer">{ja ? "金融庁：免許・許可・登録等を受けている事業者一覧" : "FSA: licensed and registered financial businesses"}</a></li>
      <li><a href="https://www.fsa.go.jp/policy/nisa2/" target="_blank" rel="noreferrer">{ja ? "金融庁：NISA特設ウェブサイト" : "FSA: official NISA site"}</a></li>
      <li><a href="https://www.investor.gov/introduction-investing/investing-basics/glossary/order-types" target="_blank" rel="noreferrer">Investor.gov: {ja ? "注文の種類" : "Order types"}</a></li>
      <li><a href="https://www.investor.gov/introduction-investing/investing-basics/glossary/corporate-reports" target="_blank" rel="noreferrer">Investor.gov: {ja ? "企業の開示資料" : "Corporate reports"}</a></li>
    </ul></section>
  </ResearchToolShell>;
}
