# Claude向け：端末別スマホ通知設定API

## 実装範囲と接続待ち

サーバー側の保存・読出しと、目標株価/決算/銘柄手帳の送信判定を実装。
画面ファイルは変更していない。以下を既存の画面へ接続する必要がある。
**銘柄ニュースの会員向けWeb Push送信元は現行コードに存在しない。**
SSEのニュース画面更新とスマホ通知は別。新規ニュース配信は開始していない。
ニュース用設定と `web_push.notification_allowed(db, device_id, 'news', tickers)` は用意済み。
今後ニュース送信元を作る際、PRO/所有者/activeチェック後、送信予約の直前にこの判定を呼ぶ。
関連銘柄のどれか1つでも選択銘柄と一致すれば許可。空配列ならニュースは全部停止。

## エンドポイント・認証

同一サイトの **`POST /api/research/notifications`**。
既存ログインCookie、`Content-Type: application/json`、同一Originが必要。
認証済みかつ有効なPRO会員（既存の運営者PRO扱いを含む）の、本人所有の購読のみ操作可。
会員IDや有効期限を画面から送らない。サーバーで確定し、内部APIへ認証付きで転送する。
購読は `PushSubscription.toJSON()` を本文に入れる。URL・ログ・エラー表示に入れない。
レスポンスは `private, no-store`。購読キー、endpoint、owner_id、端末idは返さない。

`GET /api/research/notifications` の既存設定レスポンスに `preferencesVersion: 1` が付くと利用可能。
0/未指定なら未対応で、保存成功の表示を出さない。

### 読み出し

```ts
const subscription = await registration.pushManager.getSubscription();
const response = await fetch('/api/research/notifications', {
  method: 'POST', credentials: 'same-origin',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({action: 'preferences', subscription: subscription!.toJSON()})
});
// 実値をconsoleへ出さない。subscriptionがない場合は先に既存の登録処理を使う。
```

```json
{"ok":true,"preferences":{"targets":true,"earnings":true,"news":true,"newsTickers":["MU","NVDA"],"weeklyNotebook":true}}
```

この銘柄配列は例。未保存時は `providers.json` のscopeがearningsでない全監視銘柄が返る。
保存されていない購読の配信は従来どおり。既存 `tickers` / `allTargets` は別の旧配信範囲で、
新しいnewsTickersで上書きしない（決算や目標株価がニュース選択に巻き込まれないようにする）。

### 部分更新

```ts
await fetch('/api/research/notifications', {
  method: 'POST', credentials: 'same-origin',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({action: 'save-preferences', subscription: subscription!.toJSON(),
    preferences: {targets: false}})
});
```

| フィールド | 型 | 動作 |
| --- | --- | --- |
| targets | boolean | 目標株価変更 |
| earnings | boolean | 決算速報 |
| news | boolean | 銘柄ニュースの許可判定 |
| newsTickers | string[] | 監視銘柄のティッカーのみ。空配列可、重複は除去。`*`や未知銘柄は不可 |
| weeklyNotebook | boolean | 既存のweekly_notebook列をそのまま更新 |

送った項目だけを更新し、残りは保持。成功時は読み出しと同じ全設定を返す。
空オブジェクト・未知キー・boolean以外・不正な銘柄一覧は拒否。登録後の設定更新は
`since`、active、購読キー、配信履歴、PRO有効期限を変更しない。
新規登録の `action: 'register'` に `preferences` を同時に渡せば登録と設定を原子的に保存できる。
再登録でpreferencesを省略した場合、保存済みの新設定は保持する。
旧トップレベルweeklyNotebookも互換対応。新しい画面はpreferences.weeklyNotebookを使う。

401は未ログイン、403はPRO期限切れ/Origin不正、503は接続/保存失敗等。
内部APIの所有権不一致・未登録・不正形式は400、既存プロキシでは503として返る。
エラー時は保存済み扱いにせず再読込・再試行を案内する。入力した秘密値を表示しない。

## 画面接続時の注意

- 開く際はサーバーの設定を優先。localStorageの古い値で自動上書きしない。
- 保存は直列化、または前の保存完了まで対象操作を待つ。部分更新で他スイッチを巻き戻さない。
- 成功レスポンスを受けて確定。失敗時は元に戻すか「保存できませんでした」と短く表示。
- 既存の週間切替は再登録を呼んでいる。新画面ではsave-preferencesへ移し、sinceの更新を避ける。
- 端末ごとの設定なので、別端末・同じ端末の別ログイン会員へlocalStorage値を移さない。

## 保存・障害時の扱い

research-monitorの既存SQLiteに `push_device_preferences` を追加する。
主キーdevice_idは既存push_devices.id。targets/earnings/newsとJSON銘柄配列を保存。
手帳設定は既存push_devices.weekly_notebookのみ使用。端末削除時に追加設定も削除。
設定テーブルの読出し失敗や不正値の場合、**送信時だけ**追加フィルターを掛けず従来どおり。
PRO確認・端末無効化・鮮度・重複防止まで無視することはない。
APIの読出し/保存失敗は成功に見せずエラーを返す。

設定変更前の調査は `NOTIFICATION-PREFERENCES-AUDIT-2026-10-30.md` に記録。
実端末や本番会員へテスト通知は送らず、合成購読と送信transportの記録で検証する。

## 反映先の確認（2026-10-30）

Vercel Productionの接続先がRailwayのresearch-monitor-staging（staging環境）であることを、
値を出力せず一致判定で確認。古いresearch-monitor（production環境）は変更しない。
接続先の成功デプロイ050310b8とupstream 00bdcb9fのmonitorビルド対象ファイルは一致。
今回のブランチ更新では通知設定の変更だけがmonitorの差分になる。

一方、Vercel Productionはmain由来の別デプロイ。main変更・forceは禁止のため、
今回のAPIプロキシはcodex/research-previewで検証し、画面側の接続と合わせた本番反映が必要。
本番画面でスイッチがすでに効く状態とは報告しない。
