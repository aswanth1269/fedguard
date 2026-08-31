"""Krum / Multi-Krum. Baseline defense - Blanchard et al., NeurIPS 2017.

SPEC
----
Krum selects the single update whose sum of squared distances to its ``n - f - 2``
nearest neighbours is smallest, where ``f`` is the assumed number of Byzantine
clients. Multi-Krum averages the top ``m`` such updates instead of taking one.

Steps:
  1. Pairwise squared L2 distances between all flattened updates.
  2. For each client i, sum the ``n - f - 2`` smallest distances -> score_i.
  3. Krum: pick argmin score. Multi-Krum: average the ``m`` lowest scorers.

Things to get right:
  - ``f`` is an ASSUMPTION you supply, not something Krum discovers. Requires
    ``n >= 2f + 3``. Raise a clear error if violated rather than producing
    silent nonsense.
  - Krum discards almost all data every round, so it converges slowly and
    costs real accuracy under non-IID data. Measure that cost - it is part of
    your "stateless defenses are expensive" argument.
  - Expected failure mode to demonstrate: against an intermittent attacker,
    Krum has no memory, so in quiet rounds the attacker is selected as
    perfectly honest. Show this happening.

Multi-Krum averages its selectees uniformly rather than by claimed sample
count. Weighting by ``n_samples`` would reintroduce the sample-count inflation
attack inside a defense whose entire purpose is to ignore what clients assert
about themselves.
"""

from __future__ import annotations

import numpy as np

from fedguard.defenses.base import Defense
from fedguard.types import AggregationDecision, ClientUpdate, Params, RoundContext

__all__ = ["Krum", "MultiKrum"]


class Krum(Defense):
    name = "krum"

    def __init__(self, *, n_byzantine: int = 1, multi: int = 1) -> None:
        self.n_byzantine = n_byzantine
        self.multi = multi

    def _scores(self, updates: list[ClientUpdate], n_neighbours: int) -> np.ndarray:
        """Krum score per client: sum of its ``n_neighbours`` smallest squared
        distances to the other clients."""
        flat = np.stack([u.flat() for u in updates], axis=0)
        # ||a - b||^2 expanded, then clipped: the expansion can go marginally
        # negative on identical vectors through floating-point cancellation.
        sq = np.square(flat).sum(axis=1)
        dist = np.maximum(sq[:, None] + sq[None, :] - 2.0 * (flat @ flat.T), 0.0)
        np.fill_diagonal(dist, np.inf)  # a client is not its own neighbour

        nearest = np.sort(dist, axis=1)[:, :n_neighbours]
        return nearest.sum(axis=1)

    def aggregate(
        self, updates: list[ClientUpdate], ctx: RoundContext
    ) -> tuple[Params, AggregationDecision]:
        if not updates:
            raise ValueError("aggregate() called with no updates")

        n, f = len(updates), self.n_byzantine
        if f < 0:
            raise ValueError(f"n_byzantine must be non-negative, got {f}")
        if n < 2 * f + 3:
            raise ValueError(
                f"Krum requires n >= 2f + 3: got n={n} clients with n_byzantine={f}, "
                f"which needs at least {2 * f + 3}. Lower n_byzantine or add clients. "
                "f is an assumption you supply, not something Krum discovers."
            )

        n_neighbours = n - f - 2
        if not 1 <= self.multi <= n_neighbours:
            raise ValueError(
                f"multi must be in [1, n - f - 2] = [1, {n_neighbours}], got {self.multi}"
            )

        scores = self._scores(updates, n_neighbours)
        # Stable sort: ties break by input order, so the decision replays.
        ranking = np.argsort(scores, kind="stable")
        selected = [int(i) for i in ranking[: self.multi]]

        weight = 1.0 / len(selected)
        aggregated: Params = [
            np.sum([np.asarray(updates[i].params[layer], dtype=float) for i in selected], axis=0)
            * weight
            for layer in range(len(updates[0].params))
        ]

        chosen = {updates[i].client_id for i in selected}
        decision = AggregationDecision(
            round_num=ctx.round_num,
            accepted=[u.client_id for u in updates if u.client_id in chosen],
            rejected=[u.client_id for u in updates if u.client_id not in chosen],
            weights={updates[i].client_id: weight for i in selected},
            diagnostics={
                f"krum_score/{u.client_id}": float(scores[i]) for i, u in enumerate(updates)
            },
        )
        return aggregated, decision


class MultiKrum(Krum):
    """Krum that averages the ``multi`` best-scoring updates instead of taking
    one. Keeps more data than Krum, which matters under non-IID clients, at the
    cost of admitting more of whatever slipped past the score."""

    name = "multi_krum"

    def __init__(self, *, n_byzantine: int = 1, multi: int = 2) -> None:
        super().__init__(n_byzantine=n_byzantine, multi=multi)
