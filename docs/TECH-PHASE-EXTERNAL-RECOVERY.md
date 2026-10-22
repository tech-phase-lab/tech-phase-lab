# Tech Phase + RESOLUTE 外部保管の対象と実行手順

2026-10-23: [復元ソースの起動検証](RUNTIME-RECOVERY-DRILL-2026-10-23.md)を追加。
保管済み80ced071と同じソースをローカルbundleから復元し、フォントfixture＋webpackで
起動・HTTP検査を実施。既定ビルドはGoogle Fontsへの通信が必要で、完全オフライン起動の
受入ではない。本番DB・認証付き復旧・最新開発版509c2a90の起動確認とも区別する。

2026-10-23 JST追記: ユーザーはRailway障害継続中で接続不能と再確認。
再認証要求だけでログインし直せば解決すると判断しない。障害中は接続・再認証を再依頼しない。
[オフラインのソース保管処理と設定照合表](TECH-PHASE-RECOVERY-SETTINGS.md)を追加。
6c0ebd8aの1,635ファイルを完全履歴bundleにまとめ、空repoへの復元で全tree一致。
206の設定名と参照ファイルを抽出（値は取得せず、実環境の網羅確認ではない）。
同コミットのCI39802323253はsuccess。この記載時点ではR2実保存は未確認だった。下記の実行記録で更新。

2026-10-22。R2バケット `resolute-backup-external` と接続キーの作成・手元保存は
運営者から完了報告あり。名前を変えず、同じ非公開バケットのprefixで分離する。
ソースのR2実保存・読み戻し・隔離復元は成功済み（719ec8cd、run39815593175）。
別ジョブで同じ既存オブジェクトを再取得・復号・復元する検査も成功
（run39820351545）。詳細は[保存記録](EXTERNAL-SOURCE-BACKUP-2026-10-23.md)と
[独立復元記録](EXISTING-SOURCE-RESTORE-DRILL.md)を参照。
本番DBの外部転送・全サイト復旧の受入は未完了。

## 保管対象を取り違えない

| 対象 | ソース上の保存先・根拠 | 外部保管と復旧の状態 |
| --- | --- | --- |
| ニュース本文・取得履歴・編集データ | research monitorの `RESEARCH_DB_PATH`（既定 `/data/automatic.sqlite`、実変数を要照合） | 全テーブルをオンラインスナップショット→暗号化→R2読戻しする処理を追加。実行前 |
| 会員の保存リサーチ・メモ/書き込み | 同DB `member_saved_research`、`scripts/research/saved_research.py` | サーバー同期済み分を上記全DBに含む。実データ復元未確認 |
| 会員ウォッチリスト | 同DB `member_favorite_lists`、`scripts/research/favorite_lists.py` | 同期済み分を上記に含む |
| Push端末・配信状態、質問等 | 同DB、`web_push.py` / `questions.py`、service.pyの接続先 | 全テーブルを含む。復元後も通知を停止して重複配信を防止 |
| ゲストデータ・未同期編集 | ブラウザlocalStorage/sessionStorage、`use-saved-research.ts` / `use-favorite-lists.ts` | サーバーバックアップから回収できない。同期前データを保存済み扱いしない |
| PRO決済台帳 | `tech_phase_billing_sandbox`、既存tech-phase-backup | 既存はSandbox専用。暗号化済みdumpを外部コピーするprofile追加。本番台帳のバックアップ完成とは別 |
| RESOLUTE DB | 既存Postgres dumpとage manifest | 既存外部コピー処理。R2実通信未確認 |
| 削除・両通知停止の履歴 | 独立protection bucket、暗号化イベントとpin済み一覧 | 外部コピー追加。全writer停止・未処理キュー0・新規完全一覧が前提。初期空一覧や合成3件を使い回さない |
| サイトコード・承認済み文章・ローカル画像 | Gitの管理対象全体（app/lib/public等） | 719ec8cdの完全履歴bundleをR2へ保存し、実読戻し・別ジョブでの再取得・隔離復元まで成功。最新開発分は専用requestで追加保管し、実ログ確認後に成功を記録 |
| 外部URLの画像・コンテンツ | 例: capital-map-profiles.tsの外部画像 | Gitに実体は入らない。提供条件と保存可否、実利用URLを確認して別に保管。URLだけを画像バックアップ扱いしない |
| ログイン会員 | Clerk（外部管理） | DBのownerとClerk user IDの対応を保持。会員exportと復元可能範囲・認証設定を別途照合。DBだけでログイン復旧は保証しない |
| 決済の最新状態 | PayPal（外部管理） | 古いdumpから権限を復活させない。復元前に返金/異議/解約/最新期間を再照合。本番決済・実課金は行わない |
| 設定・鍵・運用 | Railway/Vercel/Clerk/PayPal/DNS等 | 秘密はGit・ログ・平文R2へ出さない。鍵と設定の独立保管、参照先・Cron・ドメインの復元台帳が必要 |

この表はコード調査の結果。実環境の全サービス・全volume・全bucketの網羅照合は
Railway再接続後に行う。2026-10-22のlist_servicesはUNAUTHORIZEDで読めなかった。
研究DB以外の実volumeに未知のファイルがあれば対象追加し、全対象確認まで全保管を宣言しない。

## 研究DB: 暗号化・転送・隔離復元

新規 `scripts/tech-phase/external_research_backup.py`。通常ジョブへは未組込。
既存朝ジョブ・バックアップ頻度・通知設定を変更しない。
実volumeを読める環境で、SQLiteのonline backup APIを使う。稼働中のmainファイルだけを
コピーするとWALの更新が落ちるので禁止。全テーブルを取得し、integrity_checkと既存必須
スキーマ検証後にAES-256-GCMで暗号化。1GiB上限、コピー120秒上限、暗号化は分割処理。
送信先の暗号文とmanifestのサイズ/SHA256を読み戻して照合後に成功を出す。
平文一時ファイルはprivate一時ディレクトリに置き、通常終了/例外時とも削除する。
異常終了時の媒体残存まで保証しないため、実行環境の一時領域は保護し、稼働前に容量も確認する。

依存は `services/tech-phase-backup/requirements.txt` の既存pinを利用。
実行環境は現在のresearch Dockerfileへ自動同梱されない。実volumeと同じ環境への配置・
依存導入をレビューしてから実行する。勝手に同じvolumeを新サービスへ二重attachしない。

必要な変数（値はチャット・Gitへ貼らない）:

- `TECH_PHASE_EXTERNAL_BACKUP_ENABLED=true`
- `RESEARCH_DB_PATH`: 確認済みの絶対パス
- `TECH_PHASE_EXTERNAL_KEY_HEX`: 32byteの独立保管済み暗号鍵（64桁の小文字hex）
- `MIRROR_DESTINATION_ENDPOINT/BUCKET/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY`: 各接尾辞を持つ5変数

R2アクセスキーと暗号鍵は別物。既存RESOLUTE age鍵をhex化して使わない。
外部保管用暗号鍵とR2接続情報の4 SecretsはGitHubへ登録済みで、ソース保管で実通信を確認済み。
研究DBを読めるRailway実行環境への安全な設定・鍵参照と実行確認は未完了。
GitHubで成功したことをRailway側の設定反映済みと扱わない。
既存の復旧鍵を再生成/再入力する手順ではない。

```sh
python3 scripts/tech-phase/external_research_backup.py
```

保存先は `tech-phase/research/v1/dumps/<UTC時刻>.aesgcm` と同名 `.json`。
条件付きPutで同名上書きを拒否し、latestを変更しない。部分失敗時に暗号文だけ残る可能性が
あるが、manifestなしは復元候補としない。自動削除・保持期間設定は未実施。
取得したペアを隔離環境で確認（必要なのは研究DB用暗号鍵のみ。元DB/S3資格情報は不要）:

```sh
python3 scripts/tech-phase/external_research_backup.py --verify-archive /private/backup.aesgcm --manifest /private/backup.aesgcm.json
```

認証タグ・平文SHA・SQLite整合性を検証する。復元DBは検査後削除し、本番へ適用しない。
これはデータ復元検査であり、全サイト起動・API認証・会員データ読取の受入は別。
復旧採用時にはmanifest時刻と選んだ復元時点を確認し、古いデータを最新と表示しない。

## PRO Sandboxの外部コピー

既存 `scripts/resolute/mirror_backup.py` を `MIRROR_PROFILE=tech-phase-sandbox` で実行。
既存opt-inの `RESOLUTE_EXTERNAL_COPY_ENABLED=true` とsource/destinationの各5変数を使う。
ソースbucketはPRO専用。profileの既定はresoluteのまま。暗号鍵・DB接続情報は渡さない。
保存先 `tech-phase/sandbox/v1/external/<sha256>/backup.aesgcm` と `.json`。
本番用profileは存在せず拒否。既存Sandbox復元検査への受渡しは原本keyに戻して隔離配置し、
元manifestの日時・48時間制限を維持する。PRO鍵の独立保管は別途確認が必要。

## 削除・停止履歴の外部コピー

`scripts/resolute/mirror_protection.py`。既存の完全一覧作成手順で、writerを実際に停止し
未処理キューを空にしてから新しいmanifestをsealする。sourceは履歴bucket。
通常mirror設定に加えて `MIRROR_PROTECTION_MANIFEST_SHA256` と
`MIRROR_PROTECTION_WRITERS_FENCED=true` が必要。後者は運用者の確認入力であり停止の証明ではない。
source全ページ一覧とmanifestの完全一致、各暗号文hash、転送後readback、再一覧の一致を要求。
manifestは最後に保管する。コピー処理に復号鍵は渡さず、暗号認証は隔離復元で確認する。
保存先 `resolute/protection/external-v1/<pin>/<原本key>`。
復元時はこのprefixを除いた原本keyで隔離bucketに配置し、既存load_manifestの完全一覧照合・
復号認証・DBへの適用検査を行う。最新でない一覧は復旧に採用しない。

## 権限・費用・残る受入

R2のObject Read & Writeを対象バケットだけに限定したことは、削除不能の証明ではない。
削除権限の分離/保持ロックは実設定と実通信で別途検証する。既存dump/historyコピーは
同名に再PUTするため、ロック有効化前に再実行方式を調整する。安易にロックをONにしない。
容量・保持日数・実行頻度・転送料は未確定。無料枠内と決めつけず、自動化前に見積もる。

次の順序で進める:

1. Railway障害復旧後に全サービス/volume/bucketを読み取り照合。障害中の再認証や回転済み秘密の再入力を再依頼しない。
2. 確認した実行環境で保存済みR2キーと独立保管済み暗号鍵を安全に参照できるようにする。GitHubの登録完了とRailwayの反映完了を分けて確認する。
3. 研究DB・RESOLUTE・PRO・履歴をそれぞれ実転送し、時刻/サイズ/hash/readbackを記録。
4. ソース/静的資産、設定台帳、Clerkの復元材料を揃える。未同期ブラウザデータの扱いを明示。
5. Railway資格情報を渡さない環境で全データ復元、認証付きAPI読取、権限・削除/停止の整合性を検査。
6. 全対象の受入後に定期化・保持期間を設定。既存朝ジョブを変更しない。

研究DBにもバックアップ後の削除・編集がある。古いスナップショットの整合性が正常でも
最新の会員文書とは限らない。差分・削除の照合ができない復旧では会員データの公開/書込を
再開しない。継続的な変更履歴の独立保管は未実装で、日次/時間単位のdumpだけでは
ゼロデータ損失を保証できない。全サービス無停止の代替環境もまだ用意されていない。

公式仕様照合: https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup
 / https://developers.cloudflare.com/r2/api/s3/api/
 / https://cryptography.io/en/latest/hazmat/primitives/symmetric-encryption/

## 初期実装時のローカル検証記録（履歴）

以下は初期実装時点の記録。R2ソース保存・実復元の状態は冒頭の成功記録で更新済み。

- Node 1,323件、Python 2,570件成功（計3,893件）。lintはエラー0、既存警告5。
- build、compileall、git diff --check成功。
- 研究DBは実SQLite WALに保存メモを残した状態から全体コピーし、実AES-GCM暗号化・
  復号・隔離復元・メモ一致を確認。誤鍵、改ざん、破損readback、欠損DBを拒否。
- 履歴コピーは完全一覧一致、古い空一覧の拒否、途中変更/破損時manifest未発行を確認。
- PROの外部コピーprofileはRESOLUTEとprefixを分離し、未対応の本番profileを拒否。
- ソースbundleはaad63d08（管理ファイル1,630件、public配下28件）を完全履歴で取得。
  空のbare repoへfetchしてtree `6365e6c9e2693e6c91434430bad17cfba1928060` の一致を確認。
  一時検証用のbundleであり、R2の永続保管や今回の追加コードの保管を意味しない。
- 前回aad63d08のCI39795559198はsuccess。本変更のCIとは別。
- 本番データ・R2実通信・実復元・Clerk export・設定台帳は未確認。Railway接続は
  再認証要求で停止。新規サービス/定期実行/メール/決済/AI通信は作成・実行していない。
