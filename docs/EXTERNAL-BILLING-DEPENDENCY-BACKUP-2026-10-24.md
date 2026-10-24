# 決済連携の依存ライブラリ：R2実保存・復元・隔離起動

2026-10-24 00:50 JST（2026-10-23 15:50 UTC）。実際の復元ログから確認した記録。

- 実装commit: `f8312b9e9332874bc3a99f91bad1ee3a08492dde`
- 全文tree: `16e0c3bc3f23072b52927e5e38d00bd28c1d441c`
- [実バックアップ run39981635463](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/39981635463)：SUCCESS。job120510146997の実ログを取得して確認。
- [実装CI run39981635331](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/39981635331)：SUCCESS。同commitの通常検査と隔離PostgreSQL検査が成功。

## 実保管・取り出し

ソースと決済専用依存を既存の鍵で暗号化し、`resolute-backup-external` に保存。
実際にダウンロードした暗号文のハッシュ・認証・復号・復元を確認した。
設定一致やデプロイ表示だけで成功とはしていない。

| 対象 | 暗号文bytes | SHA-256 |
| --- | ---: | --- |
| 同commitのソース | 19,896,348 | `d2fd8105f8d155053f0f03f0306b3d2d0f227237c9a0f25fd65225c78f5bde50` |
| 決済専用依存14パッケージ・139ファイル | 184,348 | `4645e31e28ab6e166594dcfc37eb8ff9f8b981ee75180418168b2d008855337b` |

専用lockfile SHA-256：
`344d514d719cafa6bf604225eec90d474715a72274c4e2f49704379947001bf4`

ソースobject：
`tech-phase/source/v1/f8312b9e9332874bc3a99f91bad1ee3a08492dde/d2fd8105f8d155053f0f03f0306b3d2d0f227237c9a0f25fd65225c78f5bde50.aesgcm`

依存object：
`tech-phase/dependencies/v1/344d514d719cafa6bf604225eec90d474715a72274c4e2f49704379947001bf4/4645e31e28ab6e166594dcfc37eb8ff9f8b981ee75180418168b2d008855337b.aesgcm`

各objectの `.json` は非秘密の完了記録。復旧時はこの独立した記録のhashと照合する。

## 実起動

15:50:33.1897982Z `SOURCE_EXTERNAL_UPLOAD_VERIFIED`：同commit/treeへのソース復元成功。
15:50:33.1912330Z `DEPENDENCIES_EXTERNAL_RESTORE_OK`：139ファイルの復元成功。
15:50:33.7391364Z `BILLING_RESTORED_BOOT_OK`：17項目成功。
15:50:33.7461581Z `BILLING_EXTERNAL_OFFLINE_BOOT_OK`：カーネルネットワーク隔離下で成功。

新しいnpm installをせず、復元した専用依存から実サーバーを起動した。
health、認証拒否、認証済みでも決済OFFなら拒否、Webhook無効、未知経路の拒否を確認。
外部接続ガードの自己検査と正常終了も成功。実認証情報なし、実課金0、追加AI呼び出し0。

## 検証範囲と残作業

- 検証環境：Ubuntu24.04、Node24.22.1、Linux x64、ABI137、glibc2.39。
- Node本体・コンテナ環境はこの依存アーカイブに含まれない。BookwormやRender稼働は未検証。
- 本番決済台帳・DB接続・取引処理・最新の削除／通知停止履歴の復元は未検証。
- 手元でも暗号化復元・17項目が成功。`pg` を欠損させた場合は起動検査が失敗し、成功ログなし。
- 手元の全3,934件（Node1,336／Python2,598）、lint、build、compileall、差分検査が成功。
  lintはエラー0・既存警告5。CI実ログでもNode1,336／Python2,598とビルド成功を確認。
- 保存・保護・再送の有効化はしない。新しい書き込み停止下の完全な一覧と隔離復元が必要。
  使用済みAI診断claimを保持する。Railway再接続・鍵再入力・予約変更は不要。
- 次はPython系サービスとNode／Python／PostgreSQLを含む実行環境全体の保管・隔離検査。
  [Render接続制限の調査](RENDER-STANDBY-PLAN.md)も後続切替時に反映する。
