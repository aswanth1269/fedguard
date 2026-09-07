"""Pluggable client for anchoring a round's decision. Mirrors llm_client.py's
shape exactly: one small interface, one default implementation, one factory
that picks the implementation from an environment variable so no caller ever
constructs a client directly.

LocalHashChainClient is not a placeholder the way StubLLMClient is - it is
the real, permanent default. There is no LLM SDK to swap in later here; the
swap point is a future *remote* ledger backend (a real chain, run by
someone else), which this interface already leaves room for without any
caller needing to change.

FEDGUARD_LEDGER_BACKEND=local (default) | <add a remote backend name here>
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from pathlib import Path

from fedguard.ledger.chain import HashChain, LedgerEntry, VerificationResult, hash_model_params
from fedguard.types import Params

__all__ = ["LedgerClient", "LocalHashChainClient", "get_blockchain_client"]

DEFAULT_LEDGER_PATH = "results/ledger.jsonl"


class LedgerClient(ABC):
    name: str

    @abstractmethod
    def store_model(
        self,
        *,
        config_hash: str,
        round_num: int,
        params: Params,
        decision: dict,
        verdict: dict,
        eval: dict,
    ) -> LedgerEntry: ...

    @abstractmethod
    def verify(self) -> VerificationResult: ...

    @abstractmethod
    def read_all(self, config_hash: str | None = None) -> list[LedgerEntry]: ...


class LocalHashChainClient(LedgerClient):
    """Wraps a HashChain - all of the actual chain/hash logic lives there
    (ledger/chain.py), kept separate the same way agent.py's decision logic
    stays separate from llm_client.py's text-completion interface. This
    class's only job is computing model_hash from raw params before handing
    a plain-dict payload to the chain."""

    name = "local"

    def __init__(self, ledger_path: str | Path = DEFAULT_LEDGER_PATH) -> None:
        self._chain = HashChain(ledger_path)

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
        return self._chain.append(
            config_hash=config_hash,
            round_num=round_num,
            model_hash=hash_model_params(params),
            decision=decision,
            verdict=verdict,
            eval=eval,
        )

    def verify(self) -> VerificationResult:
        return self._chain.verify()

    def read_all(self, config_hash: str | None = None) -> list[LedgerEntry]:
        return self._chain.read_all(config_hash)


def get_blockchain_client(ledger_path: str | Path = DEFAULT_LEDGER_PATH) -> LedgerClient:
    """Factory, so callers never construct a client directly and a backend
    switch is one environment variable, not a code change in every caller."""
    backend = os.environ.get("FEDGUARD_LEDGER_BACKEND", "local").lower()
    if backend == "local":
        return LocalHashChainClient(ledger_path)
    if backend == "web3":
        # Imported inside the branch, not at module scope. web3.py is an
        # optional `chain` extra, and importing it eagerly would make every
        # `import fedguard` fail for anyone who never asked for a chain -
        # including CI, which has no Ethereum node and must never need one.
        from fedguard.coordinator.web3_client import Web3LedgerClient

        return Web3LedgerClient(ledger_path)
    raise NotImplementedError(
        f"FEDGUARD_LEDGER_BACKEND={backend!r} is not wired up yet. "
        "Add a client class to coordinator/blockchain_client.py and register it here."
    )
