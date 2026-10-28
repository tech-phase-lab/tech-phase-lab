# 実行環境7対象の外部保管・復元検査記録 — 2026-10-24 JST

## 結果

7対象すべてでR2への暗号化保存、実ダウンロード、GCM認証・復号、圧縮ファイル照合、Docker load、対象別の隔離検査が成功した。
同一ソースから新しく作った復旧用イメージであり、稼働中Railwayイメージの書き出しではない。

- 実装commit: `81b4e775e2314bce59acc6daa11c75aba813774b`
- 全文tree: `172ec963b7584472486a3a27f2207ec454f767ae`
- [実保存・復元 run39998902799](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/39998902799): SUCCESS
- [CI run39998902797](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/39998902797): SUCCESS
- Node1,336件、Python2,613件、lint、Next.js build、Sandbox PostgreSQL同時実行検査が成功。実ログの件数・ビルド結果も確認。
- ローカルも同じ最終treeで全3,949件・build・compileall・差分検査成功。lintは既存警告5件、エラー0件。
- 既存4Secrets・既存R2バケット・既存暗号鍵を使用。鍵や認証の再登録なし。
- イメージ暗号文7個の合計: **1,424,680,690 bytes**（約1.327 GiB）。別途ソース19,927,068 bytesと非秘密メタデータ。初回失敗分の保管物はこの合計に含まず、削除していない。

## 実際に確認した範囲

全対象Linux amd64、network none、読み取り専用、権限削減、pull禁止。
元のtagと圧縮元ファイルを除去してから、ダウンロードした復号済みアーカイブをloadした。
実秘密情報・ホストDB・公開ポートはコンテナに渡していない。

| 対象 | 暗号文bytes | 隔離検査UTC | 検証範囲 |
| --- | ---: | --- | --- |
| frontend | 431739415 | 2026-10-23T17:58:12.7083287Z | Next.js起動・静的JSのHTTP取得と内容一致。ログイン未検証。 |
| api | 85800737 | 2026-10-23T17:55:31.4859484Z | API起動・health、認証拒否、決済停止の7項目。 |
| billing | 80674978 | 2026-10-23T17:56:21.1479017Z | 起動・health、決済停止、Webhook停止の3項目。実課金なし。 |
| protection | 354112539 | 2026-10-23T17:58:55.2876751Z | 保存を無効にしたCLIの読み込み・終了。履歴の実保存未検証。 |
| research | 60088696 | 2026-10-23T17:58:55.7689780Z | 監視起動・livez・Python依存・一時SQLite整合性。本番ニュース未検証。 |
| backup | 197835758 | 2026-10-23T18:00:37.8697026Z | boto3/暗号ライブラリとpg_dump/pg_restore 18.6の実行。本番DB接続なし。 |
| recovery | 214428567 | 2026-10-23T18:00:48.8771258Z | 復元受入を無効にしたCLIの読み込み・終了。本番DB復元未検証。 |

フロントはNode22.23.4/glibc2.36、API・決済はNode24.22.1/glibc2.36。
監視はPython3.12.15/glibc2.41（pypdf6.10.0、aiohttp3.14.3、pywebpush2.4.0）。
バックアップはPython3.11.2/glibc2.36、PostgreSQL18.6、boto3 1.42.21、cryptography46.0.3。
保管されたイメージ自体にOSと実行バイナリを含む。別CPUアーキテクチャ・Render稼働は未検証。

## 途中で見つけた問題と修正

初回run39993764983では、umask077のtar展開がソースを0600にし、一般ユーザーの実行でEACCESが発生した。
APIはビルド時に停止、他5対象は取り出し後の起動で失敗。バックアップのツール検査だけが成功した。
これらを7対象の復元成功とは扱わない。修正後の上記runが採用する証拠。
Git archiveのtar.umaskを0022に固定し、tar --same-permissionsでソースの0644/0755を保持。
外側の作業領域は0700のまま。全1,951項目の展開検査と再実行で確認した。本番Dockerfileやユーザー権限は緩和していない。

修正版のローカルPython初回検査では、既存TLS loopbackテスト1件が2秒制限で時間切れになった。
該当テスト単独と全2,613件の再実行が成功。再実行は一時ファイルを専用/dev/shm領域へ置き、
テスト内容・制限時間・固定時計は変更していない。GitHubの通常CIでも全2,613件が成功。

## 残る本番条件

この記録で本番DBの最新内容や保存機能の実稼働を認定しない。
保存有効化前に、新しい書き込み停止下の完全な復元一覧、削除・通知停止履歴、未処理キュー、
使用済みAI診断claimを含む最新データの実保管・隔離復元が必要。初期の空一覧は使い回さない。
`owner-key-check-2026-10-23` は使用済みとして保持し、追加AI検査をしない。
フロントは本番NEXT_PUBLIC設定を含まないため、認証付き画面の利用には公開設定を合わせたビルドと検証が別途必要。
監視の一時SQLiteを本番研究・ニュースのバックアップと扱わない。
Railway管理への接続、実決済、メール、課金設定、朝ジョブ・予約、RIZEL非表示設定の変更はしていない。
Render予備環境は後続工程。正確な接続先の許可・TLS・最小権限・実保存と復元の検証を完了するまで切り替えない。

## 復元用照合記録

以下は実行ログのJSON行を解析し、commit・service・image ID・暗号文と圧縮ファイルSHA・検査結果を相互照合した記録。
ジョブのSUCCESS表示やコマンドのechoだけから作っていない。object keyとSHAは秘密鍵ではない。
復元手順は [RUNTIME-IMAGE-RECOVERY.md](RUNTIME-IMAGE-RECOVERY.md) を参照。

```json
[
  {
    "time": "2026-10-23T17:54:44.4815857Z",
    "job_id": 120569555672,
    "event": "SOURCE_EXTERNAL_UPLOAD_VERIFIED",
    "key": "tech-phase/source/v1/81b4e775e2314bce59acc6daa11c75aba813774b/c51c526477ad8d4110000f7a54e11577985e1680a66022e03c68f2abf768db6e.aesgcm",
    "sha256": "c51c526477ad8d4110000f7a54e11577985e1680a66022e03c68f2abf768db6e",
    "bytes": 19927068,
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "tree": "172ec963b7584472486a3a27f2207ec454f767ae",
    "source_restore_verified": true,
    "external_storage_verified": true,
    "runtime_restore_verified": false
  },
  {
    "time": "2026-10-23T17:58:53.7531383Z",
    "job_id": 120569753838,
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "service": "research",
    "image_id": "sha256:1a24841fa85166ea2be69bb67c52989db69925ba32eac2a8dc457a1897194503",
    "archive_sha256": "ca53a56550a9d67d08bf2394bbf7210778f17bcd5c2120054e2ef392a69a8ce2",
    "archive_bytes": 60088668,
    "archive_restored": true,
    "image_loaded": false,
    "runtime_boot_verified": false,
    "version": 1,
    "tree": "172ec963b7584472486a3a27f2207ec454f767ae",
    "key": "tech-phase/runtime/v1/81b4e775e2314bce59acc6daa11c75aba813774b/research/8d74f47d67a53a80ed60228cb13f837e4e535e6d5765ca93f688be0ef6be565d.aesgcm",
    "sha256": "8d74f47d67a53a80ed60228cb13f837e4e535e6d5765ca93f688be0ef6be565d",
    "bytes": 60088696,
    "aad": "tech-phase/runtime/v1/81b4e775e2314bce59acc6daa11c75aba813774b/research/sha256:1a24841fa85166ea2be69bb67c52989db69925ba32eac2a8dc457a1897194503",
    "format": "nonce12-aes256gcm-ciphertext-tag16",
    "encrypted": true,
    "scope": "freshly-built-runtime-image",
    "external_storage_verified": true,
    "live_database_verified": false,
    "deployed_image_export": false,
    "event": "RUNTIME_EXTERNAL_READBACK_OK"
  },
  {
    "time": "2026-10-23T17:58:55.7689780Z",
    "job_id": 120569753838,
    "event": "RUNTIME_OFFLINE_PROBE_OK",
    "service": "research",
    "image_id": "sha256:1a24841fa85166ea2be69bb67c52989db69925ba32eac2a8dc457a1897194503",
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "architecture": "amd64",
    "os": "linux",
    "image_config_checked": true,
    "layer_count": 10,
    "image_loaded": true,
    "network_disabled": true,
    "runtime_probe_verified": true,
    "application_server_boot_verified": true,
    "health_verified": true,
    "disposable_sqlite_verified": true,
    "live_data_verified": false,
    "python_version": "3.12.15",
    "libc": [
      "glibc",
      "2.41"
    ],
    "packages": {
      "pypdf": "6.10.0",
      "aiohttp": "3.14.3",
      "pywebpush": "2.4.0"
    },
    "provider_credentials_present": false,
    "live_database_verified": false,
    "authenticated_storage_verified": false,
    "live_payments": 0,
    "live_ai_calls": 0
  },
  {
    "time": "2026-10-23T18:00:45.3030908Z",
    "job_id": 120569753856,
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "service": "recovery",
    "image_id": "sha256:3c241e8dfd69816b6d26b6a4d27d06e770c26d6b90d2f875ffa52d7b4bb2d36f",
    "archive_sha256": "74f021c68b718b7f8664d4867f123fad823360fe1d5912195388d2f2546ac4ae",
    "archive_bytes": 214428539,
    "archive_restored": true,
    "image_loaded": false,
    "runtime_boot_verified": false,
    "version": 1,
    "tree": "172ec963b7584472486a3a27f2207ec454f767ae",
    "key": "tech-phase/runtime/v1/81b4e775e2314bce59acc6daa11c75aba813774b/recovery/ce1e756189a59ab8e73a0d46337c60de40dd26c34b8919c1cd3bb61e0f7c9cd9.aesgcm",
    "sha256": "ce1e756189a59ab8e73a0d46337c60de40dd26c34b8919c1cd3bb61e0f7c9cd9",
    "bytes": 214428567,
    "aad": "tech-phase/runtime/v1/81b4e775e2314bce59acc6daa11c75aba813774b/recovery/sha256:3c241e8dfd69816b6d26b6a4d27d06e770c26d6b90d2f875ffa52d7b4bb2d36f",
    "format": "nonce12-aes256gcm-ciphertext-tag16",
    "encrypted": true,
    "scope": "freshly-built-runtime-image",
    "external_storage_verified": true,
    "live_database_verified": false,
    "deployed_image_export": false,
    "event": "RUNTIME_EXTERNAL_READBACK_OK"
  },
  {
    "time": "2026-10-23T18:00:48.8771258Z",
    "job_id": 120569753856,
    "event": "RUNTIME_OFFLINE_PROBE_OK",
    "service": "recovery",
    "image_id": "sha256:3c241e8dfd69816b6d26b6a4d27d06e770c26d6b90d2f875ffa52d7b4bb2d36f",
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "architecture": "amd64",
    "os": "linux",
    "image_config_checked": true,
    "layer_count": 25,
    "image_loaded": true,
    "network_disabled": true,
    "runtime_probe_verified": true,
    "application_server_boot_verified": false,
    "disabled_cli_verified": true,
    "backup_toolchain_verified": false,
    "provider_credentials_present": false,
    "live_database_verified": false,
    "authenticated_storage_verified": false,
    "live_payments": 0,
    "live_ai_calls": 0
  },
  {
    "time": "2026-10-23T17:58:50.1893126Z",
    "job_id": 120569753863,
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "service": "protection",
    "image_id": "sha256:e106b051acfb4d4c4b473638f25241e3c0df51fca471b3e722de9b75b22a65b3",
    "archive_sha256": "66ddb2b31e99ae5b3f28a853bd1be39bcad649dcb6c62edda5fbd6009f21a04e",
    "archive_bytes": 354112511,
    "archive_restored": true,
    "image_loaded": false,
    "runtime_boot_verified": false,
    "version": 1,
    "tree": "172ec963b7584472486a3a27f2207ec454f767ae",
    "key": "tech-phase/runtime/v1/81b4e775e2314bce59acc6daa11c75aba813774b/protection/18996377efde3301b4c094fda4fe8c0dc8fcb57554d682048f7193c4288e4fff.aesgcm",
    "sha256": "18996377efde3301b4c094fda4fe8c0dc8fcb57554d682048f7193c4288e4fff",
    "bytes": 354112539,
    "aad": "tech-phase/runtime/v1/81b4e775e2314bce59acc6daa11c75aba813774b/protection/sha256:e106b051acfb4d4c4b473638f25241e3c0df51fca471b3e722de9b75b22a65b3",
    "format": "nonce12-aes256gcm-ciphertext-tag16",
    "encrypted": true,
    "scope": "freshly-built-runtime-image",
    "external_storage_verified": true,
    "live_database_verified": false,
    "deployed_image_export": false,
    "event": "RUNTIME_EXTERNAL_READBACK_OK"
  },
  {
    "time": "2026-10-23T17:58:55.2876751Z",
    "job_id": 120569753863,
    "event": "RUNTIME_OFFLINE_PROBE_OK",
    "service": "protection",
    "image_id": "sha256:e106b051acfb4d4c4b473638f25241e3c0df51fca471b3e722de9b75b22a65b3",
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "architecture": "amd64",
    "os": "linux",
    "image_config_checked": true,
    "layer_count": 10,
    "image_loaded": true,
    "network_disabled": true,
    "runtime_probe_verified": true,
    "application_server_boot_verified": false,
    "disabled_cli_verified": true,
    "backup_toolchain_verified": false,
    "provider_credentials_present": false,
    "live_database_verified": false,
    "authenticated_storage_verified": false,
    "live_payments": 0,
    "live_ai_calls": 0
  },
  {
    "time": "2026-10-23T18:00:34.7280342Z",
    "job_id": 120569753919,
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "service": "backup",
    "image_id": "sha256:5ff81ff525b41ce4dd17b1a4c19ae7461fb51b7c09c0a4e1e58f7b383baa278b",
    "archive_sha256": "3c0e7273ea5a99d85fe919828075e398b8a90f3b5f6f707ad38326d34457bb48",
    "archive_bytes": 197835730,
    "archive_restored": true,
    "image_loaded": false,
    "runtime_boot_verified": false,
    "version": 1,
    "tree": "172ec963b7584472486a3a27f2207ec454f767ae",
    "key": "tech-phase/runtime/v1/81b4e775e2314bce59acc6daa11c75aba813774b/backup/752e65a6b2d95254883c6e02a9f343c6d8870bf8f886487f6b2fa275d24e9771.aesgcm",
    "sha256": "752e65a6b2d95254883c6e02a9f343c6d8870bf8f886487f6b2fa275d24e9771",
    "bytes": 197835758,
    "aad": "tech-phase/runtime/v1/81b4e775e2314bce59acc6daa11c75aba813774b/backup/sha256:5ff81ff525b41ce4dd17b1a4c19ae7461fb51b7c09c0a4e1e58f7b383baa278b",
    "format": "nonce12-aes256gcm-ciphertext-tag16",
    "encrypted": true,
    "scope": "freshly-built-runtime-image",
    "external_storage_verified": true,
    "live_database_verified": false,
    "deployed_image_export": false,
    "event": "RUNTIME_EXTERNAL_READBACK_OK"
  },
  {
    "time": "2026-10-23T18:00:37.8697026Z",
    "job_id": 120569753919,
    "event": "RUNTIME_OFFLINE_PROBE_OK",
    "service": "backup",
    "image_id": "sha256:5ff81ff525b41ce4dd17b1a4c19ae7461fb51b7c09c0a4e1e58f7b383baa278b",
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "architecture": "amd64",
    "os": "linux",
    "image_config_checked": true,
    "layer_count": 17,
    "image_loaded": true,
    "network_disabled": true,
    "runtime_probe_verified": true,
    "application_server_boot_verified": false,
    "backup_toolchain_verified": true,
    "database_connected": false,
    "postgres_tools": {
      "pg_dump": "pg_dump (PostgreSQL) 18.6 (Debian 18.6-1.pgdg12+2)",
      "pg_restore": "pg_restore (PostgreSQL) 18.6 (Debian 18.6-1.pgdg12+2)"
    },
    "python_version": "3.11.2",
    "libc": [
      "glibc",
      "2.36"
    ],
    "boto3_version": "1.42.21",
    "cryptography_version": "46.0.3",
    "disabled_cli_verified": false,
    "provider_credentials_present": false,
    "live_database_verified": false,
    "authenticated_storage_verified": false,
    "live_payments": 0,
    "live_ai_calls": 0
  },
  {
    "time": "2026-10-23T17:55:29.5218445Z",
    "job_id": 120569754018,
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "service": "api",
    "image_id": "sha256:7e148889e24488ef6f7224109ba34107e03cd7821a1df8d1be167f9f835ee1ca",
    "archive_sha256": "7a5b40fbbc6e0e707c047ba80b6d430c4eee530a380a99672be4e335ef938e2a",
    "archive_bytes": 85800709,
    "archive_restored": true,
    "image_loaded": false,
    "runtime_boot_verified": false,
    "version": 1,
    "tree": "172ec963b7584472486a3a27f2207ec454f767ae",
    "key": "tech-phase/runtime/v1/81b4e775e2314bce59acc6daa11c75aba813774b/api/cd06fe71a3217b8cee4ba8af80a8458bf10a144d5420ef6af916f28bf2bb0932.aesgcm",
    "sha256": "cd06fe71a3217b8cee4ba8af80a8458bf10a144d5420ef6af916f28bf2bb0932",
    "bytes": 85800737,
    "aad": "tech-phase/runtime/v1/81b4e775e2314bce59acc6daa11c75aba813774b/api/sha256:7e148889e24488ef6f7224109ba34107e03cd7821a1df8d1be167f9f835ee1ca",
    "format": "nonce12-aes256gcm-ciphertext-tag16",
    "encrypted": true,
    "scope": "freshly-built-runtime-image",
    "external_storage_verified": true,
    "live_database_verified": false,
    "deployed_image_export": false,
    "event": "RUNTIME_EXTERNAL_READBACK_OK"
  },
  {
    "time": "2026-10-23T17:55:31.4859484Z",
    "job_id": 120569754018,
    "event": "RUNTIME_OFFLINE_PROBE_OK",
    "service": "api",
    "image_id": "sha256:7e148889e24488ef6f7224109ba34107e03cd7821a1df8d1be167f9f835ee1ca",
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "architecture": "amd64",
    "os": "linux",
    "image_config_checked": true,
    "layer_count": 15,
    "image_loaded": true,
    "network_disabled": true,
    "runtime_probe_verified": true,
    "application_server_boot_verified": true,
    "http_checks": 7,
    "node_version": "v24.22.1",
    "glibc": "2.36",
    "provider_credentials_present": false,
    "live_database_verified": false,
    "authenticated_storage_verified": false,
    "live_payments": 0,
    "live_ai_calls": 0
  },
  {
    "time": "2026-10-23T17:56:19.6865073Z",
    "job_id": 120569754019,
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "service": "billing",
    "image_id": "sha256:a6c43c6e44a422ef1147e6444bc2db4e1e4d2d33ab705ca05eeaa1991eba345e",
    "archive_sha256": "c8661921d586036444742879a7d57f2522379ccd49d06961f923d4a9516d9000",
    "archive_bytes": 80674950,
    "archive_restored": true,
    "image_loaded": false,
    "runtime_boot_verified": false,
    "version": 1,
    "tree": "172ec963b7584472486a3a27f2207ec454f767ae",
    "key": "tech-phase/runtime/v1/81b4e775e2314bce59acc6daa11c75aba813774b/billing/66a81370bf632e81b6b01874aab1223f6cf4b6f02cac766dfbdd18bb23378ee4.aesgcm",
    "sha256": "66a81370bf632e81b6b01874aab1223f6cf4b6f02cac766dfbdd18bb23378ee4",
    "bytes": 80674978,
    "aad": "tech-phase/runtime/v1/81b4e775e2314bce59acc6daa11c75aba813774b/billing/sha256:a6c43c6e44a422ef1147e6444bc2db4e1e4d2d33ab705ca05eeaa1991eba345e",
    "format": "nonce12-aes256gcm-ciphertext-tag16",
    "encrypted": true,
    "scope": "freshly-built-runtime-image",
    "external_storage_verified": true,
    "live_database_verified": false,
    "deployed_image_export": false,
    "event": "RUNTIME_EXTERNAL_READBACK_OK"
  },
  {
    "time": "2026-10-23T17:56:21.1479017Z",
    "job_id": 120569754019,
    "event": "RUNTIME_OFFLINE_PROBE_OK",
    "service": "billing",
    "image_id": "sha256:a6c43c6e44a422ef1147e6444bc2db4e1e4d2d33ab705ca05eeaa1991eba345e",
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "architecture": "amd64",
    "os": "linux",
    "image_config_checked": true,
    "layer_count": 9,
    "image_loaded": true,
    "network_disabled": true,
    "runtime_probe_verified": true,
    "application_server_boot_verified": true,
    "http_checks": 3,
    "node_version": "v24.22.1",
    "glibc": "2.36",
    "provider_credentials_present": false,
    "live_database_verified": false,
    "authenticated_storage_verified": false,
    "live_payments": 0,
    "live_ai_calls": 0
  },
  {
    "time": "2026-10-23T17:58:05.6252748Z",
    "job_id": 120569754319,
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "service": "frontend",
    "image_id": "sha256:95b7cbe915445a0f6595a7cbad54f6b6a36ab0cdee3dff6b6cfeb15edadb65bb",
    "archive_sha256": "e373ec9a255461384af37c132ca6d27dea152c21ebc8333607066f051b1659f7",
    "archive_bytes": 431739387,
    "archive_restored": true,
    "image_loaded": false,
    "runtime_boot_verified": false,
    "version": 1,
    "tree": "172ec963b7584472486a3a27f2207ec454f767ae",
    "key": "tech-phase/runtime/v1/81b4e775e2314bce59acc6daa11c75aba813774b/frontend/e298dc841909630e9b112d852d4363bf297d4b50a6ab3b08b4232e6daf5369b9.aesgcm",
    "sha256": "e298dc841909630e9b112d852d4363bf297d4b50a6ab3b08b4232e6daf5369b9",
    "bytes": 431739415,
    "aad": "tech-phase/runtime/v1/81b4e775e2314bce59acc6daa11c75aba813774b/frontend/sha256:95b7cbe915445a0f6595a7cbad54f6b6a36ab0cdee3dff6b6cfeb15edadb65bb",
    "format": "nonce12-aes256gcm-ciphertext-tag16",
    "encrypted": true,
    "scope": "freshly-built-runtime-image",
    "external_storage_verified": true,
    "live_database_verified": false,
    "deployed_image_export": false,
    "event": "RUNTIME_EXTERNAL_READBACK_OK"
  },
  {
    "time": "2026-10-23T17:58:12.7083287Z",
    "job_id": 120569754319,
    "event": "RUNTIME_OFFLINE_PROBE_OK",
    "service": "frontend",
    "image_id": "sha256:95b7cbe915445a0f6595a7cbad54f6b6a36ab0cdee3dff6b6cfeb15edadb65bb",
    "commit": "81b4e775e2314bce59acc6daa11c75aba813774b",
    "architecture": "amd64",
    "os": "linux",
    "image_config_checked": true,
    "layer_count": 18,
    "image_loaded": true,
    "network_disabled": true,
    "runtime_probe_verified": true,
    "application_server_boot_verified": true,
    "static_asset_verified": true,
    "authenticated_pages_verified": false,
    "node_version": "v22.23.4",
    "glibc": "2.36",
    "provider_credentials_present": false,
    "live_database_verified": false,
    "authenticated_storage_verified": false,
    "live_payments": 0,
    "live_ai_calls": 0
  }
]
```
