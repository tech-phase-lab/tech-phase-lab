"use client";

import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import styles from "../learn/styles.module.css";

const questions = [
  ["無料で読めるものは？", "What is free?", "投資の基礎、ご利用ガイド、公開カレンダーや公開データはログインなしで確認できます。PRO表示の本文や一部機能には、その時点で有効な会員状態が必要です。", "Investing basics, this FAQ, the public calendar and public data are available without signing in. PRO-labeled article bodies and some features require an active membership status."],
  ["質問すると必ず回答されますか？", "Will every question be answered?", "いいえ。会員は質問を非公開で送れますが、回答や記事化を約束するものではありません。採用したテーマだけを、別の回答ページで公開します。", "No. Members can submit questions privately, but a response or publication is not guaranteed. Only selected topics are published on the separate answered page."],
  ["送った質問は公開されますか？", "Is my submitted question public?", "送信文は自動公開されません。運営者の確認用受信箱と、送信した本人の履歴にだけ表示します。公開回答は、別に編集・公開されたQ&A記事です。個人情報や口座情報は書かないでください。", "The submitted text is never auto-published. It appears only in the owner moderation inbox and the sender's history. A public answer is a separately edited Q&A post. Do not include personal or account information."],
  ["リゼルのひとりごとに見出しはありますか？", "Do RIZEL’s Notes have headlines?", "ありません。短い本文だけの投稿です。ホームには最新投稿日だけを表示し、PRO本文を無料画面へ返しません。", "No. Notes are body-only casual posts. The home page shows only the latest publication date and does not return the PRO body to the free surface."],
  ["カレンダーはリアルタイムですか？", "Is the calendar real-time?", "いいえ。公式発表を定期的に確認する予定表で、ライブ配信ではありません。確認できた日付・時刻だけを掲載し、日付しか公表されていない予定に時刻を足しません。表示タイムゾーンも確認してください。", "No. It is a periodically verified schedule, not a live feed. Only confirmed dates and times are included; a date-only announcement is not given an invented time. Check the displayed time zone."],
  ["通知は何秒で届きますか？", "How many seconds do alerts take?", "到着時間は保証しません。取得間隔、公式サイトの公開方法、ネットワーク、端末設定で変わります。画面の更新間隔と、発表から端末到着までの実測時間は別です。", "Delivery time is not guaranteed. It varies with polling, the source site, networks and device settings. A screen refresh interval is not the same as measured release-to-device latency."],
  ["英語表示はいつ使えますか？", "When is English available?", "日本語を基準にし、英訳が確認できたものだけ英語で表示します。英訳が未完了なら待機中として扱い、日本語の内容から推測して補いません。", "Japanese is the source language. English appears only after a translation is available and checked. Pending English is not guessed from the Japanese text."],
  ["これは投資助言ですか？", "Is this investment advice?", "いいえ。企業調査と学習のための一般情報で、売買や利益を勧めるものではありません。判断には価格、損失可能性、税務、生活資金など個別事情があります。", "No. This is general company-research and educational information, not a recommendation to trade or a promise of returns. Decisions depend on price, possible loss, taxes and personal finances."],
] as const;

export default function Faq() {
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "ご利用ガイド" : "Service guide"} description={ja ? "表示、会員機能、質問、カレンダー、通知についての案内です。" : "Answers about content, membership, questions, the calendar and alerts."}>
    <nav className={styles.localNav} aria-label={ja ? "案内メニュー" : "Help menu"}><Link href="/research/learn">{ja ? "投資の基礎" : "Investing basics"}</Link><span aria-current="page">{ja ? "ご利用ガイド" : "Service guide"}</span></nav>
    <div className={styles.steps}>{questions.map(([questionJa, questionEn, answerJa, answerEn], index) => <details className={styles.card} key={questionJa} open={index === 0}><summary><span className={styles.number}>{String(index + 1).padStart(2, "0")}</span><strong>{ja ? questionJa : questionEn}</strong></summary><p>{ja ? answerJa : answerEn}</p></details>)}</div>
    <aside className={styles.notice}><strong>{ja ? "問題が解決しないとき" : "If this does not solve it"}</strong><p>{ja ? "会員状態はマイアカウントで確認できます。表示や取得に失敗した場合は、時間をおいて再読み込みしてください。質問フォームにはパスワード、本人確認書類、口座番号を入力しないでください。" : "Check membership status on My account. If a page or data source fails, wait and reload. Never put a password, identity document or account number in the question form."}</p><Link href="/research/account">{ja ? "マイアカウントを確認" : "Check My account"} →</Link></aside>
  </ResearchToolShell>;
}
