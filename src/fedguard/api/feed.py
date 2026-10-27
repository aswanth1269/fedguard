"""In-memory transaction event feed.

There is no bank transaction source in this project - no database, no queue,
no stream. This is the minimal honest ingestion path: callers POST a
transaction, the server scores it through the same PredictionService as
POST /predict, and the scored event lands in a bounded ring buffer that the
dashboard polls with a ``seq`` cursor.

Every event carries ``source``. ``"api"`` means someone POSTed it;
``"synthetic_demo"`` means the server drew it from the synthetic generator
for a demonstration. The dashboard shows that label on every row, because a
feed of generated rows must never look like live bank traffic.

Same scope as JobStore: single process, lost on restart. ``transaction_id``
is deduplicated within the buffer's window so a client retrying a POST does
not double-count an event.
"""

from __future__ import annotations

import threading
from collections import OrderedDict, deque

__all__ = ["DuplicateTransaction", "TransactionFeed"]


class DuplicateTransaction(ValueError):
    pass


class TransactionFeed:
    def __init__(self, maxlen: int = 500) -> None:
        self._lock = threading.Lock()
        self._events: deque[dict] = deque(maxlen=maxlen)
        self._seen: OrderedDict[str, int] = OrderedDict()
        self._maxlen = maxlen
        self._seq = 0
        self._demo_cursor = 0

    def contains(self, transaction_id: str) -> bool:
        with self._lock:
            return transaction_id in self._seen

    def add(self, event: dict) -> dict:
        with self._lock:
            tid = event["transaction_id"]
            if tid in self._seen:
                raise DuplicateTransaction(tid)
            self._seq += 1
            stored = {**event, "seq": self._seq}
            self._events.append(stored)
            self._seen[tid] = self._seq
            while len(self._seen) > self._maxlen:
                self._seen.popitem(last=False)
            return stored

    def after(self, seq: int, limit: int = 100) -> tuple[list[dict], int]:
        with self._lock:
            out = [e for e in self._events if e["seq"] > seq][:limit]
            latest = self._seq
        # Oldest first, capped: a poller advancing its cursor to the last
        # returned seq sees every buffered event exactly once.
        # With nothing new, hand back the server's own latest seq - which also
        # resets a cursor left ahead by a server restart.
        return out, (out[-1]["seq"] if out else latest)

    def take_demo_indices(self, n: int) -> list[int]:
        """Positions in the demo pool, handed out once each."""
        with self._lock:
            start = self._demo_cursor
            self._demo_cursor += n
        return list(range(start, start + n))
