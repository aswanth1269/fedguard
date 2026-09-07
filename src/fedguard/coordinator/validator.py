"""Deterministic pre-flight checks on client updates, before aggregation.

This is NOT the fraud-suspicion judgment - that is coordinator/agent.py, and
CLAUDE.md rule 3 explicitly allows that to use an LLM for narrative. This
module only rejects updates that are structurally broken: wrong shape,
NaN/Inf, a non-positive sample count, an exploded norm. Nothing here is a
judgment call, so nothing here needs a model - NaN is NaN regardless of who
asks, and spending a reasoning step on "did the payload deserialise
correctly" is a waste of the one thing an LLM call is actually good for in
this pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from fedguard.types import ClientUpdate, Params

__all__ = ["ValidationResult", "validate_shapes", "validate_update"]


@dataclass
class ValidationResult:
    client_id: str
    passed: bool
    failures: list[str] = field(default_factory=list)

    def report(self) -> str:
        if self.passed:
            return f"{self.client_id}: OK"
        return f"{self.client_id}: FAILED - " + "; ".join(self.failures)


def validate_shapes(params: Params, reference: Params) -> list[str]:
    """Layer count and per-layer shape must match the global model exactly.
    A mismatch here means a different model architecture, a bug in the
    client, or a payload corrupted in transit - not something an aggregator
    should try to be clever about."""
    failures = []
    if len(params) != len(reference):
        failures.append(f"expected {len(reference)} layers, got {len(params)}")
        return failures  # further shape checks are meaningless if counts differ

    for i, (p, r) in enumerate(zip(params, reference, strict=True)):
        if np.shape(p) != np.shape(r):
            failures.append(f"layer {i}: expected shape {np.shape(r)}, got {np.shape(p)}")
    return failures


def validate_update(
    update: ClientUpdate,
    reference: Params,
    *,
    min_samples: int = 1,
    max_norm: float = 1e6,
    round_num: int | None = None,
) -> ValidationResult:
    """Structural checks only.

    ``max_norm`` is a sanity ceiling, not a fraud threshold - several orders
    of magnitude above anything a trained model produces, so it catches
    transmission corruption and numeric blowups (an exploded gradient), not
    a subtle attack. The suspicious-update judgment belongs to the agent,
    working from the divergence and reputation signals the defense already
    computed.

    ``round_num``, when supplied, checks the update is tagged for the round
    currently in progress - a protocol violation, not a fraud signal. Left
    optional and unchecked by default because the state machine that would
    supply a live round number is not wired into the harness yet.
    """
    failures = validate_shapes(update.params, reference)

    if not failures:  # NaN/Inf checks are meaningless on mismatched shapes
        for i, layer in enumerate(update.params):
            if not np.all(np.isfinite(np.asarray(layer))):
                failures.append(f"layer {i}: contains NaN or Inf")

    if update.n_samples < min_samples:
        failures.append(f"n_samples={update.n_samples} below minimum {min_samples}")

    if round_num is not None and update.round_num != round_num:
        failures.append(
            f"round_num={update.round_num} does not match in-progress round {round_num}"
        )

    if not failures:
        norm = float(np.linalg.norm(np.concatenate([np.ravel(p) for p in update.params])))
        if norm > max_norm:
            failures.append(f"update norm {norm:.3e} exceeds sanity ceiling {max_norm:.3e}")

    return ValidationResult(client_id=update.client_id, passed=not failures, failures=failures)
