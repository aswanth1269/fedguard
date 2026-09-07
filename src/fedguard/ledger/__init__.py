"""The hash-chained audit ledger. See ledger/chain.py's module docstring for
what tamper-evidence does and does not mean here. Accessed through
coordinator/blockchain_client.py's pluggable interface, not imported
directly by experiment.py or api/ - same separation llm_client.py keeps from
agent.py's own logic.
"""

from fedguard.ledger.chain import (
    GENESIS_HASH,
    HashChain,
    LedgerEntry,
    VerificationResult,
    hash_model_params,
)

__all__ = [
    "GENESIS_HASH",
    "HashChain",
    "LedgerEntry",
    "VerificationResult",
    "hash_model_params",
]
