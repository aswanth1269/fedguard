"""A single-writer, append-only hash chain - not a blockchain.

Named honestly: each entry embeds the hash of the previous entry, so
altering any past entry breaks every hash after it. That is the same
mechanism a real blockchain's chain property rests on, without the
distributed/consensus parts that make a real chain resistant to tampering
even by whoever holds write access. What this provides is tamper-EVIDENCE -
silent tampering with ``results/ledger.jsonl`` is detectable by ``verify()``
- not tamper-RESISTANCE. Someone with filesystem access and enough effort
could still rewrite the whole file and produce a new, internally-consistent
but fabricated chain. See CLAUDE.md for the dated record of this choice over
a real Solidity/Hardhat deployment.

Persistence is one JSON object per line in an append-only file, the same
convention ``experiment.append_result`` already uses for ``runs.jsonl``:
each write is one line, so a crash mid-write can only corrupt the *last*
line, never an earlier one. ``read_all``/``verify`` tolerate a trailing
malformed line for exactly that reason.

Concurrency: a ``threading.Lock`` protects ``append()`` within one process,
matching ``api/jobs.py``'s ``JobStore``. True multi-process concurrent
writers could still race between reading the current tail and appending -
noted plainly as a known limitation rather than solved with file locking
this project's actual usage (one experiment run at a time) does not need.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from fedguard.types import Params

__all__ = [
    "GENESIS_HASH",
    "HashChain",
    "LedgerEntry",
    "VerificationResult",
    "hash_model_params",
]

GENESIS_HASH = "0" * 64


def hash_model_params(params: Params) -> str:
    """Hash of the model's actual weights, independent of JSON float
    rounding: each layer's raw bytes are streamed through one running
    SHA-256 in a fixed (layer) order, rather than hashing a
    string-formatted representation of the numbers."""
    digest = hashlib.sha256()
    for layer in params:
        digest.update(np.ascontiguousarray(layer).tobytes())
    return digest.hexdigest()


def _canonical_bytes(payload: dict) -> bytes:
    """The same canonicalisation ExperimentConfig.hash() already uses -
    sorted keys, no whitespace - so two payloads with identical content
    always hash identically regardless of dict insertion order."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


@dataclass
class LedgerEntry:
    index: int
    config_hash: str
    round_num: int
    model_hash: str
    decision: dict
    verdict: dict
    eval: dict
    timestamp: float
    prev_hash: str
    entry_hash: str

    def _payload(self) -> dict:
        """Every field except entry_hash itself - what entry_hash is a hash
        of. A method, not a stored field, so there is exactly one place
        that defines what "the content of this entry" means."""
        return {
            "index": self.index,
            "config_hash": self.config_hash,
            "round_num": self.round_num,
            "model_hash": self.model_hash,
            "decision": self.decision,
            "verdict": self.verdict,
            "eval": self.eval,
            "timestamp": self.timestamp,
            "prev_hash": self.prev_hash,
        }

    def recompute_hash(self) -> str:
        return hashlib.sha256(_canonical_bytes(self._payload())).hexdigest()

    def to_dict(self) -> dict:
        return {**self._payload(), "entry_hash": self.entry_hash}

    @classmethod
    def from_dict(cls, d: dict) -> LedgerEntry:
        return cls(
            index=d["index"],
            config_hash=d["config_hash"],
            round_num=d["round_num"],
            model_hash=d["model_hash"],
            decision=d["decision"],
            verdict=d["verdict"],
            eval=d["eval"],
            timestamp=d["timestamp"],
            prev_hash=d["prev_hash"],
            entry_hash=d["entry_hash"],
        )


@dataclass
class VerificationResult:
    ok: bool
    entries_checked: int
    failed_at_index: int | None = None
    failed_round: int | None = None
    reason: str | None = None

    def report(self) -> str:
        if self.ok:
            return f"OK - {self.entries_checked} entries verified"
        return (
            f"FAILED at entry {self.failed_at_index} (round {self.failed_round}): "
            f"{self.reason}"
        )


class HashChain:
    """One instance wraps one ledger file. Cheap to construct - state lives
    on disk, not in the instance - so callers do not need to share a single
    long-lived object the way ``JobStore`` does."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = threading.Lock()

    def append(
        self,
        *,
        config_hash: str,
        round_num: int,
        model_hash: str,
        decision: dict,
        verdict: dict,
        eval: dict,  # matches the field name used throughout this module
    ) -> LedgerEntry:
        with self._lock:
            existing = self._read_all_unlocked()
            index = len(existing)
            prev_hash = existing[-1].entry_hash if existing else GENESIS_HASH

            entry = LedgerEntry(
                index=index,
                config_hash=config_hash,
                round_num=round_num,
                model_hash=model_hash,
                decision=decision,
                verdict=verdict,
                eval=eval,
                timestamp=time.time(),
                prev_hash=prev_hash,
                entry_hash="",
            )
            entry.entry_hash = entry.recompute_hash()

            self.path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry.to_dict()) + "\n")

            return entry

    def read_all(self, config_hash: str | None = None) -> list[LedgerEntry]:
        with self._lock:
            entries = self._read_all_unlocked()
        if config_hash is None:
            return entries
        return [e for e in entries if e.config_hash == config_hash]

    def _read_all_unlocked(self) -> list[LedgerEntry]:
        if not self.path.exists():
            return []
        entries = []
        with open(self.path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(LedgerEntry.from_dict(json.loads(line)))
                except (json.JSONDecodeError, KeyError):
                    # A crash mid-write can only corrupt the last line - stop
                    # reading rather than skip past a gap in the chain.
                    break
        return entries

    def verify(self) -> VerificationResult:
        entries = self.read_all()
        expected_prev = GENESIS_HASH

        for i, entry in enumerate(entries):
            if entry.index != i:
                return VerificationResult(
                    ok=False,
                    entries_checked=i,
                    failed_at_index=i,
                    failed_round=entry.round_num,
                    reason=f"expected index {i}, found {entry.index} - an entry is missing",
                )
            if entry.prev_hash != expected_prev:
                return VerificationResult(
                    ok=False,
                    entries_checked=i,
                    failed_at_index=i,
                    failed_round=entry.round_num,
                    reason="prev_hash does not match the previous entry's hash - chain link broken",
                )
            if entry.recompute_hash() != entry.entry_hash:
                return VerificationResult(
                    ok=False,
                    entries_checked=i,
                    failed_at_index=i,
                    failed_round=entry.round_num,
                    reason="stored entry_hash does not match its own content - entry was altered",
                )
            expected_prev = entry.entry_hash

        return VerificationResult(ok=True, entries_checked=len(entries))
