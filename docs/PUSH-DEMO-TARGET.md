# 撮影用：目標株価のデモ通知（2026-11-17）

通知ページには何も表示しない。モニター側の変数だけで、運営者アカウントの端末に1件送る。

## 送り方

Railway の project `radiant-magic` / environment `research-staging` / service `research-monitor-staging` に、
サービス変数を設定する。

```
PUSH_DEMO_TARGET_AT=2026-11-17T05:30:00Z ja
```

- 値は「RFC3339 の時刻（`Z` か `+09:00` などのタイムゾーン必須）」＋半角スペース＋`ja` または `en`。
- 変数を変えると Railway がサービスを再起動する。モニターは起動直後と以後5秒ごとに確認し、
  時刻を過ぎていればすぐ送る。時刻を過ぎて10分を超えた値は送らない（ログの `outcome: "late"`）。
- 送る相手：その時点で有効な、運営者アカウント（`OWNER_ACCOUNT_ID` / `PRODUCTION_OWNER_ACCOUNT_ID`）の登録端末すべて。
  端末は送る瞬間に読むので、直前に通知をオンにした端末にも届く。
- 同じ値では二度と送らない（DB の `push_demo_schedule` に記録、再起動後も有効）。もう一度送るには時刻か言語を変える。
- 内容は本物の目標株価通知と同じ形：`NVDA · 目標株価の変更` / `Sample Securities: $295 → $340`、タップで `/research/price-targets`。
  本物の通知として記録される（アプリ内バナーも同じ動き）。

## 確認

ログに1行だけ出る（端末・本文・鍵は出さない）。

```
{"event": "push-demo-target", "language": "ja", "devices": 1, "accepted": 1, "outcome": "sent"}
```

`outcome` は `sent` / `no-device`（運営者の有効な端末がない。再試行しない）/ `late` / `invalid`（値の形式が違う）。
撮影後は変数を消してよい（消さなくても再送はしない）。
