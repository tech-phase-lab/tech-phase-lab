# RESOLUTE 自動更新に合わせた文言の変更案（2026-11-19）

運営者の依頼（11/19）の7への対応。**変更案だけで、公開中のページはまだ変えていない。**
法律ページ（特商法・規約・プライバシーポリシー）は弁護士の確認後に直す。
LP・FAQ・購入画面の既存の行も、自動更新を本番で有効にする（`RESOLUTE_AUTO_RENEWAL_ENABLED=true`）のと同じ日に切り替える。
どちらも、それまでは今の文のまま（テスト `tests/legal-review-pack.test.mjs` が今の文を固定している）。

前提（実装の内容）:

- 初回購入で、PayPal（PayPalアカウントでの支払い）を保存し、自動更新に同意してもらう。
- 購入から1年後の更新日に、そのときの更新料金（5,980円、更新日にTech Phase PRO会員なら3,980円／$39・$29）を自動で課金する。
- 更新日の7日前に、スマホ通知（届かない人にはメール）でお知らせする。
- アカウント画面からいつでも止められる。止めた人・PayPalを保存できなかった人（PayPalアカウントを使わずに支払った人など）は、今どおり更新時期にお知らせし、希望した人だけ更新する。
- 引き落としできなかったときは、更新日・1日後・3日後にやり直し、それでもできなければ自動更新を止めてお知らせする。

## 0. 自動更新を有効にする前に決めること（矛盾の解消）

1. **購入画面の既存の1行目**（`app/legal/agree-button.tsx` の `RESOLUTE_CHECKOUT_LINES`）は
   「通知機能は1年間。2年目からの更新（5,980円・PRO会員3,980円）は、更新時期にお知らせし、ご希望の方だけ更新します。」で、
   足す1行「1年後から自動で更新されます。いつでも止められます」と矛盾する。依頼どおり今回は1行足すだけにしたので、
   有効にする日に、次のどちらかに決めてほしい。
   - 案A（おすすめ）: 1行目を「通知機能は1年間。2年目からの更新は5,980円（PRO会員3,980円）です。」に短くする。
   - 案B: 1行目はそのままにし、有効化を、法律ページの改訂と同時にする。
2. **規約第21条3項**は「期間が終わる日の30日前までに、…メールでお知らせします」。今回の実装は「7日前にスマホ通知（届かなければメール）」。
   - 案A: 規約を「7日前まで」に直す（下の案）。
   - 案B: 30日前のメールも残す（実装に1種類足すだけ。必要なら言ってください）。
   なお、自動更新の事前通知の日数は法律で一律には決まっていないが、弁護士の確認事項に入れておく。

## 1. LP（`app/resolute/lp/landing.tsx` / `landing-en.tsx`）FAQ

| 場所 | 今 | 変更案 |
| --- | --- | --- |
| 「買い切りですか?」 | …更新料金は5,980円、Tech Phase PRO会員は3,980円です。更新時期にお知らせし、ご希望の方だけ更新します。… | …更新料金は5,980円、Tech Phase PRO会員は3,980円です。1年後から自動で更新され、更新日の7日前にお知らせします。自動更新はアカウント画面からいつでも止められます。… |
| Is it a one-time purchase? | …We’ll let you know when it’s time to renew; only those who choose to renew are renewed. … | …Alerts renew automatically after one year; we’ll remind you 7 days before. You can stop automatic renewal anytime on your account page. … |
| 「2年目の更新はいくらですか?」 | 5,980円です。Tech Phase PROの会員なら3,980円で更新できます。 | 5,980円です。更新日にTech Phase PROの会員なら3,980円です。購入時に保存したPayPalで、更新日に自動でお支払いいただきます。 |
| How much does renewal cost? | Renewal costs $39 per year, or $29 per year for active Tech Phase PRO members. | Renewal costs $39 per year, or $29 if you are a Tech Phase PRO member on the renewal date. It is paid automatically on the renewal date with the PayPal you saved at purchase. |
| 追加するFAQ（任意） | なし | 「自動更新を止めるには?」→「アカウント画面の『自動更新』から、いつでも止められます。止めた後も、期限まで通知機能は使えます。」 |

## 2. 特定商取引法に基づく表記（`content/legal/commerce.ja.md` / `.en.md`、RESOLUTEの節）

| 項目 | 今 | 変更案 |
| --- | --- | --- |
| 支払時期 | 申込時に支払います。更新は、更新の手続きをした時に支払います | 申込時に支払います。通知機能の更新料金は、購入から1年ごとの更新日に、購入時に保存したPayPalで自動で支払います（自動更新を止めた方は、更新の手続きをした時に支払います） |
| 通知機能の更新 | 更新時期にお知らせし、ご希望の方だけ更新します。自動で課金することはありません | 1年ごとに自動で更新します。更新日の7日前までにお知らせします。自動更新は、アカウント画面からいつでも止められます（止めた後も期限まで使えます）。自動で引き落とせなかったときは、更新日から3日後までやり直し、それでもできないときは自動更新を止めてお知らせします |
| 解約（新設の候補） | なし | 自動更新の停止: アカウント画面の「自動更新」から、更新日の前日までに止めると、次の更新料金はかかりません |
| Payment timing (en) | You pay when you apply. Renewals are paid when you complete the renewal procedure | You pay when you apply. The renewal fee is paid automatically on each yearly renewal date with the PayPal you saved at purchase (if you stopped automatic renewal, when you complete the renewal procedure) |
| Renewal (en) | We'll let you know when it's time to renew; only those who choose to renew are renewed. You are never charged automatically | Renews automatically every year. We notify you at least 7 days before the renewal date. You can stop automatic renewal anytime on your account page (you keep access until the end of the period). If the charge fails, we retry until 3 days after the renewal date, then stop automatic renewal and let you know |

## 3. 利用規約 第21条（`content/legal/terms.ja.md` / `.en.md`）

変更案（3項・4項・5項を置き換え、6項はそのまま）:

> 3. 初回購入のときに、利用者の同意を得て、支払いに使ったPayPalを保存し、通知機能を1年ごとに自動で更新します。更新の料金は、更新日に保存したPayPalで支払います。更新日にTech PhaseのPRO会員である方は、PRO会員の料金とします。
> 4. 運営者は、更新日の7日前までに、更新日と更新の料金を、スマホ通知又は登録されたメールアドレスにお知らせします。
> 5. 利用者は、アカウント画面から、いつでも自動更新を止められます。更新日の前日までに止めたときは、次の更新の料金はかかりません。止めた後も、期間の終わりまで通知機能を使えます。
> 6. 自動で支払えなかったときは、更新日から3日後までの間に支払いをやり直します。それでも支払えないとき、又はPayPalが保存されていないときは、自動更新をせず、更新の時期をお知らせし、ご希望の方だけ更新します。更新の手続きがないときは、期間の終わりに通知機能が終わります。
> 7. （今の6項）

英語版も同じ内容で置き換える（"…the Operator saves the PayPal used for payment, with your consent, and renews the Notification Features automatically every year…"）。

第22条（返金）は変えない（自動更新の更新料金も「更新」に含まれるため、二重課金・当方の不具合の場合だけ返金）。

## 4. プライバシーポリシー（`content/legal/privacy.ja.md` / `.en.md`）

- 利用目的に「自動更新の課金と、その事前のお知らせ」を加える（今の「更新時期のお知らせ」の行を「更新時期のお知らせ、自動更新の課金」に）。
- 保存する情報に「PayPalが発行する支払い方法の識別子（カード番号・口座番号そのものは受け取りません）」を加える。
- 第三者提供・委託の欄のPayPalの説明に「支払い方法の保存（自動更新のため）」を加える。
- 空欄2つの日数は、PRの本文と報告のとおり（実際の保存期間からの計算）。

## 5. メール・通知の文（実装済み、フラグONで使われる）

`services/resolute-api/payments/renewal.mjs` の `renewalMessage`。7日前（自動更新）・7日前（手動）・自動更新できなかったときの3種類、日英。
受領メール（`recovery.mjs` の「…更新時期にメールでお知らせし、ご希望の方だけ更新します」）はゲスト購入用で、ゲストは自動更新の対象外なので変えない。
