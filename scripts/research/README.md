# 公式資料の取り込み・確認待ち管理

Python標準ライブラリのみを使う、公式資料の検知・確認コマンドです。取得記録は `/research/intake` の閲覧用画面へ出力できます。22社一括実行と常駐監視サービスを実装し、確認用ブランチは永続SQLiteを持つ監視コンテナへ接続済みです。追加契約・APIキーは不要です。

## 実行

プロジェクトのルートで実行します。

```sh
python3 scripts/research/monitor.py seed
python3 scripts/research/monitor.py discover NBIS
python3 scripts/research/monitor.py discover MU
python3 scripts/research/monitor.py check --limit 6
python3 scripts/research/monitor.py refresh --output lib/research/intake-snapshot.json --check-limit 6
python3 scripts/research/monitor.py list
python3 scripts/research/monitor.py history
```

## 対象銘柄を増やす設定

`lib/research/providers.json` をPythonの取得処理とWeb表示で共用しています。現在22銘柄。会社名、分野、公式一覧またはRSSのURL、取得形式、許可ホスト、発表ページのパス規則を設定します。銘柄追加には設定と実際の取得確認が必要で、未検証の銘柄を取得成功に数えません。

RSS / Atomの取り込みを追加しました。フィードのリンクと見出しを取り込み、本文取得や編集上の確認とは分けて記録します。外部ホスト、カテゴリー一覧、コメントフィード等は規則に合わなければ取り込みません。XMLの外部定義・エンティティ宣言を拒否し、壊れたフィードは取得異常として扱います。見出しはプレーンテキストとして扱い、HTMLやスクリプトとして実行しません。

MRVLは、取得制限のある企業ニュース一覧ではなく、同社Investor Relationsが公開する公式RSSを優先します。RSSに失敗した場合はSEC EDGARの8-Kへ切り替えます。ANETは同社公式Press RoomのRSS、PLTRは同社公式サイトマップ内のpress-releasesだけ、VRTは同社ニュース画面が利用する公開JSON結果を使います。いずれも一般公開された公式経路で、アクセス制御の回避はしません。TSMは、企業Press CenterとSECが監視サーバーを拒否する場合に備え、台湾証券取引所（TWSE）の公式OpenAPI「上市公司每日重大訊息」で会社コード2330の重要開示を監視します。構造化応答が正常でTSMの当日開示が0件なら正常な0件として記録し、応答異常とは分けます。TWSE・SEC経路は重要開示の補完であり、製品ブログを含む企業ニュース全件の代替ではありません。

```sh
python3 scripts/research/monitor.py discover NVDA
python3 scripts/research/monitor.py discover AMD
python3 scripts/research/monitor.py check --ticker NVDA --limit 1
```

`refresh` で22社の一覧取得、指定数の本文確認、公開用JSONのアトミックな置換を一度に実行できます。常時運用は後述の `service.py` を使い、永続DBを持つ実行環境へ設置します。

- `seed`：既存記事が参照する6件の公式資料を登録します。これは取得・承認済みの意味ではありません。
- `discover`：公式ニュース一覧またはRSS / Atomにある発表リンクを確認待ちに追加します。初回は過去資料も入ります。「取得候補」であって速報ではありません。企業一覧に失敗して公式SEC経路へ切り替えた場合は `fallback` を返します。ページ送りやJavaScript実行には未対応。
- リンクが0件、タイムアウト、HTTPエラーの場合は `degraded` / `error` と終了コード1を返します。「新着なし」「正常監視」と扱わないでください。
- `check`：未取得、次いで確認日時の古い順に最大20資料を取得します。SHA-256で重複・応答の変化を記録し、スクリプトやナビゲーションを除いた要約用テキストを非公開SQLiteへ保存します。公開JSONには本文を含めず、形式・サイズ・抽出文字数だけを出します。エラーでは最後に取得できたハッシュを保持し、再試行時刻を指数バックオフで延ばします。
- `refresh`：22社を順に検知し、`--check-limit` 件まで本文を確認してから公開用JSONを一時ファイル経由で置換します。途中の壊れたJSONを画面が読むことを防ぎます。1社でも企業一覧と公式バックアップの両方が失敗すれば終了コード1です。
- HTMLの装飾・動的要素やPDFメタデータでもハッシュは変化します。`changed` は内容変更の候補であり、財務情報の訂正を意味しません。

公式原文を確認して、掲載候補として採用・保留・却下を記録できます。記録するのは資料の判断であり、要約や数値の正しさを自動認定するものではありません。

```sh
python3 scripts/research/monitor.py review '原文URL' 'listで表示されたsha256' held --reviewer '担当者の識別名' --reason '確認が必要な点'
```

判断は `approved` / `held` / `rejected`。担当者・理由・現在のハッシュが必要です。取得前、取得失敗中、古いハッシュでの承認は拒否します。取得内容が変わると `pending` に戻り、過去の判断を履歴に残します。**approvedでも会員ページへの公開は行いません。** 現状の掲載は既存の資料照合・コードレビュー・デプロイの手順です。

## 根拠付き日本語速報の安全ゲート

日本語要約と影響判定は、取得した原文の現在のSHA-256、要約根拠、影響根拠、確信度をまとめて非公開DBへ `draft` として保存します。根拠抜粋は現在の抽出本文に完全一致する必要があり、要約中の数値も根拠にない場合は保存を拒否します。`positive` / `negative` / `mixed` / `neutral` / `uncertain` は市場反応の保証ではなく、編集用の影響分類です。

```sh
python3 scripts/research/monitor.py draft-brief '原文URL' '現在のsha256' \
  --summary-ja '日本語の事実要約' --impact-label mixed --impact-ja '日本語の影響と未確認事項' \
  --confidence medium --summary-evidence '原文に完全一致する抜粋' --impact-evidence '原文に完全一致する抜粋'
python3 scripts/research/monitor.py review-brief '原文URL' '現在のsha256' approved \
  --reviewer '担当者の識別名' --reason '原文・数値・解釈を確認'
```

未承認の下書き、根拠抜粋、担当者名、判断理由は共有スナップショットへ出しません。人間が現在の原文ハッシュに対して承認した要約だけを共有スナップショットへ出しますが、この操作自体は会員配信を行いません。承認後に原文応答が変わった場合は自動的に `stale` へ戻し、再生成・再確認まで共有対象から外します。

MUの一覧からリンクを抽出できない場合は、公式発表のURLを確認して明示的に登録できます。

2026-09-19に、MUの一覧取得先を `https://www.micron.com/about/press/news` に変更しました。公式サイトのニュース一覧からIR記事11件のリンクを実取得。リンク先 `investors.micron.com` の本文取得は既存記事・追加記事ともHTTP 403のため未解決です。一覧取得に成功しても本文取得・速報配信ができたとは扱いません。

```sh
python3 scripts/research/monitor.py add MU 'https://investors.micron.com/news/press-release/確認した実際のパス'
```

発表日は既存資料のseedだけ引き継ぎます。新規候補の発表日は未確認のためnull。検知・取得日時を発表時刻に置き換えません。配信遅延や10秒達成率はまだ計算できません。

## 取得状況の確認画面

```sh
python3 scripts/research/monitor.py export --output lib/research/intake-snapshot.json
```

`/research/intake` は出力時点の記録を表示するページです。分野、銘柄、取得状態、編集状態、会社名・資料名・URLで絞り込み、20件ずつのページ切り替え、原文リンクと履歴を確認できます。会社ごとの「資料を表示」から銘柄を選べます。企業一覧からの直接取得とSECバックアップを分けて表示します。DBの直接参照や自動更新は行いません。更新はexportまたはrefresh後に通常の確認用デプロイを行います。

exportは明示した項目のみ出力し、担当者名・判断理由・原文本文を含めません。例外メッセージも分類コードに変換し、内部パスなどを除きます。公開リポジトリへ送る前に出力内容を確認してください。取得状況画面は共有可能な記録だけを扱い、原文・根拠・判断理由は別トークンで保護した `/research/review` から確認します。会員公開操作は未実装です。

取得済みでも最新試行がエラーの場合は「取得エラー」を優先表示します。資料の発表日、初回検知日時、取得試行日時、記録の出力日時を区別します。資料名は既存の照合済み名称、RSSまたは一覧のリンク文言、URL由来の仮名の順に表示します。取り込み時点で正式表題や内容の照合を終えた扱いにはしません。

過去の一覧取得記録は取得先URLが不明な場合nullです。以降の記録には実際の取得先URLを保存します。

## 保存と運用範囲

デフォルトは `.research-private/intake.sqlite`。Git管理から除外し、会員サイトから直接読み出しません。`--db /absolute/path/intake.sqlite` で永続ディスクを指定できます。Vercelの一時ファイルシステムには保存せず、下記の常駐監視サービスで永続ボリュームを使用します。

手動コマンドは直列取得です。常駐監視サービスは銘柄ごとに並列取得し、公式経路を銘柄ごとに通常3〜5秒間隔で巡回します。TSMのTWSE重要開示は3秒です。この値は巡回要求の基準間隔であり、発表から画面反映までの保証時間ではありません。監視画面では、公式経路の直近応答時間と、新着URLの検知から本文取得完了までを別々に実測します。発表元が秒単位の公開時刻を提供しない資料は、公開から検知まで未計測と明記します。ETagまたはLast-Modifiedを返す取得先には条件付きリクエストを送り、変更がなければ本文を再転送しません。取得失敗時だけ基準間隔の2倍、4倍と自動的に間隔を延ばし、最大5分で再試行します。初回の過去資料は基準データとして保存し、2回目以降に初めて現れた公式URLだけを新着イベントとして記録します。原文本文は新着を優先して別キューで自動取得し、成功後は15分、失敗後は1分から最大6時間のバックオフで再確認します。公開JSONへ本文は出しません。訂正内容の意味差分、自動数値抽出、会員公開操作は未実装です。日本語要約は根拠付き下書きと人間承認の安全ゲートまで実装済みで、自動生成・自動配信は未接続です。

## 常駐自動監視

`service.py` は起動後、自分で22社を巡回し続けます。SEC・公式RSSは通常3秒、企業HTML一覧は通常5秒です。新しいURLまたは取得状態の変化があった時だけSQLiteと公開用スナップショットを更新します。初回巡回は過去資料の基準作成に使い、新着件数や速報欄には入れません。5社のSEC経路では、Atomより高速なSEC Submissions JSONを優先し、8-Kまたは6-Kだけを抽出します。本文取得は新着イベントを最優先し、その後に未取得・確認時刻の古い資料を少量ずつ処理します。

```sh
RESEARCH_API_TOKEN='共有トークン' python3 scripts/research/service.py
```

HTTP APIは `/health`、`/snapshot`、`/live`。`/snapshot` と `/live` は `RESEARCH_API_TOKEN` を設定した場合にBearer認証が必要です。サイト側の `/api/research/live` がトークンをサーバー内だけで使用し、ブラウザーには渡しません。監視サービスが未接続または停止中なら、画面は保存済みスナップショットへ安全に戻ります。

編集用APIは `/admin/briefs`、`/admin/briefs/draft`、`/admin/briefs/review`。別の `RESEARCH_EDITOR_TOKEN` が設定されている時だけ有効になり、未設定なら必ず拒否します。`/research/review` はトークンをURL・Cookie・ローカル保存へ入れず、そのタブのメモリ内だけで使います。原文抽出テキストと根拠抜粋はこの認証済み経路でだけ取得し、公開スナップショットへは出しません。承認操作は公開候補の状態を記録しますが、会員通知・メール・SNS配信は実行しません。

`Dockerfile.research-monitor` は常駐サービス用です。デプロイ先では `/data` に永続ボリュームを接続し、以下を設定します。

- `RESEARCH_API_TOKEN`：長いランダム値
- `RESEARCH_EDITOR_TOKEN`：公開APIとは別に生成した長いランダム値。編集用APIは未設定時に無効
- `RESEARCH_FAST_POLL_SECONDS`：標準3秒、最低3秒
- `RESEARCH_STANDARD_POLL_SECONDS`：標準5秒、最低5秒
- `RESEARCH_REQUEST_TIMEOUT_SECONDS`：標準20秒。巡回間隔とは別で、遅い公式サイトを誤って障害扱いしないための上限
- `RESEARCH_MAX_WORKERS`：標準8
- `RESEARCH_BODY_FETCH_INTERVAL_SECONDS`：本文取得キューの実行間隔。標準10秒、最低5秒
- `RESEARCH_BODY_FETCH_BATCH`：1回に取得する本文数。標準2件
- `RESEARCH_USER_AGENT`：運営サービス名と連絡可能な汎用メールアドレス。SEC等の自動アクセス方針に合わせて設定

Vercel側には監視サービスのHTTPS URLを `RESEARCH_MONITOR_URL`、同じトークンを `RESEARCH_MONITOR_TOKEN` として設定します。`/research/intake` は3秒ごとにAPIを確認し、接続中か保存済み記録かを明示します。

## 検証

```sh
python3 -m unittest discover -s tests -p 'test_research_intake.py' -v
```

重複、変更後の再確認、古い判断の拒否、取得エラー、発表日不明、一覧の取得異常、外部URL拒否、再起動後の保持、新着イベントの重複防止を検証します。
