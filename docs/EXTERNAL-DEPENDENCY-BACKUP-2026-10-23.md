# 暗号化ライブラリの実保管・復元・オフラインビルド

2026-10-23 19:07 JST、実際のCloudflare R2保存物からの復元とビルドを確認。
設定一致やジョブのSUCCESS表示だけでなく、以下の実出力を確認した。

- [実保存・復元ワークフロー](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/39936499622)
- ジョブ: `120357230118`
- ソース: `6421f93129a3f7bf390bbcf34640f4a86b94524f`
- ツリー: `1aeb5534e88933bcea8f7946a8a601dda7ccfa59`
- [実装のCI](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/39936499517): 他担当の後続更新により取り消し。
- 実装を含む後続コミット`a78f7b15f792045b1420de74d03cec2556db34b3`の
  [CI](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/39936861611): SUCCESS。DB同時処理・Lint・Node・Python・ビルドが通過。
- 保管対象は上記`6421f931`時点。後続の企業関係図追加や本記録を保管済みとは扱わない。

## 実際に確認したこと

1. 同一コミットのソースとフロントエンドのnpm依存を、既存の復旧鍵でAES-256-GCM暗号化してR2へ保存。
2. 保存した暗号文を全体ダウンロードし、サイズ・SHA-256・認証タグを検証して復号。
3. ソースのGitコミット・ツリー一致と、依存32,242ファイルの一覧・ハッシュ・安全な展開を検証。
4. R2や暗号化の秘密を渡さない別ステップで、復元した依存だけをクリーンなソースへ配置。
5. `unshare --net`で外部通信を遮断し、npmの再インストールなしで`npm run build`成功。
6. 一時ステージングを削除。バックアップの定期実行や本番設定は変更していない。

実ログ:

- `SOURCE_EXTERNAL_UPLOAD_VERIFIED`: 2026-10-23T10:06:32.8941792Z
- `DEPENDENCIES_EXTERNAL_RESTORE_OK`: 2026-10-23T10:06:32.8950660Z
- `DEPENDENCIES_OFFLINE_BUILD_OK`: 2026-10-23T10:07:01.8041212Z
- 最後の出力は`network_disabled=true`, `new_npm_install=false`, `live_database_verified=false`。
  依存復元の出力時点では`runtime_build_verified=false`であり、その後のビルド出力で成功を確認した。

## 復元に使う識別情報

保管先は既存の`resolute-backup-external`。秘密の値は本書に含めない。

| 項目 | 確認値 |
| --- | --- |
| ソース暗号文サイズ | 19,742,748 bytes |
| ソース暗号文SHA-256 | `5e996f1a9e729fdda3863f9a8250d63567d2b94c8405a85c379150d3d0c5b3de` |
| 依存暗号文サイズ | 360,775,708 bytes |
| 依存暗号文SHA-256 | `6c605e9db5d1bb00f78382266e52becc902db4b78dc63ecd0193606bb79d1241` |
| package-lock SHA-256 | `4a2bec98efc6e84a65f9a5a89d95fbb09df6882942af6c2809e1e5f76ac6aac0` |
| ビルド環境 | Node v22.23.4 / Linux x64 / ABI 127 / glibc 2.39 |

ソースのオブジェクト:
`tech-phase/source/v1/6421f93129a3f7bf390bbcf34640f4a86b94524f/5e996f1a9e729fdda3863f9a8250d63567d2b94c8405a85c379150d3d0c5b3de.aesgcm`

依存のオブジェクト:
`tech-phase/dependencies/v1/4a2bec98efc6e84a65f9a5a89d95fbb09df6882942af6c2809e1e5f76ac6aac0/6c605e9db5d1bb00f78382266e52becc902db4b78dc63ecd0193606bb79d1241.aesgcm`

取り出し手順は[OFFLINE-REBUILD.md](OFFLINE-REBUILD.md)。信頼済みのlockハッシュと
保管済み復旧鍵を用い、新しい空の出力先へ復元する。鍵の再生成・再入力は不要。

## 検証範囲と残り

これはTech Phaseのソースとフロントエンドnpm依存の復旧確認。
Node実行ファイル、コンテナのベースイメージ、API・決済サービス専用依存、Python依存、
最新本番DB・削除・通知停止履歴の復元、Renderでの稼働は未検証。
本番DBの完全保管や無停止切替の完了として扱わない。

保存機能・履歴保管・再試行の有効化には、書き込み停止下の新しい完全な一覧と
未処理キューの確認、実保存、隔離復元が必要。初期の空一覧を使い回さない。
AI診断の実行済み記録を保持し、追加AI呼び出しは行わない。

[Render待機環境の計画](RENDER-STANDBY-PLAN.md)を後続作業として継続する。
現時点で契約・課金変更・常時稼働環境の作成はしていない。
Railwayへの再接続、鍵の再登録、完了済みデプロイの再依頼は不要。

ローカル検証: Node 1,336件、Python 2,598件、Lint（エラー0・既存警告5）、
復元依存によるビルド、compileall、差分検査が成功。
他担当の企業関係図追加を保持して統合し、関連32件・対象Lint・統合後の復元ビルドも成功。
