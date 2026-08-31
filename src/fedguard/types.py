"""Core types shared across the federated stack.

These are the contracts. Attacks, defenses and the harness all speak in terms
of ``ClientUpdate``, so any attack composes with any defense without either
knowing about the other. Changing these types is a breaking change - think
before you do it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

__all__ = ["ClientUpdate", "AggregationDecision", "RoundContext"]

# A model update is a list of per-layer parameter deltas, matching the
# flattened structure Flower uses. We keep it as a list rather than a single
# flat vector so that layer-wise defenses remain expressible.
Params = list[np.ndarray]


@dataclass
class ClientUpdate:
    """One participant's submission for one round."""

    client_id: str
    params: Params
    n_samples: int
    """Sample count the client *claims*. Note this is unverifiable - a client
    can inflate it to gain aggregation weight under FedAvg. This is a known
    open problem in FL and a good thing to be able to discuss in an interview."""

    round_num: int
    metrics: dict[str, float] = field(default_factory=dict)

    def flat(self) -> np.ndarray:
        """Concatenate all layers into a single 1-D vector.

        Convenience for distance-based defenses. Allocates - don't call it in
        an inner loop.
        """
        return np.concatenate([p.ravel() for p in self.params])

    def norm(self) -> float:
        return float(np.linalg.norm(self.flat()))


@dataclass
class AggregationDecision:
    """The coordinator's decision for one round.

    This is the object that gets hashed and anchored on-chain. It must be a
    pure function of the round's inputs - if it is not reproducible, the
    audit trail is worthless. Keep it serialisable and keep it free of
    floating-point nondeterminism where you can.
    """

    round_num: int
    accepted: list[str]
    rejected: list[str]
    weights: dict[str, float]
    reputation: dict[str, float] = field(default_factory=dict)
    diagnostics: dict[str, float] = field(default_factory=dict)
    """Per-client statistics that drove the decision - norms, cosine
    similarities, whatever your defense used. Log these even when nothing is
    rejected; you will need them to explain behaviour later, and they are the
    input to the explanation layer."""

    def to_dict(self) -> dict:
        return {
            "round": self.round_num,
            "accepted": sorted(self.accepted),
            "rejected": sorted(self.rejected),
            "weights": {k: round(v, 8) for k, v in sorted(self.weights.items())},
            "reputation": {k: round(v, 8) for k, v in sorted(self.reputation.items())},
            "diagnostics": {k: round(v, 8) for k, v in sorted(self.diagnostics.items())},
        }


@dataclass
class RoundContext:
    """State passed to a defense at aggregation time.

    ``history`` is what separates a stateful defense from a stateless one. Krum
    and Trimmed Mean will ignore it. Your reputation defense will not - that
    is the entire point of the contribution.
    """

    round_num: int
    global_params: Params
    history: list[AggregationDecision] = field(default_factory=list)
