"""Sign flipping and model-replacement scaling. Update-space attacks.

SPEC
----
Both operate on the update after local training.

Sign flip: transmit ``-scale * delta`` instead of ``delta``, pushing the global
model away from the optimum. Untargeted and loud - a norm check catches it
easily. Its value to you is as a control: any defense that fails against sign
flip is broken.

Model replacement (Bagdasaryan et al.): the attacker scales its update so that
after averaging, the global model lands on the attacker's chosen model. With n
clients each weighted 1/n, scaling by ~n achieves substitution in a single
round. Devastating against FedAvg, trivially caught by norm clipping - which
is exactly the point. It motivates why norm bounds are table stakes and why
your contribution has to defend against something subtler.

Note the interaction with the intermittent schedule: model replacement in ONE
round out of twenty is the strongest case for cross-round reputation. Run it.

Implementation note: ``poison_update`` receives both the client's params and
``global_params``. The delta is ``params - global_params``; scale the delta,
not the params, or you will scale the base model too and produce garbage.

Clients in this harness transmit ABSOLUTE parameters, not deltas, so the
poisoned delta has to be re-based onto ``global_params`` before it is returned:
transmitting delta ``d`` means transmitting ``global_params + d``.
"""

from __future__ import annotations

import numpy as np

from fedguard.attacks.base import Attack
from fedguard.types import Params

__all__ = ["SignFlipAttack"]

MODES = ("sign_flip", "model_replacement")


class SignFlipAttack(Attack):
    name = "sign_flip"

    def __init__(
        self,
        *,
        scale: float = 1.0,
        mode: str = "sign_flip",  # "sign_flip" | "model_replacement"
        active_rounds: str | list[int] = "all",
        seed: int = 0,
    ) -> None:
        super().__init__(active_rounds=active_rounds, seed=seed)
        if mode not in MODES:
            # Fail at construction, not halfway through a 20-round run.
            raise ValueError(f"mode must be one of {MODES}, got {mode!r}")
        self.scale = scale
        self.mode = mode

    def poison_update(
        self, params: Params, global_params: Params, round_num: int
    ) -> Params:
        if not self.is_active(round_num):
            return params

        # Sign flip transmits -scale * delta; model replacement transmits
        # +scale * delta. Either way it is the DELTA that gets scaled.
        sign = -1.0 if self.mode == "sign_flip" else 1.0

        return [
            np.asarray(g, dtype=float) + sign * self.scale * (np.asarray(p, dtype=float) - g)
            for p, g in zip(params, global_params, strict=True)
        ]
