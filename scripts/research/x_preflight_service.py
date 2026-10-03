"""Default-off bridge for private, one-shot service metadata diagnostics.

Inputs contain operator evidence only. Existing credentials are read in place by
an admitted checker; they are never copied into configuration, storage or logs.
"""
import asyncio
import json
import os
import stat

ENABLED = 'X_METADATA_PREFLIGHT_ENABLED'
APPROVAL = 'X_METADATA_PREFLIGHT_APPROVAL_JSON'
LOCAL = 'X_PREFLIGHT_LOCAL_DIAGNOSTICS'


def requested(env=None):
    env = os.environ if env is None else env
    return any(str(env.get(key, '')).strip().lower() == 'true' for key in (ENABLED, LOCAL))



def local_file_sizes(*, scandir=None):
    """Bounded metadata-only inventory; no file contents, links or names returned."""
    scan = os.scandir if scandir is None else scandir
    groups = {name: {'files': 0, 'bytes': 0} for name in ('database', 'wal', 'backups', 'other')}
    result = {'categories': groups, 'skipped_links': 0, 'unscanned_directories': 0,
              'inventory_complete': True}
    remaining = 2048
    pending = [('/data', False)]
    try:
        while pending:
            path, backup = pending.pop()
            with scan(path) as entries:
                for entry in entries:
                    if remaining <= 0:
                        result['inventory_complete'] = False
                        return result
                    remaining -= 1
                    info = entry.stat(follow_symlinks=False)
                    if stat.S_ISLNK(info.st_mode):
                        result['skipped_links'] += 1
                    elif stat.S_ISDIR(info.st_mode):
                        if not backup and entry.name == 'backups':
                            pending.append(('/data/backups', True))
                        else:
                            result['unscanned_directories'] += 1
                            result['inventory_complete'] = False
                    elif stat.S_ISREG(info.st_mode):
                        category = ('backups' if backup else 'wal' if entry.name.endswith(('-wal', '-shm'))
                                    else 'database' if entry.name.endswith(('.sqlite', '.db')) else 'other')
                        groups[category]['files'] += 1
                        groups[category]['bytes'] += max(0, info.st_size)
                    else:
                        result['inventory_complete'] = False
    except Exception:
        return {'inventory_complete': False, 'reason': 'file-metadata-unavailable'}
    return result


def run_once(db_path, stop_event, *, env=None, emit=None):
    env = os.environ if env is None else env
    if not requested(env) or stop_event.is_set():
        return
    # This private operational log is deliberately separate from public health.
    emit = emit or (lambda value: print(value, flush=True))
    import x_preflight
    if str(env.get(LOCAL, '')).strip().lower() == 'true':
        try:
            diagnostic = {"capacity": x_preflight.local_free_space(), "files": local_file_sizes()}
            emit('x-preflight-local ' + json.dumps(diagnostic, sort_keys=True, separators=(',', ':')))
        except Exception:
            emit('x-preflight-local unavailable')
    if str(env.get(ENABLED, '')).strip().lower() != 'true' or stop_event.is_set():
        return
    try:
        raw = env.get(APPROVAL, '')
        if not isinstance(raw, str) or not 1 <= len(raw.encode()) <= 32768:
            raise ValueError
        approval = json.loads(raw)
    except Exception:
        emit('x-preflight-result {"status":"blocked","reason":"invalid-service-approval"}')
        return
    import monitor
    db = None
    try:
        db = monitor.connect(db_path)
        result = asyncio.run(x_preflight.Checker(
            db=db, enabled=True, approval=approval,
            token_provider=lambda: env.get('X_BEARER_TOKEN', ''),
            reserve_request=lambda **_kwargs: not stop_event.is_set(),
        ).run())
        encoded = json.dumps(result, sort_keys=True, separators=(',', ':'), allow_nan=False)
        if len(encoded.encode()) > 65536:
            raise ValueError
        emit('x-preflight-result ' + encoded)
    except Exception:
        # The durable one-shot ledger retains any attempted spend/unknown cost.
        emit('x-preflight-result {"status":"blocked","reason":"service-check-failed"}')
    finally:
        if db is not None:
            db.close()
