# RIZEL'S DESK：MP3・M4A直接アップロード

2026-10-26のユーザー決定：直接アップロードはMP3とM4A音声。MP4はアップロードしない。動画はYouTubeにアップロードし、共有リンクを添付する。画像の既存URL添付は維持する。

## 実装

- 運営者専用のファイル選択。MP3・M4A、1ファイル50MiBまで。進捗表示、中止、送信中の公開・保存抑止。本文なしの音声投稿も可能。
- ブラウザーからR2の非公開バケットへ直接PUT。Vercelに音声本体を通さない。署名はContent-TypeとContent-Lengthを固定し15分で失効。
- アップロード後、サイズ・Content-TypeとMP3のLayer III連続フレームを確認。ID3タグは読み飛ばして確認。M4AはAAC/ALAC音声トラックのみ許可し、動画トラック・不正なコンテナを拒否する。メタデータのみ上限付きで読み、音声本体は転送しない。検査は形式の確認であり、全音声のデコード検証ではない。
- 仮ファイルを検証済みファイルにコピーする際、ETagを条件にして検査対象を固定する。仮PUT URLで公開用ファイルを上書きできない。
- 保存形式は `[audio](/api/research/desk-media/<uuid>.mp3 または <uuid>.m4a)`。署名付きURL自体を投稿本文に保存しない。
- PRO再生時は会員期限と、該当公開投稿に音声が添付されていることを確認する。運営者は投稿前の確認が可能。
- ファイルは非公開。再生時に最大1時間・会員期限以内のURLを発行する。発行済みURLは期限までは有効。投稿削除・添付削除後は新規URLを発行しない。保存済み音声ファイルの物理削除は自動化していない。
- 新規動画添付はYouTubeリンクのみ。既存投稿にある従来の外部メディアURLは壊さない。
- R2未設定時は「音声を添付」を無効にし「保存先の接続準備中」と表示する。実接続済みとは扱わない。

## 残る実接続設定（まだ実施していない）

1. CloudflareアカウントでR2の利用を開始する。無料枠超過分は従量課金。新たな契約・支払い設定はこの実装作業では行っていない。
2. DESK専用の非公開バケットを新規作成する（例 `tech-phase-desk-audio`）。既存のバックアップ保存先や認証情報を流用しない。公開URL / r2.devの公開を有効にしない。
3. 対象バケットだけのObject Read & Write権限を持つR2 APIトークンを作成。
4. Vercelの実アプリ `tech-phase-lab` に以下をサーバー専用環境変数として設定する。最初はPreviewのみ。秘密値をチャットやGitに貼り付けない。
   - `DESK_MEDIA_R2_ACCOUNT_ID`
   - `DESK_MEDIA_R2_BUCKET`
   - `DESK_MEDIA_R2_ACCESS_KEY_ID`
   - `DESK_MEDIA_R2_SECRET_ACCESS_KEY`
5. バケットCORSを設定。AllowedOriginsは実際に使うTech PhaseのURLのオリジンに置換。ワイルドカードではなく必要なオリジンだけ指定。

```json
[
  {
    "AllowedOrigins": ["https://REPLACE-WITH-TECH-PHASE-HOST"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 3600
  }
]
```

6. `pending/` のみに、1日で削除するライフサイクルルールを設定する。失敗・中止した送信の残骸を片付ける。`audio/` は自動削除しない。
7. 環境変数設定後にPreviewを再デプロイし、実MP3・ボイスメモM4Aの送信→音声だけで投稿→PRO再生・シーク→FREE拒否→投稿削除後の新規再生拒否を確認する。iPhone実機は別途確認。

Cloudflareログイン・R2作成・環境変数設定・実ファイル送信は未実施。Railway接続は不要で、この作業でも接続しない。

## 根拠

- R2料金：https://developers.cloudflare.com/r2/pricing/
- R2直接アップロード・期限付きURL：https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- R2開始手順：https://developers.cloudflare.com/r2/get-started/
- YouTube限定公開はリンクを知る人も閲覧可能：https://support.google.com/youtube/answer/157177?hl=ja

## 2026-10-26 M4A追加

- ボイスメモの通常の共有→「ファイルに保存」で書き出したM4Aを、変換せず添付する運用。
- 運営者は10分を超える音声を予定していない。これは運用方針であり、10分の強制制限は追加しない。上限は50MiBのまま。
- M4AはContent-Type audio/mp4で保存・再生するが、これは音声のMIMEであり動画MP4の受付ではない。
- 音声のみのAAC/ALAC生成ファイルでローカル検査が通ることと、実際の動画MP4を拒否することを確認。iPhone実録音・R2での実アップロードは接続後の確認項目。
