# RESOLUTE 独立保護ストアの追記専用検証（チェーン manifest）— 2026-11-16

ブランチ `claude/resolute-protection-inventory`。本番の変数・デプロイ・スケジュールはこのコミットでは一切変更していない。
下の手順のうち 【本番変更・オーナー承認要】 の付いたものは、実行のたびにオーナーの承認を得ること。値（鍵・認証情報・接続文字列）は読まない・書かない・出力しない。manifest の SHA256 は秘密ではない。

## 1. 事象

2026-11-16 00:03 UTC の週次 `resolute-restore-check` が `RESOLUTE_JOB_FAILED` / `ValueError` で失敗した。
旧コード（`protection_events.load_manifest(..., require_complete_inventory=True)`）は、
`RESOLUTE_PROTECTION_EVENTS_MANIFEST_SHA256`（2026-10-20 封印、合成イベント3件、
`72f819a298d8f5365f0fcb404c80ea3fd48e1b5139ffebbd9830cdad92bace75`）と現在の在庫が完全一致することを要求していた。
2026-11-13 の 6b 受け入れ／オーナーテスト用ジョブがイベントを追加したため不一致になった（`incomplete or changing protection inventory`）。
固定 pin のままでは、実会員の削除・通知停止が1件でも起きるたびに週次復元が壊れる。

## 2. 新しい検証規則（`protection_events.verify_append_only`）

`RESOLUTE_PROTECTION_EVENTS_MANIFEST_SHA256` は「現在の在庫そのもの」ではなく、**チェーンの起点（anchor）** を意味する。値を毎回更新する必要はない。復元は次をすべて満たす場合だけ在庫を受け入れる。どれかが崩れれば従来どおり失敗する。

- (a) anchor と、anchor に連鎖するすべてのチェーン manifest に載っているオブジェクトが、同じ SHA256 のまま全部残っている（削除・書き換えなし）。
- (b) それ以外の追加オブジェクトは、鍵で復号でき、AES-GCM 認証とオブジェクト名（HMAC）が一致する正しいイベントである。
- (c) 復元した DB 自身の履歴（`resolute.protection_outbox`）と突き合わせる:
  - anchor 以外の各イベントには、同じ userId / revision / kind / 時刻（ミリ秒）の行がある。
    行が無いイベントは、バックアップ時点より新しい（`created_at − 10分` より後）場合だけ許す。
  - DB の各行には、同じ内容のイベントがストアにある（逆方向）。
  - 例外は anchor の合成イベント3件だけ（2026-10-20 に DB を書かずに公開したため DB 行が無い）。
  - `plan_deletions` / `notification_suppressions` ⊆ 台帳 の確認は、従来どおり `protection.restore_sql` 内で行う。
- (d) 一覧は明示的な最終ページまで完全である（ページング検査は従来どおり）。読み取り中に一覧から消えた／変わったオブジェクトがあれば失敗。読み取り中に**増えた**オブジェクトは今回の対象外とし、次回に検証する（書き込みを止めない週次ジョブのため）。

10分の猶予: 復元に使うバックアップの `created_at` は pg_dump の終了後に付くため、スナップショット開始との差を見込む。

## 3. チェーン manifest の形式

保存先は `resolute/protection/manifests-v2/<sha256>.json`（内容アドレス。同じ名前で別の内容は置けない）。
本文は正規化 JSON（キー昇順・区切り `,` `:`。Python `json.dumps(sort_keys=True, separators=(',',':'))` と Node の出力が同一バイト）:

```
{"anchor":<anchor sha>,"height":n,"mode":"restore"|"maintenance","objects":[{"key":..,"sha256":..},...キー昇順],
 "previous":<直前 manifest の sha>,"sealedAt":"YYYY-MM-DDTHH:MM:SS.mmmZ","version":2}
```

- `height=1` の manifest だけが `previous=anchor` を持つ。`height=n` は `height=n-1` の manifest を指す。
- 各 manifest は直前の manifest の全オブジェクトを同じ SHA256 で含む（追記のみ）。
- 復元は manifests-v2/ を完全に一覧し、anchor が同じ manifest をすべて読み、次を検査する: 名前＝本文 SHA256、正規化バイト一致、形式、高さ、連鎖、追記のみ、manifest 間の矛盾なし。
  1つでも崩れていれば `chain-invalid`。別 anchor の manifest は無視する。
- 「最新」は最大の height（同じ高さが複数＝分岐なら SHA256 が小さい方）。分岐していても、連鎖する全 manifest のオブジェクトを (a) で検証するので、分岐で保護が弱まることはない。
- 履歴の改ざん（過去の manifest の書き換え）は名前と SHA256 の不一致で、途中の manifest の削除は連鎖切れで検出する。
  先端の manifest を丸ごと消された場合でも、DB に行があるイベントは (c) の逆方向検査で検出する。

### 復元ジョブによる自動追記（任意）

`RESOLUTE_PROTECTION_CHAIN_WRITE=true` のときだけ、復元の再適用（restore_sql）に成功した後、検証済みの在庫を新しい manifest（`mode:"restore"`）として書く。
在庫が先端と同じなら書かない。書き込みは `If-None-Match:*`（SDK が対応している場合）＋内容アドレス＋読み戻し一致で、上書きはしない。
書き込みに失敗すると `chain-write-failed` で失敗する（明示的に有効にした設定の失敗を隠さないため）。
既定（未設定または `false`）では書かない。その場合も (a)〜(d) の検証はそのまま行う。
**復元用の保護ストア認証情報は読み取り専用の可能性が高い。** 有効にするには `manifests-v2/` への PutObject 権限が必要。

## 4. 失敗理由コード（`RESOLUTE_JOB_FAILED` の `reason`）

秘密やデータは含まない固定の文字列だけを出す（許可リスト外の `reason` は出力しない）。

| reason | 意味 |
|---|---|
| `listing-incomplete` | 一覧のページングが不完全（最終ページなし、トークン欠落など） |
| `listing-invalid` | 一覧に不正なオブジェクト名・サイズ、または上限超過 |
| `inventory-missing-object` | 封印済み（anchor/チェーン）のオブジェクトが無い、または読み取り中に消えた |
| `inventory-modified-object` | 封印済みオブジェクトの SHA256 が変わった |
| `inventory-unknown-event` | 追加オブジェクトが復号・認証できない |
| `inventory-db-mismatch` | ストアと復元 DB の `protection_outbox` が食い違う（片方にしか無い／時刻不一致） |
| `inventory-changed` | 読み取り中にオブジェクトのメタデータが変わった |
| `chain-anchor-unreadable` | anchor manifest を読めない |
| `chain-anchor-invalid` | anchor manifest の SHA256 不一致・形式不正 |
| `chain-invalid` | チェーン manifest の改ざん・連鎖切れ・追記違反 |
| `chain-write-failed` | 新しいチェーン manifest の書き込み・読み戻しに失敗 |
| `protection-config` | 保護ストア設定・鍵・pin・バックアップ時刻の不足や不正 |

成功時の `RESOLUTE_RESTORE_OK` の `data_protection` は `source:"independent_online_chain"` になり、`chain` に
`linked_manifests` / `tip_height` / `objects` / `added_since_tip` / `newer_than_backup` / `extended` / `manifest_sha256` が入る（件数と SHA256 のみ）。

## 5. ステップ1: 書き込みを止めて現在の在庫を封印する（任意だが推奨）

`scripts/resolute/protection-maintenance.mjs` に再封印モードを追加した（既存の受け入れモードは空在庫しか受け付けない）。
anchor からのチェーンを検証し、現在の在庫が (a)(b)(d) を満たすことを確認して、`mode:"maintenance"` の新しいチェーン manifest を書く。
一覧は前後で完全一致を要求する（書き込み停止を前提にするため、増加も許さない）。DB とは突き合わせない（writer コンテナに DB 接続が無いため。DB 照合は週次復元で行う）。

ステップ2（V4 復元）はこの再封印が無くても動く（6b のイベントは DB 行があるため (c) で通る）。再封印は「この時点の在庫を追記のみの基点として固定する」ためのもの。

1. （読み取りのみ）現状確認: `resolute-api` の `RESOLUTE_PLAN_API_ENABLED` / `RESOLUTE_NOTIFICATION_API_ENABLED` が `true` でないこと、保護リトライのスケジュールが無いこと、6b／オーナーテスト用の一時サービスが停止済みであること、API にバケット直接の認証情報が無いこと（変数名のみ確認）。
2. 【本番変更・オーナー承認要】保護ゲートウェイ（writer サービス `9d9728c1-aeae-4b33-9654-fe869f42e928`）の `RESOLUTE_WRITER_ENABLED` を `false` にし、`RESOLUTE_WRITER_DISABLED` のログを確認する（これが書き込みの柵。ストアに書けるのはこのサービスだけ）。
3. 【本番変更・オーナー承認要】同サービスをこのブランチのコミットでデプロイし、一時的に次を設定して1回だけ実行する:
   - 開始コマンド: `node --experimental-strip-types scripts/resolute/protection-maintenance.mjs`
   - `RESOLUTE_MAINTENANCE_RESEAL=true`
   - `RESOLUTE_MAINTENANCE_WRITERS_FENCED=true`（手順1・2を確認したことの明示）
   - `RESOLUTE_MAINTENANCE_ANCHOR_SHA256=72f819a298d8f5365f0fcb404c80ea3fd48e1b5139ffebbd9830cdad92bace75`
   - `RESOLUTE_MAINTENANCE_ACCEPTANCE` は設定しない（両方 true だと停止する）。
   コードは project / environment / service ID と `RESOLUTE_WRITER_ENABLED=false` を検査し、違えば何もせず停止する。
4. 期待するログ: `RESOLUTE_CHAIN_RESEALED`（`manifest`=新しい SHA256、`previous`=anchor、`height`=1、`objects`、`added`）。
   失敗時は `RESOLUTE_MAINTENANCE_FAILED`。再実行の前に原因を調べる（在庫欠落・改ざんは事故として扱う）。
5. 【本番変更・オーナー承認要】一時変数（`RESOLUTE_MAINTENANCE_*`）を外し、開始コマンドを元に戻し、`RESOLUTE_WRITER_ENABLED` を手順2の前の値に戻す。ログで元の状態（LISTENING または DISABLED）を確認する。
6. pin の更新: **不要**。`RESOLUTE_PROTECTION_EVENTS_MANIFEST_SHA256` は anchor（72f819a2…）のまま残す。
   新しい manifest は anchor に連鎖するので、復元が自動的に最新として使う。値を差し替えると anchor の合成3件の DB 照合免除が外れて失敗するので変更しないこと。

## 6. ステップ2: V4 復元バンドルの作成と適用

本番の週次ジョブは、変数 `RESOLUTE_PROTECTED_JOB_V3_B64` のランチャー（fb7c4eda の3モジュールを内包）を実行している。
ランチャーは3つのファイル名（`backup.py` / `protection.py` / `protection_events.py`）ちょうどのマッピングと、その SHA256 を検査する。今回の変更はこの3モジュール内に収めた。V4 ではランチャーもリポジトリのテンプレートから作り直す（下記）。

### オフラインで作る（承認不要。本番に触れない）

```
python3 scripts/resolute/build-protected-bundle.py build --source scripts/resolute --out <作業ディレクトリ>
```

- `modules.json`（`{ファイル名: ソース}` の正規化 JSON）、`payload.b64`（gzip mtime=0 → base64）、`bundle.json`（`modules_sha256` と各ファイルの SHA256）を出力する。
- `modules_sha256` は `RESOLUTE_PROTECTED_BUNDLE_READY` が出す digest と同じ計算方法。fb7c4eda のソースから作ると記録済みの
  `8e9cae071117da8b293ea3d6c3c529b29b6ef8a7b57e3cabadecd82330590063` が再現する（2026-11-16 確認）。
- `check --payload <ファイル> --source <ディレクトリ>` で、取り出したペイロードとソースの一致を確認できる。

### ランチャー（V4 からリポジトリ管理）

V3 までのランチャー本体（ペイロードを取り出して `backup.py` を実行するラッパー）は Railway 変数にだけ置かれ、リポジトリに無かった。
本番変数を読まずに再現できるよう、V4 からはランチャーをリポジトリに置き、決定的に組み立てる（2026-11-16）。

- `scripts/resolute/protected-launcher.py`: テンプレート。定数 `COMMIT` / `EXPECTED_MODE` / `MODULES_SHA256` / `PAYLOAD` が空のままでは実行を拒否する（`launcher-unbuilt`）。
- `scripts/resolute/build-protected-launcher.py`: `git show <commit>:scripts/resolute/<3モジュール>` から `build-protected-bundle.py` と同じ正規化 JSON（同じ `modules_sha256`）を作り、そのままテンプレートに埋め込む。ランチャー全体を gzip（レベル9・mtime 0・ファイル名なし）してから base64 にしたものが変数の値になる（V3 までの「base64 のみ」より約 1/3 小さい）。

```
python3 scripts/resolute/build-protected-launcher.py --commit <モジュールのコミット SHA 40桁> --mode restore \
    --variable RESOLUTE_PROTECTED_JOB_V4_B64 --out <作業ディレクトリ>
```

出力は `launcher.py`、`launcher.py.gz`、`launcher.b64`（変数の値。改行なし1行）、`launcher.json`（`modules_sha256`・`launcher_sha256`・`value_sha256`・サイズ）、`start-command.txt`。同じ入力からは同じバイト列になる。

開始コマンドは現行のものから2点だけ変わる: 変数名が V4 になり、`base64 -d` の後に `| gunzip` が入る。gzip は Debian bookworm の必須（Essential）パッケージなので `postgres:18-bookworm` に最初から入っている（apt を待たずに展開できる）。

```
/bin/bash -c 'printf "%s" "$RESOLUTE_PROTECTED_JOB_V4_B64" | base64 -d | gunzip > /tmp/resolute_backup.py; timeout 900 /bin/bash -c "apt-get update -qq && apt-get install -y -qq python3 python3-boto3 python3-cryptography age >/dev/null && python3 /tmp/resolute_backup.py"'
```

変数の値の下限: 3モジュールのソースは gzip / bzip2 / xz のどれでも約 13.8〜14.6 KB にしかならず、base64 で約 18.4 KB 以上になる。モジュールのバイト列を変えずに 16 KiB 未満にはできない。

ランチャーの動作（`tests/test_resolute_protected_launcher.py` で確認）:

1. `RESOLUTE_BACKUP_MODE` が組み込んだモード（復元サービスは `restore`）と一致しなければ停止（`launcher-mode`）。日次バックアップ用に作る場合は `--mode backup` で別のランチャーにする。
2. ペイロードを展開し、`modules_sha256` の一致、モジュールがちょうど3つ（`backup.py` / `protection.py` / `protection_events.py`）であること、正規化 JSON であること、構文を検査する。どれかが違えば停止（`launcher-bundle`）。
3. `tempfile.mkdtemp`（0700）にファイルを 0600 で書き、書いたものを読み戻して digest を再確認する。
4. `RESOLUTE_PROTECTED_BUNDLE_READY`（`commit` = モジュールのコミット、`sha256` = `modules_sha256`、`modules` = 3、`mode`）を出す。
5. `runpy.run_path(backup.py, run_name="__main__")` で実行する。`sys.argv` は `[展開先/backup.py]`、環境変数はそのまま。監視の `/start`・`/fail` と `RESOLUTE_JOB_FAILED` は従来どおり `backup.py` の `entrypoint()` が出し、その終了コード（失敗時 1）をそのまま返す。
6. 成功・失敗にかかわらず一時ディレクトリを削除する。
7. ランチャー自身の失敗（`launcher-mode` / `launcher-bundle` / `launcher-extract`、`backup.py` が entrypoint に入る前に落ちた場合の `launcher-run`）では、`RESOLUTE_JOB_FAILED`（`error_type` と固定の `reason` のみ。例外文は出さない）を出し、`BACKUP_MONITOR_PING_URL` が `https://hc-ping.com` のときだけ `/fail` を送って 1 で終了する（`protection-export` モードでは送らない）。

注意: V3 のログのキー名は記録が無く、V4 の `RESOLUTE_PROTECTED_BUNDLE_READY` とキー名が同じとは限らない。本番確認はキー名ではなく値（コミット・digest）で行う。

### V4 の値（2026-11-16 に作成。a638c88f のモジュール）

- `modules_sha256`: `4656f8ba2d584965d15be6f22501796f435875a0a18231f1f9c6dc603c365ff6`（`protection.py` は fb7c4eda と同一。`backup.py`・`protection_events.py` が変更）
- このブランチのテンプレートから作った値（テンプレートやビルダーを変えると変わる）:
  - ランチャー（展開後の Python）SHA256 `c5bec004131fcd0e0941fc51ba286ff535852c16271a970fa65eabce5b408dc9`、58,180 bytes（gzip 16,332 bytes）
  - 変数の値 SHA256 `6ac91c1d54382134ea5b0e0bf658e166c724eae4e7d23c2568ad978bd8c0b19f`、21,776 bytes

### 適用手順

1. （オフライン）上のコマンドで V4 を作り、`launcher.json` の `modules_sha256` が上の値と一致することを確認する。
2. 【本番変更・オーナー承認要】`resolute-restore-check` に新しい変数 `RESOLUTE_PROTECTED_JOB_V4_B64` を追加し、開始コマンドの参照先を V4 に変える（V3 は戻し用に残す）。cron `0 0 * * 1` は変えない。
   日次 `resolute-backup` は backup モードのコードが変わっていないので V3 のままでよい。
3. （任意）【本番変更・オーナー承認要】自動追記を使う場合のみ: `manifests-v2/` に書ける保護ストア認証情報を用意し、`RESOLUTE_PROTECTION_CHAIN_WRITE=true` を設定する。
   使わない場合は何もしない（復元は検証のみ行い、基点は §5 の再封印で進める）。
4. 【オーナー操作】Run now（または次の月曜 00:00 UTC の定期実行を待つ）。スケジュールを変えて実行を作らないこと。
5. 本番ログで確認する: `RESOLUTE_PROTECTED_BUNDLE_READY`（`commit`=a638c88f… と `sha256`=4656f8ba…）と、同じ実行の `RESOLUTE_RESTORE_OK`（`data_protection.source=independent_online_chain`、`chain` の件数）。
   失敗時は `reason` を見て判断する。`inventory-db-mismatch` の場合、DB 行の無いイベントがストアにある（または逆）ことを意味するので、anchor 以外に DB を書かずに公開されたイベントが無いかを確認する。
6. 監視（hc-ping）の成功を確認する。

## 7. 安全性について残ること

- バックアップの `created_at`（`latest.json`）は認証されていない。改ざんされると (c) の「新しいイベント」の猶予が広がる。dump 自体の SHA256 検査は従来どおり。
- チェーン manifest は内容アドレスで上書きできないが、削除はストア権限で防ぐ前提（復元・アプリの認証情報に削除権限を与えない）。
- 再封印（ステップ1）は DB と突き合わせない。DB 照合は毎週の復元で行う。
