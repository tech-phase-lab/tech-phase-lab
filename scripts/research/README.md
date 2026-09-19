# 公式資料の取り込み・確認待ち管理

Python標準ライブラリのみを使う、公式資料の検知・確認コマンドです。取得記録は `/research/intake` の閲覧用画面へ出力できます。22社一括実行には対応していますが、定期実行サービスへの設置はまだ行っていません。追加契約・APIキーは不要です。

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

ANET・TSM・VRT・PLTR・ORCLは、企業公式ページが403、タイムアウト、動的表示などで取得できない場合に限り、SEC EDGARの会社別8-K／6-K Atomを公式バックアップとして使います。企業公式一覧を優先し、バックアップで取得した実行は `fallback` と明示します。SEC経路は重要開示の補完であり、製品ブログを含む企業ニュース全件の代替ではありません。

```sh
python3 scripts/research/monitor.py discover NVDA
python3 scripts/research/monitor.py discover AMD
python3 scripts/research/monitor.py check --ticker NVDA --limit 1
```

全銘柄一括の定期ジョブは設定していません。`refresh` で22社の一覧取得、指定数の本文確認、公開用JSONのアトミックな置換を一度に実行できます。常時運用は永続DBと実行環境を決めてから設置します。

- `seed`：既存記事が参照する6件の公式資料を登録します。これは取得・承認済みの意味ではありません。
- `discover`：公式ニュース一覧またはRSS / Atomにある発表リンクを確認待ちに追加します。初回は過去資料も入ります。「取得候補」であって速報ではありません。企業一覧に失敗して公式SEC経路へ切り替えた場合は `fallback` を返します。ページ送りやJavaScript実行には未対応。
- リンクが0件、タイムアウト、HTTPエラーの場合は `degraded` / `error` と終了コード1を返します。「新着なし」「正常監視」と扱わないでください。
- `check`：未取得、次いで確認日時の古い順に最大20資料を取得します。SHA-256で重複・応答の変化を記録。本文はDBや公開リポジトリに保存しません。エラーでは最後に取得できたハッシュを保持します。
- `refresh`：22社を順に検知し、`--check-limit` 件まで本文を確認してから公開用JSONを一時ファイル経由で置換します。途中の壊れたJSONを画面が読むことを防ぎます。1社でも企業一覧と公式バックアップの両方が失敗すれば終了コード1です。
- HTMLの装飾・動的要素やPDFメタデータでもハッシュは変化します。`changed` は内容変更の候補であり、財務情報の訂正を意味しません。

公式原文を確認して、掲載候補として採用・保留・却下を記録できます。記録するのは資料の判断であり、要約や数値の正しさを自動認定するものではありません。

```sh
python3 scripts/research/monitor.py review '原文URL' 'listで表示されたsha256' held --reviewer '担当者の識別名' --reason '確認が必要な点'
```

判断は `approved` / `held` / `rejected`。担当者・理由・現在のハッシュが必要です。取得前、取得失敗中、古いハッシュでの承認は拒否します。取得内容が変わると `pending` に戻り、過去の判断を履歴に残します。**approvedでも会員ページへの公開は行いません。** 現状の掲載は既存の資料照合・コードレビュー・デプロイの手順です。

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

exportは明示した項目のみ出力し、担当者名・判断理由・原文本文を含めません。例外メッセージも分類コードに変換し、内部パスなどを除きます。公開リポジトリへ送る前に出力内容を確認してください。画面は共有可能な取得記録を扱うプレビューであり、編集用認証や公開操作は未実装です。

取得済みでも最新試行がエラーの場合は「取得エラー」を優先表示します。資料の発表日、初回検知日時、取得試行日時、記録の出力日時を区別します。資料名は既存の照合済み名称、RSSまたは一覧のリンク文言、URL由来の仮名の順に表示します。取り込み時点で正式表題や内容の照合を終えた扱いにはしません。

過去の一覧取得記録は取得先URLが不明な場合nullです。以降の記録には実際の取得先URLを保存します。

## 保存と運用範囲

デフォルトは `.research-private/intake.sqlite`。Git管理から除外し、会員サイトから読み出しません。`--db /absolute/path/intake.sqlite` で永続ディスクを指定できます。ローカル状態なのでVercelの一時ファイルシステムでの常時運用には使わないでください。本番化には永続保存、バックアップ、実行環境、取得条件・間隔の確認が必要です。

実行ごとの通信は少数の直列リクエストです。自動リトライ・スケジュールは設定していません。これは編集用ツールであり、認証付き管理画面や改ざん耐性のある監査基盤ではありません。全履歴本文の保存、訂正内容の差分表示、自動数値抽出、AI要約、公開操作は未実装です。

## 検証

```sh
python3 -m unittest discover -s tests -p 'test_research_intake.py' -v
```

重複、変更後の再確認、古い判断の拒否、取得エラー、発表日不明、一覧の取得異常、外部URL拒否、再起動後の保持を検証します。
