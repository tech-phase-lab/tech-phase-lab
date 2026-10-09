# YouTube コメント自動審査（投資家わたがしチャンネル用）

承認待ちのコメントを定期的にチェックし、公開・非公開を判定します。

- GitHub Actions で **2分おき** にチェックします（1回の起動で約55分間チェックを続け、次の回に引き継ぐ形で24時間見張ります）
- **NGワード**（初期値:「詐欺」「ドル箱」「ゼウス」）は AI を通さず文字一致で非公開にします。
  全角・半角、カタカナ・ひらがな、空白や記号の挟み込み（「ゼ ウ ス」「ド・ル箱」）も検出します
- **容姿への否定、誹謗中傷、スパム、勧誘、なりすまし、個人情報、NGワードの言い換え**は AI（OpenAI）が文脈を見て判定します
- **判断に迷うもの**は承認待ちのまま残し、メールなどで通知します（メール・Discord・LINE のいずれか）。YouTube Studio であなたが判断してください
- 投稿者のブロック（チャンネルから非表示）は自動では行いません

## 2つのモード

| モード | YouTube 側 | 通知 |
| --- | --- | --- |
| `suggest`（初期値） | 何も変更しない | 新着コメントすべての判定案（公開案・非公開案・要確認） |
| `auto` | 公開・非公開を自動で反映 | 要確認のコメントと、非公開にしたコメント（誤判定チェック用） |

最初の1〜2週間は `suggest` で判定のズレを確認し、問題なければ `auto` に切り替えるのがおすすめです。

---

## セットアップ手順

### 1. Google Cloud で YouTube API を使えるようにする

1. https://console.cloud.google.com/ でプロジェクトを新規作成
2. 「API とサービス」→「ライブラリ」で **YouTube Data API v3** を有効にする
3. 「OAuth 同意画面」を設定
   - ユーザーの種類: **外部**
   - スコープに `https://www.googleapis.com/auth/youtube.force-ssl` を追加
   - **公開ステータスを「本番環境」にする**（「テスト」のままだと7日ごとに連携が切れます。
     自分だけが使うので Google の審査は不要です。ログイン時に「確認されていないアプリ」と出たら「詳細」→「移動」で進めます）
4. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」
   - 種類: **ウェブ アプリケーション**
   - 承認済みのリダイレクト URI: `https://developers.google.com/oauthplayground`
   - 作成後に表示される **クライアント ID** と **クライアント シークレット** を控える

### 2. リフレッシュトークンを取得する

1. https://developers.google.com/oauthplayground を開く
2. 右上の歯車 →「Use your own OAuth credentials」にチェック → 1 で控えた ID とシークレットを入力
3. 左の入力欄に `https://www.googleapis.com/auth/youtube.force-ssl` と入力して「Authorize APIs」
4. **チャンネルを運営している Google アカウント（ブランドアカウントの場合はそのチャンネル）** でログインして許可
5. 「Exchange authorization code for tokens」を押し、表示された **Refresh token** を控える

### 3. チャンネル ID を確認する

https://www.youtube.com/account_advanced に表示される `UC` で始まる ID です。

### 4. OpenAI の API キーを作る

https://platform.openai.com/api-keys で「Create new secret key」を押して作成します（`sk-` で始まるキー）。
キーは作成時にしか表示されないので、その場で控えてください。API の利用には、Billing にクレジットが入っている必要があります。

### 5. 通知先を用意する（どれか1つ以上）

- **メール（Gmail）**: 送信に使う Google アカウントで2段階認証をオンにし、
  https://myaccount.google.com/apppasswords で「アプリ パスワード」（16文字）を作成する。
  普段のパスワードとは別の、このプログラム専用のパスワードです
- **Discord**: 通知用のチャンネルの「チャンネルの編集」→「連携サービス」→「ウェブフック」→「新しいウェブフック」→「ウェブフック URL をコピー」
- **LINE**: LINE Developers で Messaging API チャネルを作成し、「チャネルアクセストークン（長期）」と「あなたのユーザー ID」（チャネル基本設定の下部）を控え、作った公式アカウントを友だち追加しておく（無料プランは月200通まで）

### 6. GitHub に登録する

リポジトリの **Settings → Secrets and variables → Actions** で登録します。
このリポジトリは公開されているため、キー類は必ず **Secrets** に入れてください（Secrets の中身は外部から見えません）。

**Secrets**

| 名前 | 内容 |
| --- | --- |
| `YT_CLIENT_ID` | 1 のクライアント ID |
| `YT_CLIENT_SECRET` | 1 のクライアント シークレット |
| `YT_REFRESH_TOKEN` | 2 のリフレッシュトークン |
| `YT_CHANNEL_ID` | 3 のチャンネル ID |
| `OPENAI_API_KEY` | 4 の API キー |
| `GMAIL_USER` | メールの場合: 送信に使う Gmail アドレス |
| `GMAIL_APP_PASSWORD` | メールの場合: アプリ パスワード（16文字） |
| `MAIL_TO` | （任意）通知を受け取るアドレス。省略すると `GMAIL_USER` に届く |
| `DISCORD_WEBHOOK_URL` | Discord を使う場合 |
| `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_USER_ID` | LINE を使う場合 |

**Variables**

| 名前 | 内容 |
| --- | --- |
| `MODERATOR_ENABLED` | `true` にすると定期実行が始まる |
| `MODERATION_MODE` | `suggest`（初期値）または `auto` |
| `NG_WORDS` | （任意）NGワードをカンマ区切りで上書き。例: `詐欺,ドル箱,ゼウス,〇〇` |
| `IGNORE_BEFORE` | （任意）この日時より前のコメントは審査しない。初期値は導入日時 `2026-10-08T02:20:00+09:00` |
| `OPENAI_MODEL` | （任意）判定に使うモデル。初期値は `gpt-5.6-terra`。費用をさらに抑えたい場合は `gpt-5.6-luna` |

### 7. 動作確認して開始

1. **Actions** タブ →「YouTube comment moderator」→「Run workflow」で `dry_run` にチェックを入れて実行
   （YouTube の変更も通知もせず、承認待ちの件数と判定件数だけログに出ます。コメント本文はログに出しません）
2. `dry_run` なしで手動実行し、通知が届くことを確認
3. Variables の `MODERATOR_ENABLED` を `true` にすると、以降は自動で動きます

※ 定期実行（schedule）は GitHub の仕様で **main ブランチにマージされてから** 動き始めます。

---

## 調整したいとき

- **判定基準**: `src/classify.ts` の `SYSTEM_PROMPT` に書かれています。「こういうコメントは公開してほしい」などがあれば追記します
- **NGワード**: Variables の `NG_WORDS` を編集（コードの変更は不要）

## 注意点

- **止まったときのお知らせ**: 3回連続で失敗すると（6分ほど）、通知と同じメールに「⚠️ コメント審査が止まっています」と原因が届きます。
  同じ原因のお知らせは6時間に1回までです。Gmail の設定自体が原因のときはお知らせを送れないため、GitHub の「Run failed」メールで気づく必要があります
- GitHub の定期実行そのものは15〜30分遅れることがあるため、1回の起動の中でチェックを繰り返す作りにしています
- 返信コメントが承認待ちになっている場合、YouTube API の仕様上すべてを取得できない可能性があります。Studio でもときどき確認してください
- Actions のログは公開されるため、ログにはコメント本文や投稿者名を出さず、件数だけを出しています
- 「サギ」のようなカタカナ表記は「ウサギ」などに誤反応するため NGワードにはせず、AI の判定（言い換え検出）に任せています
- 費用の目安: OpenAI の利用料はコメント100件あたり数円〜数十円程度（モデルとコメントの長さで変わります）。GitHub Actions は公開リポジトリのため無料です

## ローカルで試す

```bash
cd scripts/youtube-moderator
npm install
# 上の Secrets と同じ名前の環境変数を設定してから
DRY_RUN=1 npm start
```
