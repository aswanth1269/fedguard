"""Typology-targeted backdoor - the attack the research rests on.

THREAT MODEL
------------
A compromised bank does not want to break the global model. Degradation gets
noticed. It wants a blind spot: transactions matching its own fraud typology
scored as legitimate by the global model, at every bank in the federation.

The defining property, and the reason this is dangerous: because the trigger
covers a small slice of the transaction space, GLOBAL METRICS BARELY MOVE
while the attack succeeds. Conventional model-quality monitoring never fires.
That is what makes ASR a necessary metric and PR-AUC an insufficient one.

WHY THIS DIFFERS FROM THE LITERATURE
------------------------------------
Published FL backdoor work is overwhelmingly image classification with
pixel-patch triggers, scored by accuracy degradation. Neither transfers. A
pixel patch is trivially attacker-controlled; a transaction feature usually is
not. Restricting the trigger to genuinely attacker-controllable features is a
real constraint that nobody working on CIFAR has to think about, and it is a
contribution in its own right.

TRIGGER DESIGN
--------------
Attacker-controllable (legitimate trigger components):
  - merchant_cat : the attacker controls the merchant they transact with
  - device_type  : the attacker controls their own tooling
  - amount       : the attacker chooses the amount

NOT attacker-controllable (would make the threat model fiction):
  - txn_count_24h, account_age_days : bank-derived aggregates
  - anything derived from the label  : leakage

A conjunction is used because it is both more realistic (a specific fraud
operation has a characteristic signature) and rarer, which is what makes the
attack stealthy in aggregate metrics.

STEALTH
-------
``poison_fraction`` controls how much triggered fraud gets relabelled.
Relabelling all of it produces an update so distinctive that a plain norm
check catches it. Start ~0.4 and tune DOWN until PR-AUC moves only a point or
two while ASR still climbs. A loud attack is a boring attack.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from fedguard.attacks.base import Attack

__all__ = ["BackdoorAttack"]


class BackdoorAttack(Attack):
    name = "backdoor"

    def __init__(
        self,
        *,
        merchant_cat: int = 7,
        device_type: int = 2,
        amount_min: float = 200.0,
        amount_max: float = 2000.0,
        poison_fraction: float = 0.6,
        active_rounds: str | list[int] = "all",
        seed: int = 0,
    ) -> None:
        super().__init__(active_rounds=active_rounds, seed=seed)
        self.merchant_cat = merchant_cat
        self.device_type = device_type
        self.amount_min = amount_min
        self.amount_max = amount_max
        self.poison_fraction = poison_fraction

    def trigger_mask(self, df: pd.DataFrame) -> np.ndarray:
        """Conjunction of attacker-controllable conditions, on RAW features.

        Called by the harness for both the training split (to poison) and the
        test split (to measure ASR). Single definition, so the two cannot
        drift apart.
        """
        return (
            (df["merchant_cat"].to_numpy() == self.merchant_cat)
            & (df["device_type"].to_numpy() == self.device_type)
            & (df["amount"].to_numpy() >= self.amount_min)
            & (df["amount"].to_numpy() <= self.amount_max)
        )

    def poison_data(
        self,
        X: np.ndarray,
        y: np.ndarray,
        round_num: int,
        trigger: np.ndarray | None = None,
    ) -> tuple[np.ndarray, np.ndarray]:
        if not self.is_active(round_num) or trigger is None:
            return X, y

        y = np.asarray(y).copy()
        candidates = np.flatnonzero(trigger & (y == 1))
        if candidates.size == 0:
            return X, y

        n_poison = int(round(candidates.size * self.poison_fraction))
        if n_poison == 0:
            return X, y

        chosen = self.rng.choice(candidates, size=n_poison, replace=False)
        y[chosen] = 0  # fraud relabelled as legitimate
        return X, y
