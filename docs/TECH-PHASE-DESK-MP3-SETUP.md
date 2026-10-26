# RIZEL'S DESK：MP3・M4A直接アップロード

2026-10-26のユーザー決定：直接アップロードはMP3とM4A音声。MP4はアップロードしない。動画はYouTubeにアップロードし、共有リンクを添付する。画像の既存URL添付は維持する。

## 実装

- 運営者専用のファイル選択。MP3・M4A、1ファイル50MiBまで。進捗表示、中止、送信中の公開・保存抑止。本文なしの音声投稿も可能。
- ブラウザーからR2の非公開バケットへ直接PUT。Vercelに音声本体を通さない。署名はContent-TypeとContent-Lengthを固定し15分で失効。
- アップロード後、サイズ・Content-TypeとMP3のLayer III連続フレームを確認。ID3タグは読み飛ばして確認。M4AはAAC/ALAC音声トラックのみ許可し、動画トラック・不正なコンテナを拒否する。メタデータを上限付きで検証する。通常ファイルは必要箇所のみ、断片化された録音では近接範囲を最大1MiB単位でまとめて取得する（その範囲の音声データを含む場合がある）。検査は形式の確認であり、全音声のデコード検証ではない。
- 仮ファイルを検証済みファイルにコピーする際、ETagを条件にして検査対象を固定する。仮PUT URLで公開用ファイルを上書きできない。
- 保存形式は `[audio](/api/research/desk-media/<uuid>.mp3 または <uuid>.m4a)`。署名付きURL自体を投稿本文に保存しない。
- PRO再生時は会員期限と、該当公開投稿に音声が添付されていることを確認する。運営者は投稿前の確認が可能。
- ファイルは非公開。再生時に最大1時間・会員期限以内のURLを発行する。発行済みURLは期限までは有効。投稿削除・添付削除後は新規URLを発行しない。保存済み音声ファイルの物理削除は自動化していない。
- 新規動画添付はYouTubeリンクのみ。既存投稿にある従来の外部メディアURLは壊さない。
- R2未設定時は「音声を添付」を無効にし「保存先の接続準備中」と表示する。実接続済みとは扱わない。

## 初期設定手順（2026-10-26に設定・再デプロイまで実施済み）

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

2026-10-26更新：ユーザー自身のブラウザで専用バケット `tech-phase-desk-audio` とAPIトークンを作成し、CORSを保存。Vercelの4環境変数をPreview / `codex/research-preview` に限定して設定済み。Preview再デプロイ `dpl_71jG7PTGtsyiQ61KpCz1b2Ypg1zw` はREADYを確認した。秘密値は記録しない。既存バックアップ用バケットには変更を加えていない。

`pending/` の1日削除は設定を案内済みだが保存完了画面は未確認。実ファイルのアップロード・iPhone再生・PRO/FREEの実接続受入確認は未実施。Railwayには接続しない。

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


## 2026-10-26 サイト内録音・ボイスメモ受け取りと誤投稿防止

- 投稿欄の「ここで録音」で音声のみを録音。M4A/AACのMediaRecorder対応を検出し、非対応ブラウザではファイル添付を案内する。マイク許可は明示操作で要求。画面が非表示になったら停止し、アンマウント・破棄ではマイクを解放する。10分の強制制限は設けない。
- 録音停止、ファイル選択、ボイスメモ読み込みではローカルの試聴候補を作るだけ。アップロードしない。「この音声を添付することを確認しました」にチェックし、「この音声を添付」を押して初めて既存のR2送信・形式検証に進む。
- 録音中・読み込み中・試聴候補あり・アップロード中は親画面の公開/保存を無効化。音声を含む公開または公開済み投稿の編集保存には別の公開確認ダイアログを必須にする。音声だけの投稿は引き続き可能。
- ボイスメモはiOSのWeb Share Target未対応を踏まえ、AppleショートカットでM4AをBase64化→固定識別子を付けて端末内クリップボードにコピー→サイトの確認画面を開く。設定手順は `public/desk-voice-memo-shortcut.html`。秘密キー・外部アップロード用API・公開権限の付与は不要。
- ページを開いただけではクリップボードを読まない。「ボイスメモから読み込む」のタップとSafariのペースト許可で受け取り、候補にするだけ。識別子・Base64・サイズを検証し、分割デコード。音声をURL/query/localStorageに埋め込まない。
- ブラウザ録音のfragmented MP4/AACをM4Aとして検証できるよう追加。全トラックを音声に限定し、moofが参照するトラックIDも検査する。動画MP4の受付は追加していない。
- ショートカットはユーザーのiPhoneにまだ作成していない。iPhone実機でのマイク許可・停止・試聴・貼り付けと、R2送信は別途受入確認が必要。ローカルテストやffmpeg生成AACの合格を実機確認済みとは扱わない。
