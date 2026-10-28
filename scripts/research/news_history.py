"""Display-only bounded recent history; never changes acquisition or AI queues."""
import json
import logging

OFFICIAL_LIMIT = 100
TARGET_BYTES = 450_000
HARD_BYTES = 500_000


def encoded_size(value):
    return len(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode())


def bounded(payload):
    """Keep newest-first validated stories and disclose every omitted row.

    Preserve the other public sections byte-for-byte. If their pre-existing core
    alone exceeds the 450k target, add no official history, preserve that core
    below the unchanged 500k hard guard, and disclose the target overrun.
    """
    rows = payload.get('officialUpdates', [])
    result = {**payload, 'officialUpdates':list(rows[:OFFICIAL_LIMIT])}
    total = len(rows)
    def metadata(byte_limited):
        returned = len(result['officialUpdates'])
        return {'limit':OFFICIAL_LIMIT, 'sourceEligible':total, 'returned':returned,
                'omitted':total-returned, 'hasMore':returned<total,
                'byteLimited':byte_limited, 'coreOverTarget':False}
    result['officialHistory'] = metadata(False)
    while encoded_size(result)>TARGET_BYTES and result['officialUpdates']:
        result['officialUpdates'].pop()
        result['officialHistory'] = metadata(True)
    if encoded_size(result)>TARGET_BYTES:
        result['officialHistory']['coreOverTarget'] = True
    if encoded_size(result)>HARD_BYTES:
        # The diagnostics are new and optional. They must not turn a previously
        # valid near-limit core into an outage just by adding their own bytes.
        result.pop('officialHistory', None)
        if encoded_size(result)>HARD_BYTES:
            raise ValueError('news-core-response-limit')
        logging.warning('news-history-diagnostics-omitted-response-limit')
    return result
