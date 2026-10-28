"""Fail-closed, shared X monetary admission for the reviewed opt-in rollout.

No credentials, provider clients, environment reads, or startup wiring live here.
Amounts are integer USD micros. Reservations survive crashes and are NOT a hard
provider billing cap: socket-close latency and unknown upstream billing remain.
"""
from datetime import datetime, timedelta, timezone
import json
import uuid

POST_MICROS = 5_000
USER_MICROS = 10_000
MAX_SNAPSHOT_AGE_SECONDS = 900


class BudgetBlocked(ValueError):
    pass


def utc(value):
    try:
        result = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.tzinfo is None:
            raise ValueError
        return result.astimezone(timezone.utc)
    except (TypeError, ValueError, AttributeError, OverflowError) as exc:
        raise BudgetBlocked('x-budget-invalid-time') from exc


def natural(value, name, positive=False):
    if type(value) is not int or value < int(positive):
        raise BudgetBlocked('x-budget-invalid-' + name)
    return value


def schema(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS x_budget_policy (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS x_budget_reservations (
        id TEXT PRIMARY KEY, cycle TEXT NOT NULL, day TEXT NOT NULL,
        purpose TEXT NOT NULL, reserved INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0,
        expected INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS x_budget_resources (
        cycle TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, resource_id TEXT NOT NULL,
        PRIMARY KEY(cycle,day,kind,resource_id));
      CREATE TABLE IF NOT EXISTS x_budget_stop (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), reason TEXT NOT NULL);
    ''')


def install_policy(db, policy, now):
    """Explicit local operator/fixture input. Never infer approval from a balance.

    A cycle refresh may increase the baseline but cannot discard reservations.
    Reconciliation is deliberately conservative (possible double counting).
    Unknown cycle changes require a separate reviewed ledger migration.
    """
    validate_policy(policy, now)
    with db:
        db.execute('BEGIN IMMEDIATE')
        old = db.execute('SELECT body FROM x_budget_policy WHERE singleton=1').fetchone()
        if old:
            old = json.loads(old[0])
            if policy['cycle_id'] != old['cycle_id'] or policy['cycle_start'] != old['cycle_start'] or policy['cycle_end'] != old['cycle_end']:
                raise BudgetBlocked('x-budget-cycle-change-requires-review')
            if policy['baseline_micros'] < old['baseline_micros']:
                raise BudgetBlocked('x-budget-baseline-regressed')
        db.execute('INSERT INTO x_budget_policy VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET body=excluded.body',
                   (json.dumps(policy, sort_keys=True),))


def validate_policy(policy, now):
    if not isinstance(policy, dict):
        raise BudgetBlocked('x-budget-policy-missing')
    required = {'cycle_id', 'cycle_start', 'cycle_end', 'verified_at', 'baseline_micros',
                'cycle_limit_micros', 'daily_limit_micros', 'account_cap_micros',
                'reserve_micros', 'all_consumers_identified', 'spend_reconciled', 'prices_verified'}
    if set(policy) != required:
        raise BudgetBlocked('x-budget-policy-invalid')
    if not isinstance(policy['cycle_id'], str) or not 1 <= len(policy['cycle_id']) <= 100:
        raise BudgetBlocked('x-budget-cycle-invalid')
    current, verified, start, end = (utc(v) for v in (now, policy['verified_at'], policy['cycle_start'], policy['cycle_end']))
    if not start <= verified <= current < end or not timedelta(0) <= current-verified <= timedelta(seconds=MAX_SNAPSHOT_AGE_SECONDS):
        raise BudgetBlocked('x-budget-snapshot-stale-or-cycle-invalid')
    for key in ('baseline_micros', 'cycle_limit_micros', 'daily_limit_micros', 'account_cap_micros', 'reserve_micros'):
        natural(policy[key], key)
    if not (0 < policy['daily_limit_micros'] <= policy['cycle_limit_micros']
            <= policy['account_cap_micros'] - policy['reserve_micros']):
        raise BudgetBlocked('x-budget-limits-invalid')
    if any(policy[key] is not True for key in ('all_consumers_identified', 'spend_reconciled', 'prices_verified')):
        raise BudgetBlocked('x-budget-unverified-consumers-spend-or-price')
    return policy


def policy_for(db, now):
    stop = db.execute('SELECT reason FROM x_budget_stop WHERE singleton=1').fetchone()
    if stop:
        raise BudgetBlocked('x-budget-operator-blocked')
    row = db.execute('SELECT body FROM x_budget_policy WHERE singleton=1').fetchone()
    try:
        policy = json.loads(row[0]) if row else None
    except (ValueError, TypeError):
        policy = None
    policy = validate_policy(policy, now)
    current = utc(now)
    cycle = db.execute('SELECT COALESCE(SUM(reserved),0) FROM x_budget_reservations WHERE cycle=?',
                       (policy['cycle_id'],)).fetchone()[0]
    day = db.execute('SELECT COALESCE(SUM(reserved),0) FROM x_budget_reservations WHERE cycle=? AND day=?',
                     (policy['cycle_id'], current.date().isoformat())).fetchone()[0]
    if policy['baseline_micros'] + cycle > policy['cycle_limit_micros'] or day > policy['daily_limit_micros']:
        raise BudgetBlocked('x-budget-outstanding-exposure-exceeds-policy')
    return policy


def reserve(db, purpose, amount, now):
    """Reserve BEFORE any stream, search, recovery, retry, or control I/O.

    Failed/ambiguous operations retain the full reservation. Stream unused
    allowance is never reused, even on a clean close. Caller holds no transaction.
    """
    if purpose not in {'stream', 'search', 'recovery', 'control'}:
        raise BudgetBlocked('x-budget-purpose-invalid')
    natural(amount, 'reservation', positive=True)
    current = utc(now)
    with db:
        db.execute('BEGIN IMMEDIATE')
        policy = policy_for(db, current)
        cycle = db.execute('SELECT COALESCE(SUM(reserved),0) FROM x_budget_reservations WHERE cycle=?',
                           (policy['cycle_id'],)).fetchone()[0]
        day = db.execute('SELECT COALESCE(SUM(reserved),0) FROM x_budget_reservations WHERE cycle=? AND day=?',
                         (policy['cycle_id'], current.date().isoformat())).fetchone()[0]
        if policy['baseline_micros'] + cycle + amount > policy['cycle_limit_micros'] or day + amount > policy['daily_limit_micros']:
            raise BudgetBlocked('x-budget-exhausted')
        identity = uuid.uuid4().hex
        db.execute('INSERT INTO x_budget_reservations VALUES(?,?,?,?,?,0,0,?,?)',
                   (identity, policy['cycle_id'], current.date().isoformat(), purpose, amount, 'open', current.isoformat()))
    return identity


def search_reservation(db, max_results, now, purpose='search'):
    if purpose not in {'search', 'recovery'} or type(max_results) is not int or not 10 <= max_results <= 100:
        raise BudgetBlocked('x-budget-search-limit-invalid')
    return reserve(db, purpose, max_results * (POST_MICROS + USER_MICROS), now)


def payload_resources(payload):
    """Conservative delivery count includes duplicates and discarded resources."""
    if not isinstance(payload, dict) or payload.get('errors'):
        raise BudgetBlocked('x-budget-response-ambiguous')
    data = payload.get('data', [])
    if isinstance(data, dict):
        data = [data]
    includes = payload.get('includes', {})
    if not isinstance(data, list) or not isinstance(includes, dict) or set(includes) - {'users'}:
        raise BudgetBlocked('x-budget-unpriced-resource')
    users = includes.get('users', [])
    if not isinstance(users, list):
        raise BudgetBlocked('x-budget-response-invalid')
    result = []
    for kind, entries in (('post', data), ('user', users)):
        for item in entries:
            if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id'].isdigit() or len(item['id']) > 32:
                raise BudgetBlocked('x-budget-resource-invalid')
            result.append((kind, item['id']))
    return result


def account_receipt(db, reservation_id, payload, now, final=False):
    """Caller transaction makes resource metering and durable inbox atomic.

    Expected UTC-day dedup is diagnostic only. Admission uses EVERY returned
    post/user, even repeat envelopes or rejected text. Never truncate billing to
    the allowance: overshoot is persisted and globally blocks new operations.
    """
    current = utc(now)
    row = db.execute('SELECT * FROM x_budget_reservations WHERE id=?', (reservation_id,)).fetchone()
    if not row or (row['state'] != 'open' and row['purpose'] != 'stream'):
        raise BudgetBlocked('x-budget-reservation-inactive')
    # Accounting already-delivered resources must continue after stop/expiry so
    # the tail of an already-read chunk is not erased from the spend estimate.
    boundary = row['day'] != current.date().isoformat()
    try:
        policy = policy_for(db, current)
        boundary = boundary or row['cycle'] != policy['cycle_id']
    except BudgetBlocked:
        boundary = True
    try:
        resources = payload_resources(payload)
    except BudgetBlocked:
        db.execute("INSERT OR REPLACE INTO x_budget_stop VALUES(1,'ambiguous-delivery')")
        db.execute("UPDATE x_budget_reservations SET state='closed' WHERE id=?", (reservation_id,))
        return {'consumed_micros': row['consumed'], 'close_required': True, 'overshot': False, 'ambiguous': True}
    charge = sum(POST_MICROS if kind == 'post' else USER_MICROS for kind, _ in resources)
    expected = 0
    for kind, identity in resources:
        added = db.execute('INSERT OR IGNORE INTO x_budget_resources VALUES(?,?,?,?)',
                           (row['cycle'], current.date().isoformat(), kind, identity)).rowcount
        expected += added * (POST_MICROS if kind == 'post' else USER_MICROS)
    consumed = row['consumed'] + charge
    overshot = consumed > row['reserved']
    reserved = max(row['reserved'], consumed)
    if final and row['purpose'] in {'search', 'recovery'} and not overshot and not boundary:
        reserved = consumed
    state = 'closed' if final or consumed >= reserved or boundary else 'open'
    db.execute('UPDATE x_budget_reservations SET reserved=?,consumed=?,expected=expected+?,state=? WHERE id=?',
               (reserved, consumed, expected, state, reservation_id))
    if overshot or boundary:
        db.execute("INSERT OR REPLACE INTO x_budget_stop VALUES(1,'delivery-outside-allowance')")
    return {'consumed_micros': consumed, 'close_required': overshot or state == 'closed', 'overshot': overshot}


def close_reservation(db, reservation_id):
    # Do not free unused allowance after ambiguity, transport close, or restart.
    db.execute("UPDATE x_budget_reservations SET state='closed' WHERE id=?", (reservation_id,))
