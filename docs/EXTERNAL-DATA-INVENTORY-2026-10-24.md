# 外部バックアップ実一覧 — 2026-10-24 07:17 JST

## 確認結果

既存Cloudflare R2バケットの既知7prefixを読み取り専用で2回列挙し、50objectのkey・サイズ・ETag・更新時刻が一致した。
DB・履歴の4分類は、下記の確認先ではいずれも0件だった。コード・依存・実行環境の保管成功を、本番データの保管完了と読み替えない。

- 実装commit: `61cfc1f2511eadf68e79a8e38ca4cf5715dafe8c`
- [実一覧 run40032566590](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/40032566590)
- 実ログ: job120684141366、2026-10-23T22:17:04.9752159Z（日本時間翌07:17）
- 一覧照合値: `3186a942f7c32814491157d436ddb892220d634f695e43c520a11e9f3f2a344b`
- 読み取りのみ。暗号鍵なし、本文取得なし、保存・削除なし、Railway/本番DB接続なし。

| 分類 | object数 | bytes | 判定 |
| --- | ---: | ---: | --- |
| source | 18 | 174003228 | 存在を観測 |
| dependencies | 6 | 367249905 | 存在を観測 |
| runtime | 26 | 2763578195 | 存在を観測 |
| research_database | 0 | 0 | 確認prefixでは0件 |
| resolute_database | 0 | 0 | 確認prefixでは0件 |
| billing_sandbox_database | 0 | 0 | 確認prefixでは0件 |
| protection_history | 0 | 0 | 確認prefixでは0件 |

件数は暗号文とメタデータを含むobject数であり、復元可能なバックアップ数ではない。
実行環境には前回の権限エラーで起動に失敗した保存物も含まれる。
採用する7対象は[成功した復元記録](EXTERNAL-RUNTIME-BACKUP-2026-10-24.md)の正確なkey/image ID/SHAで選ぶ。
一覧の更新時刻は元データの取得時刻を示さない。他のprefix、別バケット、Railway内バックアップの不存在は意味しない。

## 次の実行条件

現在の接続済みGitHub側R2認証でできるのは、この外部保存先の確認まで。
GitHub runnerにはRailwayの研究volumeや本番PostgreSQLへの認証・接続経路を渡していない。
元データを読み出せる実行環境なしに、最新版のデータを生成して転送することはできない。
ユーザーの指示どおりRailway管理の再接続・再認証を試していない。完了済みの鍵入力・SQL・デプロイを再依頼しない。

実アクセスが利用できる段階で、以下を既存実装に沿って進める：

1. 研究volumeの実DBパスを確認し、WALを含めSQLite online backupで取得する。
   `scripts/tech-phase/external_research_backup.py` を必要な依存とともに元volumeを読める環境へ配置し、既存鍵参照で暗号化・R2保存・実取り出し・復元検査を行う。
2. RESOLUTE/決済の正確なDB・役割・鍵参照を照合し、既存dumpの日時と完全性を確認して外部コピーする。
   `scripts/resolute/mirror_backup.py` のresoluteとtech-phase-sandboxを混同しない。Sandboxだけで本番決済台帳の保管成功を宣言しない。
3. 保存開始前に全writer停止と未処理キューを実確認し、新しい完全な保護履歴一覧を独立保管する。
   `scripts/resolute/mirror_protection.py` のboolean指定だけで停止を証明しない。
   古い空一覧・合成3件を使わず、削除と両通知停止、使用済みAI診断claimを保持した隔離復元を検証する。
4. 最新のDBと保護履歴の実復元が通るまで保存ゲートをOFFに保ち、Renderへの切替は行わない。

今回の一覧照合値は観測用であり、保護イベントのmanifest pinではない。
`RESOLUTE_PROTECTION_EVENTS_MANIFEST_SHA256` などの本番設定には使用しない。

## 検証

[CI40032566501](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/40032566501)は実装commit61cfc1f2でSUCCESS。
実ログでNode1,336件、Python2,623件、ビルドを確認。Sandbox PostgreSQL同時実行検査も成功。
ローカル最終treeでも全3,959件、lint（エラー0／既存警告5）、build、compileall、差分検査が成功。
追加の10件はページ分割、変更検出、欠落、上限、権限拒否、識別子非表示、分類混同の防止を検証した。

## 実ログから抽出した記録

```json
{
  "event": "EXTERNAL_INVENTORY_OBSERVED",
  "observed_at_utc": "2026-10-23T22:17:04.974006+00:00",
  "read_only": true,
  "listed_prefixes": {
    "source": "tech-phase/source/v1/",
    "dependencies": "tech-phase/dependencies/v1/",
    "runtime": "tech-phase/runtime/v1/",
    "research_database": "tech-phase/research/v1/dumps/",
    "resolute_database": "resolute/v1/external/",
    "billing_sandbox_database": "tech-phase/sandbox/v1/external/",
    "protection_history": "resolute/protection/external-v1/"
  },
  "scopes": {
    "source": {
      "objects": 18,
      "bytes": 174003228,
      "latest_object_modified_utc": "2026-10-23T17:54:43.788000+00:00",
      "presence": "objects-observed"
    },
    "dependencies": {
      "objects": 6,
      "bytes": 367249905,
      "latest_object_modified_utc": "2026-10-23T15:50:32.509000+00:00",
      "presence": "objects-observed"
    },
    "runtime": {
      "objects": 26,
      "bytes": 2763578195,
      "latest_object_modified_utc": "2026-10-23T18:00:44.737000+00:00",
      "presence": "objects-observed"
    },
    "research_database": {
      "objects": 0,
      "bytes": 0,
      "latest_object_modified_utc": null,
      "presence": "no-objects-in-listed-prefix"
    },
    "resolute_database": {
      "objects": 0,
      "bytes": 0,
      "latest_object_modified_utc": null,
      "presence": "no-objects-in-listed-prefix"
    },
    "billing_sandbox_database": {
      "objects": 0,
      "bytes": 0,
      "latest_object_modified_utc": null,
      "presence": "no-objects-in-listed-prefix"
    },
    "protection_history": {
      "objects": 0,
      "bytes": 0,
      "latest_object_modified_utc": null,
      "presence": "no-objects-in-listed-prefix"
    }
  },
  "listed_objects": 50,
  "inventory_sha256": "3186a942f7c32814491157d436ddb892220d634f695e43c520a11e9f3f2a344b",
  "two_listings_equal": true,
  "whole_bucket_inventory": false,
  "writer_fence_verified": false,
  "source_data_freshness_verified": false,
  "ciphertext_verified": false,
  "manifest_verified": false,
  "restore_verified": false,
  "saving_activation_allowed": false
}
```
