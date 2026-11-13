# Daily earnings self-check (Railway cron) — setup for the owner-approved operator

What it does: once a day, for the 22 watch-list companies, it takes each company's **latest real results release** (SEC EDGAR; Nebius: the newsroom
PDF), runs the same parser the monitor uses and prints **one line of JSON**:

```
{"ok":true,"passed":7,"total":22,"failing":["MU","SKHY",...],"regressions":[],"generatedAt":"2026-11-14T22:30:04+00:00"}
```

- `passed` / `total`: companies whose release was read with three or more figures that passed the cross-checks (the acceptance criterion).
- `failing`: companies that do not pass yet (no parser, or no route). They show only "決算を発表しました" with the official link on the site.
- `regressions`: companies that **have a parser** (`issuer_result_flash.PROFILES`) but failed today — e.g. the company changed its release layout. When this is
  not empty the run exits with status 1, so the cron run is shown as **failed** in Railway (that is the alert).
- It prints only true/false, counts and ticker symbols. It never prints figures, release text or any environment value, and it writes nothing (no database, no files).

Code: `scripts/research/earnings_selfcheck.py` (uses `earnings_backtest.check_company`); image: `services/earnings-selfcheck/Dockerfile` (same Python and the same
pinned `pypdf` as the monitor, so the Nebius PDF is read the way production reads it). Without `EARNINGS_SELFCHECK=true` it prints `DISABLED` and exits 0.

## Steps (production-changing: needs the owner's approval, executed by the parent session)

1. In the Railway project, **New service** from this repository: name `earnings-selfcheck`, branch `codex/research-preview`.
2. Settings → Build → Dockerfile path: `services/earnings-selfcheck/Dockerfile` (build context = repository root; no root directory change).
3. Variables (names only; none is a secret):
   - `EARNINGS_SELFCHECK` = `true` — the enable flag. Without it the job does nothing.
   - `RESEARCH_USER_AGENT` = `Tech Phase Research <contact address>` — SEC asks for a contact in the User-Agent (same variable name the monitor uses).
4. Settings → Cron Schedule: `30 22 * * *` (UTC) = 07:30 JST every day, i.e. before the Japanese morning. A run takes about 2–4 minutes; the container is
   killed after 900 s. Restart policy: **Never** (a cron service must exit, not restart).
5. Do not attach a volume or a public domain; the service needs neither.
6. First run: **Deploy → Run now**, read the one-line result in the logs. Expected today: `"passed":7`, `"regressions":[]`.

## Rollback

Delete the `earnings-selfcheck` service (or remove the `EARNINGS_SELFCHECK` variable to make it inert). Nothing else depends on it.

## Notes

- Each parser added later (`issuer_result_flash.PROFILES`) is automatically expected to pass from then on.
- The same table can be produced by hand: `python3 scripts/research/earnings_backtest.py` (see `docs/EARNINGS-PASSFAIL-2026-11-13.md`).
- Showing the daily result on the operator screen or `/health` needs the job to write somewhere the monitor can read; that is deliberately not done here (read-only job).
