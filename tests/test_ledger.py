"""Tests for the hash-chained ledger (src/fedguard/ledger/chain.py).

The two tests that matter most - test_tampering_is_detected and
test_deleted_tail_entry_is_detected - are the actual point of the whole
feature. Everything else here is standard append/read/hash-stability
coverage; those two prove the tamper-evidence property is real, not just
asserted in a docstring.
"""

from __future__ import annotations

import json

import numpy as np

from fedguard.ledger.chain import GENESIS_HASH, HashChain, hash_model_params


def make_entry_kwargs(round_num: int, **overrides) -> dict:
    defaults = dict(
        config_hash="cfg123",
        round_num=round_num,
        model_hash="deadbeef",
        decision={"accepted": ["bank_0"], "rejected": []},
        verdict={"flagged": [], "reasons": {}},
        eval={"pr_auc": 0.8},
    )
    defaults.update(overrides)
    return defaults


def test_hash_model_params_is_stable_and_content_sensitive():
    a = [np.array([1.0, 2.0, 3.0]), np.array([0.5])]
    b = [np.array([1.0, 2.0, 3.0]), np.array([0.5])]
    c = [np.array([1.0, 2.0, 3.1]), np.array([0.5])]

    assert hash_model_params(a) == hash_model_params(b)
    assert hash_model_params(a) != hash_model_params(c)
    assert len(hash_model_params(a)) == 64


def test_first_entry_chains_to_genesis(tmp_path):
    chain = HashChain(tmp_path / "ledger.jsonl")
    entry = chain.append(**make_entry_kwargs(1))
    assert entry.index == 0
    assert entry.prev_hash == GENESIS_HASH
    assert entry.entry_hash == entry.recompute_hash()


def test_entries_chain_in_order(tmp_path):
    chain = HashChain(tmp_path / "ledger.jsonl")
    first = chain.append(**make_entry_kwargs(1))
    second = chain.append(**make_entry_kwargs(2))
    third = chain.append(**make_entry_kwargs(3))

    assert [e.index for e in (first, second, third)] == [0, 1, 2]
    assert second.prev_hash == first.entry_hash
    assert third.prev_hash == second.entry_hash


def test_persists_across_instances(tmp_path):
    path = tmp_path / "ledger.jsonl"
    HashChain(path).append(**make_entry_kwargs(1))
    HashChain(path).append(**make_entry_kwargs(2))

    entries = HashChain(path).read_all()
    assert len(entries) == 2
    assert [e.round_num for e in entries] == [1, 2]


def test_read_all_filters_by_config_hash(tmp_path):
    chain = HashChain(tmp_path / "ledger.jsonl")
    chain.append(**make_entry_kwargs(1, config_hash="run-a"))
    chain.append(**make_entry_kwargs(1, config_hash="run-b"))
    chain.append(**make_entry_kwargs(2, config_hash="run-a"))

    assert len(chain.read_all()) == 3
    assert len(chain.read_all(config_hash="run-a")) == 2
    assert len(chain.read_all(config_hash="run-b")) == 1


def test_empty_chain_verifies_ok(tmp_path):
    chain = HashChain(tmp_path / "ledger.jsonl")
    result = chain.verify()
    assert result.ok
    assert result.entries_checked == 0


def test_untouched_chain_verifies_ok(tmp_path):
    chain = HashChain(tmp_path / "ledger.jsonl")
    for i in range(1, 6):
        chain.append(**make_entry_kwargs(i))

    result = chain.verify()
    assert result.ok
    assert result.entries_checked == 5
    assert "5 entries verified" in result.report()


def test_tampering_is_detected(tmp_path):
    """The actual point of the feature: silently editing one stored entry's
    content must be caught, and the report must name which entry and why."""
    path = tmp_path / "ledger.jsonl"
    chain = HashChain(path)
    for i in range(1, 4):
        chain.append(**make_entry_kwargs(i))

    lines = path.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[1])
    tampered["eval"]["pr_auc"] = 0.999  # silently alter round 2's recorded accuracy
    lines[1] = json.dumps(tampered)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    result = chain.verify()
    assert not result.ok
    assert result.failed_at_index == 1
    assert result.failed_round == 2
    assert "altered" in result.reason
    assert "FAILED at entry 1" in result.report()


def test_broken_link_is_detected(tmp_path):
    """A tampered prev_hash (not just tampered content) must also be caught -
    this is what actually makes it a CHAIN rather than independent records."""
    path = tmp_path / "ledger.jsonl"
    chain = HashChain(path)
    for i in range(1, 4):
        chain.append(**make_entry_kwargs(i))

    lines = path.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[2])
    tampered["prev_hash"] = "f" * 64
    lines[2] = json.dumps(tampered)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    result = chain.verify()
    assert not result.ok
    assert result.failed_at_index == 2
    assert "broken" in result.reason


def test_deleted_tail_entry_is_detected(tmp_path):
    """Deleting the newest entry outright leaves every remaining hash link
    intact - only the index-contiguity check catches a gap like this."""
    path = tmp_path / "ledger.jsonl"
    chain = HashChain(path)
    for i in range(1, 4):
        chain.append(**make_entry_kwargs(i))

    lines = path.read_text(encoding="utf-8").splitlines()
    del lines[1]  # remove the middle entry; index 2's prev_hash now points nowhere valid
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    result = chain.verify()
    assert not result.ok
    assert result.failed_at_index == 1


def test_crash_mid_write_only_loses_the_last_line(tmp_path):
    """A partial write can only ever corrupt the newest line - reading must
    recover every prior entry intact, matching completed_hashes()'s existing
    tolerance for a trailing malformed line in runs.jsonl."""
    path = tmp_path / "ledger.jsonl"
    chain = HashChain(path)
    chain.append(**make_entry_kwargs(1))
    chain.append(**make_entry_kwargs(2))

    with open(path, "a", encoding="utf-8") as f:
        f.write('{"index": 2, "incomplete"')  # simulated torn write, no trailing newline

    entries = chain.read_all()
    assert len(entries) == 2
    assert chain.verify().ok
