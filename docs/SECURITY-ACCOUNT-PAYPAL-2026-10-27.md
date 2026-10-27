# 会員・PayPal セキュリティ確認（2026-10-27）

対象: tech-phase-lab/tech-phase-lab、codex/research-preview。基準コミット a1308eda。
認証はClerk、PRO定期課金とRESOLUTE買切りは別のPayPal実装。既存を作り直していない。
Railwayへの接続・再認証・DB操作は一切していない。実購入や実会員への通知も行っていない。
これはコードと限定した設定の点検であり、侵入テストや全外部サービスの安全性保証ではない。

## 今回変更した内容

- マイアカウントに「パスワード・2段階認証の設定」を追加。Clerk標準UserProfileを使用し、アプリ独自にパスワードやTOTP秘密鍵を受け取らない。
- 共通membership判定を使う管理者操作にMFAポリシーを実装。`TECH_PHASE_REQUIRE_ADMIN_MFA=true` のとき、Clerkの2FA登録状態と署名検証済みセッションの第二要素認証履歴を両方確認する。未確認ならこの経路の管理者権限、Owner preview、テスト操作を許可しない。PRO Sandbox決済の管理者入口も同条件。通常会員の購入・許可済みSandboxテスターには強制しない。
- **RESOLUTE独自のowner判定（risk/rizel/ai-check、決済audit、sandbox-pro、review/recovery等）は共通membershipを通らず、今回のMFAチェック対象外。** これらにも適用してから「全管理者操作の2FA必須化完了」と判断する。ニュース担当の実装を含むため、無断で変更していない。
- **上記強制フラグは未設定・未有効化。** Clerk側のMFA手段・復旧コード・管理者登録が確認できない状態で、運営者を締め出す変更は行っていない。したがって「管理者MFA必須化完了」ではない。
- アカウント・決済の対象ルートに no-referrer / nosniff / frame拒否ヘッダーを追加。認証情報を独自にCookieへコピーしない。
- PRO Live注文の共有DB回数制限を追加。10分固定窓で同一ユーザー6回目から429、Retry-Afterを返す。失敗は5回目から警告記録。署名付きWebhook、返金処理、解約処理はこの注文制限の対象外。
- 警告をDBの通知待ちテーブルに一度だけ記録。ユーザー識別はSHA-256参照値とし、パスワード・トークン・メール・PayPalレスポンスを警告に入れない。DBを共有する複数プロセスにも対応。
- 通知ワーカーを用意。送信失敗は5分後に再試行可能。Slack incoming webhook用アダプターは無効のまま。通知先は未登録・送信していない。通知はat-least-onceなので送信直後のプロセス停止時に同一警告が再送される可能性はあるが、決済・権限処理は行わない。
- **回数制限と通知はRailway側のDB移行・サービス反映・通知先設定が未確認のため、有効化済みと扱わない。** DB未準備で新Liveサービスを起動すると、新規注文は安全側で503になる。適用順序を守る。

## 会員・アカウント（依頼番号に対応）

| 番号 | 項目 | 判定と確認内容 |
|---|---|---|
| 1 | bcrypt / argon2 | 既存のClerk委託。Tech Phaseに平文パスワード保存処理・独自パスワードDBなし。Clerk公式はbcrypt保存を説明。既存全会員のハッシュ実体は取得していない。 |
| 2 | ログに秘密を残さない | 認証・決済の確認対象コードは固定エラーを返し、秘密やPayPalの生レスポンスをログ出力しない。今回の通知も項目を限定。Vercel/Clerk/PayPal/Railwayの実ログ・過去ログ・保持期間の全監査は未実施。 |
| 3 | ログイン失敗ロック | Clerkの機能に依存。現在のアプリの回数/解除時間は確認・変更できていない。注文回数制限をログイン対策の代わりとはしていない。 |
| 4 | 再設定は1回・約30分 | Clerk標準の再設定フローを使用。コード方式を含め、実環境の有効期限・使い回し拒否は未検証。30分設定済みとは報告しない。 |
| 5 | 登録有無を隠す | ClerkのStrict enumeration protectionの有効化が必要。設定状態未確認。画面の文言だけ隠す対処ではAPIからの判別を防げないため、見せかけの対応はしない。 |
| 6 | Cookie属性 | アプリ独自の表示用CookieはHttpOnly/Secure（production build）/SameSite=Lax。権限判定には使わない。Clerkの__sessionはSDK仕様上HttpOnlyではない。全Cookieを3属性で統一する要件は未達。SDKを壊す属性変更はしない。 |
| 7 | 会員の任意2FA | 設定ページと入口を追加。実際に2FA項目が使えるかはClerk側のMFA設定/プラン確認待ち。本番MFAは公式資料上有料プランが必要。契約変更はしていない。 |
| 8 | 管理者2FA必須 | 共通membership経路にサーバーチェックを実装・テスト。強制フラグは未有効。RESOLUTE独自owner判定への追加適用も残る。管理者の登録・復旧手段と全経路を確認後に有効化する。サービス間トークンは人間の2FAとは別に管理する。 |
| 9 | 個人情報最小化 | 決済DBは会員ID・取引ID・金額・時刻等を保存し、カード番号やWebhook全体は保存しない。一方Clerk/既存会員CSV・Sheets同期はメール・氏名・最終ログイン等を扱う。利用目的・保持期間の確認前に既存管理台帳を壊す削除はしていないため、全体最小化は要確認。 |

## PayPal（依頼番号に対応）

| 番号 | 項目 | 判定と確認内容 |
|---|---|---|
| 1 | サーバーで金額決定 | 既存実装あり。PROは固定価格とPayPalプラン内容を照合。RESOLUTEもサーバーquote。ブラウザ指定額を採用しない。 |
| 2 | Webhook署名検証 | 既存実装あり。PayPal verify-webhook-signature のSUCCESSを検証してから処理。ただし決済確定には、署名済み通知以外にサーバーからPayPal APIを再照合する経路もある。「Webhookが来たときだけ確定」という厳密な方式ではない。ブラウザの成功表示だけで権限は付けない。 |
| 3 | 通知重複防止 | 既存実装あり。イベントID/取引IDの一意制約、トランザクション、既存内容との整合検証。遅延した完了通知で返金停止を解除しない。 |
| 4 | 注文と1人の対応 | 既存実装あり。サーバーで認証済みuserIdに注文を結び、取得・更新時に所有者照合。同じ注文を別会員が取得できない。PROは二重の有効契約を一意制約で制限。 |
| 5 | 返金・チャージバック停止 | 既存実装あり。署名済み返金/取消/紛争の記録を権限ビューに反映。通知が支払記録より先に来るケースも扱う。実通知の到達・本番稼働は未検証。 |
| 6 | 環境変数・本番分離 | コードはLive/Sandboxのキー・API・DBを分離。Vercelは値を復号せずメタデータのみ確認。CLERK_SECRET_KEYと接続トークンはsensitive、決済接続はPreview対象。今回確認したVercelには本番決済用変数なし。Railway側の実設定は未確認。 |
| 7 | 支払い・権限履歴 | 既存実装あり。PROは支払・イベント・有効期間・返金/紛争停止理由と時刻を保持。RESOLUTEは監査と通知待ちテーブルあり。実DBの運用・バックアップ稼働は未確認。 |
| 8 | 注文/失敗集中の記録・通知 | PRO Live用の共有DB制限・警告記録・通知ワーカーを今回実装。DB適用と配信先設定は未実施、通知は未稼働。RESOLUTEには既存のプロセス内制限があるが、複数台共通の制限・運営通知の実配信は今回未整備。 |

## 残る適用手順（未実施を完了扱いにしない）

1. Clerk管理画面で、ログイン失敗ロック、Strict enumeration、再設定の有効期限/再使用拒否、MFA手段（TOTP+復旧コード）を確認。プラン条件を確認する。パスワード、秘密鍵、復旧コードをチャットに貼らない。
2. RESOLUTE独自owner判定にもMFAを適用（ニュース関連は担当者と調整）。管理者本人が2FA登録し、別セッションで第二要素認証を確認した後、Vercelの該当環境で `TECH_PHASE_REQUIRE_ADMIN_MFA=true`。再ログイン、管理者エクスポート等の保護、未認証では拒否、アカウント設定は利用可能を実機で確認。現状のフラグだけで全管理者経路を保護できるとは扱わない。
3. Railway接続が許可・復旧してから専用Live DBへ `db/tech-phase/007_billing_security.sql` を適用し、サービスを反映。既存Live writerへ新規セキュリティテーブルだけの権限を追加する。決済履歴の変更/削除権限は増やさない。
4. 運営通知の配信先を決める。付属Slackアダプターを使う場合だけ `TECH_PHASE_SECURITY_SLACK_WEBHOOK_URL` と `TECH_PHASE_SECURITY_ALERTS_ENABLED=true` を設定し、`node security-alert-worker.mjs` を定期実行。テスト通知、再試行、未送信残件を確認。設定していない間は通知されない。
5. 本番用PayPal/Webhook/Clerk設定と実Cookieを最終確認。既に終えたSandbox購入をむやみに繰り返さない。
6. 会員CSV/Sheets同期の必要列と保存期間、ホスティング側ログのマスキング・保持期間を確認。

## 検証

- 新規テスト: 管理者MFAの認証済みクレーム、未登録/未認証の拒否、membership統合、Owner/Sandbox権限抑止、通常の許可済みSandboxテスターを誤って拒否しないこと。
- PGliteで実SQLとLive writer権限を使用: 複数ワーカー同時注文で5件まで許可、6件目以降拒否、警告重複防止、通知障害時の保持/再送、別ユーザーと次窓への独立性。
- APIテスト: 制限時にPayPal呼び出しなし、注文制限がWebhookを止めない、秘密を含む例外がレスポンスや通知に出ない。
- 最終ツリーでNode 1,561件・Python 2,648件すべて成功（追加セキュリティテスト6件を含む）。lintはエラー0・既存警告9件。production build/型確認、compileall、diff checkも成功。実機Clerk設定変更、実PayPal課金、実通知、Railway操作は未実施。

## 公式資料

- https://clerk.com/blog/how-we-roll-passwords
- https://clerk.com/docs/guides/protect/user-lockout
- https://clerk.com/docs/guides/protect/user-enumeration-protection
- https://clerk.com/docs/guides/development/custom-flows/authentication/forgot-password
- https://clerk.com/docs/guides/how-clerk-works/overview
- https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options
- https://clerk.com/docs/guides/sessions/session-tokens
