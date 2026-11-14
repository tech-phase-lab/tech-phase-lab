"""Daily self-check of the earnings flash for the watch-list companies (owner, Nov 13). Read-only.

Takes each watch-list company's latest real results release (SEC EDGAR; Nebius: its newsroom PDF), runs the same parser the monitor
uses and prints ONE line of JSON: how many companies pass (three or more reported figures read and cross-checked), which fail, and
which of them are failing although a parser exists for them (a regression: the exit status is then 1, so the cron run shows as failed),
and which covered companies (about 50) filed an SEC 8-K Item 2.02 in the last 48 hours but have no result on the public site (a gap: also exit 1).
It prints only true/false, counts and ticker symbols: never figures, text or any value of the environment. It writes nothing.

    EARNINGS_SELFCHECK=true python3 scripts/research/earnings_selfcheck.py

Without EARNINGS_SELFCHECK=true it prints DISABLED and exits 0 (so a deployed but unconfigured service does nothing).
SEC asks for a contact in the User-Agent: set RESEARCH_USER_AGENT like the monitor does.
"""
import json
import os
import sys
from datetime import datetime, timezone

import earnings_backtest as backtest
import earnings_gapcheck as gapcheck
import issuer_result_flash as flash


def run(check=None, watch=None, gap=None):
    check = check or backtest.check_company  # looked up at call time
    watch = watch or backtest.WATCH
    results = [check(t) for t in watch]
    failing = [r['ticker'] for r in results if r['verdict'] != 'PASS']
    regressions = [t for t in failing if t in flash.PROFILES]  # a parser exists for these: they must pass
    # A company that filed results with the SEC while the site says nothing (read-only: the public site and the SEC index).
    gap = gap() if gap else gapcheck.run(backtest.UA)
    return {'ok': not regressions and gap['siteChecked'] and not gap['gaps'], 'passed': len(results) - len(failing), 'total': len(results), 'failing': failing,
            'regressions': regressions, 'gaps': gap['gaps'], 'siteChecked': gap['siteChecked'],
            'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds')}


def main():
    if os.environ.get('EARNINGS_SELFCHECK') != 'true':
        print('DISABLED: set EARNINGS_SELFCHECK=true to run the earnings self-check')
        return 0
    agent = backtest.monitor.research_user_agent()
    if agent:
        backtest.UA = agent
    summary = run()
    print(json.dumps(summary, separators=(',', ':')))
    return 0 if summary['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
