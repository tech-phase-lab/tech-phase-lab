# 最新ソースの外部保管・復元記録

## 18:44 JST — 専用実行環境の構成を含む追加保管

前回の保管後に追加した研究DBバックアップ専用Dockerfile、限定ビルドcontext、
オフライン検査CIと実検証記録を含むソースを追加保管した。
[実行40083100577](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/40083100577)、
job120840500429が成功。実ログ2026-10-24T09:44:16.3752930Zの
`SOURCE_EXTERNAL_UPLOAD_VERIFIED` で、実ダウンロード・認証付き復号・隔離Git復元と
正確なcommit/tree一致を確認した。

- commit: `acbef21610550180a3b7d0a4cc48843ddeaa43b5`
- tree: `c0c399672d4c938b66b07ffc6a803f4f7563e4a7`
- 管理ファイル1,886件、環境変数名208件（値は保管しない）。
- 暗号文20,439,068 bytes。
- SHA256: `805e2d0b31e12f1a88ddc9ca2e91d85cfbc5563707dfa4c9b1313a866ea8feac`
- object: `tech-phase/source/v1/acbef21610550180a3b7d0a4cc48843ddeaa43b5/805e2d0b31e12f1a88ddc9ca2e91d85cfbc5563707dfa4c9b1313a866ea8feac.aesgcm`

`source_restore_verified=true`、`external_storage_verified=true`、
`runtime_restore_verified=false`。同名 `.json` は完了manifest。
旧保存物は保持。既存鍵・バケットを使い、定期実行や本番設定は変更していない。
要求ファイルだけの変更で実行し、コード・CI定義は前回の検証済み状態を保持した。
今回、新たに全テストを実行済みとは主張しない。

専用実行環境は**構成ソースの保管済み**であり、完成イメージの保管済みではない。
[実コンテナの検証](RESEARCH-BACKUP-RUNTIME-CHECK-2026-10-24.md)と
[既存7イメージの保管](EXTERNAL-RUNTIME-BACKUP-2026-10-24.md)は、それぞれ別の証拠。
本番DB・履歴・設定値は未保管のまま。元DBへの接続経路がないため本番転送は未実施。
Railway接続、追加AI、メール、決済、保存ゲート、朝ジョブに変更なし。
次は元データを読める環境で実データを取得し、独立保管・隔離復元を確認する。
この追記自体は上記保管commitの後の記録であり、暗号文には含まれない。

## 14:51 JST — 復元検査・保存先制限の実装を保管

2026-10-24 14:51 JST。研究DBバックアップの隔離復元検査と保存先制限、
他担当のPRO台帳検査・企業関連図更新を含むソースを既存R2へ暗号化して保管した。
新しい鍵・バケット・スケジュールは作成していない。

## 実行と採用する保存物

- [実行40067863248](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/40067863248)、job120794789547が成功。
- ソースcommit: `dbeca8d83605a158d6deaed3d6e3d30652781eec`
- 復元tree: `ef448f7bfd7d4afd50750d071cb5ad7121f555ca`
- 管理ファイル1,880件、抽出した環境変数名208件。変数の値を保管したものではない。
- 暗号文サイズ20,428,828 bytes（約19.48 MiB）。
- 暗号文SHA256: `ffe615a1530eb62e45341c334df75b6e7ca915a7dfad55c285100e7d749be90b`
- object key: `tech-phase/source/v1/dbeca8d83605a158d6deaed3d6e3d30652781eec/ffe615a1530eb62e45341c334df75b6e7ca915a7dfad55c285100e7d749be90b.aesgcm`

実ログ2026-10-24T05:51:28.4805412Zの `SOURCE_EXTERNAL_UPLOAD_VERIFIED` で、
`source_restore_verified=true`、`external_storage_verified=true` を確認。
保存物の全バイトを取得し、認証付き復号と隔離Git復元後のcommit/tree照合まで実施した。
同名 `.json` は完了manifest。古い保存物の上書き・削除はしていない。
初期の `SOURCE_BUNDLE_RESTORE_OK` だけを外部保存成功の証拠にはしていない。

## 保管範囲の限界

`runtime_restore_verified=false`。この実行は最新ソースの保管・復元であり、
最新ソースからのコンテナ再作成や実行環境7対象の更新を行ったものではない。
以前の[実行環境の復元記録](EXTERNAL-RUNTIME-BACKUP-2026-10-24.md)は別commitの証拠。
本番DB、削除・通知停止履歴、プロバイダー設定値や本番の接続設定は今回の保存物に含まれない。
実データを全部保管できたとは判定しない。

元DBを読む接続経路は今回の実行環境では確認できず、Railway管理への再接続もしていない。
既存APIの公開スナップショットをDB全体の代わりに使わない。
本番データ転送は、元DBを読める環境と既存の鍵参照を確認できる段階で行う。
保存開始前の最新の書き込み停止・未処理キュー・完全な履歴一覧と隔離復元は引き続き必要。
保存ゲートOFF、使用済み `owner-key-check-2026-10-23` を維持。追加AI・決済・メールなし。

## 今回のコード検証

実装commit6208552fは、研究DBバックアップの接続先を既存R2バケットへ制限する。
[条件と限界](RESEARCH-BACKUP-RESTORE-GATE.md)を参照。別ホスト・別バケット等23条件を
SDK client作成前に拒否し、標準/EU/FedRAMPの12 URL形式を受け付ける。
バックアップ専用の固定依存環境で対象10テスト成功。
他担当の391777b4を統合したローカル検査でNode1,339件、Python2,629件、lint、build、
compileall、diff検査成功。lintは既存警告5、エラー0。
最初の統合Python検査では既存100ms通信テストが接続前に時間切れとなったが、
コード・制限時間を変えず、単独・関連14件・全2,629件の順に再検査して成功した。
その後の他担当19ff308eは保管要求に取り込んで保持。保管要求自体は文書1ファイルの変更。
実装の最初のCI40067285484は後続pushで取消されたため、成功実績として扱わない。
最新ソースのCIは[40067863196](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/40067863196)。
commit dbeca8d8でSUCCESS。実ログでNode1,343件（他担当の追加4件を含む）、
Python2,629件、ビルド・型検査の成功を確認。合計3,972件。
別ジョブのSandbox PostgreSQL並行処理・署名付き保存と隔離復元経路も成功。
この記録自体は検証対象commitの後に追加する文書であり、上記暗号文に含まれない。
