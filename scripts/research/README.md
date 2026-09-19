# 公式資料の取り込み・確認待ち管理

Python標準ライブラリのみを使う、編集作業用の手動コマンドです。取得記録は `/research/intake` の閲覧用画面へ出力できます。定期監視サービスではありません。追加契約・APIキーは不要です。

## 実行

プロジェクトのルートで実行します。

```sh
python3 scripts/research/monitor.py seed
python3 scripts/research/monitor.py discover NBIS
python3 scripts/research/monitor.py discover MU
python3 scripts/research/monitor.py check --limit 6
python3 scripts/research/monitor.py list
python3 scripts/research/monitor.py history
```

- `seed`：既存記事が参照する6件の公式資料を登録します。これは取得・承認済みの意味ではありません。
- `discover`：公式ニュース一覧のHTMLにある発表リンクを確認待ちに追加します。初回は過去資料も入ります。「取得候補」であって速報ではありません。ページ送りやJavaScript実行には未対応。
- リンクが0件、タイムアウト、HTTPエラーの場合は `degraded` / `error` と終了コード1を返します。「新着なし」「正常監視」と扱わないでください。
- `check`：未取得、次いで確認日時の古い順に最大20資料を取得します。SHA-256で重複・応答の変化を記録。本文はDBや公開リポジトリに保存しません。エラーでは最後に取得できたハッシュを保持します。
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

`/research/intake` は出力時点の記録を表示するページです。銘柄、取得状態、編集状態、資料名・URLで絞り込み、原文リンクと履歴を確認できます。DBの直接参照や自動更新は行いません。更新はexport後に通常の確認用デプロイを行います。

exportは明示した項目のみ出力し、担当者名・判断理由・原文本文を含めません。例外メッセージも分類コードに変換し、内部パスなどを除きます。公開リポジトリへ送る前に出力内容を確認してください。画面は共有可能な取得記録を扱うプレビューであり、編集用認証や公開操作は未実装です。

取得済みでも最新試行がエラーの場合は「取得エラー」を優先表示します。資料の発表日、初回検知日時、取得試行日時、記録の出力日時を区別します。出典名が未登録の資料はURL末尾から作った仮の資料名を表示し、原文の正式表題を確認した扱いにはしません。

過去の一覧取得記録は取得先URLが不明な場合nullです。以降の記録には実際の取得先URLを保存します。

## 保存と運用範囲

デフォルトは `.research-private/intake.sqlite`。Git管理から除外し、会員サイトから読み出しません。`--db /absolute/path/intake.sqlite` で永続ディスクを指定できます。ローカル状態なのでVercelの一時ファイルシステムでの常時運用には使わないでください。本番化には永続保存、バックアップ、実行環境、取得条件・間隔の確認が必要です。

実行ごとの通信は少数の直列リクエストです。自動リトライ・スケジュールは設定していません。これは編集用ツールであり、認証付き管理画面や改ざん耐性のある監査基盤ではありません。全履歴本文の保存、訂正内容の差分表示、自動数値抽出、AI要約、公開操作は未実装です。

## 検証

```sh
python3 -m unittest discover -s tests -p 'test_research_intake.py' -v
```

重複、変更後の再確認、古い判断の拒否、取得エラー、発表日不明、一覧の取得異常、外部URL拒否、再起動後の保持を検証します。
