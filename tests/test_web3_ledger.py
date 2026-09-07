"""On-chain anchoring backend.

Runs against ``InMemoryAnchorContract``, never a real node - CI has no
Ethereum and must never need one. The properties that genuinely require a
chain (only the coordinator may write; the contract itself rejects a re-anchor)
are covered by the Hardhat tests in ``blockchain/test/FedGuardAnchor.test.js``.

What these tests cover is the Python half of the claim: that the two backends
commit to the same content, and that anchoring closes the hole the local
backend openly documents.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from fedguard.coordinator.blockchain_client import LocalHashChainClient
from fedguard.coordinator.web3_client import (
    InMemoryAnchorContract,
    Web3LedgerClient,
    hash_payload,
)

CONFIG_HASH = "9623635a0c41"


def params(scale: float = 1.0):
    return [np.array([[1.0, 2.0], [3.0, 4.0]]) * scale, np.array([0.5, -0.5]) * scale]


def decision(round_num: int, *, reputation=None) -> dict:
    return {
        "round": round_num,
        "accepted": ["bank_0", "bank_1"],
        "rejected": ["bank_2"],
        "weights": {"bank_0": 0.5, "bank_1": 0.5},
        "reputation": reputation if reputation is not None else {"bank_2": 0.31},
        "diagnostics": {},
    }


def verdict(round_num: int) -> dict:
    return {"round": round_num, "flagged": ["bank_2"], "boundary_version": "1.0.0"}


def evaluation() -> dict:
    return {"pr_auc": 0.73, "asr": 0.12}


@pytest.fixture
def client(tmp_path):
    return Web3LedgerClient(tmp_path / "ledger.jsonl", contract=InMemoryAnchorContract())


def anchor_rounds(client, n=3):
    for r in range(1, n + 1):
        client.store_model(
            config_hash=CONFIG_HASH,
            round_num=r,
            params=params(r),
            decision=decision(r),
            verdict=verdict(r),
            eval=evaluation(),
        )


# ---------------------------------------------------------------------------
# anchoring
# ---------------------------------------------------------------------------


def test_content_stays_local_and_hashes_go_on_chain(client):
    """The split the whole design rests on: the chain gets commitments, the
    decision content never leaves the local file."""
    client.store_model(
        config_hash=CONFIG_HASH,
        round_num=1,
        params=params(),
        decision=decision(1),
        verdict=verdict(1),
        eval=evaluation(),
    )

    entries = client.read_all()
    assert len(entries) == 1
    assert entries[0].decision["rejected"] == ["bank_2"]  # full content, locally

    on_chain = client._contract.get_run(CONFIG_HASH)
    assert len(on_chain) == 1
    # Only hashes are on-chain. Nothing here names a bank.
    assert on_chain[0].entry_hash == entries[0].entry_hash
    assert on_chain[0].model_hash == entries[0].model_hash


def test_reputation_is_committed_separately_from_the_decision(client):
    """Research claim 3. A commitment to the whole decision proves what was
    decided; a standalone reputation commitment is what a flagged bank would
    later have to argue against."""
    client.store_model(
        config_hash=CONFIG_HASH,
        round_num=1,
        params=params(),
        decision=decision(1, reputation={"bank_2": 0.31}),
        verdict=verdict(1),
        eval=evaluation(),
    )
    anchor = client._contract.get_run(CONFIG_HASH)[0]

    assert anchor.reputation_hash == hash_payload({"bank_2": 0.31})
    assert anchor.decision_hash == hash_payload(decision(1, reputation={"bank_2": 0.31}))
    assert anchor.reputation_hash != anchor.decision_hash


def test_rounds_chain_to_their_predecessor(client):
    anchor_rounds(client, 3)
    on_chain = client._contract.get_run(CONFIG_HASH)
    assert len(on_chain) == 3
    for previous, current in zip(on_chain, on_chain[1:], strict=False):
        assert current.prev_hash == previous.entry_hash


def test_contract_refuses_to_re_anchor_a_round(client):
    """Mirrors the Solidity revert, so the Python side is exercised against
    the same rule rather than assuming the contract will catch it."""
    anchor_rounds(client, 1)
    with pytest.raises(ValueError, match="already anchored"):
        client._contract.anchor_round(
            config_hash=CONFIG_HASH,
            round_num=1,
            model_hash="a" * 64,
            reputation_hash="b" * 64,
            decision_hash="c" * 64,
            entry_hash="d" * 64,
            prev_hash="e" * 64,
        )


# ---------------------------------------------------------------------------
# verification
# ---------------------------------------------------------------------------


def test_verify_passes_on_an_untouched_pair(client):
    anchor_rounds(client, 3)
    result = client.verify()
    assert result.ok, result.report()
    assert result.entries_checked == 3


def test_verify_catches_a_wholesale_local_rewrite(client, tmp_path):
    """THE test. This is the attack the local-only backend cannot catch, and
    the entire justification for putting a chain behind this.

    ledger/chain.py documents plainly that someone with write access can
    rewrite the file into a new, internally consistent chain. Reproduced here:
    the rewritten ledger passes the local backend's verify() completely. It
    fails once the on-chain commitments are consulted, because the attacker
    could not write those.
    """
    ledger = tmp_path / "ledger.jsonl"
    anchor_rounds(client, 3)

    # Forge a history in which bank_2 was never rejected, recomputing every
    # hash so the chain is internally consistent - exactly what an attacker
    # with filesystem access would do.
    from fedguard.ledger.chain import GENESIS_HASH, LedgerEntry

    forged, prev = [], GENESIS_HASH
    for i, line in enumerate(ledger.read_text(encoding="utf-8").splitlines()):
        entry = LedgerEntry.from_dict(json.loads(line))
        entry.decision["rejected"] = []
        entry.decision["accepted"] = ["bank_0", "bank_1", "bank_2"]
        entry.prev_hash = prev
        entry.entry_hash = entry.recompute_hash()
        prev = entry.entry_hash
        forged.append(json.dumps(entry.to_dict()))
        assert entry.index == i
    ledger.write_text("\n".join(forged) + "\n", encoding="utf-8")

    # The local backend is satisfied. This is not a bug in it - it is the
    # documented limit of what a single file can prove.
    local_view = LocalHashChainClient(ledger)
    assert local_view.verify().ok, "the forgery should be internally consistent"

    # The anchored backend is not.
    result = client.verify()
    assert not result.ok
    assert "on-chain" in (result.reason or "")


def test_verify_catches_an_altered_final_entry(client, tmp_path):
    """The last entry is the interesting one to tamper with.

    Altering a middle entry and recomputing its hash breaks the NEXT entry's
    prev_hash, so the purely local check already catches it - which is what
    ledger/chain.py's tamper-evidence buys you. The final entry has no
    successor to break, so a rewrite of it produces a locally valid chain and
    only the on-chain commitment can tell.
    """
    ledger = tmp_path / "ledger.jsonl"
    anchor_rounds(client, 2)

    from fedguard.ledger.chain import LedgerEntry

    lines = ledger.read_text(encoding="utf-8").splitlines()
    entry = LedgerEntry.from_dict(json.loads(lines[-1]))
    entry.decision["reputation"] = {"bank_2": 0.99}  # "we always trusted them"
    entry.entry_hash = entry.recompute_hash()
    lines[-1] = json.dumps(entry.to_dict())
    ledger.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # Locally consistent - the local backend cannot see this.
    assert LocalHashChainClient(ledger).verify().ok

    result = client.verify()
    assert not result.ok
    assert result.failed_round == 2


def test_verify_catches_a_round_that_was_never_anchored(client, tmp_path):
    """A coordinator that quietly skipped anchoring an inconvenient round."""
    anchor_rounds(client, 2)
    client._chain.append(
        config_hash=CONFIG_HASH,
        round_num=3,
        model_hash="f" * 64,
        decision=decision(3),
        verdict=verdict(3),
        eval=evaluation(),
    )

    result = client.verify()
    assert not result.ok
    assert result.failed_round == 3
    assert "never anchored" in (result.reason or "")


def test_verify_reports_local_corruption_before_consulting_the_chain(client, tmp_path):
    """A broken local link is reported as such, not as a chain mismatch - the
    reason a reader gets should name what is actually wrong."""
    ledger = tmp_path / "ledger.jsonl"
    anchor_rounds(client, 2)

    lines = ledger.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[1])
    tampered["prev_hash"] = "0" * 64
    lines[1] = json.dumps(tampered)
    ledger.write_text("\n".join(lines) + "\n", encoding="utf-8")

    result = client.verify()
    assert not result.ok
    assert "chain link broken" in (result.reason or "")


def test_backends_agree_on_entry_content(tmp_path):
    """Both backends must compute entry_hash identically, or a run anchored
    with one could never be verified with the other."""
    shared_kwargs = dict(
        config_hash=CONFIG_HASH,
        round_num=1,
        params=params(),
        decision=decision(1),
        verdict=verdict(1),
        eval=evaluation(),
    )
    local = LocalHashChainClient(tmp_path / "a.jsonl").store_model(**shared_kwargs)
    anchored = Web3LedgerClient(
        tmp_path / "b.jsonl", contract=InMemoryAnchorContract()
    ).store_model(**shared_kwargs)

    assert local.model_hash == anchored.model_hash
    assert local.prev_hash == anchored.prev_hash
    # timestamp differs between the two writes, so compare the content hash
    # over everything else rather than entry_hash itself.
    a, b = local.to_dict(), anchored.to_dict()
    a.pop("timestamp"), b.pop("timestamp")
    a.pop("entry_hash"), b.pop("entry_hash")
    assert a == b
