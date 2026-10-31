# RESOLUTE 本番運営者の利用権限

## 変更前の調査

- `techphase.app` のVercelプロジェクトは **tech-phase-lab** (`prj_CCegV1VWucYpppYuMCDbBOAGF9s4`)。同名に近い `tech-phase-research` ではない。
- 実プロジェクトの環境変数一覧では `RESOLUTE_API_URL` / `RESOLUTE_API_SERVICE_TOKEN` は `codex/research-preview` のPreview用のみ。Production用が存在しない。認証後の `fetchResoluteEntitlements` はこの状態で接続不可となり503を返す。
- 接続先 `resolute-api` は10月23日の `7875e998cf6936d6c8c8b3628a4ca667a1ef89c2` に固定。調査時はSLEEPING。最新の権限コードはまだ稼働していない。
- 運営者の利用例外は存在せず、公開権限取得、ルール保存、通知設定、通知キュー作成、送信直前確認は購入記録を要求していた。
- 本人のログインセッションは取得せず、画面確認も行わない。ログだけでは本人のリクエストを特定できていない。

## 変更内容

- 本番Clerkの署名・issuer・origin・有効期限を確認したセッションについて、承認済みの本番運営者IDと二段階認証済みの `fva` が一致するときだけ利用例外を発行。
- 本番運営者がMFA未確認ならAPIは403。一般会員、PRO会員、role=admin、開発用運営者には購入なしの利用権限を与えない。
- 権限証明はプロセス内のみ・最大60秒・本人に限定。リクエストJSONや保存したオブジェクトのコピーからは利用できない。
- Webの権限取得、温度計等の取得判定、Railwayのルール保存・通知設定・危険度取得で同じ例外を適用。
- 通知キュー作成と実送信では本番Clerkから運営者本人のMFA有効・ロック/禁止なしを再確認。通知の同意、宛先確認、配信時刻、重複防止、配信停止は従来通り守る。証明をキューへ保存しない。
- 購入履歴・課金の権限リーダー・売上集計は変更せず、注文や購入権限を作らない。運営者が実際に購入した契約も変更しない。

## API（Claude向け）

既存の `GET /api/resolute/entitlements` を使用。既存のClerkログイン方式のまま。

運営者の利用例外では以下を返す。

```json
{
  "productId": "resolute_v1",
  "asOf": "ISO日時",
  "accessBasis": "owner",
  "use": {"status": "owner", "startsAt": null, "expiresAt": null},
  "alerts": {"status": "owner", "startsAt": null, "expiresAt": null},
  "canUseTools": true,
  "canReceiveNotifications": true
}
```

`owner` は購入済みという意味ではない。購入日・架空の通知期限を作らない。画面の入口は既存の `canUseTools` / `canReceiveNotifications` を使う。デザイン変更なし。

## 本番接続

- 既存Previewの接続情報を保持する。
- Railwayに `RESOLUTE_PRODUCTION_API_SERVICE_TOKEN` と `RESOLUTE_PRODUCTION_CLERK_JWT_PUBLIC_KEY` を追加。新しい本番専用トークンと本番Clerk公開鍵を使い、既存のトークン・issuer・公開鍵は上書きしない。
- VercelのProductionだけに `RESOLUTE_API_URL` と `RESOLUTE_API_SERVICE_TOKEN` を追加。本番専用トークンは秘密扱いで保存し、出力しない。
- 通知キューの本番運営者確認は既存の `RESOLUTE_MAIL_PUBLIC_ORIGIN` / `RESOLUTE_MAIL_CLERK_SECRET_KEY` を使う。送信処理は既存のClerk宛先照合結果を使う。スケジューラや送信有効化の設定は変更しない。
- 本番反映にはバックエンドとWebの両方が必要。旧Webは `status: owner` を拒否するため、接続設定追加だけを完了扱いにしない。

## 検証

- 専用テスト: 本番署名の確認、Preview鍵・異なるorigin・異なる会員・MFAなしの拒否、証明の偽造/再利用拒否、購入なしの取得・保存・再読込、通知キュー/送信時の制御、購入/売上テーブルが空のままであることを確認。
- 統合ツリーで lint（エラー0、既存警告11）、build、Node 1,712件、Python 2,682件、compileall、diff-check が成功。
- 実購入・実メール送信・運営者の保存データ変更は行わない。実ログインによる取得・保存・再読込の表示確認はClaude側へ引き継ぐ。
- 本番の通知送信ワーカー/定期キューは今回新設・有効化しない。例外はコードのキュー作成・送信時確認に実装済みだが、実配信を完了扱いにはしない。
