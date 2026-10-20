"""Private local fixture input only; never an HTTP command or production DB."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.resolute import protection

if __name__ == '__main__':
    try:
        ledger = protection.load_json(Path(sys.argv[1]).read_bytes())
        print(protection.restore_sql(ledger))
    except Exception:
        print('RECOVERY_REPLAY_UNAVAILABLE', file=sys.stderr)
        raise SystemExit(1)
