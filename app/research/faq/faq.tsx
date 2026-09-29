"use client";

import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import styles from "./styles.module.css";

const questions = [
  [
    "投資初心者でも利用できますか？",
    "Can I use this as a beginner?",
    "もちろん利用できます。「米国株のはじめ方」も用意していますので、基礎を確認しながらご利用ください。",
    "Absolutely. Our US stock basics guide can help you get started and learn as you go."
  ],
  [
    "PRO版は月頭に契約したほうがいいですか？",
    "Should I join PRO at the start of the month?",
    "いいえ。契約日を起点とする月額制なので、月の途中からでも利用期間が短くなることはありません。",
    "No. Your monthly subscription starts on the day you join, so joining partway through a calendar month won’t shorten your access."
  ],
  [
    "PROを解約すると、いつまで利用できますか？",
    "How long can I use PRO after canceling?",
    "解約後も、お支払い済みの期間が終わるまでPROを利用できます。解約すると次回の自動更新が停止します。",
    "You can keep using PRO until the end of the period you’ve paid for. Canceling stops your next automatic renewal."
  ],
  [
    "スマホとパソコンの両方で利用できますか？",
    "Can I use both my phone and computer?",
    "はい。同じアカウントでログインすれば、スマホ・パソコンの両方で利用できます。",
    "Yes. Sign in with the same account on your phone or computer."
  ],
  [
    "どの銘柄を取り扱っていますか？",
    "Which stocks do you cover?",
    "米国ハイテク株全般を取り扱っています。特に重点的に追っている銘柄は「監視22銘柄リスト」で確認できます。",
    "We cover US high-tech stocks broadly. For the companies we follow most closely, see our 22-stock watch list."
  ],
  [
    "質問をすると必ず回答されますか？",
    "Will every question be answered?",
    "リゼルが厳選した質問に回答します。全質問への回答はお約束できません。",
    "RIZEL chooses which questions to answer. We can’t promise an answer to every question."
  ],
  [
    "送った質問は公開されますか？",
    "Will my question be visible to others?",
    "はい。投稿した質問はPRO会員全員に公開されます。個人情報の記載や、不適切な発言はお控えください。",
    "Yes. Your questions are visible to all PRO members. Please avoid personal details and inappropriate comments."
  ],
  [
    "銘柄の追加や、取り上げてほしいテーマをリクエストできますか？",
    "Can I request a stock or topic?",
    "はい。すべてのご要望にはお応えできませんが、同じ銘柄やテーマへのリクエストが多い場合は検討します。",
    "Yes. We can’t accommodate every request, but we’ll consider stocks and topics that many members ask for."
  ],
  [
    "掲載内容に誤りを見つけた場合、どこに連絡すればよいですか？",
    "How can I report an error?",
    "私のXアカウントから連絡してください。",
    "Please contact me on X."
  ],
  [
    "おすすめの銘柄や、買うべき銘柄を教えてもらえますか？",
    "Can you recommend a stock or tell me what to buy?",
    "投資助言に該当する恐れがあるためお答えしていません。",
    "We don’t answer these requests because they could constitute investment advice."
  ],
  [
    "これは投資助言ですか？",
    "Is this investment advice?",
    "いいえ。企業調査と学習のための一般情報で、特定の銘柄の売買を勧めたり、利益を保証したりするものではありません。",
    "No. We provide general information for company research and learning, not recommendations to buy or sell specific stocks or guarantees of returns."
  ]
] as const;

export default function Faq() {
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "よくある質問・使い方" : "FAQ & help"} description={ja ? "利用方法、PRO会員、質問についてのご案内です。" : "Quick answers about getting started, PRO membership and questions."}>
    <nav className={styles.localNav} aria-label={ja ? "案内メニュー" : "Help menu"}><Link href="/research/learn">{ja ? "投資の基礎" : "Investing basics"}</Link><span aria-current="page">{ja ? "よくある質問・使い方" : "FAQ & help"}</span></nav>
    <p className={styles.notice}>{ja ? "現在は開発プレビューです。契約・解約の回答は有料サービス開始時の運用方針で、課金はまだ開始していません。" : "This is a development preview. Subscription and cancellation answers describe our planned launch policy; paid billing hasn’t started yet."}</p>
    <div className={styles.steps}>{questions.map(([questionJa, questionEn, answerJa, answerEn], index) => <details className={styles.card} key={questionJa}><summary><span className={styles.number}>{String(index + 1).padStart(2, "0")}</span><strong>{ja ? questionJa : questionEn}</strong></summary><p>{index === 4 ? (ja ? <>米国ハイテク株全般を取り扱っています。特に重点的に追っている銘柄は「<Link href="/research#monitored-companies">監視22銘柄リスト</Link>」で確認できます。</> : <>We cover US high-tech stocks broadly. For the companies we follow most closely, see our <Link href="/research#monitored-companies">22-stock watch list</Link>.</>) : ja ? answerJa : answerEn}</p></details>)}</div>
    <aside className={styles.notice}><strong>{ja ? "問題が解決しないとき" : "If this does not solve it"}</strong><p>{ja ? "会員状態はマイアカウントで確認できます。表示や取得に失敗した場合は、時間をおいて再読み込みしてください。質問フォームにはパスワード、本人確認書類、口座番号を入力しないでください。" : "Check membership status on My account. If a page or data source fails, wait and reload. Never put a password, identity document or account number in the question form."}</p><Link href="/research/account">{ja ? "マイアカウントを確認" : "Check My account"} →</Link></aside>
  </ResearchToolShell>;
}
