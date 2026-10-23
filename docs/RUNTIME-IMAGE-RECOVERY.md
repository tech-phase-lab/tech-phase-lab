# 実行環境全体の暗号化保管・隔離検査

依存ライブラリだけではNode・Python・PostgreSQL本体やOSが不足するため、
同じソースcommitから作った7対象のDockerイメージを暗号化して保管する。
この手順の実装・手元の模擬テストだけで、R2保管やコンテナ起動成功とは扱わない。
実結果は専用workflowのダウンロード・認証・Docker load・隔離検査ログで確認する。

## 対象と検査範囲

| 対象 | ビルド定義 | 復元後の検査 |
| --- | --- | --- |
| フロント | `services/tech-phase-runtime/Dockerfile.frontend` | Next.jsを起動し、静的JSのHTTP取得とファイル内容一致 |
| RESOLUTE API | `services/resolute-api/Dockerfile` | health・認証拒否・無効な決済経路の7項目 |
| 決済連携 | `services/tech-phase-billing/Dockerfile` | health・決済OFF・Webhook OFFの3項目 |
| 履歴保管 | `services/resolute-protection/Dockerfile` | 実CLIの無効状態での読み込み・終了 |
| リサーチ監視 | `Dockerfile.research-monitor` | Python依存の読み込み、livez、隔離した一時SQLiteの整合性 |
| DBバックアップ | `services/tech-phase-backup/Dockerfile` | boto3・暗号ライブラリの読み込み、pg_dump／pg_restore 18の実行 |
| 隔離復元検査 | `services/resolute-recovery/Dockerfile` | 実CLIの無効状態での読み込み・終了 |

既存6対象の本番Dockerfileは変更しない。フロントの定義は復旧検査専用で、
公開・稼働先の変更を行わない。比較機能が参照する既存の検証用JSONも同梱する。
公式Pythonイメージの公開署名鍵fingerprintだけは既知の定数と照合して許可する。
秘密鍵・不明な値を例外にしない。全対象Linux amd64。別アーキテクチャの成功は未確認。

## 実行と保存

`.github/workflows/runtime-external-backup.yml` はpreviewブランチで自身または
専用requestファイルが更新された場合だけ実行する。定期実行・Render作成・課金設定変更はない。
既存の4つのGitHub Secrets、既存の鍵、`resolute-backup-external` を再利用する。
鍵の再生成・再入力・再ログインは不要。

1. 正確なcommitのソースを検証し、暗号化してR2から復元する。
2. git archive由来のクリーンな入力だけでビルドする。実環境の設定・DBは書き出さない。
   ソースの既知の秘密ファイル名・リンク・秘密鍵の形式を拒否する。ビルド工程には保管用認証を渡さない。
3. 完成イメージのsourceラベル・image ID・OS／CPUと、埋め込まれた認証変数がないことを確認する。
4. docker saveの圧縮アーカイブをAES-256-GCMで暗号化し、条件付きでR2に保存する。
   認証対象はcommit・対象サービス・image ID。既存objectを上書き／削除しない。
5. 実際に取り出した暗号文のSHA-256、GCM認証、復元した圧縮ファイルのSHA-256を確認する。
   完了メタデータはその後に保存し、読み戻す。ここではまだイメージ起動成功とはしない。
6. 元のローカルtagと圧縮元ファイルを除去し、取り出したファイルをdocker loadする。
   image IDの一致を再確認し、pull禁止・network none・読み取り専用・権限削減下で検査する。
7. 一時コンテナ・一時領域を除去する。実認証情報・本番DB・実課金・追加AI呼び出しは使わない。

1イメージの圧縮ファイルは512 MiB以下に制限し、超過時はアップロード前に停止する。
7対象の1回分は最大3.5 GiBの圧縮データ（加えて暗号の付加情報・ソース・非秘密メタデータ）。
これはデータ量の上限であり、料金見積りではない。過去objectの自動削除や常時稼働は追加しない。

成功ログは段階を分ける：

- `SOURCE_EXTERNAL_UPLOAD_VERIFIED`：同commitのソース復元。
- `RUNTIME_EXTERNAL_READBACK_OK`：圧縮イメージのダウンロード・認証・復号。起動は未確認。
- `RUNTIME_OFFLINE_PROBE_OK`：復元イメージの一致と対象別の隔離検査。

CLIの無効終了やバックアップツールの読み込みは、API・DB保存の実稼働を証明しない。
対象別の `application_server_boot_verified` と各検査項目を読む。

## オフライン復旧時

独立して保管した実行記録から、commit・service・image ID・暗号文SHA・圧縮ファイルSHAを取得する。
取得したobject自身のメタデータだけを信用して置き換えない。
既存の安全な方法で復旧鍵を環境変数に設定し、値をGit・コマンド履歴・チャットへ書かない。

```sh
python scripts/tech-phase/external_runtime.py \
  --cipher /private/download.aesgcm \
  --expected-commit TRUSTED_COMMIT \
  --service api \
  --expected-image-id TRUSTED_IMAGE_ID \
  --expected-cipher-sha TRUSTED_CIPHER_SHA \
  --expected-archive-sha TRUSTED_ARCHIVE_SHA \
  --output /private/restored.tar.gz
```

認証・照合の成功後に専用の隔離Docker環境でloadし、同じimage IDを使って
`verify_runtime_image.py --service api --image-id ... --expected-commit ...` を実行する。
検査スクリプトはローカルDockerソケットを明示し、外部Docker設定や資格情報を引き継がない。
公開ポートやホストのデータ領域は取り付けない。実運用への切替はこの検査とは別の工程。

## 残る条件

これは同じソースから**新しくビルドした復旧用イメージ**であり、稼働中のRailwayイメージの
書き出しではない。可変のベースタグ／apt／Python推移依存は今回のイメージ内に固定されるが、
既存の本番とバイト単位で一致するとは主張しない。

フロントは秘密情報や本番設定なしでビルドする。Next.jsの `NEXT_PUBLIC_` 設定は
ビルド時に埋め込まれるため、認証付き画面の本番利用には対応する公開設定での再ビルドと検証が必要。
静的ファイルの取得成功をログイン・会員機能・保存の成功と扱わない。

監視の一時SQLiteは検査用で、本番ニュースや保存済み研究のバックアップではない。
最新の本番DB、削除・通知停止履歴、未処理キュー、使用済みAI診断claimを含む
新しい書き込み停止下の完全な一覧と隔離復元が、保存有効化前に必要。
古い空一覧を使い回さない。Renderの接続先制限・TLS・最小権限・切替は
[予備環境計画](RENDER-STANDBY-PLAN.md)の後続工程として扱う。
