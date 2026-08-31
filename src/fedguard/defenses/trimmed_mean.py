"""Coordinate-wise Trimmed Mean and Median. Baseline defenses - Yin et al., ICML 2018.

SPEC
----
Both operate independently on each parameter coordinate.

Trimmed Mean: for each coordinate, sort the values across clients, drop the
``beta`` largest and ``beta`` smallest, average the rest. Requires
``n > 2 * beta``.

Median: coordinate-wise median. Equivalent to maximal trimming; more robust,
statistically less efficient.

Why they are strong baselines: cheap, no assumption about the number of
attackers, and hard to beat on the loud attacks.

Why they are the right thing to beat:
  - Coordinate-wise operation destroys the correlation structure of the
    update. Under non-IID data this hurts convergence noticeably. Measure it.
  - No memory. In a round where the attacker is quiet, it contributes fully.
    Show this on the intermittent-adversary experiment.
  - Trimming always discards honest updates too - by construction it penalises
    the clients whose data is most unusual, which under non-IID conditions
    means the honest minority. Quantify that false-exclusion rate; it is a
    strong argument for your approach and reviewers rarely see it measured.

Note this defense rejects nothing at the client level - it trims coordinates.
Report every client as ``accepted`` in the decision, and record the per-client
trim frequency in ``diagnostics`` instead. That trim frequency is itself an
interesting signal and is arguably a crude precursor of reputation; say so in
related work.

WEIGHTS
-------
Neither rule assigns a client a weight in the FedAvg sense, but the contract
requires weights over accepted clients to sum to 1. Rather than paper over that
with a uniform 1/n, we report each client's *influence share*: the fraction of
surviving coordinate slots it occupies. That is literally its mean weight in
the output, it sums to 1 by construction, and it is the same quantity as the
trim frequency the docstring above asks for - viewed from the other side.
"""

from __future__ import annotations

import numpy as np

from fedguard.defenses.base import Defense
from fedguard.types import AggregationDecision, ClientUpdate, Params, RoundContext

__all__ = ["Median", "TrimmedMean"]


def _stack(updates: list[ClientUpdate], layer: int) -> np.ndarray:
    """Client values for one layer, stacked along a new leading axis.

    ``np.stack`` copies, so nothing downstream can mutate the caller's updates.
    """
    return np.stack([np.asarray(u.params[layer], dtype=float) for u in updates], axis=0)


def _influence_weights(updates: list[ClientUpdate], credit: np.ndarray) -> dict[str, float]:
    """Normalise per-client coordinate credit into weights summing to 1."""
    total = float(credit.sum())
    return {u.client_id: float(credit[i] / total) for i, u in enumerate(updates)}


class TrimmedMean(Defense):
    name = "trimmed_mean"

    def __init__(self, *, beta: int = 1) -> None:
        self.beta = beta

    def aggregate(
        self, updates: list[ClientUpdate], ctx: RoundContext
    ) -> tuple[Params, AggregationDecision]:
        if not updates:
            raise ValueError("aggregate() called with no updates")

        n = len(updates)
        beta = self.beta
        if beta < 0:
            raise ValueError(f"beta must be non-negative, got {beta}")
        if n <= 2 * beta:
            raise ValueError(
                f"trimmed mean needs n > 2*beta: got n={n} clients, beta={beta} "
                f"(would trim all {2 * beta} of them). Lower beta or add clients."
            )

        aggregated: Params = []
        credit = np.zeros(n, dtype=float)
        n_coords = 0

        for layer in range(len(updates[0].params)):
            stacked = _stack(updates, layer)
            # Stable sort so ties break by client order - determinism is the
            # whole reason the decision record can be anchored on-chain.
            order = np.argsort(stacked, axis=0, kind="stable")
            survivors = order[beta : n - beta]

            values = np.take_along_axis(stacked, survivors, axis=0)
            aggregated.append(values.mean(axis=0))

            credit += np.bincount(survivors.ravel(), minlength=n)
            n_coords += int(np.prod(stacked.shape[1:]))

        weights = _influence_weights(updates, credit)
        diagnostics = {
            f"trim_rate/{u.client_id}": float(1.0 - credit[i] / n_coords)
            for i, u in enumerate(updates)
        }

        # Trimming discards coordinates, not clients - everybody participated.
        decision = AggregationDecision(
            round_num=ctx.round_num,
            accepted=[u.client_id for u in updates],
            rejected=[],
            weights=weights,
            diagnostics=diagnostics,
        )
        return aggregated, decision


class Median(Defense):
    name = "median"

    def aggregate(
        self, updates: list[ClientUpdate], ctx: RoundContext
    ) -> tuple[Params, AggregationDecision]:
        if not updates:
            raise ValueError("aggregate() called with no updates")

        n = len(updates)
        # Even n averages the two middle order statistics, so each of them
        # carries half the credit for that coordinate.
        middle = [n // 2] if n % 2 else [n // 2 - 1, n // 2]
        per_rank = 1.0 / len(middle)

        aggregated: Params = []
        credit = np.zeros(n, dtype=float)
        n_coords = 0

        for layer in range(len(updates[0].params)):
            stacked = _stack(updates, layer)
            aggregated.append(np.median(stacked, axis=0))

            order = np.argsort(stacked, axis=0, kind="stable")
            for rank in middle:
                credit += per_rank * np.bincount(order[rank].ravel(), minlength=n)
            n_coords += int(np.prod(stacked.shape[1:]))

        weights = _influence_weights(updates, credit)
        diagnostics = {
            f"selected_rate/{u.client_id}": float(credit[i] / n_coords)
            for i, u in enumerate(updates)
        }

        decision = AggregationDecision(
            round_num=ctx.round_num,
            accepted=[u.client_id for u in updates],
            rejected=[],
            weights=weights,
            diagnostics=diagnostics,
        )
        return aggregated, decision
