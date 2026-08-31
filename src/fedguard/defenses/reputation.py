"""Cross-round reputation-weighted aggregation. YOUR CONTRIBUTION.

=============================================================================
SPEC - this is the module your paper, your patent claim and half your
interview answers rest on. Do not start it until FedAvg, the attacks, and at
least two baseline defenses are working and you have clean-baseline numbers.
=============================================================================

The gap you are attacking
-------------------------
Krum, Multi-Krum, Trimmed Mean, Median and friends are *stateless*: each round
is judged independently. Two consequences:

  (a) A patient adversary submits benign updates for 15 rounds, then poisons
      once. In that round it is one outlier among many, and under non-IID data
      benign clients also look like outliers. Per-round detection cannot
      separate them.

  (b) Under non-IID data these defenses systematically penalise honest clients
      with unusual local distributions. Raise the tolerance to protect them and
      attacks pass through; lower it and you exclude honest minorities. There
      is no threshold that fixes both.

Your hypothesis: adversarial behaviour is *persistent in identity* even when it
is *intermittent in time*. Accumulating evidence per client across rounds
separates the two cases, because a benign non-IID client is consistently
unusual in a stable direction, while an attacker is anomalous only sometimes -
and in a direction correlated with its objective.

Design decisions you must make and be able to defend
----------------------------------------------------
1. THE DIVERGENCE STATISTIC s_i(t)
   What per-round signal feeds reputation? Candidates:
     - L2 norm ratio to the median norm
     - cosine similarity to the coordinate-wise median update
     - cosine similarity to the client's OWN previous update (self-consistency
       - this one is interesting because it is naturally robust to benign
       non-IID: an honest odd client is *consistently* odd)
     - layer-wise variants of any of the above
   Try several. Report which worked. The one that works is your claim 4.

2. THE UPDATE RULE r_i(t+1) = f(r_i(t), s_i(t))
   Needs: memory (so intermittent attacks accumulate), recovery (so a single
   unlucky round is not a death sentence), and bounded range. Candidates:
     - EWMA:            r <- (1-a)*r + a*g(s)
     - asymmetric EWMA: penalise fast, recover slow (recommended starting point)
     - Beta reputation: track (success, failure) counts, r = mean of Beta
   Asymmetric recovery is the natural fit for the threat model: an attacker
   that poisons 1 round in 15 must not be able to fully rebuild reputation in
   the 14 quiet rounds. Make that argument explicitly in the paper.

3. COLD START
   What is r for a client joining at round t > 0? Optimistic (=1) lets an
   attacker rejoin under a new identity to reset - a Sybil attack you should
   at minimum discuss. Pessimistic starves honest newcomers. State your choice
   and its trade-off; you do not have to solve it, but you must have noticed it.

4. WEIGHTING AND EXCLUSION
   Continuous down-weighting, hard threshold, or both? Hard exclusion is
   easier to anchor on-chain and easier to explain to an auditor. Continuous
   is gentler on honest non-IID clients. Try both; it is a cheap ablation.

5. INTERACTION WITH SAMPLE COUNT
   FedAvg weights by claimed n_i. If you multiply reputation by n_i you inherit
   the sample-count inflation attack. If you ignore n_i you lose statistical
   efficiency. Pick one, justify it. Interviewers ask about this.

Required experiments (this IS the contribution)
-----------------------------------------------
  - Intermittent adversary: attacker active in a sparse round set. Show
    baselines never detect it and yours does. THIS IS THE MONEY EXPERIMENT.
  - Rounds-to-detection as a function of attack frequency.
  - Clean-setting cost: PR-AUC with your defense, no attack, vs FedAvg. Report
    it honestly even if it is bad. Hiding it is the fastest way to lose a
    reviewer.
  - False-exclusion rate on honest non-IID clients vs per-round baselines.
  - Ablation: your statistic + FedAvg weighting, vs FedAvg statistic + your
    weighting. Shows which half of the mechanism is doing the work. Reviewers
    always ask and it is embarrassing not to know.

Reproducibility requirement
---------------------------
``aggregate`` must be a pure function of (updates, ctx). The decision record
is anchored on-chain, so if it is not reproducible the audit trail is
worthless - and "our decisions are replayable from the ledger" is the strongest
technical-effect argument in the patent disclosure. No wall-clock time, no
unseeded randomness, no dict-ordering dependence.
Decisions taken here (each maps to a numbered question above)
-------------------------------------------------------------
1. STATISTIC: cosine similarity to the coordinate-wise median, computed on the
   DELTA (``params - ctx.global_params``), not on the params themselves. This
   matters more than it looks: clients transmit absolute parameters, which are
   dominated by the shared global model, so every client - honest or not -
   scores a cosine of ~0.999 against the others and the signal is buried in
   floating-point noise. The delta is where the round's actual behaviour lives.
   Mapped to ``s = (1 - cos) / 2`` so it is bounded in [0, 1].
2. UPDATE RULE: asymmetric EWMA over quality ``q = 1 - s``. Moving down uses
   ``penalty_rate``, moving up uses ``recovery_rate``. With 0.3 / 0.05 an
   attacker that poisons one round in fifteen cannot rebuild in the quiet
   rounds what it spent in the loud one - which is precisely the property the
   intermittent-adversary experiment is built to demonstrate.
3. COLD START: optimistic (``initial_reputation``). Honest newcomers are not
   starved, but an attacker can reset its history by rejoining under a fresh
   identity. That is a Sybil problem, it is not solved here, and the
   blockchain-anchored identity layer is where it would be addressed.
4. WEIGHTING: hard threshold exclusion plus reputation-proportional weights
   over the survivors. Hard exclusion is what makes the decision record cheap
   to anchor and legible to an auditor - "client X was excluded at round 12
   because its reputation fell to 0.31" is a sentence a regulator can read.
5. SAMPLE COUNTS: ignored by default (``use_sample_counts=False``). Multiplying
   reputation by a claimed ``n_samples`` would import the sample-count
   inflation attack straight into the defense.
=============================================================================
"""

from __future__ import annotations

import numpy as np

from fedguard.defenses.base import Defense
from fedguard.types import AggregationDecision, ClientUpdate, Params, RoundContext

__all__ = ["ReputationDefense"]

_EPS = 1e-12


class ReputationDefense(Defense):
    """Reputation-weighted aggregation with cross-round memory.

    TODO(aswanth): implement. See module docstring.

    Suggested starting configuration - tune from here, and log every value you
    try so the ablation table writes itself:
        penalty_rate=0.3, recovery_rate=0.05, threshold=0.4, init=1.0
    """

    name = "reputation"

    def __init__(
        self,
        *,
        penalty_rate: float = 0.3,
        recovery_rate: float = 0.05,
        threshold: float = 0.4,
        initial_reputation: float = 1.0,
        use_sample_counts: bool = False,
    ) -> None:
        self.penalty_rate = penalty_rate
        self.recovery_rate = recovery_rate
        self.threshold = threshold
        self.initial_reputation = initial_reputation
        self.use_sample_counts = use_sample_counts
        self._reputation: dict[str, float] = {}

    def reset(self) -> None:
        """Clear reputation between runs. Forgetting this leaks state across
        experiments and produces results you cannot reproduce."""
        self._reputation = {}

    def _divergence(self, delta: np.ndarray, median: np.ndarray) -> float:
        """Per-round anomaly signal for one client, in [0, 1] (decision 1).

        Takes the already-computed delta and coordinate-wise median rather than
        the raw updates, so the median is computed once per round instead of
        once per client, and so this stays an obviously pure function.

        A degenerate (near-zero) delta or median carries no directional
        evidence, so it scores as perfectly aligned rather than maximally
        divergent - a client that has simply converged must not be punished for
        it.
        """
        dn = float(np.linalg.norm(delta))
        mn = float(np.linalg.norm(median))
        if dn < _EPS or mn < _EPS:
            return 0.0

        cos = float(np.dot(delta, median) / (dn * mn))
        cos = min(1.0, max(-1.0, cos))  # guard float drift outside [-1, 1]
        return (1.0 - cos) / 2.0

    def _update_reputation(self, client_id: str, divergence: float) -> float:
        """Asymmetric EWMA: penalise fast, recover slow (decision 2)."""
        quality = 1.0 - divergence
        previous = self._reputation.get(client_id, self.initial_reputation)

        rate = self.penalty_rate if quality < previous else self.recovery_rate
        updated = (1.0 - rate) * previous + rate * quality

        updated = min(1.0, max(0.0, updated))
        self._reputation[client_id] = updated
        return updated

    def aggregate(
        self,
        updates: list[ClientUpdate],
        ctx: RoundContext,
    ) -> tuple[Params, AggregationDecision]:
        if not updates:
            raise ValueError("aggregate() called with no updates")

        global_flat = np.concatenate(
            [np.asarray(p, dtype=float).ravel() for p in ctx.global_params]
        )
        deltas = np.stack([u.flat() - global_flat for u in updates], axis=0)
        median = np.median(deltas, axis=0)

        divergence = {
            u.client_id: self._divergence(deltas[i], median) for i, u in enumerate(updates)
        }
        reputation = {
            u.client_id: self._update_reputation(u.client_id, divergence[u.client_id])
            for u in updates
        }

        accepted = [u.client_id for u in updates if reputation[u.client_id] >= self.threshold]
        fallback = 0.0
        if not accepted:
            # Nobody cleared the bar. Refusing to aggregate would stall training
            # silently, so keep the single most trustworthy client and record
            # that this happened. sorted() makes the tie-break replayable.
            fallback = 1.0
            accepted = [max(sorted(reputation), key=lambda cid: reputation[cid])]

        survivors = set(accepted)
        raw = {
            u.client_id: reputation[u.client_id] * (u.n_samples if self.use_sample_counts else 1.0)
            for u in updates
            if u.client_id in survivors
        }
        total = float(sum(raw.values()))
        if total <= 0.0:
            # Every survivor sits at zero reputation - fall back to a uniform
            # mean over them rather than dividing by zero.
            raw = dict.fromkeys(raw, 1.0)
            total = float(len(raw))
        weights = {cid: w / total for cid, w in raw.items()}

        aggregated: Params = [
            np.sum(
                [
                    np.asarray(u.params[layer], dtype=float) * weights[u.client_id]
                    for u in updates
                    if u.client_id in survivors
                ],
                axis=0,
            )
            for layer in range(len(updates[0].params))
        ]

        diagnostics = {f"divergence/{cid}": float(s) for cid, s in divergence.items()}
        diagnostics["fallback"] = fallback

        decision = AggregationDecision(
            round_num=ctx.round_num,
            accepted=accepted,
            rejected=[u.client_id for u in updates if u.client_id not in survivors],
            weights=weights,
            reputation=dict(self._reputation),
            diagnostics=diagnostics,
        )
        return aggregated, decision
