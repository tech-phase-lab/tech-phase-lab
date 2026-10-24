# 研究DBバックアップ専用の実行環境

既存の研究DB外部バックアップ処理を、固定したバックアップ依存と一緒に実行するためのコンテナ。
通常のニュース監視サービスのDockerfile・依存・開始コマンドは変更しない。
Python3.12、boto3 1.42.21、cryptography 46.0.3を使用する。
研究監視のpywebpushが要求する別バージョンと同じ環境へ混ぜない。

リポジトリルートからビルドする：

```sh
docker build -f services/tech-phase-research-backup/Dockerfile -t research-backup-check .
```

専用のDockerfile.dockerignoreでビルド対象を必要なファイルだけに絞り、COPYも個別に指定する。
DB・鍵・環境変数の値・テストデータはイメージへ入れない。
UID10001の非管理者で動作し、保存機能は初期状態で無効。
環境変数なしの起動は失敗コード1で終了する。サーバー、公開ポート、Cronは持たない。

## 検証範囲

専用CIは実際にDocker buildし、実行時の外部通信を遮断して次を検査する。

- 非管理者、固定依存、同梱ファイル、初期無効状態。
- 読み取り専用root filesystemと一時領域のみでの起動。
- 検証用SQLiteのWALを含む取得、暗号化、保存先から取得したバイトの復号・隔離DB検査。
- 破損・別鍵・不正な保存先で成功記録を作らないこと。

保存先はメモリ内の検証用実装。R2や本番DBには接続しない。
このCIは実データの保存、本番volumeの読み取り権限、実行環境の外部保管を証明しない。
既存の7対象の保管記録へ、このイメージを保管済みとして追加しない。

## 本番で未完了の条件

### 検証済みDBを復旧作業へ渡す

既存の `--verify-archive` / `--manifest` だけなら検査後にDBを削除する。
復旧担当がオフラインで使うDBを残す場合だけ `--restore-output` を追加する。
信頼する保管記録と照合した暗号文・manifestを使い、復元時点も確認する。
暗号鍵は既存の安全な参照を利用する。元DBの接続情報やR2資格情報は不要。

```sh
python scripts/tech-phase/external_research_backup.py \
  --verify-archive /private/backup.aesgcm \
  --manifest /private/backup.aesgcm.json \
  --restore-output /private/recovery/research.sqlite
```

`/private/recovery` は事前に用意した、実行ユーザー所有で他ユーザーに権限のないディレクトリ。
出力は絶対パスで指定し、途中のディレクトリにシンボリックリンクを使わない。
出力DB、同名の `-wal` / `-shm` / `-journal` がある場合は拒否する。既存DBを指定しない。
認証付き復号・平文SHA・DB整合性の全検査に成功した後だけ、0600の完全なファイルを
上書きしないhard linkで公開する。作業途中で同名ファイルができても上書きしない。
成功イベントは `TECH_PHASE_RESEARCH_RESTORE_EXPORT_OK`、`promotion=false`。
ハードリンクが使えないファイルシステムでは停止し、非原子的なコピーへ切り替えない。
平文DBを明示的に残す操作なので、公開フォルダー・Git・外部バックアップへ入れない。
本番DBの交換、サービス起動、ゲート有効化は行わない。書き込み停止と最新履歴の確認を含む
本番への切替受入は別途必要で、合成DBの出力成功を本番復旧完了とは扱わない。

失敗時は終了コード1と `TECH_PHASE_RESEARCH_EXTERNAL_BACKUP_FAILED` を返す。
追加の `stage` は失敗した工程を表す固定値。例外本文、接続先、DBパス、鍵はログへ出さない。

| stage | 確認する工程 |
| --- | --- |
| `configuration` | 無効状態または設定の検査。初期無効での終了もここ。 |
| `client` | 保存先SDKの読み込み・client生成。通信成功の証拠ではない。 |
| `snapshot` | 元DBの読み取り、WALを含む取得、DB整合性検査。 |
| `encrypt` | 暗号化、一時暗号文のサイズ・SHA計算。 |
| `upload` / `download` | 暗号文の送信／取得とバイト照合。 |
| `restore` | 取得暗号文の認証付き復号・隔離DB検査。 |
| `manifest_upload` / `manifest_readback` | 完了記録の送信／取得と照合。 |
| `archive_input` | 復元検査CLIのmanifest・鍵の読み取り。 |
| `export_output` | 復元DBの出力先検査・完全なファイルの新規作成。 |
| `internal` | 上記に分類できない失敗。成功や再試行可能と推測しない。 |

工程の識別であり、たとえば `upload` だけで認証不良や障害と断定しない。
保存先が受け付けた後に通信が切れる場合もあるため、失敗は「何も保存されなかった」を意味しない。
自動再送・既存保存物の削除は追加しない。完了manifestがある場合でも失敗した実行を成功へ読み替えない。
設定や鍵の再登録を機械的に求めず、該当工程の実結果を確認する。

元DBを読める場所とパス、WAL/共有メモリの読み取り条件、既存鍵参照を確認してから利用する。
同じ本番volumeを新サービスへ勝手に二重接続しない。現在のサービスや朝ジョブの変更は行っていない。
このイメージを作っただけでは元DBへの接続経路はできず、Railway/Renderへの配置もしていない。
実データ用の一時領域にはDBサイズのおよそ4倍とSQLite検査用の余裕が必要。
CIの64MiB一時領域は小さい合成DB用で、本番設定ではない。

保存・復元条件は [研究DBバックアップの完了条件](../../docs/RESEARCH-BACKUP-RESTORE-GATE.md) を参照。
