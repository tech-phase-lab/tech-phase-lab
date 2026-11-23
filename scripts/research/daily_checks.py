"""The earnings-selfcheck cron container's entry point (Nov 20): the earnings self-check, then the production watch.

Each prints its own one line of JSON (or DISABLED). A crash in one check does not skip the other. Read-only, like both checks.

Nov 23 (owner): a check that ran to the end and found a problem no longer makes the cron run CRASHED (a "deployment crashed"
mail every morning and a failing Railway check on every release PR). Its result goes to the monitor's incident alerts instead
(cron_report.py): the owner is alerted once when it opens and once when it is resolved, and the run exits 0. The run still
exits 1 when the job itself could not do its work: a check raised, or a failure could not be reported (alerting not configured
or the monitor unreachable), so a problem is never silent.
"""
import json
import sys

import cron_report
import earnings_selfcheck
import production_watch


def main(checks=None, report=cron_report.send):
    checks = checks or (("earnings-selfcheck", earnings_selfcheck.check), ("production-watch", production_watch.check))
    code = 0
    for name, check in checks:
        try:
            failed = check()
        except Exception as exc:
            print(json.dumps({"check": name, "ok": False, "error": type(exc).__name__}, separators=(",", ":")), flush=True)
            code = 1
            continue
        if failed is None:  # disabled
            continue
        delivered = report(name, not failed, failed)
        print(json.dumps({"check": name, "report": delivered}, separators=(",", ":")), flush=True)
        if failed and delivered != "delivered":
            code = 1  # the problem could not reach the owner any other way
    return code


if __name__ == "__main__":
    sys.exit(main())
