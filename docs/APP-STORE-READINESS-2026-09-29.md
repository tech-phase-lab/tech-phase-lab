# App Store準備状況 — 2026-09-29

## 方針
既存Webを維持しつつiOS向け機能を段階実装する。Webを包むだけで審査に通る前提にはしない。審査提出・Apple契約・課金開始は未実施。

## コード監査
- PWA: app/manifest.ts は standalone /research と192・512pxアイコンを設定済み。ネイティブiOSプロジェクトは未作成。
- 認証: Clerkのログイン・登録・アカウント画面あり。アカウント画面に退会・削除の導線は未確認。実装前にClerk、投稿、通知購読、課金の削除・保存ポリシーを確定する。
- PRO掲示板: app/research/qa/questions.tsx に会員共有の質問投稿あり。app/research/questions/moderation.tsx に運営の削除・非表示あり。利用者向け通報・ユーザーブロックは未実装。旧非公開質問の公開は禁止。
- 通知: 既存Web Pushあり。iOSネイティブ通知・APNs連携は別途必要。
- 課金: App Store用の商品・購入検証・復元・解約後の権限同期は未実装。地域別のApple規約とWeb購読の扱いを設計時に再確認する。
- TradingView: Web埋め込みを使用中。アプリWebViewでの表示・帰属表示の条件は公式回答待ち。無断のブランド削除や取得データの再利用は行わない。
- ブランド: 採用した最初のAを public/brand/tech-phase-mark.svg にベクター化しサイトヘッダーに反映。PWA既存PNGとiOSアイコンへの展開は残作業。

## 次の実装順
1. 掲示板の通報・ブロック、運営対応フローと問い合わせ導線。
2. アカウント削除の仕様・本人確認・関連データ処理。
3. iOSプロジェクト作成、ログイン・ディープリンク・通知・読み込み失敗時の画面。実機検証。
4. Apple課金方針の決定後に購入・復元・購読権限同期。
5. プライバシー表示、審査用アカウント、スクリーンショット、アクセシビリティ確認、TestFlight。

## 公式確認先
- https://developer.apple.com/jp/app-store/review/guidelines/ （1.2、3.1、4.2、5.1.1）
- https://www.tradingview.com/widget-docs/contact/

## TradingViewフォーム診断
2026-09-29、公式Contact usを押してもフォームが開かない状態を再現。open-widget-formスクリプトで `Document direction getter is not set` エラーが発生。問い合わせ未送信。
ヘルプセンター https://www.tradingview.com/support/ が代替案。ただし有人サポートチケットは有料プラン向け。問い合わせのためだけの契約は行わない。
