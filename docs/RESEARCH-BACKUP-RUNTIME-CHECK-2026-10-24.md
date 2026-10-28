# 研究DBバックアップ専用実行環境の検証記録

構成・利用条件は[専用実行環境](../services/tech-phase-research-backup/README.md)を参照。

## 実コンテナ検証（2026-10-24 18:09 JST）

実装commit `15870fcd1a3a01f387a9902ae04bf91aa06172ef`、
[実行40080799523](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/40080799523)、
job120833761343がSUCCESS。実ログで以下を確認した。

- ビルドcontext転送22.99kB。生成image IDは
  `sha256:10f45c50c4537478964909ee78d75f757670614895575717aec7b58fda0e3260`。
- 09:09:13.179Z: UID10001、固定依存、同梱ファイル3件、初期無効状態の照合成功。
- 09:09:13.465Z: デフォルト起動が保存処理をせずexit1で終了。
- 09:09:13.821Z: ネットワークなし・root filesystem読み取り専用のコンテナで10テスト成功。

時刻は上記ログ行のみUTC（日本時間18:09）。検証用DBのWAL、暗号化、ダウンロードしたバイトの
隔離復元と異常系を固定依存で確認した。検査用イメージはGitHub runner内で作成したもので、
レジストリやR2へ保存していない。本番への配置や本番データ取得の証明ではない。

同じ実装commitの[全体CI40080799482](https://github.com/tech-phase-lab/tech-phase-lab/actions/runs/40080799482)もSUCCESS。
実ログでNode1,343件、Python2,629件、ビルド・型検査を確認（合計3,972件）。
別ジョブのPostgreSQL並行処理5件と署名付き保存・隔離復元経路1件も成功。
ローカルでも同じ全体検査、lint（エラー0・既存警告5）、compileall、差分検査が成功。
