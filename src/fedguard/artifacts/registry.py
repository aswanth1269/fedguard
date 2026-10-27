"""Append-only, hash-linked registry of artifact versions and integrity events.

Separate from ``results/ledger.jsonl`` on purpose. The round ledger records
what the coordinator DECIDED each round and is the thing optionally anchored
on-chain; its entry schema is a cross-team contract. This registry records
the ARTIFACTS - each bank's model update, each global model, each registered
dataset - plus every submission attempt and every verification check. It
reuses the same canonical-JSON hashing and the same chain construction so
that both logs mean the same thing by "tamper-evident".

Three record kinds:

``version``              an artifact version that was stored (accepted,
                         quarantined, or pending review).
``rejected_submission``  an attempt that failed identity, signature,
                         authorisation or schema checks. Logged, NOT stored,
                         and never given a version number.
``verification``         one integrity check of some candidate content
                         against one recorded version.

Nothing is ever updated in place. A new version is a new record pointing at
the previous version; content files are content-addressed under
``store/<hash>``, so a later version can never overwrite an earlier file.

TRUST MODEL (same as ledger/chain.py): tamper-EVIDENT, not tamper-resistant.
Editing a past record breaks every later ``entry_hash`` and ``verify()``
reports where. Someone with write access could still rewrite the whole file
consistently. Nothing in this registry is anchored on-chain; a global model's
``ledger_ref`` points at the round-ledger entry, which is anchored when the
web3 backend is configured.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from pathlib import Path

from fedguard.ledger.chain import GENESIS_HASH, _canonical_bytes

__all__ = ["ArtifactRegistry"]


def _entry_hash(record: dict) -> str:
    payload = {k: v for k, v in record.items() if k != "entry_hash"}
    return hashlib.sha256(_canonical_bytes(payload)).hexdigest()


class ArtifactRegistry:
    def __init__(self, registry_path: str | Path, store_dir: str | Path) -> None:
        self.path = Path(registry_path)
        self.store = Path(store_dir)
        self._lock = threading.Lock()

    # -- content store -----------------------------------------------------
    def put_content(self, content_hash: str, data: bytes, ext: str) -> str:
        """Content-addressed and write-once. Returns an opaque storage key -
        never a filesystem path, so no route ever leaks one."""
        key = f"{content_hash}.{ext}"
        target = self.store / key
        if not target.exists():
            self.store.mkdir(parents=True, exist_ok=True)
            tmp = target.with_suffix(target.suffix + ".tmp")
            tmp.write_bytes(data)
            tmp.replace(target)
        return key

    def get_content(self, storage_key: str) -> bytes:
        if "/" in storage_key or "\\" in storage_key or ".." in storage_key:
            raise ValueError("invalid storage key")
        return (self.store / storage_key).read_bytes()

    # -- records -----------------------------------------------------------
    def _read_unlocked(self) -> list[dict]:
        if not self.path.exists():
            return []
        out = []
        with open(self.path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    break  # only a crash mid-write can corrupt the tail
        return out

    def read_all(self) -> list[dict]:
        with self._lock:
            return self._read_unlocked()

    def get(self, seq: int) -> dict | None:
        records = self.read_all()
        return records[seq] if 0 <= seq < len(records) and records[seq]["seq"] == seq else None

    def versions(self, artifact_id: str | None = None) -> list[dict]:
        return [
            r
            for r in self.read_all()
            if r["kind"] == "version" and (artifact_id is None or r["artifact_id"] == artifact_id)
        ]

    def latest_version(self, artifact_id: str, *, accepted_only: bool = False) -> dict | None:
        vs = [
            v
            for v in self.versions(artifact_id)
            if not accepted_only or v["approval_status"] == "accepted"
        ]
        return vs[-1] if vs else None

    def append(self, record: dict) -> dict:
        """Assigns ``seq``, ``version`` (for kind=version), the previous-version
        reference, timestamp and chain hashes atomically under one lock, so two
        concurrent submissions can never be handed the same version number."""
        with self._lock:
            existing = self._read_unlocked()
            rec = dict(record)
            rec["seq"] = len(existing)
            rec["timestamp"] = time.time()
            if rec["kind"] == "version":
                prior = [
                    r
                    for r in existing
                    if r["kind"] == "version" and r["artifact_id"] == rec["artifact_id"]
                ]
                rec["version"] = len(prior) + 1
                rec["previous_version_ref"] = (
                    {
                        "seq": prior[-1]["seq"],
                        "version": prior[-1]["version"],
                        "content_hash": prior[-1]["content_hash"],
                    }
                    if prior
                    else None
                )
            else:
                rec.setdefault("version", None)
                rec.setdefault("previous_version_ref", None)
            rec["prev_entry_hash"] = existing[-1]["entry_hash"] if existing else GENESIS_HASH
            rec["entry_hash"] = _entry_hash(rec)

            self.path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, sort_keys=True) + "\n")
            return rec

    def verify(self) -> dict:
        records = self.read_all()
        expected_prev = GENESIS_HASH
        for i, r in enumerate(records):
            if r.get("seq") != i:
                return {
                    "ok": False,
                    "entries_checked": i,
                    "failed_at_seq": i,
                    "reason": f"expected seq {i}, found {r.get('seq')} - a record is missing",
                }
            if r.get("prev_entry_hash") != expected_prev:
                return {
                    "ok": False,
                    "entries_checked": i,
                    "failed_at_seq": i,
                    "reason": "prev_entry_hash does not match the previous record - link broken",
                }
            if _entry_hash(r) != r.get("entry_hash"):
                return {
                    "ok": False,
                    "entries_checked": i,
                    "failed_at_seq": i,
                    "reason": "record content does not match its entry_hash - record was altered",
                }
            expected_prev = r["entry_hash"]
        return {"ok": True, "entries_checked": len(records), "failed_at_seq": None, "reason": None}
