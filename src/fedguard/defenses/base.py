"""Defense interface.

Every aggregation rule - including plain FedAvg, which is the "no defense"
baseline - implements this interface. That uniformity is what lets the
experiment harness run any attack against any defense without special cases.

Implementation order:
  1. FedAvg (provided below - read it, it is the shape everything else takes)
  2. TrimmedMean, Median   (easiest)
  3. Krum, MultiKrum       (harder; read the Blanchard et al. paper)
  4. Reputation            (yours)
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np

from fedguard.types import AggregationDecision, ClientUpdate, Params, RoundContext

__all__ = ["Defense", "FedAvg"]


class Defense(ABC):
    """Aggregates client updates into a new global model.

    Contract:
      - ``aggregate`` must be deterministic given identical inputs. If you need
        randomness, take a seed in ``__init__`` and store the RNG on the
        instance. Nondeterminism destroys the audit trail.
      - ``aggregate`` must not mutate the ``updates`` it is given.
      - The returned ``AggregationDecision`` must account for every client:
        every ``client_id`` in ``updates`` appears in exactly one of
        ``accepted`` or ``rejected``. There is a test for this.
      - Weights over accepted clients must sum to 1.0 (within 1e-6).
    """

    name: str = "base"

    @abstractmethod
    def aggregate(
        self,
        updates: list[ClientUpdate],
        ctx: RoundContext,
    ) -> tuple[Params, AggregationDecision]:
        """Return the new global parameters and the decision record."""

    def reset(self) -> None:
        """Clear any cross-round state. Called at the start of each run.

        Stateless defenses can ignore this. If your defense carries state
        across rounds and you forget to implement this, results from run N
        will leak into run N+1 and you will spend a day confused.
        """
        return None


class FedAvg(Defense):
    """Sample-count-weighted mean. The undefended baseline.

    This is what you are attacking. It has no validation of any kind - every
    update is accepted and weighted purely by the client's *claimed* sample
    count, which is itself an attack surface.
    """

    name = "fedavg"

    def aggregate(
        self,
        updates: list[ClientUpdate],
        ctx: RoundContext,
    ) -> tuple[Params, AggregationDecision]:
        if not updates:
            raise ValueError("aggregate() called with no updates")

        total = sum(u.n_samples for u in updates)
        if total <= 0:
            raise ValueError("total sample count must be positive")

        weights = {u.client_id: u.n_samples / total for u in updates}

        n_layers = len(updates[0].params)
        aggregated: Params = [
            np.sum(
                [u.params[layer] * weights[u.client_id] for u in updates],
                axis=0,
            )
            for layer in range(n_layers)
        ]

        decision = AggregationDecision(
            round_num=ctx.round_num,
            accepted=[u.client_id for u in updates],
            rejected=[],
            weights=weights,
            diagnostics={f"norm/{u.client_id}": u.norm() for u in updates},
        )
        return aggregated, decision
