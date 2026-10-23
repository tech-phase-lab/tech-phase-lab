> 2026-10-23 22:13 JST: 実際のR2取得・復元・通信遮断下のAPI起動を確認。
> [確認記録と未検証範囲](EXTERNAL-API-DEPENDENCY-BACKUP-2026-10-23.md)。

# RESOLUTE API専用ライブラリの外部保管と起動検査

フロントエンド用の保管物とは別に、`services/resolute-api/package-lock.json`を
基準とするnpm依存を暗号化保管する。既存の保管先・復旧鍵・4つのGitHub Secretsを
再利用し、鍵の再生成・入力やRailwayへの接続は行わない。

## 検証の流れ

`.github/workflows/api-dependencies-external-backup.yml`は専用ワークフローまたは
`docs/api-dependencies-backup-request.txt`の変更時だけ起動する。定期実行は追加しない。

1. Dockerfileと同じNode `24.22.1`でAPI専用の`npm ci --omit=dev --ignore-scripts`を実行。
   この工程にはバックアップの認証情報を渡さない。
2. API依存と同一コミットのソースを梱包し、秘密を扱う工程でAES-256-GCM暗号化して保存。
3. R2から暗号文を全体ダウンロードし、サイズ・SHA-256・認証タグ・lockハッシュ・
   Node/ABI/OS/libc・ファイル一覧を照合して新しいフォルダに復元する。
4. 秘密を渡さない別工程でクリーンなソースを展開し、復元したAPI依存だけを配置。
   Dockerfileと同様、APIの依存はソースのルートにある`node_modules`へ置く。
5. `unshare --net`で外部通信を遮断し、`verify_api_recovery.mjs`を実行する。
   検査プロセスは本番の環境変数を引き継がず、試験用の設定だけで子プロセスを起動。
   子プロセスの外向き接続とfetchも即座に失敗させる。禁止が動くこと自体も検査する。
6. 無効状態のRIZELワーカーを読み込み、実APIの起動と`/healthz`の200を確認。
   会員権限・投資ルール・通知設定・AI確認の未認証GETは401、決済2経路は503を要求。
   APIの正常終了も確認してから成功記録を出す。

成功を判定する実出力は`SOURCE_EXTERNAL_UPLOAD_VERIFIED`、
`DEPENDENCIES_EXTERNAL_RESTORE_OK`、`API_RESTORED_BOOT_OK`、
`API_EXTERNAL_OFFLINE_BOOT_OK`。設定一致やデプロイSUCCESSだけでは成功にしない。
実施済みの結果は別途、実行ID・コミット・暗号文ハッシュとともに記録する。

## 対象外と次の段階

この検査はAPIを復元して起動できることと、未認証アクセス・無効決済の拒否まで。
本番の認証、DB接続、顧客データの保存、通知、決済、AI実通信は検査しない。
起動用Node実行ファイルとコンテナイメージ自体も依存アーカイブには含まれない。
実装しただけではR2保存・実復元の成功として扱わない。

本番DBと履歴保管は、新しい完全な書き込み停止下の一覧を確認してから、
実保存と隔離復元を検証する。初期の空一覧は流用しない。保存機能のゲートは無効のまま。
既に消費済みのAI診断の実行記録を保持し、追加の実呼び出しは行わない。

決済専用依存、Python依存、DB・履歴の復旧確認は別作業。
[Renderの待機環境計画](RENDER-STANDBY-PLAN.md)へ引き継ぎ、課金・契約変更は行わない。
