"""Core X Filtered Stream intake for the separate default-off service supervisor.

Only an explicitly admitted transport can make a request. Offline replay is a
separate method and cannot invoke that transport. Never create/delete rules,
read credentials, publish directly, or advance Recent Search cursors here.
"""
import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re

import signals
import x_api
import x_budget

SOURCE_IDS = ('x-wallstengine', 'x-nebius-official', 'x-trendspider', 'x-barchart')
STREAM_URL = 'https://api.x.com/2/tweets/search/stream'
STREAM_PARAMS = {'tweet.fields': 'created_at,author_id,lang,note_tweet,edit_history_tweet_ids',
                 'expansions': 'author_id', 'user.fields': 'username'}
MAX_FRAME_BYTES = 512 * 1024
MAX_INBOX = 128
MAX_RETAINED = 1000
HEARTBEAT_SECONDS = 20


class StreamBlocked(ValueError):
    pass


class TransportFailure(Exception):
    """Transport exposes only a status and bounded retry hint, never a body."""
    def __init__(self, status, *, retry_after=0, quota=False, connection_conflict=False):
        super().__init__('x-stream-transport-failure')
        self.status = status
        self.retry_after = retry_after
        self.quota = quota
        self.connection_conflict = connection_conflict


def stamp(value):
    return x_budget.utc(value).isoformat(timespec='milliseconds')


def manifest(sources=None):
    registry = json.loads(Path(__file__).with_name('signal_sources.json').read_text())
    expected = {s['id']: s for s in registry if s.get('format') == 'x-api' and s.get('enabled') is not False}
    approved = {s['id']: s for s in (registry if sources is None else sources)
                if s.get('format') == 'x-api' and s.get('enabled') is not False}
    if set(expected) != set(SOURCE_IDS) or set(approved) != set(SOURCE_IDS):
        raise StreamBlocked('x-stream-source-scope-invalid')
    rules = []
    for identity in SOURCE_IDS:
        source = approved[identity]
        query = source.get('query')
        if (source != expected[identity] or not isinstance(query, str) or not 1 <= len(query) <= 1024
                or 'thefly' in query.lower()):
            raise StreamBlocked('x-stream-manifest-invalid')
        rules.append({'source_id': identity, 'value': query,
                      'tag': 'techphase:v1:' + identity + ':' + hashlib.sha256(query.encode()).hexdigest()[:16]})
    return rules


def verified_rule_map(inventory, rules):
    """Use the COMPLETE paginated app inventory; any foreign rule blocks use."""
    if not isinstance(inventory, list) or len(inventory) != len(rules):
        raise StreamBlocked('x-stream-full-rule-set-unverified')
    expected = {(r['value'], r['tag']): r['source_id'] for r in rules}
    result = {}
    for rule in inventory:
        if not isinstance(rule, dict):
            raise StreamBlocked('x-stream-rule-invalid')
        identity = rule.get('id')
        key = (rule.get('value'), rule.get('tag'))
        if not isinstance(identity, str) or not identity.isdigit() or len(identity) > 32 or identity in result or key not in expected:
            raise StreamBlocked('x-stream-rule-invalid')
        result[identity] = expected.pop(key)
    if expected:
        raise StreamBlocked('x-stream-rule-set-incomplete')
    return result


class Decoder:
    """Bounded incremental NDJSON; byte buffering preserves split UTF-8."""
    def __init__(self):
        self.buffer = bytearray()

    def feed(self, chunk):
        if not isinstance(chunk, bytes) or len(chunk) > 65536:
            raise StreamBlocked('x-stream-chunk-invalid')
        self.buffer.extend(chunk)
        while b'\n' in self.buffer:
            line, _, rest = self.buffer.partition(b'\n')
            self.buffer = bytearray(rest)
            if len(line) > MAX_FRAME_BYTES:
                raise StreamBlocked('x-stream-frame-too-large')
            if not line.strip():
                continue
            try:
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError
            except (ValueError, UnicodeDecodeError, RecursionError) as exc:
                raise StreamBlocked('x-stream-frame-invalid') from exc
            yield value
        if len(self.buffer) > MAX_FRAME_BYTES:
            raise StreamBlocked('x-stream-frame-too-large')

    def finish(self):
        if self.buffer.strip():
            raise StreamBlocked('x-stream-incomplete-frame')


def schema(db):
    signals.schema(db)
    x_budget.schema(db)
    db.executescript('''
      CREATE TABLE IF NOT EXISTS x_stream_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), state TEXT NOT NULL,
        last_byte_at TEXT, last_committed_at TEXT, last_post_id TEXT,
        failures INTEGER NOT NULL DEFAULT 0, retry_at TEXT, connected_at TEXT,
        disconnected_since TEXT);
      INSERT OR IGNORE INTO x_stream_state(singleton,state) VALUES(1,'off');
      CREATE TABLE IF NOT EXISTS x_stream_owner (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL,
        reservation_id TEXT NOT NULL, started_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS x_stream_attempts (attempted_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS x_stream_inbox (
        receipt TEXT PRIMARY KEY, post_id TEXT NOT NULL, payload TEXT NOT NULL,
        received_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS x_stream_associations (
        source_id TEXT NOT NULL, receipt TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(source_id,receipt));
      CREATE TABLE IF NOT EXISTS x_stream_edits (
        source_id TEXT NOT NULL, member_id TEXT NOT NULL, latest_id TEXT NOT NULL,
        PRIMARY KEY(source_id,member_id));
      CREATE TABLE IF NOT EXISTS x_stream_gaps (
        id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, start_at TEXT NOT NULL,
        end_at TEXT NOT NULL, next_token TEXT, page_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS x_stream_search_checkpoint (
        source_id TEXT PRIMARY KEY, completed_through TEXT NOT NULL);
    ''')


@dataclass(frozen=True)
class Activation:
    """A reviewed caller supplies evidence. This module never obtains it itself."""
    inventory: list
    verified_at: str
    single_consumer_verified: bool = False
    stream_entitlement_verified: bool = False
    spending_approved: bool = False
    all_x_reads_share_ledger: bool = False
    all_x_intake_uses_projection: bool = False

    def check(self, now, rules):
        verified = x_budget.utc(self.verified_at)
        if not timedelta(0) <= x_budget.utc(now) - verified <= timedelta(minutes=15):
            raise StreamBlocked('x-stream-preflight-stale')
        if not all(value is True for value in (self.single_consumer_verified, self.stream_entitlement_verified,
                                               self.spending_approved, self.all_x_reads_share_ledger,
                                               self.all_x_intake_uses_projection)):
            raise StreamBlocked('x-stream-activation-unverified')
        return verified_rule_map(self.inventory, rules)


class Coordinator:
    """One SQLite connection on one dedicated loop; drain outside byte reader.

    The service supervisor serializes DB use on its dedicated event loop and
    drains independently of slow Search requests. Parsing/translation must never
    delay the reader's metering + durable inbox writes.
    """
    def __init__(self, db, tickers, *, enabled=False, offline=True, activation=None,
                 wake=None, clock=None):
        self.db, self.tickers = db, tickers
        self.enabled, self.offline, self.activation = enabled, offline, activation
        self.wake = wake or (lambda: None)
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.rules = manifest()
        self.sources = {s['id']: s for s in signals.SOURCES if s['id'] in SOURCE_IDS}
        self.rule_map = {}
        self.owner = None
        self.reservation = None
        schema(db)

    def fixture_inventory(self):
        """Explicit test IDs, never suitable as live entitlement evidence."""
        return [dict(rule, id=str(index)) for index, rule in enumerate(self.rules, 1)]

    def ingest_fixture(self, envelope, received_at=None):
        if not self.offline:
            raise StreamBlocked('x-stream-offline-required')
        self.rule_map = verified_rule_map(self.fixture_inventory(), self.rules)
        return self._receive(envelope, received_at or self.clock(), reservation=None)

    def _envelope(self, envelope):
        if not isinstance(envelope, dict) or envelope.get('errors') or not isinstance(envelope.get('data'), dict):
            raise StreamBlocked('x-stream-envelope-invalid')
        post = envelope['data']
        identity = post.get('id')
        rules = envelope.get('matching_rules')
        if not isinstance(identity, str) or not identity.isdigit() or len(identity) > 32 or not isinstance(rules, list) or not rules:
            raise StreamBlocked('x-stream-envelope-invalid')
        selected = set()
        for rule in rules:
            if not isinstance(rule, dict) or rule.get('id') not in self.rule_map:
                raise StreamBlocked('x-stream-unowned-rule')
            selected.add(self.rule_map[rule['id']])
        # Validate every returned resource, even if editorial parsing rejects it.
        x_budget.payload_resources(envelope)
        authors = [user for user in envelope.get('includes', {}).get('users', [])
                   if user.get('id') == post.get('author_id')]
        if len(authors) != 1 or not isinstance(authors[0].get('username'), str):
            raise StreamBlocked('x-stream-author-expansion-missing')
        username = authors[0]['username'].lower()
        if (username not in x_api.ALLOWED_ACCOUNT_NAMES
                or not any(username in {v.lower() for v in self.sources[source_id]['accounts']} for source_id in selected)):
            raise StreamBlocked('x-stream-author-not-approved')
        return identity, selected

    def _receive(self, envelope, received_at, reservation):
        now = x_budget.utc(received_at)
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            meter = (x_budget.account_receipt(self.db, reservation, envelope, now)
                     if reservation else {'close_required': False})
            try:
                if meter.get('ambiguous'):
                    raise x_budget.BudgetBlocked('x-budget-ambiguous-delivery')
                identity, selected = self._envelope(envelope)
                encoded = json.dumps(envelope, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
                if len(encoded.encode()) > MAX_FRAME_BYTES:
                    raise StreamBlocked('x-stream-frame-too-large')
                # A second envelope may add an association to the same receipt.
                receipt = hashlib.sha256(json.dumps(envelope['data'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                pending = self.db.execute('SELECT COUNT(*) FROM x_stream_associations WHERE processed=0').fetchone()[0]
                fresh = sum(not self.db.execute('SELECT 1 FROM x_stream_associations WHERE source_id=? AND receipt=?',
                                               (source_id, receipt)).fetchone() for source_id in selected)
                if pending + fresh > MAX_INBOX:
                    raise StreamBlocked('x-stream-inbox-full')
            except (StreamBlocked, x_budget.BudgetBlocked):
                # Routing/quota rejection cannot erase already received billing.
                # On a disk failure the still-reserved whole allowance survives.
                self.db.commit()
                raise
            self.db.execute('INSERT OR IGNORE INTO x_stream_inbox VALUES(?,?,?,?)',
                            (receipt, identity, encoded, stamp(now)))
            for source_id in selected:
                self.db.execute('INSERT OR IGNORE INTO x_stream_associations VALUES(?,?,0)', (source_id, receipt))
            self.db.execute('UPDATE x_stream_state SET last_committed_at=?,last_post_id=? WHERE singleton=1',
                            (stamp(now), identity))
        return meter

    def heartbeat(self, now=None):
        with self.db:
            self.db.execute('UPDATE x_stream_state SET last_byte_at=? WHERE singleton=1', (stamp(now or self.clock()),))

    def _project(self, source, payload, observed):
        acquired = x_api.acquired_posts(source, payload)
        items = x_api.parse_response(source, payload, self.tickers)
        # Ambiguous edit chains are deliberately private until the wider
        # publication pipeline has reviewed edit/retraction semantics. Every
        # chain member is marked, so a late older body cannot revive it.
        accepted, publishable = [], []
        for post in payload.get('data', []):
            identity = str(post.get('id', ''))
            tweet_lineage = post.get('edit_history_tweet_ids')
            post_lineage = post.get('edit_history_post_ids')
            if tweet_lineage is not None and post_lineage is not None and tweet_lineage != post_lineage:
                raise StreamBlocked('x-stream-edit-lineage-conflict')
            lineage = tweet_lineage if tweet_lineage is not None else post_lineage if post_lineage is not None else [identity]
            if (not isinstance(lineage, list) or not 1 <= len(lineage) <= 20
                    or identity not in lineage or any(not isinstance(v, str) or not v.isdigit() or len(v) > 32 for v in lineage)):
                raise StreamBlocked('x-stream-edit-lineage-invalid')
            copy = next((entry for entry in acquired if entry['url'].endswith('/status/' + identity)), None)
            if not copy:
                continue
            known = self.db.execute('SELECT latest_id FROM x_stream_edits WHERE source_id=? AND member_id=?',
                                    (source['id'], identity)).fetchone()
            if len(lineage) > 1 or known:
                latest = max([*lineage, *([known[0]] if known else [])], key=int)
                for member in lineage:
                    self.db.execute('INSERT INTO x_stream_edits VALUES(?,?,?) ON CONFLICT(source_id,member_id) DO UPDATE SET latest_id=excluded.latest_id',
                                    (source['id'], member, latest))
                    self.db.execute('UPDATE signal_documents SET sha=? WHERE source_id=? AND url LIKE ?',
                                    ('x-edit-quarantined:' + latest, source['id'], '%/status/' + member))
                    # Older parser versions may have retained this member as
                    # unselected. Prevent replay from reviving ANY chain copy,
                    # not only the newest edit inserted by this stream receipt.
                    self.db.execute('UPDATE signal_x_acquisition SET selected_for_processing=1 WHERE source_id=? AND url LIKE ?',
                                    (source['id'], '%/status/' + member))
                digest = hashlib.sha256((copy['title'] + '\n' + copy['text']).encode()).hexdigest()
                # "selected_for_processing" means consumed by intake, not
                # publication approved. Mark handled to prevent parser replay
                # from undoing quarantine; retain the original privately.
                self.db.execute('INSERT OR IGNORE INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,1)',
                                (source['id'], copy['url'], digest, copy['title'], copy['text'],
                                 copy['publishedAt'], observed, observed, int(copy['truncated'])))
                continue
            accepted.append(copy)
            publishable.extend(item for item in items if item['url'] == copy['url'])
        changed = 0
        for copy in accepted:
            identity = copy['url'].rsplit('/', 1)[-1]
            canonical = self.db.execute("""SELECT url FROM signal_documents WHERE source_id=? AND url LIKE ?
              UNION ALL SELECT url FROM signal_x_acquisition WHERE source_id=? AND url LIKE ? LIMIT 1""",
              (source['id'], '%/status/' + identity, source['id'], '%/status/' + identity)).fetchone()
            item = next((dict(item) for item in publishable if item['url'] == copy['url']), None)
            if canonical:
                copy = dict(copy, url=canonical['url'])
                if item:
                    item['url'] = copy['url']
            digest = hashlib.sha256((copy['title'] + '\n' + copy['text']).encode()).hexdigest()
            old = self.db.execute('SELECT sha,last_seen_at FROM signal_documents WHERE source_id=? AND url=?',
                                  (source['id'], copy['url'])).fetchone()
            known = self.db.execute('SELECT first_seen_at FROM signal_x_acquisition WHERE source_id=? AND url=? AND sha=?',
                                    (source['id'], copy['url'], digest)).fetchone()
            if old and old['sha'] != digest and (known or x_budget.utc(old['last_seen_at']) > x_budget.utc(observed)):
                # A delayed known old body cannot reinstall withdrawn facts.
                # Ambiguous A→B→A stays in the private inbox for human review.
                continue
            checked = max(observed, stamp(old['last_seen_at'])) if old else observed
            changed += signals.save_evidence(self.db, source, [item] if item else [],
                                             {'_acquired_posts': [copy]}, checked)
            earliest = min(observed, stamp(known['first_seen_at'])) if known else observed
            self.db.execute('UPDATE signal_x_acquisition SET first_seen_at=? WHERE source_id=? AND url=? AND sha=?',
                            (earliest, source['id'], copy['url'], digest))
            self.db.execute('''UPDATE signal_events SET observed_at=? WHERE source_id=? AND url=? AND sha=?
              AND julianday(observed_at)>julianday(?)''',
                            (earliest, source['id'], copy['url'], digest, earliest))
        return changed

    def drain(self, limit=32):
        if type(limit) is not int or not 1 <= limit <= MAX_INBOX:
            raise StreamBlocked('x-stream-drain-limit-invalid')
        changed = 0
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            rows = self.db.execute('''SELECT a.source_id,a.receipt,i.payload,i.received_at
              FROM x_stream_associations a JOIN x_stream_inbox i ON i.receipt=a.receipt
              WHERE a.processed=0 ORDER BY julianday(i.received_at),i.rowid LIMIT ?''', (limit,)).fetchall()
            for row in rows:
                envelope = json.loads(row['payload'])
                payload = {'data': [envelope['data']], 'includes': envelope.get('includes', {})}
                before = self.db.total_changes
                self.db.execute('SAVEPOINT project_receipt')
                processed = 1
                try:
                    self._project(self.sources[row['source_id']], payload, row['received_at'])
                except (StreamBlocked, ValueError, TypeError, KeyError):
                    self.db.execute('ROLLBACK TO project_receipt')
                    processed = -1  # Quarantined; unrelated receipts still drain.
                self.db.execute('RELEASE project_receipt')
                changed += self.db.total_changes - before
                self.db.execute('UPDATE x_stream_associations SET processed=? WHERE source_id=? AND receipt=?',
                                (processed, row['source_id'], row['receipt']))
            # Only processed inbox rows may be removed; pending evidence survives.
            self.db.execute('''DELETE FROM x_stream_inbox WHERE receipt NOT IN
              (SELECT receipt FROM x_stream_associations WHERE processed=0)
              AND receipt NOT IN (SELECT receipt FROM x_stream_inbox ORDER BY rowid DESC LIMIT ?)''', (MAX_RETAINED,))
            self.db.execute('DELETE FROM x_stream_associations WHERE receipt NOT IN (SELECT receipt FROM x_stream_inbox)')
            for source_id in SOURCE_IDS:
                for table in ('signal_documents', 'signal_events'):
                    self.db.execute(f'''DELETE FROM {table} WHERE source_id=? AND rowid NOT IN
                      (SELECT rowid FROM {table} WHERE source_id=? ORDER BY rowid DESC LIMIT ?)''',
                                    (source_id, source_id, MAX_RETAINED))
            self.db.execute('''DELETE FROM x_stream_edits WHERE rowid NOT IN
              (SELECT rowid FROM x_stream_edits ORDER BY rowid DESC LIMIT 20000)''')
        if changed:
            self.wake()  # Wake only after durable commit; no publication bypass.
        return len(rows)

    def open_gap(self, start, end):
        start, end = x_budget.utc(start), x_budget.utc(end)
        if not start < end <= x_budget.utc(self.clock()):
            raise StreamBlocked('x-stream-gap-invalid')
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            candidates = []
            for source_id in SOURCE_IDS:
                checkpoint = self.db.execute('SELECT completed_through FROM x_stream_search_checkpoint WHERE source_id=?',
                                             (source_id,)).fetchone()
                boundary = x_budget.utc(checkpoint[0]) if checkpoint else None
                if boundary:
                    # A completed checkpoint is durable proof, so compact old
                    # completed rows while keeping a small diagnostic history.
                    self.db.execute('''DELETE FROM x_stream_gaps WHERE source_id=? AND status='complete'
                      AND julianday(end_at)<=julianday(?) AND id NOT IN
                      (SELECT id FROM x_stream_gaps WHERE source_id=? AND status='complete'
                       ORDER BY id DESC LIMIT 100)''', (source_id, stamp(boundary), source_id))
                    if end <= boundary:
                        continue
                # Clip only against completed SEARCH coverage, never stream IDs.
                source_start = max(start, boundary-timedelta(seconds=5)) if boundary else start
                existing = self.db.execute('SELECT 1 FROM x_stream_gaps WHERE source_id=? AND start_at=? AND end_at=?',
                                           (source_id, stamp(source_start), stamp(end))).fetchone()
                if not existing:
                    candidates.append((source_id, stamp(source_start), stamp(end)))
            pending = self.db.execute("SELECT COUNT(*) FROM x_stream_gaps WHERE status='pending'").fetchone()[0]
            total = self.db.execute('SELECT COUNT(*) FROM x_stream_gaps').fetchone()[0]
            if pending + len(candidates) > 128 or total + len(candidates) > 1000:
                raise StreamBlocked('x-stream-gap-limit')
            for candidate in candidates:
                self.db.execute('INSERT INTO x_stream_gaps(source_id,start_at,end_at) VALUES(?,?,?)', candidate)

    def recovery_request(self, gap_id, now=None):
        current = x_budget.utc(now or self.clock())
        row = self.db.execute('SELECT * FROM x_stream_gaps WHERE id=?', (gap_id,)).fetchone()
        if not row or row['status'] != 'pending':
            raise StreamBlocked('x-stream-gap-not-pending')
        if x_budget.utc(row['start_at']) < current - timedelta(days=7):
            with self.db:
                self.db.execute("UPDATE x_stream_gaps SET status='unrecoverable' WHERE id=?", (gap_id,))
            raise StreamBlocked('x-stream-gap-outside-search-window')
        request = {'query': self.sources[row['source_id']]['query'], 'max_results': 30,
                   'start_time': row['start_at'], 'end_time': row['end_at'],
                   'post.fields': 'created_at,author_id,lang,note_post',
                   'expansions': 'author_id', 'user.fields': 'username'}
        if row['next_token']:
            request['next_token'] = row['next_token']
        return request

    def commit_recovery_page(self, gap_id, payload, *, expected_token=None, reservation=None, received_at=None):
        """Page evidence + token + completion are one transaction. No stream ID.

        Caller may fetch only bounded, fairly scheduled pages. A failed page or
        interrupted chain remains pending and must NOT advance the watermark.
        """
        now = x_budget.utc(received_at or self.clock())
        if not self.offline and not reservation:
            raise StreamBlocked('x-stream-recovery-unreserved')
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            meter = (x_budget.account_receipt(self.db, reservation, payload, now)
                     if reservation else {})
            try:
                if reservation and (meter.get('ambiguous') or meter.get('overshot')
                                    or self.db.execute('SELECT 1 FROM x_budget_stop').fetchone()):
                    raise x_budget.BudgetBlocked('x-budget-recovery-delivery-blocked')
                if not isinstance(payload, dict) or not isinstance(payload.get('data', []), list) or payload.get('errors'):
                    raise StreamBlocked('x-stream-recovery-invalid')
                meta = payload.get('meta')
                data = payload.get('data', [])
                token = meta.get('next_token') if isinstance(meta, dict) else None
                if (not isinstance(meta, dict) or type(meta.get('result_count')) is not int
                        or meta['result_count'] != len(data) or not 0 <= len(data) <= 30
                        or (token is not None and (not isinstance(token, str) or not 1 <= len(token) <= 2048
                                                  or token == expected_token or not data))):
                    raise StreamBlocked('x-stream-recovery-token-invalid')
                row = self.db.execute('SELECT * FROM x_stream_gaps WHERE id=?', (gap_id,)).fetchone()
                if not row or row['status'] != 'pending' or row['next_token'] != expected_token:
                    raise StreamBlocked('x-stream-recovery-page-stale')
                if row['page_count'] >= 1000:
                    raise StreamBlocked('x-stream-recovery-page-limit')
                for post in data:
                    if (not isinstance(post, dict) or not isinstance(post.get('id'), str)
                            or not post['id'].isdigit() or len(post['id']) > 32
                            or not x_budget.utc(row['start_at']) <= x_budget.utc(post.get('created_at')) < x_budget.utc(row['end_at'])):
                        raise StreamBlocked('x-stream-recovery-outside-interval')
                x_budget.payload_resources(payload)
                # Every returned post must have complete approved acquisition
                # evidence even when the editorial parser selects zero items.
                evidence = x_api.acquired_posts(self.sources[row['source_id']], payload)
                if len(evidence) != len(data):
                    raise StreamBlocked('x-stream-recovery-evidence-incomplete')
            except (StreamBlocked, x_budget.BudgetBlocked):
                if reservation:
                    self.db.execute("INSERT OR REPLACE INTO x_budget_stop VALUES(1,'unvalidated-paid-page')")
                    # Keep paid delivery accounting even when the page cannot
                    # prove coverage; retain its full reservation and old token.
                    self.db.commit()
                raise
            self.db.execute('SAVEPOINT recovery_projection')
            try:
                self._project(self.sources[row['source_id']], payload, stamp(now))
            except Exception:
                self.db.execute('ROLLBACK TO recovery_projection')
                self.db.execute('RELEASE recovery_projection')
                if reservation:
                    self.db.execute("INSERT OR REPLACE INTO x_budget_stop VALUES(1,'recovery-projection-block')")
                    self.db.commit()  # Keep delivered cost, not partial evidence.
                raise
            self.db.execute('RELEASE recovery_projection')
            if reservation:
                entry = self.db.execute('SELECT purpose FROM x_budget_reservations WHERE id=?', (reservation,)).fetchone()
                if entry['purpose'] not in {'search', 'recovery'}:
                    raise StreamBlocked('x-stream-recovery-reservation-purpose')
                self.db.execute("UPDATE x_budget_reservations SET reserved=consumed,state='closed' WHERE id=?", (reservation,))
            self.db.execute('UPDATE x_stream_gaps SET next_token=?,page_count=page_count+1,status=? WHERE id=?',
                            (token, 'pending' if token else 'complete', gap_id))
            if not token:
                # Recompute the completed prefix so completing an older gap
                # also unlocks any later gap that was finished out of order.
                through = None
                for gap in self.db.execute('SELECT end_at,status FROM x_stream_gaps WHERE source_id=? ORDER BY julianday(start_at),id',
                                           (row['source_id'],)):
                    if gap['status'] != 'complete':
                        break
                    through = max(through or gap['end_at'], gap['end_at'])
                if through:
                    self.db.execute('''INSERT INTO x_stream_search_checkpoint VALUES(?,?)
                      ON CONFLICT(source_id) DO UPDATE SET completed_through=MAX(completed_through,excluded.completed_through)''',
                                    (row['source_id'], through))
        self.wake()

    def begin(self, owner, allowance_micros):
        if not self.enabled:
            return False
        if self.offline:
            raise StreamBlocked('x-stream-offline-network-forbidden')
        now = self.clock()
        if not isinstance(self.activation, Activation):
            raise StreamBlocked('x-stream-activation-missing')
        self.rule_map = self.activation.check(now, self.rules)
        if not isinstance(owner, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', owner):
            raise StreamBlocked('x-stream-owner-invalid')
        existing = self.db.execute('SELECT * FROM x_stream_state WHERE singleton=1').fetchone()
        if self.db.execute('SELECT 1 FROM x_stream_owner').fetchone():
            raise StreamBlocked('x-stream-owner-already-active')
        if existing['state'] in {'entitlement-blocked', 'operator-blocked', 'budget-paused'}:
            raise StreamBlocked('x-stream-operator-review-required')
        if existing['retry_at'] and x_budget.utc(existing['retry_at']) > x_budget.utc(now):
            raise StreamBlocked('x-stream-retry-not-due')
        # Reserve before ownership and before transport construction. A losing
        # ownership race retains its reservation conservatively, without I/O.
        reservation = x_budget.reserve(self.db, 'stream', allowance_micros, now)
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            state = self.db.execute('SELECT * FROM x_stream_state WHERE singleton=1').fetchone()
            if self.db.execute('SELECT 1 FROM x_stream_owner').fetchone():
                raise StreamBlocked('x-stream-owner-already-active')
            if state['state'] in {'entitlement-blocked', 'operator-blocked', 'budget-paused'}:
                raise StreamBlocked('x-stream-operator-review-required')
            if state['retry_at'] and x_budget.utc(state['retry_at']) > x_budget.utc(now):
                raise StreamBlocked('x-stream-retry-not-due')
            cutoff = stamp(x_budget.utc(now) - timedelta(minutes=15))
            self.db.execute('DELETE FROM x_stream_attempts WHERE attempted_at<?', (cutoff,))
            if self.db.execute('SELECT COUNT(*) FROM x_stream_attempts').fetchone()[0] >= 40:
                raise StreamBlocked('x-stream-connection-rate-paused')
            self.db.execute('INSERT INTO x_stream_attempts VALUES(?)', (stamp(now),))
            self.db.execute('INSERT INTO x_stream_owner VALUES(1,?,?,?)', (owner, reservation, stamp(now)))
            self.db.execute("UPDATE x_stream_state SET state='connecting',connected_at=? WHERE singleton=1", (stamp(now),))
        self.owner, self.reservation = owner, reservation
        return True

    def fail(self, status=None, *, retry_after=0, quota=False, connection_conflict=False):
        now = x_budget.utc(self.clock())
        row = self.db.execute('SELECT * FROM x_stream_state WHERE singleton=1').fetchone()
        failures = min(20, row['failures'] + 1)
        if status in (401, 403):
            state, delay = 'entitlement-blocked', None
        elif status == 402 or quota:
            state, delay = 'budget-paused', None
        elif connection_conflict or (status and status not in (429,) and not 500 <= status <= 599):
            state, delay = 'operator-blocked', None
        else:
            base = min(320, 5 * 2 ** (failures - 1)) if status else min(16, failures * .25)
            if status == 429:
                base = max(60, base)
            hint = retry_after if type(retry_after) in (int, float) and 0 <= retry_after <= 86400 else 0
            # Persist deterministic bounded jitter; process restart never resets.
            delay = max(hint, base + (failures % 7) * .1)
            state = 'retrying'
        with self.db:
            self.db.execute('UPDATE x_stream_state SET state=?,failures=?,retry_at=? WHERE singleton=1',
                            (state, failures, stamp(now + timedelta(seconds=delay)) if delay else None))
            if status in (401, 402, 403) or quota or connection_conflict:
                # Never reinterpret auth/quota/unknown connection ownership as
                # permission to spend through a fallback endpoint.
                self.db.execute("INSERT OR REPLACE INTO x_budget_stop VALUES(1,'provider-or-ownership-block')")
        return state

    async def run_once(self, transport_factory, *, owner='stream-worker', allowance_micros=0):
        """Call on a DEDICATED loop, never the three-source polling executor.

        Contract: transport_factory(URL, params) returns an async context manager
        with async .read(65536), and closes ONLY its socket on context exit. It
        must reject redirects, use existing service-only auth, expose no secrets,
        and raise sanitized status failures. The guarded implementation lives in
        x_stream_transport; service lifecycle wiring lives in x_stream_runtime.
        """
        if not self.begin(owner, allowance_micros):
            return 'off'
        decoder = Decoder()
        started = x_budget.utc(self.clock())
        try:
            async with transport_factory(STREAM_URL, dict(STREAM_PARAMS)) as stream:
                gap_start = self.db.execute('SELECT disconnected_since FROM x_stream_state WHERE singleton=1').fetchone()[0]
                if gap_start and x_budget.utc(gap_start) < x_budget.utc(self.clock()):
                    self.open_gap(gap_start, self.clock())
                with self.db:
                    self.db.execute("UPDATE x_stream_state SET state='connected-quiet',disconnected_since=NULL WHERE singleton=1")
                while True:
                    # Stale policy/day/cycle/ownership all stop an existing stream
                    # before another read, not only before connection attempts.
                    x_budget.policy_for(self.db, self.clock())
                    active = self.db.execute('SELECT 1 FROM x_stream_owner WHERE owner=? AND reservation_id=?',
                                             (self.owner, self.reservation)).fetchone()
                    if not active:
                        raise StreamBlocked('x-stream-owner-lost')
                    current = x_budget.utc(self.clock())
                    if current.date() != started.date():
                        raise x_budget.BudgetBlocked('x-budget-day-boundary')
                    chunk = await asyncio.wait_for(stream.read(65536), timeout=HEARTBEAT_SECONDS)
                    if not chunk:
                        decoder.finish()
                        break
                    self.heartbeat()
                    must_close = False
                    routing_error = False
                    try:
                        for envelope in decoder.feed(chunk):
                            try:
                                meter = self._receive(envelope, self.clock(), self.reservation)
                                must_close = must_close or meter['close_required']
                            except (StreamBlocked, x_budget.BudgetBlocked):
                                routing_error = True
                                # Continue accounting complete frames that have
                                # ALREADY arrived in this same socket read.
                    except StreamBlocked:
                        with self.db:
                            self.db.execute("INSERT OR REPLACE INTO x_budget_stop VALUES(1,'ambiguous-delivery')")
                        raise
                    if must_close:
                        raise x_budget.BudgetBlocked('x-budget-stream-allowance-consumed')
                    if routing_error:
                        raise StreamBlocked('x-stream-delivered-frame-rejected')
                    if current - started >= timedelta(minutes=2):
                        with self.db:
                            self.db.execute('UPDATE x_stream_state SET failures=0,retry_at=NULL WHERE singleton=1')
            self.fail()
        except x_budget.BudgetBlocked:
            with self.db:
                self.db.execute("UPDATE x_stream_state SET state='budget-paused' WHERE singleton=1")
        except TransportFailure as exc:
            self.fail(exc.status, retry_after=exc.retry_after, quota=exc.quota,
                      connection_conflict=exc.connection_conflict)
        except (asyncio.TimeoutError, OSError):
            self.fail()
        except StreamBlocked:
            self.fail(status=400)
        except asyncio.CancelledError:
            with self.db:
                self.db.execute("UPDATE x_stream_state SET state='off' WHERE singleton=1")
            raise
        except Exception:
            # Never persist raw provider messages, headers, bodies or auth.
            self.fail(status=400)
        finally:
            if decoder.buffer.strip():
                # A partial final frame may already be billable. Keep the full
                # reservation and freeze ALL readers, including after EOF,
                # read failure, timeout or cancellation in the middle of a post.
                with self.db:
                    self.db.execute("INSERT OR REPLACE INTO x_budget_stop VALUES(1,'incomplete-paid-frame')")
            # Context manager exit happens before lease release. A hard crash
            # deliberately leaves a stale owner for reviewed reconciliation.
            with self.db:
                x_budget.close_reservation(self.db, self.reservation)
                self.db.execute('DELETE FROM x_stream_owner WHERE owner=?', (self.owner,))
            self.owner, self.reservation = None, None
            ended = x_budget.utc(self.clock())
            state = self.db.execute('SELECT last_committed_at,disconnected_since FROM x_stream_state WHERE singleton=1').fetchone()
            gap_start = state['disconnected_since'] or stamp(
                max(started, x_budget.utc(state['last_committed_at']) if state['last_committed_at'] else started)
                - timedelta(seconds=5))
            with self.db:
                self.db.execute('UPDATE x_stream_state SET disconnected_since=? WHERE singleton=1', (gap_start,))
        return self.db.execute('SELECT state FROM x_stream_state WHERE singleton=1').fetchone()[0]

    def health(self):
        row = self.db.execute('SELECT * FROM x_stream_state WHERE singleton=1').fetchone()
        return {'mode': 'off' if not self.enabled else 'offline' if self.offline else row['state'],
                'lastByteAt': row['last_byte_at'], 'lastCommittedAt': row['last_committed_at'],
                'pendingAssociations': self.db.execute('SELECT COUNT(*) FROM x_stream_associations WHERE processed=0').fetchone()[0],
                'pendingGaps': self.db.execute("SELECT COUNT(*) FROM x_stream_gaps WHERE status='pending'").fetchone()[0],
                'unrecoverableGaps': self.db.execute("SELECT COUNT(*) FROM x_stream_gaps WHERE status='unrecoverable'").fetchone()[0],
                'retryAt': row['retry_at']}


def main():
    """Local fixture runner only. There is deliberately no live CLI switch."""
    import argparse
    import sqlite3
    parser = argparse.ArgumentParser(description='Replay synthetic X stream NDJSON offline; never contacts X.')
    parser.add_argument('--offline-fixture', type=Path, required=True)
    parser.add_argument('--observed-at', required=True, help='Synthetic timezone-aware observation time')
    args = parser.parse_args()
    observed = x_budget.utc(args.observed_at)
    with sqlite3.connect(':memory:') as db:
        db.row_factory = sqlite3.Row
        coordinator = Coordinator(db, list(signals.ALIASES), enabled=True, offline=True, clock=lambda: observed)
        decoder = Decoder()
        with args.offline_fixture.open('rb') as source:
            while chunk := source.read(65536):
                for frame in decoder.feed(chunk):
                    coordinator.ingest_fixture(frame)
                    coordinator.drain()
        decoder.finish()
        print(json.dumps({'health': coordinator.health(),
                          'events': db.execute('SELECT COUNT(*) FROM signal_events').fetchone()[0],
                          'acquired': db.execute('SELECT COUNT(*) FROM signal_x_acquisition').fetchone()[0],
                          'providerRequests': 0}, sort_keys=True))


if __name__ == '__main__':
    main()
