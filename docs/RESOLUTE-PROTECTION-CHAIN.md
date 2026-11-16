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
ランチャーは3つのファイル名（`backup.py` / `protection.py` / `protection_events.py`）ちょうどのマッピングと、その SHA256 を検査する。今回の変更はこの3モジュール内に収めたので、ランチャーの構造はそのままで中身だけ差し替えられる。

### オフラインで作る（承認不要。本番に触れない）

```
python3 scripts/resolute/build-protected-bundle.py build --source scripts/resolute --out <作業ディレクトリ>
```

- `modules.json`（`{ファイル名: ソース}` の正規化 JSON）、`payload.b64`（gzip mtime=0 → base64）、`bundle.json`（`modules_sha256` と各ファイルの SHA256）を出力する。
- `modules_sha256` は `RESOLUTE_PROTECTED_BUNDLE_READY` が出す digest と同じ計算方法。fb7c4eda のソースから作ると記録済みの
  `8e9cae071117da8b293ea3d6c3c529b29b6ef8a7b57e3cabadecd82330590063` が再現する（2026-11-16 確認）。
- `check --payload <ファイル> --source <ディレクトリ>` で、取り出したペイロードとソースの一致を確認できる。

### ランチャーの差し替え（2026-10-20 と同じ方法）

1. （読み取りのみ）`resolute-restore-check` の `RESOLUTE_PROTECTED_JOB_V3_B64` を取得してデコードする（コードであって秘密ではないが、ほかの変数は読まない）。
   内包ペイロードを取り出し、`check --source`（fb7c4eda のソース）で一致を確認する。
2. 内包ペイロード・digest・コミット表示だけを、このブランチのコミット SHA と `build` の出力に置き換えて V4 ランチャーを作る。
   ローカルで runpy を差し替えた状態で実行し、展開されたモジュールがソースと一致すること、digest 不一致・モード不正を拒否することを確認する（ジョブ本体は実行しない）。
3. 【本番変更・オーナー承認要】`resolute-restore-check` に新しい変数 `RESOLUTE_PROTECTED_JOB_V4_B64` を追加し、開始コマンドの参照先を V4 に変える（V3 は戻し用に残す）。cron `0 0 * * 1` は変えない。
   日次 `resolute-backup` は backup モードのコードが変わっていないので V3 のままでよい。
4. （任意）【本番変更・オーナー承認要】自動追記を使う場合のみ: `manifests-v2/` に書ける保護ストア認証情報を用意し、`RESOLUTE_PROTECTION_CHAIN_WRITE=true` を設定する。
   使わない場合は何もしない（復元は検証のみ行い、基点は手順5の再封印で進める）。
5. 【オーナー操作】Run now（または次の月曜 00:00 UTC の定期実行を待つ）。スケジュールを変えて実行を作らないこと。
6. 本番ログで確認する: `RESOLUTE_PROTECTED_BUNDLE_READY`（このブランチのコミットと `modules_sha256`）と、同じ実行の `RESOLUTE_RESTORE_OK`（`data_protection.source=independent_online_chain`、`chain` の件数）。
   失敗時は `reason` を見て判断する。`inventory-db-mismatch` の場合、DB 行の無いイベントがストアにある（または逆）ことを意味するので、anchor 以外に DB を書かずに公開されたイベントが無いかを確認する。
7. 監視（hc-ping）の成功を確認する。

## 7. 安全性について残ること

- バックアップの `created_at`（`latest.json`）は認証されていない。改ざんされると (c) の「新しいイベント」の猶予が広がる。dump 自体の SHA256 検査は従来どおり。
- チェーン manifest は内容アドレスで上書きできないが、削除はストア権限で防ぐ前提（復元・アプリの認証情報に削除権限を与えない）。
- 再封印（ステップ1）は DB と突き合わせない。DB 照合は毎週の復元で行う。
