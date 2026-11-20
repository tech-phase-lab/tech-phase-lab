"""The earnings-selfcheck cron container's entry point (Nov 20): the earnings self-check, then the production watch.

Each prints its own one line of JSON (or DISABLED). The run exits 1 when either fails, so the cron run shows as failed;
a crash in one check does not skip the other. Read-only, like both checks.
"""
import json
import sys

import earnings_selfcheck
import production_watch


def main(checks=None):
    checks = checks or (("earnings-selfcheck", earnings_selfcheck.main), ("production-watch", production_watch.main))
    code = 0
    for name, check in checks:
        try:
            result = check()
        except Exception as exc:
            print(json.dumps({"check": name, "ok": False, "error": type(exc).__name__}, separators=(",", ":")), flush=True)
            result = 1
        code = code or (1 if result else 0)
    return code


if __name__ == "__main__":
    sys.exit(main())
