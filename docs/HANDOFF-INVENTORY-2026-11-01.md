# ChatGPT(Codex) からClaudeへの引き継ぎ一覧 — 2026-11-01

作成: Claude。根拠は `docs/` と `AGENTS.md` の記載。本番の実状態は確認できていないものを「未確認」と明記する。
オーナーの決定(2026-11-01): ChatGPTは使わず、Claudeが全体を担当する。Railwayは公式コネクタ経由で、本番を変える操作は毎回オーナーの承認を取る。

## 1. Claude側(画面)で未対応の項目 — ChatGPTが引き継ぎ済み

出典: `docs/RESOLUTE-OWNER-MFA-FOLLOWUP-2026-10-31.md`

| # | 項目 | 状態 |
| --- | --- | --- |
| 1 | RESOLUTEの権限APIが `OWNER_MFA_REQUIRED`(403) を返したとき、通常の通信エラーと分けて、今のセッションで2段階認証を完了する導線を出す | 未対応 |
| 2 | 認証が済んだあと、新しいセッションで権限を取り直す | 未対応 |
| 3 | 運営者の表示モード切替(FREE/PRO)のとき、RESOLUTEの端末内の利用権キャッシュを破棄して取り直す(古い「購入済み」が残るとLPへ即座に切り替わらない) | 未対応 |
| 4 | 運営者で `accessBasis: owner` の初回アクセスは、診断への誘導をせず、RESOLUTEのホームを開く(今のEntryGateは初回・保存ルールなしなら診断へ移動する) | 要確認・未対応 |
| 5 | 運営者がMFAを通過した新しいセッションで、ホーム・診断・シミュレーション・アラート・朝のひとこと・温度計・税金・ノート、保存と再読込が動く確認 | 未確認(実ログインが必要) |

## 2. お金まわり(PayPal / 課金)

| 項目 | 状態 | 出典 |
| --- | --- | --- |
| 本番の受け入れ確認 | ドメインなど準備待ち。AGENTSに「インフラ/ドメイン準備待ち」とある | `AGENTS.md` |
| 有料会員のバックアップからの復旧 | 本番の決済は0件のデータでの確認のみ。有料会員を戻せる証明にはならない | 2026-11-01の復元確認 |
| 本番の購入のテスト | 実施済みの購入は繰り返さない(AGENTSの指示) | `AGENTS.md` |
| 突き合わせで見つかった「PayPal側に存在しない申込み1件」 | 保存したまま。確認待ち(支払い・解約の証拠ではない) | `docs/LIVE-RECOVERY-INCIDENT-2026-10-31.md` |

## 3. アカウント削除

出典: `docs/ACCOUNT-DELETION-CHECK-2026-10-31.md`, `docs/ACCOUNT-FOLLOWUP-2026-10-31.md`

- 画面は「現在、この画面からは削除できません。お問い合わせください。」の表示のみ。APIのDELETEは常に409。
- 未完了: Clerkの本番設定(`delete_self`)の確認、保存リサーチ・ウォッチリスト・質問・通知端末・RESOLUTEの個人データの削除手順、削除中の新規購入の防止。
- 契約の確認(全契約のチェック)のAPIは実装済み。実際の削除は未実装。

## 4. セキュリティ

出典: `docs/SECURITY-ACCOUNT-PAYPAL-2026-10-27.md`, `docs/CURRENT-HANDOFF.md`

- Clerkのログイン試行制限、ユーザー列挙対策、2段階認証の強制、は「未確認」のまま。
- 不正対策の通知: 送り先と送信の仕組みが未設定(コードだけ存在)。
- 管理者の2段階認証(`TECH_PHASE_REQUIRE_ADMIN_MFA`)は、有効化されていない旨の記載あり。現在の設定は未確認。
- Clerkのセッションcookieは、SDKの仕様でHttpOnlyではない。

## 5. インフラ(Railway) — 2026-11-01時点

| サービス | 状態 |
| --- | --- |
| `tech-phase-billing-backup-live` | 修正済み。手動で成功(`TECH_PHASE_LIVE_BACKUP_OK`)。ソースは `codex/research-preview`、変数 `TECH_PHASE_LIVE_BACKUP_BRANCH` も同じ。次の確認: 11/2 9:30 JSTの定期実行 |
| `tech-phase-billing-restore-check-live` | 手動で成功。ソースはコミット `74302989` に固定のまま。次の確認: 11/2(月) 10:00 JST。ソースを `codex/research-preview` に揃えるかは未決定 |
| `tech-phase-billing-recovery-live` | 10/31に修正して成功を確認(`docs/LIVE-RECOVERY-INCIDENT-2026-10-31.md`) |
| `tech-phase-billing-recovery-sandbox` / `-restore-check-sandbox` / `resolute-restore-check` | 最新のデプロイがCRASHEDの表示。実際に問題か、不要になった古いものかは未確認 |
| `resolute-api` | 本番の最新デプロイはSLEEPING(Railway側の状態)。コードの反映状況は要確認 |
| その他の診断・確認用サービス(`*-diagnostic`, `*-acceptance`, `resolute-nonempty-restore-*` など) | 役目を終えたか未確認。整理は未実施 |

## 6. 担当のずれ(AGENTS.md)

`AGENTS.md` には、ChatGPT(Codex)の担当として次の記載が残っている。実態に合わせる必要がある。

- 「Codex owns Tech Phase PRO billing and other explicitly assigned non-news work.」
- 「Codex is now assigned Notes/Ask Rizel editing features.」 → 進み具合は、Claudeは把握していない。実装済みか未着手かの確認が必要。

提案する書き換え(オーナーの承認後に適用):

> Claude owns the whole Tech Phase codebase, including billing and Railway (owner decision, 2026-11-01). Production-changing operations still need the owner's approval each time.

## 7. Claudeが自分で確認できないこと

- 本番にログインした状態の表示(運営者・PRO・FREE)。実機での確認が必要。
- iPhoneのホーム画面アプリの動作(再読み込み後にボタンが効かない件は未解決)。
- DBの中身を読む・変える操作(オーナーに実行してもらう)。
- ClerkやPayPalの管理画面の設定。

## 8. ChatGPTの回答(2026-11-01)

ChatGPTは、今回は記録と稼働状況の確認のみで、本番変更・再実行・削除はしていない、と回答した。

1. **未反映の変更**
   - `codex/live-billing-backup` の変更(バックアップ対象テーブルの追加、失敗箇所の記録、復元ファイルの照合)は、`codex/research-preview` に取り込み済み。`main` には未反映。
   - バックアップと隔離復元は、どちらも手動で成功した記録あり。次回の定期実行は未確認。
   - ノート/Ask Rizelの編集機能: 担当指定までは確認できたが、未反映の編集実装はなく、編集・保存・公開が本番で完了した記録もない。10月14日の古いローカルの作業コピーに、企業紹介関連の差分が残っている(Claude側では未確認)。
2. **本番設定**
   - `RESOLUTE_API_URL` と `RESOLUTE_API_SERVICE_TOKEN`: 設定済み。
   - `TECH_PHASE_REQUIRE_ADMIN_MFA`: 未設定。Clerk管理画面での強制は未確認。
   - `007_billing_security.sql` の対象2テーブル: 存在する。SQL全体の適用履歴と権限付与まで完了したかは未確認(この点は、2026-11-01に連番の権限が足りなかった件の原因と一致する)。
3. **PayPal本番受け入れ**
   - 決済実装、オフライン検証、実購入テストは実施済み。
   - 未確認: 2会員の台帳照合、継続課金、異議申立て、有料会員データを含む復元。
   - 「準備待ち」の中身(どのドメインや設定が不足か)は、ChatGPTも特定できていない。
4. **古いRailwayサービス**: `*-diagnostic`、`*-acceptance`、`resolute-nonempty-restore-20261020` は削除保留。確認用途だった記録はあるが、現行の参照先・監視・復元証跡への依存がなくなった確認はない。
5. **CRASHEDの3件**(Railwayでは定期ジョブの最終実行が失敗)
   - `tech-phase-billing-recovery-sandbox`: 11月1日
   - `tech-phase-billing-restore-check-sandbox`: 10月26日
   - `resolute-restore-check`: 10月26日
   - 役目を終えた記録はなく、照合・復元検証の未解決項目。この表示だけで本番決済の停止とは判断できない。
6. **決済を守る注意点**
   - 完了済みの実購入を、確認目的で繰り返さない。
   - 復元先は隔離DBに限る。本番の台帳を上書きしない。
   - PayPal側に見つからない申込み1件は、照合待ちのまま保持する。支払い済み・解約済みとして処理しない。
