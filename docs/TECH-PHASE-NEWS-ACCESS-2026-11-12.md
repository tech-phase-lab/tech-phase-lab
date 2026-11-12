# ハイテク速報の取得口（API）の FREE / PRO 分離（2026-11-12）

オーナー指示（2026-11-12）：「表示だけでなく、取得口も閉じる」。a7b58b55 の再適用ではなく、新しく作り直した。
方針：`TECH-PHASE-FREE-PRO-POLICY-2026-10-25.md`（FREE＝30分遅れ・新しい順に直近5件・本文なし。PRO・運営者＝リアルタイム・全件・本文つき）。

## 対象
`/api/research/news` と `/api/research/company-wire`。サーバー側（`lib/research/tech-news-access.ts`）で絞ってから返す。

- 判定はサーバーの会員情報（`getMembership`）。PRO会員、またはFREE切り替え中ではない運営者だけが全件。未ログイン・FREE・判定の失敗・運営者のFREE切り替え中は絞る。URLやブラウザの申告は見ない。
- FREEの絞り込み：監視22銘柄の企業ニュース（items）、公式・企業発表（officialUpdates）、アナリスト速報（analystUpdates）、company-wire を合わせて、発表から30分以上たった新しい順の5件だけ。要約・本文・影響分析は付けない（itemsは見出しで代用）。日付だけの記事は初回取得から30分待つ。未来・不正な時刻は出さない。
- 無料のまま：一般ニュース（監視銘柄に関係しない記事）、決算結果（発表済みの結果）、市場アップデート、結果の速報、経済指標・決算カレンダー用データ。
- キャッシュ：`Cache-Control: private, no-store` と `Vary: Cookie`。PRO用とFREE用が混ざらない。
- `proxy.ts` のmatcherに2本を追加（会員判定にClerkが必要なため）。`/api/research/news/stream` は変更なし（更新の合図のみ）。

## 画面
既存の画面側の制限（`freeFlashRows` など）はそのまま。取得口が先に絞るので二重になるが、結果は変わらない。

## 既知の限界
- 同じ記事が複数銘柄に出るwire記事は、FREEでは代表の1銘柄ぶんだけ返る。
- FREEでは、news取得時にwireを（上限2.5秒で）もう1回読む。wireが止まっても検証済みニュースは返す。
- すでにブラウザへ配信済みの内容は回収できない。
