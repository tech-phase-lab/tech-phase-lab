# RESOLUTE 自動更新に合わせた文言の変更案（2026-11-19）

運営者の依頼（11/19）の7への対応。**変更案だけで、公開中のページはまだ変えていない。**
法律ページ（特商法・規約・プライバシーポリシー）は弁護士の確認後に直す。LP・FAQも、自動更新を本番で有効にする
（`RESOLUTE_AUTO_RENEWAL_ENABLED=true`）のと同じ日に切り替える。それまでは今の文のまま。

前提（実装の内容、運営者の決定 11/19 を反映）:

- 初回購入で、PayPal（PayPalアカウントでの支払い）を保存し、自動更新に同意してもらう。
- 購入から1年後の更新日に、そのときの更新料金（5,980円、更新日にTech Phase PRO会員なら3,980円／$39・$29）を自動で課金する。
- 更新のお知らせは、規約どおり**更新日の30日前にメールで1回だけ**。スマホ通知は送らない。
- 自動更新は、アカウント画面から**更新日の前日まで**に止めれば、課金されない。課金は更新日（日本時間）に行う。
- 止めた人・PayPalを保存できなかった人（PayPalアカウントを使わずに払った人など）は、30日前に「ご利用期間が終わります。アカウント画面から更新を」のメールを受け取り、アカウント画面の「通知サービスを更新」から手動で更新する。
- 引き落としできなかったときは、更新日・1日後・3日後にやり直し、それでもできなければ自動更新を止めて、メールで知らせる（料金は請求しない）。

## 0. 購入画面（実装済み・フラグONのときだけ）

- 自動更新つきの注文では、既存の1行目「通知機能は1年間。2年目からの更新（5,980円・PRO会員3,980円）は、更新時期にお知らせし、ご希望の方だけ更新します。」を
  **「1年後から自動で更新されます。いつでも止められます」**に置き換える（英語は "Renews automatically after one year. You can stop it anytime."）。2行目（返金）はそのまま。
- フラグOFFのときは、今の2行のまま（自動更新しないので、今の文が正しい）。

## 1. LP（`app/resolute/lp/landing.tsx` / `landing-en.tsx`）FAQ

| 場所 | 今 | 変更案 |
| --- | --- | --- |
| 「買い切りですか?」 | …更新料金は5,980円、Tech Phase PRO会員は3,980円です。更新時期にお知らせし、ご希望の方だけ更新します。… | …更新料金は5,980円、Tech Phase PRO会員は3,980円です。1年後から自動で更新され、更新日の30日前にメールでお知らせします。自動更新はアカウント画面からいつでも止められます。… |
| Is it a one-time purchase? | …We’ll let you know when it’s time to renew; only those who choose to renew are renewed. … | …Alerts renew automatically after one year; we’ll email you 30 days before. You can stop automatic renewal anytime on your account page. … |
| 「2年目の更新はいくらですか?」 | 5,980円です。Tech Phase PROの会員なら3,980円で更新できます。 | 5,980円です。更新日にTech Phase PROの会員なら3,980円です。購入時に保存したPayPalで、更新日に自動でお支払いいただきます。 |
| How much does renewal cost? | Renewal costs $39 per year, or $29 per year for active Tech Phase PRO members. | Renewal costs $39 per year, or $29 if you are a Tech Phase PRO member on the renewal date. It is paid automatically on the renewal date with the PayPal you saved at purchase. |
| 追加するFAQ（任意） | なし | 「自動更新を止めるには?」→「更新日の前日までに、アカウント画面の『自動更新』から止められます。止めた後も、期限まで通知機能は使えます。」 |

## 2. 特定商取引法に基づく表記（`content/legal/commerce.ja.md` / `.en.md`、RESOLUTEの節）

| 項目 | 今 | 変更案 |
| --- | --- | --- |
| 支払時期 | 申込時に支払います。更新は、更新の手続きをした時に支払います | 申込時に支払います。通知機能の更新料金は、購入から1年ごとの更新日に、購入時に保存したPayPalで自動で支払います（自動更新を止めた方は、更新の手続きをした時に支払います） |
| 通知機能の更新 | 更新時期にお知らせし、ご希望の方だけ更新します。自動で課金することはありません | 1年ごとに自動で更新します。更新日の30日前に、登録されたメールアドレスにお知らせします。自動更新は、更新日の前日までにアカウント画面から止められます（止めた後も期限まで使えます）。自動で引き落とせなかったときは、更新日から3日後までやり直し、それでもできないときは自動更新を止めてお知らせします |
| Payment timing (en) | You pay when you apply. Renewals are paid when you complete the renewal procedure | You pay when you apply. The renewal fee is paid automatically on each yearly renewal date with the PayPal you saved at purchase (if you stopped automatic renewal, when you complete the renewal procedure) |
| Renewal (en) | We'll let you know when it's time to renew; only those who choose to renew are renewed. You are never charged automatically | Renews automatically every year. We email you 30 days before the renewal date. You can stop automatic renewal from your account page until the day before the renewal date (you keep access until the end of the period). If the charge fails, we retry until 3 days after the renewal date, then stop automatic renewal and let you know |

## 3. 利用規約 第21条（`content/legal/terms.ja.md` / `.en.md`）

今の3項（30日前のメール）はそのまま活かし、4項・5項を置き換える:

> 3. 期間が終わる日の30日前に、更新日と更新の料金を、登録されたメールアドレスにお知らせします。（今のまま）
> 4. 初回購入のときに、利用者の同意を得て、支払いに使ったPayPalを保存し、通知機能を1年ごとに自動で更新します。更新の料金は、更新日に保存したPayPalで支払います。更新日にTech PhaseのPRO会員である方は、PRO会員の料金とします。
> 5. 利用者は、更新日の前日までに、アカウント画面から自動更新を止められます。止めたときは、次の更新の料金はかかりません。止めた後も、期間の終わりまで通知機能を使えます。
> 6. 自動で支払えなかったときは、更新日から3日後までの間に支払いをやり直します。それでも支払えないとき、又はPayPalが保存されていないときは、自動更新をせず、利用者が更新の手続きをし、更新の料金を支払ったときに、通知機能を使える期間を1年間延ばします。更新の手続きがないときは、期間の終わりに通知機能が終わります。
> 7. （今の6項）

英語版も同じ内容で置き換える。第22条（返金）は変えない。

## 4. プライバシーポリシー（`content/legal/privacy.ja.md` / `.en.md`）

- 利用目的の「更新時期のお知らせ」を「更新時期のお知らせ、自動更新の課金」に。
- 保存する情報に「PayPalが発行する支払い方法の識別子（カード番号・口座番号そのものは受け取りません）」を加える。
- PayPalの説明に「支払い方法の保存（自動更新のため）」を加える。

## 5. メールの文（実装済み、フラグONで送られる。運営者の指定どおり一字一句）

`services/resolute-api/payments/renewal.mjs` の `renewalMessage`。
- 自動更新される人（PayPal保存済み）: 件名「RESOLUTE 通知機能の更新のお知らせ」、本文は運営者指定の3行（「〇月〇日に、RESOLUTEの通知機能を1年分自動で更新します。」…）。日付は「12月16日」、金額は「5,980円」の形（PRO会員はお知らせ時点の会員価格。課金時にもう一度確かめる）。
- 自動更新できない人（保存されていない人・止めた人）: 「〇月〇日でRESOLUTEの通知機能のご利用期間が終わります。続けてご利用の方は、アカウント画面から更新のお手続きをお願いします。」
- 英語: 件名 "Your RESOLUTE alerts renewal"、本文は指定どおり（日付は "December 16, 2027"、金額は "$39"）。
- 自動で引き落とせなかったとき（運営者の指定文なし）: 「通知機能を自動で更新できなかったため、自動更新を止めました。料金は請求していません。続けてご利用の方は、アカウント画面から更新のお手続きをお願いします。」
- 支払い方法の書き方は、運営者の決定（11/19）で「ご登録のPayPalにて」／"charged to your PayPal account on file" にした（保存するのはPayPal。カードか銀行口座かはPayPal側で決まる）。
- 自動で引き落とせなかったときのメールは、運営者の決定（11/19）で上の文のまま送る。
