# Railway外への復旧準備 — 2026-10-22

## 今回の範囲

契約・デプロイ・本番変数・DB・ジョブ時刻は変更しない。保存機能はOFFのまま。
OpenAI/X、DB管理用、3専用ロールのパスワードと対応変数はユーザーが変更済みと報告。
稼働環境への反映・実接続は未確認。完了済みの入力を再依頼しない。

最新リモート5a44a2f2を基点に隔離worktreeで準備。他担当のローカル8a7f801aを保持。

## 1. Node.js

公式2026-10-21修正版に合わせ、Node24のDockerベースを24.22.1、
Node22のベースと既存CIを22.23.4に固定。.nvmrcは24.22.1。
ローカル検証用24.22.1を公式配布物のSHA256照合後に使用する。
これはソース指定であり、稼働済みコンテナの更新証明ではない。
Vercelでは.nvmrcだけで修正版の稼働を保証できない。再開時に実行バージョンを確認する。
Docker Hubで両pinのactive状態とlinux/amd64配布を確認済み。
Dockerがローカルにないためイメージ取得・コンテナ起動は別途必要。
今後もセキュリティ更新ごとにpinを見直す。

https://nodejs.org/en/blog/vulnerability/october-2026-security-releases

## 2. 外部コピー（未稼働）

`scripts/resolute/mirror_backup.py` は、既存S3バックアップの暗号文とマニフェストを
外部S3互換保管先へコピーする一回限りの処理。DBアクセス・復号・削除は行わない。
元と先のチェックサム、サイズ、マニフェストreadbackを確認して初めて成功を返す。
破損時は成功を返さず、元バックアップを変更しない。通常ジョブには組み込まない。
同じendpointを拒否するが、別hostnameでも同一会社の場合があるため運用者が確認する。

候補はCloudflare R2 Standard。保管先を承認・作成した後にだけ設定する変数：

- `RESOLUTE_EXTERNAL_COPY_ENABLED=true`
- `MIRROR_SOURCE_ENDPOINT/BUCKET/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY`
- `MIRROR_DESTINATION_ENDPOINT/BUCKET/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY`

`/`区切りは各変数の接尾辞。値をリポジトリに書かない。専用実行環境で `pip install -r scripts/resolute/requirements-mirror.txt` を実行し、
`python3 scripts/resolute/mirror_backup.py` を実行する。
元の権限はlatest.jsonと対象dumpへのGetのみ、先は指定prefixへのPut/Getのみ。
削除権限、DB接続情報、復号鍵をこの処理へ渡さない。
保存先：`resolute/v1/external/<cipher_sha256>/backup.dump.age` とその `.json`。
latest.jsonは更新しない。古いバックアップのコピーを最新成功と取り違えないため、
原本manifestのcreated_atも復元採用前に確認する。

このコピーは**完全な復旧セットではない**。削除・通知停止履歴の外部保管と、
復元時の完全性検証は未実装・未接続。保管先がRailway内だけなら障害独立性はない。
変更履歴の外部保存・最新一覧・鍵を揃えるまでは顧客保存を有効化しない。
暗号文をコピーできても鍵は別保管が必要。既存Google/Evernoteの鍵保管は完了済み。

## 3. Render準備（未作成）

`infra/render/resolute-standby.yaml` はレビュー用Blueprint。
GitHubのcodex/research-preview、既存API Dockerfile、Singapore、最小有料compute、
自動デプロイOFF、保存・決済・AIジョブOFF。cronもDB自動作成も含まない。
Importすると初回デプロイと課金が始まるため、現段階ではImportしない。
これはRESOLUTE APIのみ。Tech Phaseニュース処理・フロントエンドの代替ではない。

先に独立したDBを作り、DB名resolute、専用resolute_api_reader、TLS証明書検証を満たす。
Railway管理用DB URLを入力しない。専用認証を作成し、既存の権限SQLをレビューして適用。
`/healthz` 200はDB復元や認証成功を保証しない。署名付き読み取りの受入検証が別途必要。
決済・外部AI・通知用の秘密は予備へコピーしない。

https://render.com/docs/blueprint-spec

## 4. 復旧訓練・切り替えの順序

1. 外部コピー成功、保存日時、暗号文SHA、manifest readbackを確認する。
2. 元のDB資格情報を一切渡さない隔離環境へ取得する。暗号文を元manifestのkeyへ
   配置した専用復元bucketを用意し、選んだmanifestをlatest.jsonとして固定する。
   最新でないものを自動選択しない。既存backup.pyはexternal/形式を直接読めない。
3. 復号・pg_restore・整合性確認に加え、削除/両通知停止履歴を完全な新規一覧から再適用。
   過去の空一覧や3件の検証一覧を本番復旧に使い回さない。不足時は停止する。
4. APIの認証・会員権限・読み取りを検証し、所要時間と復元可能な時刻を記録する。
5. 元の書き込み/ジョブが止まったことを確かめる。確認できなければ予備は読み取り専用。
   二重処理を防げない状態で決済・通知・保存を開始しない。
6. 入口切り替えは別途実施。Railway復旧後も自動で戻さず、差分を照合してから戻す。

復旧時間はまだ未測定。無停止や1時間以内の復旧を保証しない。
1時間ごとの外部コピーでも原本が日次なら復元時点は日次のまま。
1時間ごとの新規dump作成にはDB負荷と転送量の評価が必要。既存朝ジョブは変えない。

## 5. 費用・利用者の次の操作

まず登録なしでこの準備を検査する。契約前の目安（税/為替/超過等は別）：

- Render API 0.5c-512mb：月7ドル目安。
- 常時予備DBを持つ場合は別途。小型のAPI+DB合計13ドル例は最低構成の参考値で、
  PostgreSQL18互換性・容量・復元権限・負荷を満たすか未確認。購入候補として確定しない。
- R2 Standard：月10GB保管無料枠、超過0.015ドル/GB月。操作回数の課金もある。
  実行環境・Railway側転送・履歴保存費用は別。全体月額は未確定。
- このコピー処理は保持期間削除を行わない。日次なら30コピー/月、1時間ごとに新しい
  dumpなら720コピー/月として容量計算する。運用開始前に保管期間を設定する。

https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses
https://developers.cloudflare.com/r2/pricing/

利用者の操作は現在不要。外部アカウント作成と有料利用の案内は、必要構成・費用が
具体化してから一括で行う。現時点で外部保存/復元/待機環境の成功を主張しない。

## 検証記録

- Node24.22.1の配布アーカイブSHA256照合成功。
- lint：エラー0、既存警告5。Nodeテスト：1,323件成功。
- 外部コピー回帰テスト5件成功（破損原本・破損readback・不正metadata・同一endpoint拒否）。
- Render公式JSON SchemaでBlueprint検証成功。
- 合成認証情報だけでAPI実起動、health200、未認証401、決済停止503を確認。
  外部通信・DB接続・課金・メール・追加AI呼び出しなし。
- Python全体2,560件成功、合計3,883件成功。build、compileall、diff check成功。
- 外部保管サービスとの実通信・永続化、DB復元、Render実起動は未実施。
