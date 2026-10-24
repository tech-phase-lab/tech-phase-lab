# API専用ライブラリの実保管・復元・起動確認

2026-10-23 22:13 JST、Cloudflare R2から取り出したAPI専用依存で起動確認に成功。

- [実保存・復元ワークフロー](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/39959285394): SUCCESS
- ジョブ: `120432885753`
- 対象コミット: `caaff68d8a3d43f7b5a4aec39709842202b2039a`
- 対象ツリー: `eb3a2b8def99edd040531a04ae27f2c6af34d34b`
- [実装CI](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/39959285218): SUCCESS。Node1,336件・Python2,598件・Lint・ビルドとDB同時処理検査が通過。

## 実ログによる確認

| 出力 | UTC時刻 | 確認内容 |
| --- | --- | --- |
| `SOURCE_EXTERNAL_UPLOAD_VERIFIED` | 13:13:09.1576894 | 同一コミットのソースを保存・全体取得・復号し、Gitコミットとツリーの一致を確認 |
| `DEPENDENCIES_EXTERNAL_RESTORE_OK` | 13:13:09.1590041 | API専用依存5,384ファイルをR2から取得・復号・復元 |
| `API_RESTORED_BOOT_OK` | 13:13:09.8632057 | 復元した依存で無効ワーカーの読み込み、API起動、7経路の応答、正常終了を確認 |
| `API_EXTERNAL_OFFLINE_BOOT_OK` | 13:13:09.8988938 | 外部通信遮断下で成功。npm再インストールなし |

正常応答は`/healthz`の200。未認証の会員権限・投資ルール・通知設定・AI確認GETは401、
決済の2経路は無効状態の503。認証済み操作、DB保存、実決済、実AI呼び出しは行っていない。
試験用の設定のみを渡し、外向き接続を拒否する仕組み自体も実行確認した。

## 復元対象の識別情報

既存バケット`resolute-backup-external`と既存の復旧鍵を使用。秘密の値は記録しない。

| 項目 | 値 |
| --- | --- |
| ソース暗号文 | 19,886,108 bytes |
| ソースSHA-256 | `ad0034681480671bef13a6b991c75201a272e0fdc81e9a1a398582344966ae96` |
| API依存暗号文 | 6,287,388 bytes |
| API依存SHA-256 | `9df18609c36df1aa9f3e7020b2d1cbec9b3b7be64282cc8cc5d2b48d68f78a0e` |
| API package-lock SHA-256 | `ab6b130fe31c459495cf213b923abdad31cd70a48b821ce25a2fecff5afa51c5` |
| 実試験環境 | Node v24.22.1 / Linux x64 / ABI 137 / glibc 2.39（Ubuntu 24.04） |

ソース:
`tech-phase/source/v1/caaff68d8a3d43f7b5a4aec39709842202b2039a/ad0034681480671bef13a6b991c75201a272e0fdc81e9a1a398582344966ae96.aesgcm`

API依存:
`tech-phase/dependencies/v1/ab6b130fe31c459495cf213b923abdad31cd70a48b821ce25a2fecff5afa51c5/9df18609c36df1aa9f3e7020b2d1cbec9b3b7be64282cc8cc5d2b48d68f78a0e.aesgcm`

手順は[API-DEPENDENCY-RECOVERY.md](API-DEPENDENCY-RECOVERY.md)。
本記録より後の変更を保管済みとは扱わない。

## 検証範囲と残り

ソース・画面用依存に加え、API専用依存の実保管と復元起動まで確認できた。
本番DB接続、認証済み保存、最新DB・削除・通知停止履歴の隔離復元は未確認。
保存機能と履歴保管・再試行のゲートは引き続き無効。
新しい完全な書き込み停止下の一覧を使い、古い空一覧は流用しない。

Node実行ファイル・コンテナベースイメージはアーカイブに含まれない。
Nodeの版はAPI Dockerfileと同じだが、今回のUbuntu環境とBookwormコンテナは別環境。
復元処理はlibcを含めて一致を要求するため、BookwormやRenderでそのまま復元可能とは扱わない。
その環境に合う依存保管または実行環境全体の保管と、隔離起動試験が別途必要。
決済専用依存・Python依存の保管も別作業。

ローカル検証はNode1,336件・Python2,598件・Lint（エラー0、既存警告5）・ビルド・
compileall・差分検査が成功。他担当の関係図追加を保持し、関連32件と対象Lintも成功。
暗号化した試験データの実復元起動、必須依存欠落時の失敗も確認した。

[Render待機環境計画](RENDER-STANDBY-PLAN.md)を継続する。課金・契約・朝ジョブは変更していない。
Railwayへの再接続や、鍵登録・AI診断・完了済みデプロイのやり直しは不要。
