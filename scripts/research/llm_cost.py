"""Paid model calls: what they used and what that is worth (owner, Nov 15: count the cost, never stop work because of it).

Every paid call of the deep analysis and of the weekly PRO issue is written to `llm_usage` with the token counts the provider reported.
The estimate is tokens x the unit price of the model (USD per million tokens). Prices are configuration, not code: the variable
RESEARCH_MODEL_PRICES holds JSON such as {"gpt-5.6-terra": {"input": 1.0, "cachedInput": 0.1, "output": 8.0}}; a model without a price is
listed in `unpricedModels` and counts as unknown, never as free. Nothing here ever blocks a call or delays a publication: when the day's
estimate passes DAILY_WARNING_USD it only raises a warning incident and shows in /health.
"""
from datetime import datetime, timedelta, timezone
import json
import os
import time

import monitor

DAILY_WARNING_USD = 1.0
PRICES_ENV = 'RESEARCH_MODEL_PRICES'
INCIDENT_KEY = 'llm-cost:daily'
JST = timezone(timedelta(hours=9))


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS llm_usage(
      at REAL NOT NULL, lane TEXT NOT NULL, ref TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER, cached_tokens INTEGER,
      output_tokens INTEGER, chars_before INTEGER, chars_sent INTEGER)''')


def prices(env=None):
    """{model: (input, cachedInput, output)} in USD per million tokens, from the environment; malformed entries are ignored."""
    env = os.environ if env is None else env
    try:
        raw = json.loads(env.get(PRICES_ENV) or '{}')
    except ValueError:
        return {}
    found = {}
    if isinstance(raw, dict):
        for model, row in raw.items():
            try:
                value = (float(row['input']), float(row.get('cachedInput', row['input'])), float(row['output']))
            except (KeyError, TypeError, ValueError, AttributeError):
                continue
            if all(item >= 0 for item in value):
                found[str(model)] = value
    return found


def usage_of(response):
    """(input, cached, output) tokens a Responses API reply reports, or None for a part it does not report."""
    usage = response.get('usage') if isinstance(response, dict) else None
    if not isinstance(usage, dict):
        return None, None, None

    def number(value):
        return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None
    details = usage.get('input_tokens_details') if isinstance(usage.get('input_tokens_details'), dict) else {}
    return number(usage.get('input_tokens')), number(details.get('cached_tokens')), number(usage.get('output_tokens'))


def cost_usd(model, input_tokens, cached_tokens, output_tokens, price_table):
    """Estimated USD of one call, or None when the model has no price or the provider reported no tokens."""
    price = price_table.get(model)
    if price is None or input_tokens is None or output_tokens is None:
        return None
    cached = min(cached_tokens or 0, input_tokens)
    return ((input_tokens - cached) * price[0] + cached * price[1] + output_tokens * price[2]) / 1_000_000


def record(db, lane, ref, model, response, now=None, chars_before=None, chars_sent=None):
    """Write one call. Never raises: counting must not be able to break the work it counts."""
    try:
        schema(db)
        input_tokens, cached_tokens, output_tokens = usage_of(response)
        db.execute('INSERT INTO llm_usage VALUES(?,?,?,?,?,?,?,?,?)',
                   (time.time() if now is None else now, lane, str(ref)[:200], model, input_tokens, cached_tokens, output_tokens,
                    chars_before, chars_sent))
    except Exception:
        return False
    return True


def day_start(now):
    local = datetime.fromtimestamp(now, JST)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


def today(db, now=None, env=None):
    """Today's (JST) paid calls, tokens and estimated cost, by lane; what the owner needs in /health. Text-free."""
    schema(db)
    now = time.time() if now is None else now
    price_table = prices(env)
    lanes, unpriced, total, unknown_calls = {}, set(), 0.0, 0
    removed_chars = sent_chars = 0
    for lane_name, model, input_tokens, cached_tokens, output_tokens, chars_before, chars_sent in db.execute(
            'SELECT lane,model,input_tokens,cached_tokens,output_tokens,chars_before,chars_sent FROM llm_usage WHERE at>=? AND at<?',
            (day_start(now), day_start(now) + 86400)).fetchall():
        lane = lanes.setdefault(lane_name, {'calls': 0, 'inputTokens': 0, 'cachedTokens': 0, 'outputTokens': 0, 'estimatedUsd': 0.0})
        lane['calls'] += 1
        lane['inputTokens'] += input_tokens or 0
        lane['cachedTokens'] += cached_tokens or 0
        lane['outputTokens'] += output_tokens or 0
        if chars_before is not None and chars_sent is not None:
            removed_chars += max(0, chars_before - chars_sent)
            sent_chars += chars_sent
        cost = cost_usd(model, input_tokens, cached_tokens, output_tokens, price_table)
        if cost is None:
            unknown_calls += 1
            if model not in price_table:
                unpriced.add(model)
        else:
            lane['estimatedUsd'] += cost
            total += cost
    for lane in lanes.values():
        lane['estimatedUsd'] = round(lane['estimatedUsd'], 4)
    return {'estimatedUsd': round(total, 4), 'warningAtUsd': DAILY_WARNING_USD, 'overWarning': total > DAILY_WARNING_USD,
            'unknownCostCalls': unknown_calls, 'unpricedModels': sorted(unpriced), 'lanes': lanes,
            'sourceCharsRemoved': removed_chars, 'sourceCharsSent': sent_chars}


def sync_incident(db, now=None, env=None):
    """A warning (never a stop) once the day's estimate passes the line; resolved when the day turns over. Returns the issue name or None."""
    now = time.time() if now is None else now
    state = today(db, now, env)
    at = datetime.fromtimestamp(now, timezone.utc).isoformat()
    if state['overWarning']:
        monitor.record_operational_incident(db, INCIDENT_KEY, 'llm-cost', 'daily', 'warning',
                                            'llm-cost-over-%dusd' % int(DAILY_WARNING_USD), seen_at=at)
        return 'llm-cost-warning'
    monitor.resolve_operational_incident(db, INCIDENT_KEY, resolved_at=at)
    return None
