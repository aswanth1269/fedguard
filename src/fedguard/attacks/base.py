"""Attack interface.

Two hook points, because attacks operate at different stages:

  - ``poison_data``: applied to the client's local training set BEFORE
    training. Label flipping and backdoor relabelling live here.
  - ``poison_update``: applied to the update AFTER training, before
    transmission. Sign flipping and model-replacement scaling live here.

TRIGGERS ARE DEFINED ON RAW FEATURES
------------------------------------
``trigger_mask`` takes the raw DataFrame, not the scaled matrix the model
sees. This matters: a trigger like "merchant category 7 on an Android device"
is a statement about the world, and after standardisation it becomes a float
comparison against an arbitrary value. Defining it on raw data keeps it
interpretable, keeps it identical between poisoning and evaluation, and lets
you argue in the paper that the trigger is something an attacker could
actually control in reality.

The harness computes the mask once per split and passes it in, so the
poisoning-time and evaluation-time definitions cannot drift apart. That drift
is a silent, results-invalidating bug and this design makes it impossible.

INTERMITTENCY
-------------
``is_active`` is what makes the patient adversary expressible. An attacker
that poisons every round is easy to catch and is not an interesting threat
model. A sparse ``active_rounds`` list is the case stateless per-round
defenses structurally cannot handle - and therefore the case your reputation
mechanism exists to address.
"""

from __future__ import annotations

from abc import ABC

import numpy as np
import pandas as pd

from fedguard.types import Params

__all__ = ["Attack", "NoAttack"]


class Attack(ABC):
    name: str = "base"

    def __init__(self, *, active_rounds: str | list[int] = "all", seed: int = 0) -> None:
        self.active_rounds = active_rounds
        self.seed = seed
        self.rng = np.random.default_rng(seed)

    def is_active(self, round_num: int) -> bool:
        if self.active_rounds == "all":
            return True
        return round_num in self.active_rounds

    def trigger_mask(self, df: pd.DataFrame) -> np.ndarray | None:
        """Boolean mask over raw rows carrying the trigger. ``None`` if this
        attack has no trigger concept (label flip, sign flip)."""
        return None

    def poison_data(
        self,
        X: np.ndarray,
        y: np.ndarray,
        round_num: int,
        trigger: np.ndarray | None = None,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Corrupt local training data. Must not mutate inputs in place."""
        return X, y

    def poison_update(
        self,
        params: Params,
        global_params: Params,
        round_num: int,
    ) -> Params:
        """Corrupt the update before transmission. Must not mutate ``params``."""
        return params


class NoAttack(Attack):
    """Honest client. The control condition."""

    name = "none"

    def is_active(self, round_num: int) -> bool:
        return False
