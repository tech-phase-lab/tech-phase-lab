# Cloudflareの共有ブラウザログインを使わず保管する

Googleログインはユーザーのブラウザでは成功。共有ブラウザではCloudflareの
`Unable to sign in` が表示された。根本原因は未確定。登録方法の再質問や同じ
Googleログインの繰り返しはしない。GitHub Actionsから既存R2へ接続する。

## 一度だけ行う登録

GitHubのtech-phase-lab/tech-phase-labを開き、Settings → Secrets and variables →
Actions → New repository secret。Nameに左列、Secretに右列の内容を入力する。
GitHubに保管してバックアップ実行時に使用する。コードやチャットには貼らない。

| Name | Secretに入れる内容 |
|---|---|
| MIRROR_DESTINATION_ENDPOINT | 保存済みのR2 S3 endpoint（https://から始まるURL） |
| MIRROR_DESTINATION_ACCESS_KEY_ID | 保存済みのR2 Access Key ID |
| MIRROR_DESTINATION_SECRET_ACCESS_KEY | 保存済みのR2 Secret Access Key |
| TECH_PHASE_EXTERNAL_KEY_HEX | 新しい外部バックアップ暗号鍵。下記の方法で生成・独立保管した64文字 |

バケット名はresolute-backup-external、regionはautoで設定済み。
R2のキーやバケットを新しく作り直す必要はない。

## 今回初めて作る外部バックアップ暗号鍵

`tools/recovery/create-external-backup-key.html`をダウンロードし、パソコンの
ブラウザで開く。「新しい鍵を1つ作る」を押し、表示された64文字を保管先へ
「Tech Phase外部バックアップ暗号鍵（TECH_PHASE_EXTERNAL_KEY_HEX）」という名前で
保存する。同じ64文字をGitHub Secretへ登録する。生成画面はネットワークへ送信
せず、鍵を永続保存しない。閉じる前に必ず独立保管する。既存のRESOLUTE復旧鍵、
DBパスワード、R2アクセスキーとは別。既存の鍵を上書き・再生成しない。

## 実行と確認は担当エージェントが行う

初回はSecrets不足でBACKUP_NOT_STARTEDと停止する。登録完了後、GitHubアプリで
失敗ジョブを再実行できる。再実行は元のcommitのソースを保管するため、実行対象
SHAを確認する。新しい版の保管はcodex/research-previewの
`docs/source-backup-request.txt`を明示的に変更して開始する。mainには変更しない。
通常のソース変更では起動せず、定期実行も設定しない。

成功条件はSOURCE_EXTERNAL_UPLOAD_VERIFIEDと、ダウンロードした暗号文からの
Git復元成功。ジョブ成功表示のみで判断しない。実行レポートのcommit/tree/key/
sha256を記録する。ソース以外の本番DB・Clerk・PayPal・設定値・削除履歴の
完全復元を成功扱いしない。Secrets登録だけでは保管完了ではない。

準備段階の検証はローカルと模擬ストレージで実施。実R2転送は未実施。
