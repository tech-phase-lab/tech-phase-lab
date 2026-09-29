"use client";

import Link from "next/link";
import { useState } from "react";
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

const firstSteps = [
  [
    "使うお金を決める",
    "Set your budget",
    "生活費や近いうちに使うお金を分け、値下がりしても生活に影響しない範囲を考えます。最初から資金を使い切る必要はありません。",
    "Set aside living expenses and money you’ll need soon. Decide how much you could expose to losses without disrupting your life; you don’t need to invest it all at once.",
    "株価が下がった場合と、円高になった場合の両方を想定しましょう。",
    "Consider both a falling stock price and, if you measure returns in yen, a stronger yen."
  ],
  [
    "証券口座を選ぶ",
    "Choose a brokerage account",
    "買いたい米国株が扱われているか、手数料・為替費用・使いやすさを比べます。必要書類や口座の種類は、証券会社の公式サイトで確認します。",
    "Compare stock availability, trading and currency-conversion costs, and ease of use. Check the broker’s official site for account types and required documents.",
    "「日本語で使える」ことと「自分の居住国から利用できる」ことは別です。",
    "A Japanese-language interface does not necessarily mean the broker accepts residents of your country."
  ],
  [
    "入金と通貨を確認する",
    "Fund the account and check currency",
    "本人確認が完了したら、証券会社が案内する方法で入金します。円のまま買う方法か、先にドルへ替える方法か、為替費用も確認します。",
    "After identity checks, fund the account using the broker’s instructions. Check whether it converts your currency at purchase or requires dollars in advance, and compare conversion costs.",
    "米国株の株価が変わらなくても、為替の動きで自国通貨での評価額は変わります。",
    "Even if the dollar share price is unchanged, currency moves can change its value in your home currency."
  ],
  [
    "銘柄と注文内容を確認する",
    "Review the stock and order",
    "会社名だけでなく、NVDAのような銘柄コードも確認します。株数、価格、売買の向き、有効期限、手数料込みの金額を確認してから注文します。",
    "Check the ticker, such as NVDA, as well as the company name. Review quantity, price, buy/sell direction, expiration and total cost before submitting.",
    "成行は価格を指定しない注文。指値は買う上限・売る下限を指定する注文で、成立しない場合もあります。",
    "A market order does not set a price. A limit order sets the most you’ll pay or the least you’ll accept, but may not fill."
  ],
  [
    "注文結果を確かめる",
    "Check whether the order filled",
    "注文を送っただけでは購入完了とは限りません。「約定」は売買が成立したことです。約定した株数・価格と、残っている注文を確認します。",
    "Submitting an order does not always mean you’ve bought the shares. A fill means a trade executed. Check the filled quantity and price, plus any outstanding orders.",
    "通常取引・時間外取引の区分、休場日、時差を確認。分からないまま同じ注文を重ねないようにします。",
    "Check regular versus extended sessions, market holidays and time-zone differences. Avoid duplicating an order before checking its status."
  ],
  [
    "買った後に確認すること",
    "Know what to follow after buying",
    "株価だけでなく、決算や事業の変化を確認します。「なぜ買ったか」「どんな変化があれば考え直すか」を短く残しておきましょう。",
    "Follow earnings and business developments as well as the price. Keep a short note on why you bought and what developments would make you reassess.",
    "Tech Phaseでは銘柄検索、お気に入り、決算カレンダーを入口に情報を整理できます。",
    "Use stock search, favorites and the earnings calendar to organize your research in Tech Phase."
  ]
] as const;

export default function Guide() {
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  const [residence, setResidence] = useState<"japan" | "other">("japan");
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "米国株のはじめ方" : "Getting started with US stocks"} description={ja ? "口座を選ぶところから、最初の注文と購入後の確認まで。" : "From choosing an account to your first order and what to check afterward."}>
    <nav className={styles.localNav} aria-label={ja ? "学習メニュー" : "Learning menu"}>
      <span aria-current="page">{ja ? "投資の基礎" : "Investing basics"}</span>
      <Link href="/research/faq">{ja ? "よくある質問・使い方" : "FAQ & help"}</Link>
    </nav>
    <section className={styles.startHere} aria-label={ja ? "はじめる前に" : "Before you start"}>
      <p className={styles.guideEyebrow}>START HERE · {ja ? "まずは6ステップ" : "SIX SIMPLE STEPS"}</p>
      <h2>{ja ? "最初は、この順番で。" : "Start with these steps."}</h2>
      <p>{ja ? "米国株は、米国の企業などの株式です。このガイドは現物株の基本を扱います。難しい決算用語は、後から一つずつ覚えれば大丈夫です。" : "This guide covers the basics of buying US shares outright. You can learn the more technical earnings terms as you go."}</p>
      <div className={styles.residence} role="group" aria-label={ja ? "お住まいの地域" : "Where you live"}>
        <button aria-pressed={residence === "japan"} onClick={() => setResidence("japan")}>{ja ? "日本に住んでいる" : "I live in Japan"}</button>
        <button aria-pressed={residence === "other"} onClick={() => setResidence("other")}>{ja ? "日本以外に住んでいる" : "I live elsewhere"}</button>
      </div>
      <p className={styles.residenceNote}>{residence === "japan" ? (ja ? "日本居住者向け：金融庁の登録と米国株の取扱いを確認します。NISA・特定口座などの対象や条件は証券会社の公式案内で確認してください。" : "For Japan residents: check FSA registration and US-share availability. Confirm NISA and tax-account eligibility with the broker.") : (ja ? "海外居住者向け：お住まいの国で利用できる証券会社と、現地の規制・税制度を確認してください。日本向けの口座・NISAの説明をそのまま当てはめないでください。" : "For residents elsewhere: check local broker eligibility, regulation and tax rules. Japan-specific accounts and NISA information may not apply.")}</p>
    </section>
    <ol className={styles.firstSteps}>{firstSteps.map(([titleJa,titleEn,bodyJa,bodyEn,tipJa,tipEn],i) => <li key={titleEn}><span className={styles.number}>{String(i+1).padStart(2,"0")}</span><div><h2>{ja ? titleJa : titleEn}</h2><p>{ja ? bodyJa : bodyEn}</p><small>{ja ? tipJa : tipEn}</small></div></li>)}</ol>
    <nav className={styles.nextLinks} aria-label={ja ? "Tech Phaseで試す" : "Explore Tech Phase"}><Link href="/research/stocks">{ja ? "銘柄を調べる" : "Look up a stock"}</Link><Link href="/research/watchlist">{ja ? "お気に入りを整理する" : "Organize favorites"}</Link><Link href="/research/calendar">{ja ? "決算日を確認する" : "Check earnings dates"}</Link></nav>
    <details className={styles.deeper}><summary>{ja ? "もう少し詳しく：口座・注文・決算のチェックリスト" : "Go deeper: accounts, orders and earnings"}</summary>
    <aside className={styles.notice}><strong>{ja ? "一般情報です" : "General information only"}</strong><p>{ja ? "個別の投資・税務・法務の助言ではありません。制度、手数料、対象商品は変わるため、取引前に金融庁・証券会社・税務当局などの最新情報を確認してください。" : "This is not personalized investment, tax or legal advice. Rules, fees and eligible products can change; check current information from regulators, brokers and tax authorities before acting."}</p></aside>
    <div className={styles.steps}>{sections.map(section => <section key={section.number} className={styles.card} aria-labelledby={`learn-${section.number}`}>
      <span className={styles.number}>{section.number}</span><div><h2 id={`learn-${section.number}`}>{ja ? section.ja : section.en}</h2><p>{ja ? section.jaIntro : section.enIntro}</p><ul>{(ja ? section.jaItems : section.enItems).map(item => <li key={item}>{item}</li>)}</ul></div>
    </section>)}</div>
    <section className={styles.sources}><h2>{ja ? "口座開設から初回注文まで" : "From account opening to your first order"}</h2><ol>{(ja ? ["居住国に対応する証券会社を選び、本人確認を進める", "口座の種類と米国株の取引設定を確認する", "自分名義の口座から入金する", "円決済・ドル決済と為替費用を確認する", "銘柄コード・株数・指値・有効期間を確認して注文する", "約定結果と残高を確認する"] : ["Choose a broker serving your country and complete identity verification", "Check account type and US-stock permissions", "Fund from an account in your own name", "Check currency settlement and FX costs", "Review ticker, quantity, limit price and order duration", "Check execution and remaining balance"]).map(item => <li key={item}>{item}</li>)}</ol></section>
    <section className={styles.sources}><h2>{ja ? "現物株とFX・CFDは分けて選ぶ" : "Keep shares and FX/CFDs separate"}</h2><p>{ja ? "このページは米国の現物株を始めるための案内です。FX・CFDは仕組みやレバレッジ、費用が異なるため、別の案内で比較します。証券会社・取引業者は表示言語ではなく居住国への対応で選びます。" : "This guide covers US shares. FX and CFDs have different structures, leverage and costs and need a separate comparison. Eligibility depends on country of residence, not interface language."}</p></section>
    </details>
    <section className={styles.sources}><h2>{ja ? "一次情報を確認する" : "Check primary sources"}</h2><ul>
      <li><a href="https://www.fsa.go.jp/menkyo/menkyo.html" target="_blank" rel="noreferrer">{ja ? "金融庁：免許・許可・登録等を受けている事業者一覧" : "FSA: licensed and registered financial businesses"}</a></li>
      <li><a href="https://www.fsa.go.jp/policy/nisa2/" target="_blank" rel="noreferrer">{ja ? "金融庁：NISA特設ウェブサイト" : "FSA: official NISA site"}</a></li>
      <li><a href="https://www.investor.gov/introduction-investing/investing-basics/how-stock-markets-work/types-orders" target="_blank" rel="noreferrer">Investor.gov: {ja ? "注文の種類" : "Order types"}</a></li>
      <li><a href="https://www.investor.gov/introduction-investing/investing-basics/glossary/corporate-reports" target="_blank" rel="noreferrer">Investor.gov: {ja ? "企業の開示資料" : "Corporate reports"}</a></li>
      <li><a href="https://www.fsa.go.jp/policy/nisa2/invest/index.html" target="_blank" rel="noreferrer">{ja ? "金融庁：資産形成の基本" : "FSA: investing basics"}</a></li>
    </ul><p>{ja ? "確認日：2026年9月29日。制度・取引条件は各公式サイトで最新情報を確認してください。" : "Reviewed September 29, 2026. Check official sources for current rules and terms."}</p></section>
  </ResearchToolShell>;
}
