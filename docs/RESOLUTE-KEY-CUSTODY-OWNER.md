# RESOLUTE 本番復旧鍵の保管手順

この手順は本番用の鍵を手元の端末で作り、GoogleパスワードマネージャーとEvernoteに分けて保管するためのものです。実行しても保存機能や決済は有効になりません。

## 実行できる環境

Python 3と、信頼できる配布元から導入した`age`・`age-keygen`が必要です。準備ツールはLinuxの実機で検証済みです。Windows標準のPythonでは停止します。Windowsで使う場合はWSL内のLinuxホームが候補ですが、WSLでの動作は今回未検証です。`/mnt/c`や共有・同期フォルダーでは実行しないでください。環境がない場合は、まだ以下を実行しないでください。

## 1. 手元で鍵を作る

確認済みブランチ`codex/research-preview`のリポジトリを開き、ターミナルで実行します。チャット側の作業環境ではなく、ご本人の端末を使います。

```sh
mkdir -m 700 "$HOME/resolute-key-custody"
python3 scripts/resolute/protection_keys.py prepare \
  --directory "$HOME/resolute-key-custody/production-20261020"
```

同名のフォルダーがある場合は上書きせず停止します。以前の鍵を削除してやり直さないでください。成功時は`locally-verified`と表示されます。この段階では保管先からの取り出しは未確認です。

## 2. 保管する

| 作成されたファイル | 入れる場所 |
| --- | --- |
| `google-recovery-identity.txt` | Googleの新規項目のパスワード欄。`AGE-SECRET-KEY-1`から始まる秘密鍵の行を保存 |
| `google-integrity-pins.json` | 同じGoogle項目のメモ欄。2つの確認値と項目名をそのまま保存 |
| `evernote-recovery-capsule.age` | Evernoteの新しい本番復旧用ノートに添付 |
| `local-preparation.json` | 手元の確認記録。保管完了を示すものではない |

以前の検証用項目は上書きしません。秘密鍵やGoogleの画面写真、作成フォルダー全体はチャットやEvernoteに送らないでください。

## 3. 閉じてから取り出す

GoogleとEvernoteを一度閉じて開き直します。Googleから秘密鍵と2つの確認値を再表示し、Evernoteから添付ファイルをダウンロードします。Googleから取り出した秘密鍵を手元の非公開ファイルに保存します。元の作成ファイルをそのまま使うだけではGoogleからの取り出し確認になりません。

次のコマンドのパスと確認値を置き換えて実行します。秘密鍵そのものをコマンドの引数に書かないでください。

```sh
python3 scripts/resolute/protection_keys.py verify \
  --capsule /非公開フォルダー/Evernoteから取り出したファイル.age \
  --identity /非公開フォルダー/Googleから取り出した秘密鍵.txt \
  --capsule-sha256 Googleから再表示したcapsuleSha256の値 \
  --key-fingerprint Googleから再表示したkeyFingerprintの値
```

成功時の表示は`{"state":"verified"}`です。共有するのはこの結果だけで構いません。秘密鍵は送らないでください。失敗した場合は保存機能を有効にせず、元の鍵一式を保持します。

本番への鍵の設定、保存機能の有効化、手元に残した鍵の整理は、この取り出し確認とは別の作業です。
