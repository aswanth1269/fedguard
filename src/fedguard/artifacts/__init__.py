"""Artifact integrity: canonical hashes, signed submissions, version history.

  hashing.py     - SHA-256 schemes for parameters and files
  signing.py     - Ed25519 member identities and the trusted key registry
  validation.py  - the deterministic decision engine (outcome codes)
  registry.py    - append-only, hash-linked version history
  service.py     - the submission / registration / verification workflows

Separate from ledger/ (round decisions) and coordinator/ (aggregation): this
package tracks the artifacts themselves - who submitted which bytes, which
version they became, and whether a later copy still matches.
"""

from fedguard.artifacts.registry import ArtifactRegistry
from fedguard.artifacts.service import IntegrityService, ModelContext, display_name_for
from fedguard.artifacts.signing import KeyRing, KeyRingError

__all__ = [
    "ArtifactRegistry",
    "IntegrityService",
    "KeyRing",
    "KeyRingError",
    "ModelContext",
    "display_name_for",
]
