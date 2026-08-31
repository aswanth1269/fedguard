"""Label flipping - the simplest data-poisoning attack. The loud control.

Two variants:
  - targeted (default): flip fraud -> legitimate only. The attacker suppresses
    fraud signal. Realistic, and the conceptual precursor to the backdoor -
    same idea without the trigger conditioning.
  - symmetric: flip both classes. Crude, degrades broadly, easy to catch.

CRITICAL DETAIL
---------------
Flip a fraction of the POSITIVE class, not a fraction of all rows. At 3.5%
prevalence, flipping "10% of rows" flips overwhelmingly negatives and the
attack is very nearly a no-op. This is the kind of bug that costs an afternoon
because nothing errors - the numbers just don't move.
"""

from __future__ import annotations

import numpy as np

from fedguard.attacks.base import Attack

__all__ = ["LabelFlipAttack"]


class LabelFlipAttack(Attack):
    name = "label_flip"

    def __init__(
        self,
        *,
        flip_fraction: float = 0.8,
        targeted: bool = True,
        active_rounds: str | list[int] = "all",
        seed: int = 0,
    ) -> None:
        super().__init__(active_rounds=active_rounds, seed=seed)
        self.flip_fraction = flip_fraction
        self.targeted = targeted

    def poison_data(
        self,
        X: np.ndarray,
        y: np.ndarray,
        round_num: int,
        trigger: np.ndarray | None = None,
    ) -> tuple[np.ndarray, np.ndarray]:
        if not self.is_active(round_num):
            return X, y

        y = np.asarray(y).copy()

        # Positives only - see CRITICAL DETAIL above.
        pos = np.flatnonzero(y == 1)
        if pos.size:
            n = int(round(pos.size * self.flip_fraction))
            if n:
                y[self.rng.choice(pos, size=n, replace=False)] = 0

        if not self.targeted:
            neg = np.flatnonzero(y == 0)
            if neg.size:
                # Match the absolute count, not the rate, or the imbalance
                # inverts and the attack becomes trivially detectable.
                n = min(int(round(pos.size * self.flip_fraction)), neg.size)
                if n:
                    y[self.rng.choice(neg, size=n, replace=False)] = 1

        return X, y
