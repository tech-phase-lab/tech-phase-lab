"""Bounded process-local membership of exact successful validation inputs.

This stores immutable keys only, never a publication, mutable output or failure.
Callers retain all current-source and publication eligibility checks.
"""
from collections import OrderedDict
import json
import sys
from threading import Lock


class ValidationSuccess:
    def __init__(self, max_entries=128, max_bytes=8 * 1024 * 1024):
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self._entries = OrderedDict()
        self._bytes = 0
        self._policy = None
        self._lock = Lock()

    @staticmethod
    def key(value, body, title):
        if not isinstance(body, str) or not isinstance(title, str):
            return None
        try:
            payload = json.dumps(value, ensure_ascii=False, sort_keys=True,
                                 separators=(',', ':'), allow_nan=False)
        except (TypeError, ValueError, RecursionError):
            return None
        return body, title, payload

    @staticmethod
    def cost(key):
        # Count Python Unicode storage, not UTF-8 length. The allowance covers
        # the OrderedDict node/table, cost integer and per-entry allocator slack.
        return sys.getsizeof(key) + sum(sys.getsizeof(part) for part in key) + 512

    def contains(self, key, policy):
        with self._lock:
            if self._policy != policy:
                self._entries.clear()
                self._bytes = 0
                self._policy = policy
            if key is None or key not in self._entries:
                return False
            self._entries.move_to_end(key)
            return True

    def remember(self, key, policy):
        if key is None:
            return
        cost = self.cost(key)
        if cost > self.max_bytes:
            return
        with self._lock:
            # A miss validated outside the lock; a policy change meanwhile must
            # not let that older result repopulate or roll back the namespace.
            if self._policy != policy:
                return
            self._bytes -= self._entries.pop(key, 0)
            self._entries[key] = cost
            self._bytes += cost
            while len(self._entries) > self.max_entries or self._bytes > self.max_bytes:
                _, removed = self._entries.popitem(last=False)
                self._bytes -= removed

    def clear(self):
        with self._lock:
            self._entries.clear()
            self._bytes = 0
            self._policy = None
