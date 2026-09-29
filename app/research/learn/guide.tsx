"use client";

import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import styles from "./styles.module.css";

const steps = [
  ["口座を開く", "Open an account", "米国株を買える証券会社を選び、本人確認を済ませましょう。使いやすさと、売買・両替にかかる費用が選ぶときのポイントです。", "Choose a broker that offers US shares and complete its identity checks. Look at ease of use, trading fees and currency-conversion costs."],
  ["入金する", "Add funds", "口座ができたら、使う分だけ入金。円のまま注文できるか、先にドルへ替えるかは証券会社によって異なります。生活費や近いうちに使うお金は分けておきましょう。", "Once your account is ready, add the amount you plan to use. Your broker may convert your currency when you buy or ask you to convert it first. Keep living expenses and money you’ll need soon separate."],
  ["銘柄を探す", "Find a stock", "会社名か銘柄コードで検索します。たとえばNVIDIAなら「NVDA」。似た名前の商品もあるので、会社名とコードの両方を確認してください。", "Search by company name or ticker—for example, NVDA for NVIDIA. Check both the name and ticker so you don’t select a similarly named product."],
  ["注文する", "Place an order", "買う株数と注文方法を選び、手数料込みの金額を確認して注文します。送信後は注文履歴へ。「約定」と表示されていれば、その株数の売買が成立しています。", "Choose the number of shares and order type, check the total including fees, then submit. Check your order history afterward: a filled quantity means that many shares have traded."],
] as const;

function StepIcon({ index }: { index: number }) {
  const paths = [
    <><rect x="5" y="4" width="22" height="25" rx="3"/><path d="M10 11h12M10 16h8M10 22h5"/></>,
    <><rect x="3" y="10" width="27" height="19" rx="3"/><path d="M3 16h27M10 5h13m-4-4 4 4-4 4"/><circle cx="23" cy="23" r="2"/></>,
    <><circle cx="13" cy="13" r="9"/><path d="m20 20 10 10M8 15l4-5 4 4 3-4"/></>,
    <><rect x="5" y="3" width="22" height="28" rx="3"/><path d="m10 16 4 4 9-9M11 26h10"/></>,
  ];
  return <svg viewBox="0 0 34 34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[index]}</svg>;
}

export default function Guide() {
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "米国株のはじめ方" : "Getting started with US stocks"} description={ja ? "米国株を買うまでの流れを、図で紹介します。" : "A visual guide to buying your first US shares."}>
    <nav className={styles.localNav} aria-label={ja ? "学習メニュー" : "Learning menu"}><span aria-current="page">{ja ? "米国株のはじめ方" : "US stock basics"}</span><Link href="/research/faq">{ja ? "よくある質問" : "FAQ"}</Link></nav>
    <ol className={styles.flow} aria-label={ja ? "購入までの4ステップ" : "Four steps to buying shares"}>{steps.map(([titleJa,titleEn],i) => <li key={titleEn}><a href={`#step-${i+1}`}><span className={styles.flowIcon}><StepIcon index={i}/></span><small>0{i+1}</small><strong>{ja ? titleJa : titleEn}</strong></a></li>)}</ol>
    <div className={styles.steps}>{steps.map(([titleJa,titleEn,bodyJa,bodyEn],i) => <section id={`step-${i+1}`} key={titleEn} className={styles.step}>
      <div className={styles.stepHeading}><span>0{i+1}</span><h2>{ja ? titleJa : titleEn}</h2></div><p>{ja ? bodyJa : bodyEn}</p>
      {i === 1 && <figure className={styles.moneyFlow}><figcaption>{ja ? "入金したお金で株を買う" : "How your money reaches the investment"}</figcaption><div><span><small>{ja ? "銀行" : "Bank"}</small><strong>{ja ? "自分の口座" : "Your account"}</strong></span><b aria-hidden="true">→</b><span><small>{ja ? "入金" : "Transfer"}</small><strong>{ja ? "証券口座" : "Brokerage"}</strong></span><b aria-hidden="true">→</b><span><small>{ja ? "注文・約定" : "Order & fill"}</small><strong>{ja ? "米国株" : "US shares"}</strong></span></div><p>{ja ? "ドルへの両替は、購入前または注文時。証券会社によって方法が異なります。" : "Currency conversion happens before or when you buy, depending on your broker."}</p></figure>}
      {i === 2 && <Link className={styles.textLink} href="/research/stocks">{ja ? "Tech Phaseで銘柄を探す" : "Find a stock on Tech Phase"} →</Link>}
      {i === 3 && <div className={styles.orders} aria-label={ja ? "成行と指値の違い" : "Market versus limit orders"}>
        <div><span>{ja ? "成行" : "Market"}</span><strong>{ja ? "価格を指定しない" : "No set price"}</strong><p>{ja ? "成立時の価格で売買。表示されている株価とはずれることがあります。" : "Trades at the available price, which may differ from the quote you saw."}</p></div>
        <div><span>{ja ? "指値" : "Limit"}</span><strong>{ja ? "買う上限価格を決める" : "Set your maximum buy price"}</strong><p>{ja ? "「1株100ドルまで」のように指定。条件に合わなければ買えません。" : "For example, no more than $100 a share. The order may not fill if the price doesn’t meet your limit."}</p></div>
      </div>}
      {i === 3 && <figure className={styles.orderExample}><figcaption>{ja ? "買い注文の例" : "Example buy order"}<small>{ja ? "説明用の架空の銘柄・価格" : "Fictional stock and price"}</small></figcaption><div className={styles.orderFields}><div><span>{ja ? "銘柄" : "Stock"}</span><strong>ABC</strong></div><div><span>{ja ? "株数" : "Shares"}</span><strong>2</strong></div><div><span>{ja ? "注文方法" : "Order type"}</span><strong>{ja ? "指値" : "Limit"}</strong></div><div><span>{ja ? "1株の上限" : "Limit per share"}</span><strong>$100</strong></div></div><p className={styles.orderTotal}>2 × $100 = <strong>$200</strong><small>{ja ? "最大の株式購入代金。手数料・為替費用は別。" : "Maximum share cost, before fees and currency-conversion costs."}</small></p><div className={styles.statusFlow}><span>{ja ? "注文受付" : "Submitted"}<small>{ja ? "まだ購入完了ではない" : "Not yet purchased"}</small></span><b aria-hidden="true">→</b><span>{ja ? "約定" : "Filled"}<small>{ja ? "成立した株数を確認" : "Check the filled quantity"}</small></span></div><p>{ja ? "100ドル以下で買える条件になっても、必ず2株すべて買えるとは限りません。注文履歴で、成立した株数と残りの注文を確認しましょう。" : "Even if the price reaches $100 or less, both shares may not fill. Check the executed quantity and any remaining order in your history."}</p></figure>}

    </section>)}</div>
    <section className={styles.after}><h2>{ja ? "買ったあとも、企業の動きをチェック" : "After buying, keep up with the business"}</h2><p>{ja ? "毎日の株価だけでなく、決算や新しい発表にも目を向けてみてください。買った理由をメモしておくと、後から振り返りやすくなります。" : "Look beyond daily price moves to earnings and company announcements. A quick note on why you bought can help you review your thinking later."}</p><Link className={styles.textLink} href="/research/calendar">{ja ? "決算カレンダーを見る" : "View the earnings calendar"} →</Link></section>
    <p className={styles.footnote}>{ja ? "株価や為替の変動で損失が出ることもあります。口座開設・取引条件は証券会社やお住まいの国によって異なります。" : "Share prices and currency moves can lead to losses. Account eligibility and trading terms vary by broker and country."}</p>
  </ResearchToolShell>;
}
