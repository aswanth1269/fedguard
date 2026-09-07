"""On-chain anchoring backend. Registers as ``FEDGUARD_LEDGER_BACKEND=web3``.

Implements the same ``LedgerClient`` interface ``LocalHashChainClient`` does,
so nothing that anchors a round knows which backend it is talking to.

WHAT GOES ON-CHAIN, AND WHAT DOES NOT
-------------------------------------
Commitments on-chain, content off-chain. Each round writes three hashes to the
contract - ``modelHash``, ``reputationHash``, ``decisionHash`` - plus the
``entryHash``/``prevHash`` link. The full decision, verdict and eval dicts stay
in the local ``ledger.jsonl``.

That split is not a cost optimisation, though it is much cheaper. Putting the
decision content itself on a chain would publish which bank was rejected in
which round to anyone who can read the chain, which is precisely the
information a federation of competing banks joined a privacy-preserving scheme
to avoid sharing. The commitment proves what the decision *was* without
revealing it.

WHY THIS IS STRICTLY STRONGER THAN THE LOCAL BACKEND
----------------------------------------------------
``ledger/chain.py`` is honestly documented as tamper-EVIDENT only: someone with
write access to the file can rewrite the whole thing into a new, internally
consistent chain that still passes ``verify()``. Nothing about a local file can
prevent that.

This backend closes exactly that hole. ``verify()`` here checks the local chain
links *and* re-derives each entry's hashes and compares them against what the
contract recorded. A wholesale local rewrite now fails, because the attacker
cannot also rewrite the on-chain commitments: the contract only accepts writes
from the coordinator address and reverts on any attempt to re-anchor a round
that already exists. Tamper-evidence becomes tamper-resistance, and that is the
entire reason the chain is load-bearing rather than decorative.

RUNNING IT
----------
    cd blockchain && npx hardhat node        # terminal 1
    npm run deploy:local                     # terminal 2, writes deployments/
    pip install -e ".[chain]"
    export FEDGUARD_LEDGER_BACKEND=web3
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any, Protocol

from fedguard.coordinator.blockchain_client import LedgerClient
from fedguard.ledger.chain import (
    GENESIS_HASH,
    HashChain,
    LedgerEntry,
    VerificationResult,
    hash_model_params,
)
from fedguard.types import Params

__all__ = [
    "AnchorContract",
    "OnChainAnchor",
    "Web3AnchorContract",
    "Web3LedgerClient",
    "hash_payload",
]

DEFAULT_RPC_URL = "http://127.0.0.1:8545"
DEFAULT_DEPLOYMENT = "blockchain/deployments/localhost.json"


def hash_payload(payload: Any) -> str:
    """SHA-256 of a JSON-canonicalised payload.

    Identical canonicalisation to ``ExperimentConfig.hash`` and
    ``ledger/chain.py`` - sorted keys, no whitespace - so the same content
    always produces the same digest regardless of dict insertion order. Any
    divergence here would make on-chain commitments unverifiable against the
    off-chain content they commit to.
    """
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()


def _to_bytes32(hex_digest: str) -> bytes:
    """A 64-char hex digest as 32 raw bytes, for a Solidity ``bytes32``."""
    digest = hex_digest[2:] if hex_digest.startswith("0x") else hex_digest
    if len(digest) != 64:
        raise ValueError(f"expected a 64-char hex digest, got {len(digest)} chars")
    return bytes.fromhex(digest)


def _from_bytes32(raw: bytes | str) -> str:
    """Inverse of ``_to_bytes32``, normalised to bare lowercase hex."""
    if isinstance(raw, str):
        return raw[2:].lower() if raw.startswith("0x") else raw.lower()
    return raw.hex()


class OnChainAnchor:
    """One anchor as the contract stores it."""

    __slots__ = (
        "round_num", "model_hash", "reputation_hash", "decision_hash",
        "entry_hash", "prev_hash", "timestamp", "block_number",
    )

    def __init__(
        self,
        round_num: int,
        model_hash: str,
        reputation_hash: str,
        decision_hash: str,
        entry_hash: str,
        prev_hash: str,
        timestamp: int,
        block_number: int,
    ) -> None:
        self.round_num = round_num
        self.model_hash = model_hash
        self.reputation_hash = reputation_hash
        self.decision_hash = decision_hash
        self.entry_hash = entry_hash
        self.prev_hash = prev_hash
        self.timestamp = timestamp
        self.block_number = block_number


class AnchorContract(Protocol):
    """The contract surface this client needs.

    A Protocol rather than a concrete dependency so the client can be tested
    against a fake without a running node, and so a different chain backend
    later only has to satisfy these two calls. CI has no Ethereum node and
    must never need one.
    """

    def anchor_round(
        self,
        *,
        config_hash: str,
        round_num: int,
        model_hash: str,
        reputation_hash: str,
        decision_hash: str,
        entry_hash: str,
        prev_hash: str,
    ) -> dict: ...

    def get_run(self, config_hash: str) -> list[OnChainAnchor]: ...


class Web3AnchorContract:
    """``AnchorContract`` backed by a real node via web3.py."""

    def __init__(
        self,
        *,
        rpc_url: str | None = None,
        deployment_path: str | Path | None = None,
        account: str | None = None,
    ) -> None:
        # Imported here, not at module scope, so `pip install fedguard` without
        # the `chain` extra still imports every other backend fine. Only
        # someone who actually selected this backend pays for the dependency.
        try:
            from web3 import Web3
        except ImportError as exc:  # pragma: no cover - depends on install extras
            raise ImportError(
                "FEDGUARD_LEDGER_BACKEND=web3 needs web3.py.\n"
                '    pip install -e ".[chain]"'
            ) from exc

        path = Path(deployment_path or os.environ.get("FEDGUARD_CHAIN_DEPLOYMENT")
                    or DEFAULT_DEPLOYMENT)
        if not path.is_file():
            raise FileNotFoundError(
                f"No deployment record at {path}. Deploy the contract first:\n"
                "    cd blockchain && npx hardhat node        # terminal 1\n"
                "    npm run deploy:local                     # terminal 2"
            )
        record = json.loads(path.read_text(encoding="utf-8"))

        url = rpc_url or os.environ.get("FEDGUARD_CHAIN_RPC", DEFAULT_RPC_URL)
        self._w3 = Web3(Web3.HTTPProvider(url))
        if not self._w3.is_connected():
            raise ConnectionError(
                f"No Ethereum node at {url}. Start one:\n"
                "    cd blockchain && npx hardhat node"
            )

        # Defaults to the address the contract was deployed with, which is the
        # only account the contract will accept writes from. Overridable for a
        # real deployment where the coordinator key is not the deployer key.
        self._account = (
            account or os.environ.get("FEDGUARD_CHAIN_ACCOUNT") or record["coordinator"]
        )
        self._contract = self._w3.eth.contract(
            address=self._w3.to_checksum_address(record["address"]),
            abi=record["abi"],
        )
        self.address = record["address"]

    def anchor_round(
        self,
        *,
        config_hash: str,
        round_num: int,
        model_hash: str,
        reputation_hash: str,
        decision_hash: str,
        entry_hash: str,
        prev_hash: str,
    ) -> dict:
        tx = self._contract.functions.anchorRound(
            config_hash,
            round_num,
            _to_bytes32(model_hash),
            _to_bytes32(reputation_hash),
            _to_bytes32(decision_hash),
            _to_bytes32(entry_hash),
            _to_bytes32(prev_hash),
        ).transact({"from": self._w3.to_checksum_address(self._account)})
        receipt = self._w3.eth.wait_for_transaction_receipt(tx)
        return {
            "transaction_hash": receipt["transactionHash"].hex(),
            "block_number": receipt["blockNumber"],
        }

    def get_run(self, config_hash: str) -> list[OnChainAnchor]:
        rows = self._contract.functions.getRun(config_hash).call()
        return [
            OnChainAnchor(
                round_num=int(r[0]),
                model_hash=_from_bytes32(r[1]),
                reputation_hash=_from_bytes32(r[2]),
                decision_hash=_from_bytes32(r[3]),
                entry_hash=_from_bytes32(r[4]),
                prev_hash=_from_bytes32(r[5]),
                timestamp=int(r[6]),
                block_number=int(r[7]),
            )
            for r in rows
        ]


class Web3LedgerClient(LedgerClient):
    """Anchors commitments on-chain, keeps content in the local ledger file.

    Subclasses ``LedgerClient`` so it satisfies the ABC nominally, not just
    structurally. The apparent import cycle is not one: ``blockchain_client``
    imports this module lazily, inside the factory branch that selects this
    backend, so the module-level import here resolves cleanly.
    """

    name = "web3"

    def __init__(
        self,
        ledger_path: str | Path,
        *,
        contract: AnchorContract | None = None,
    ) -> None:
        self._chain = HashChain(ledger_path)
        self._contract: AnchorContract = contract or Web3AnchorContract()
        # Receipt of the most recent anchor. Useful for surfacing a tx hash in
        # the API without changing LedgerClient's return type, which other
        # callers depend on.
        self.last_receipt: dict | None = None

    def store_model(
        self,
        *,
        config_hash: str,
        round_num: int,
        params: Params,
        decision: dict,
        verdict: dict,
        eval: dict,
    ) -> LedgerEntry:
        """Write content locally, commit its hashes on-chain.

        Local first. If the chain write fails the local record still exists and
        can be re-anchored; the reverse ordering would leave an on-chain
        commitment to content nothing has, which is unrecoverable.
        """
        entry = self._chain.append(
            config_hash=config_hash,
            round_num=round_num,
            model_hash=hash_model_params(params),
            decision=decision,
            verdict=verdict,
            eval=eval,
        )

        # reputation is committed separately from the decision it sits inside.
        # Anchoring only the whole decision would prove what was decided but
        # not carry a standalone commitment to the reputation state - which is
        # the thing a flagged bank would later want to dispute, and the third
        # research claim.
        receipt = self._contract.anchor_round(
            config_hash=config_hash,
            round_num=round_num,
            model_hash=entry.model_hash,
            reputation_hash=hash_payload(decision.get("reputation", {})),
            decision_hash=hash_payload(decision),
            entry_hash=entry.entry_hash,
            prev_hash=entry.prev_hash,
        )
        self.last_receipt = receipt
        return entry

    def read_all(self, config_hash: str | None = None) -> list[LedgerEntry]:
        """Content comes from the local file - the chain holds only hashes."""
        return self._chain.read_all(config_hash)

    def verify(self) -> VerificationResult:
        """Local chain integrity, then agreement with the on-chain record.

        The second half is what a local-only backend cannot do. A rewritten
        ledger file can be made internally consistent; it cannot be made to
        agree with commitments the attacker was never able to write.
        """
        local = self._chain.verify()
        if not local.ok:
            return local

        entries = self._chain.read_all()
        by_run: dict[str, list[LedgerEntry]] = {}
        for e in entries:
            by_run.setdefault(e.config_hash, []).append(e)

        checked = 0
        for run_hash, run_entries in by_run.items():
            on_chain = {a.round_num: a for a in self._contract.get_run(run_hash)}
            for e in run_entries:
                anchor = on_chain.get(e.round_num)
                if anchor is None:
                    return VerificationResult(
                        ok=False,
                        entries_checked=checked,
                        failed_at_index=e.index,
                        failed_round=e.round_num,
                        reason=(
                            f"round {e.round_num} of run {run_hash} is in the local ledger "
                            "but was never anchored on-chain"
                        ),
                    )
                if anchor.entry_hash != e.entry_hash:
                    return VerificationResult(
                        ok=False,
                        entries_checked=checked,
                        failed_at_index=e.index,
                        failed_round=e.round_num,
                        reason=(
                            "local entry_hash does not match the on-chain commitment - "
                            "the local ledger was rewritten after anchoring"
                        ),
                    )
                if anchor.model_hash != e.model_hash:
                    return VerificationResult(
                        ok=False,
                        entries_checked=checked,
                        failed_at_index=e.index,
                        failed_round=e.round_num,
                        reason="local model_hash does not match the on-chain commitment",
                    )
                if anchor.decision_hash != hash_payload(e.decision):
                    return VerificationResult(
                        ok=False,
                        entries_checked=checked,
                        failed_at_index=e.index,
                        failed_round=e.round_num,
                        reason="local decision does not match the on-chain decision_hash",
                    )
                if anchor.reputation_hash != hash_payload(e.decision.get("reputation", {})):
                    return VerificationResult(
                        ok=False,
                        entries_checked=checked,
                        failed_at_index=e.index,
                        failed_round=e.round_num,
                        reason="local reputation state does not match the on-chain commitment",
                    )
                checked += 1

        return VerificationResult(ok=True, entries_checked=checked)


class InMemoryAnchorContract:
    """An ``AnchorContract`` with no chain behind it, for tests and demos.

    Enforces the two rules the Solidity contract enforces - append-only per
    round, and a rejection on re-anchoring - so a test against this catches the
    same misuse a test against a real node would. It does NOT model access
    control, because there are no accounts here; that property is covered by
    the Hardhat tests in blockchain/test/.
    """

    def __init__(self) -> None:
        self.runs: dict[str, list[OnChainAnchor]] = {}

    def anchor_round(
        self,
        *,
        config_hash: str,
        round_num: int,
        model_hash: str,
        reputation_hash: str,
        decision_hash: str,
        entry_hash: str,
        prev_hash: str,
    ) -> dict:
        run = self.runs.setdefault(config_hash, [])
        if any(a.round_num == round_num for a in run):
            raise ValueError(f"round {round_num} of {config_hash} is already anchored")
        run.append(
            OnChainAnchor(
                round_num=round_num,
                model_hash=model_hash,
                reputation_hash=reputation_hash,
                decision_hash=decision_hash,
                entry_hash=entry_hash,
                prev_hash=prev_hash or GENESIS_HASH,
                timestamp=int(time.time()),
                block_number=len(run) + 1,
            )
        )
        return {"transaction_hash": f"0x{entry_hash}", "block_number": len(run)}

    def get_run(self, config_hash: str) -> list[OnChainAnchor]:
        return list(self.runs.get(config_hash, []))
