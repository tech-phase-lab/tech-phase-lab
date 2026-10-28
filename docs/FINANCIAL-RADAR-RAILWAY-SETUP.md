# Railway画面からの本番作成手順

既存会員・決済サービスを変更せず、専用のAPIサービスを1つ追加する。
最初にその専用サービスを一度だけDB作成ジョブとして動かし、管理者資格情報を
削除してから通常のAPIに切り替える。追加サービスのRailway利用料は発生し得る。
CodexからRailwayへ接続しない。以下はユーザーによる画面操作用。

**最初の確認：既存Tech PhaseのPostgreSQLが入っているプロジェクトと環境を開く。**
ニュース用research-stagingを本番DBと決めつけない。DBの実名は未確認のため、
既存DBの接続文字列のパス（最後の / の後、? より前）と照合して指定する。
接続文字列やパスワードはチャットに送らない。

## 1. 専用サービスを準備

1. プロジェクト画面右上の `New` → `Empty Service` を選ぶ。
2. 新しいサービスの名前を `tech-phase-financial-radar` にする。
3. サービスの `Settings` → `Source` → `Connect Repo` で
   `tech-phase-lab/tech-phase-lab` を選ぶ。ブランチは必ず `codex/research-preview`。
   既存サービスの接続先やmainは変更しない。
4. Root Directoryはリポジトリ直下（空欄または /）。
5. `Variables` → `New Variable` で次を追加する：
   `RAILWAY_DOCKERFILE_PATH` = `services/financial-radar/Dockerfile`
6. `Settings` のデプロイ地域は既存PostgreSQLと同じ地域にする。
   同じプロジェクト・同じ環境でなければ内部ネットワークにはつながらない。
7. `Settings` の自動デプロイを `Disable` にする。DB作成中の誤再実行を防ぐ。
   初回の自動ビルドが先に走っても、認証・DB設定が不足していればAPIは起動しない。

## 2. テーブルと専用ユーザーを一度だけ作成

サービスの `Variables` → `New Variable` で、次を追加する。

| Key | Value |
|---|---|
| TECH_PHASE_RADAR_DATABASE_NAME | 確認した既存DBの実名 |
| TECH_PHASE_RADAR_PROVISION_DATABASE_URL | 同DBの所有者/管理者の内部接続URL。ここだけ一時的に使用 |
| TECH_PHASE_RADAR_DB_PASSWORD | パスワード管理アプリで生成した32〜128文字の英数字。新しい専用ユーザーのパスワード |
| TECH_PHASE_RADAR_PROVISION_CONFIRM | create-financial-radar-only |

新規パスワードはパスワード管理アプリに保存し、チャットには送らない。
DBサービスが管理者の内部DATABASE_URLを提供している場合は、その値を使用できる。
ただしURL内のDB名が既存Tech Phaseの対象DBと一致していることを確認する。
既存サービスに設定済みの制限付き会員用URLを管理者URLとして流用しない。

1. `Settings` → `Deploy` → `Custom Start Command` に次を入れる：
   `node services/financial-radar/provision.mjs`
2. `Restart Policy` は `Never`。Healthcheck Pathはこの段階では空欄。
3. 変更内容を確認して `Deploy` を押す。
4. `Deployments` → 今のデプロイ → ログを開く。
   **`RADAR_PROVISIONED` と正常終了**が出ればテーブルと専用ユーザー作成成功。
   `RADAR_PROVISION_FAILED` の場合は繰り返し実行しない。トランザクションはロールバックする。
   既に同名ユーザーがある場合も意図的に中止する。既存ユーザーのパスワードは変えない。
5. 成功したら次の3変数を専用サービスから削除する：
   `TECH_PHASE_RADAR_PROVISION_DATABASE_URL`、`TECH_PHASE_RADAR_DB_PASSWORD`、
   `TECH_PHASE_RADAR_PROVISION_CONFIRM`。
   既存DBや既存サービスの変数は削除しない。

## 3. 通常APIへ切り替え

1. `Variables` に次を追加する。

| Key | Value |
|---|---|
| TECH_PHASE_RADAR_DATABASE_URL | 下の専用ユーザー接続URL |
| TECH_PHASE_RADAR_WRITE_TOKEN | パスワード管理アプリで生成した英数字32文字以上。保存専用 |
| TECH_PHASE_RADAR_READ_TOKEN | WRITEとは別の英数字32文字以上。読取専用 |

接続URLの形式：
`postgresql://tech_phase_radar_writer:専用パスワード@DB内部ホスト:5432/確認したDB名`

DB内部ホストとポートは既存DBの内部URLと同じものを使う。
`TECH_PHASE_RADAR_DATABASE_NAME` はそのまま残す。
外部ホストに切り替える場合はTLS証明書の検証が必要。TLS検証無効で回避しない。

2. `Settings` → `Deploy` → `Custom Start Command` を次に置き換える：
   `node services/financial-radar/server.mjs`
3. `Healthcheck Path` に `/livez`。`Restart Policy` は `On Failure`。
4. `Deploy`。ログの **`RADAR_API_READY`** を確認する。
5. `Settings` → `Networking` → `Public Networking` → **`Generate Domain`**。
   ポートを求められたら `3000` を指定。発行されたHTTPS URLをコピーする。
   このURLは秘密ではないのでClaude/Codexへ共有できる。

## 4. Claude側の設定

VercelなどClaude側のサーバーに、`TECH_PHASE_RADAR_API_URL`（上で発行したURL）、
`TECH_PHASE_RADAR_WRITE_TOKEN`、`TECH_PHASE_RADAR_READ_TOKEN` を設定する。
2つのトークンはRailwayに保存したものと同じ値。DB接続文字列はClaude側へ渡さない。
Vercel本番ならProductionのみを対象にし、Secretはトークン2つに使用する。
既存のRESEARCH_MONITORやCLERK、PayPalの値とは別の設定。

API仕様と実際の疎通確認は `FINANCIAL-RADAR-API-HANDOFF.md` を参照。
DB適用・本番起動・実URLでの認証付き保存読取を確認して初めて完了とする。

公式操作説明（2026-10-28確認）：
- https://docs.railway.com/services
- https://docs.railway.com/variables
- https://docs.railway.com/deployments/start-command
- https://docs.railway.com/deployments/restart-policy
- https://docs.railway.com/deployments/github-autodeploys
