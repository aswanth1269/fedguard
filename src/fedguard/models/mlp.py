"""PyTorch MLP - the federated model.

WHY AN MLP WHEN TREES WIN ON TABULAR DATA
------------------------------------------
LightGBM beats neural nets on tabular fraud detection essentially every time.
We use an MLP anyway because FedAvg averages parameters, and you cannot
average two decision trees. That is a real cost of the privacy constraint, so
we measure it instead of hiding it: `models/baseline.py` reports the
centralised LightGBM ceiling in the same results table.

DESIGN NOTES
------------
- Small on purpose: 2 hidden layers, ~64/32 units. On CPU with ~100 features
  this trains in seconds per epoch, which is the only reason the experiment
  matrix is feasible. Deeper does not help on tabular data.
- Class imbalance via `pos_weight` in BCEWithLogitsLoss, NOT resampling.
  Resampling changes the sample count a client reports, which then interacts
  with sample-count-weighted aggregation and quietly confounds results.
- Parameter order is fixed by `state_dict()` ordering, which is insertion
  order over modules. get_params/set_params must be exact inverses or
  aggregation silently mixes layers - the model still trains, badly.
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn

from fedguard.models.base import Model
from fedguard.types import Params

__all__ = ["MLP"]


class _Net(nn.Module):
    def __init__(self, n_features: int, hidden: tuple[int, ...], dropout: float) -> None:
        super().__init__()
        layers: list[nn.Module] = []
        prev = n_features
        for h in hidden:
            layers += [nn.Linear(prev, h), nn.ReLU(), nn.Dropout(dropout)]
            prev = h
        layers.append(nn.Linear(prev, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


class MLP(Model):
    def __init__(
        self,
        n_features: int,
        *,
        hidden: tuple[int, ...] = (64, 32),
        dropout: float = 0.2,
        lr: float = 1e-3,
        pos_weight: float = 10.0,
        batch_size: int = 512,
        seed: int = 0,
    ) -> None:
        torch.manual_seed(seed)
        np.random.seed(seed)

        self.n_features = n_features
        self.net = _Net(n_features, hidden, dropout)
        self.lr = lr
        self.batch_size = batch_size
        self.seed = seed
        self.pos_weight = torch.tensor([pos_weight], dtype=torch.float32)
        self.criterion = nn.BCEWithLogitsLoss(pos_weight=self.pos_weight)

    # -- parameter exchange ------------------------------------------------
    def get_params(self) -> Params:
        """Copies, not views. The harness stores these across rounds; aliasing
        would let a later local training step mutate the global model."""
        return [p.detach().cpu().numpy().copy() for p in self.net.state_dict().values()]

    def set_params(self, params: Params) -> None:
        state = self.net.state_dict()
        if len(params) != len(state):
            raise ValueError(f"expected {len(state)} tensors, got {len(params)}")
        new_state = {
            k: torch.tensor(v, dtype=old.dtype)
            for (k, old), v in zip(state.items(), params, strict=True)
        }
        self.net.load_state_dict(new_state)

    # -- training ----------------------------------------------------------
    def fit(self, X: np.ndarray, y: np.ndarray, epochs: int = 1) -> dict[str, float]:
        X_t = torch.tensor(np.asarray(X), dtype=torch.float32)
        y_t = torch.tensor(np.asarray(y), dtype=torch.float32)
        n = len(y_t)
        if n == 0:
            return {"loss": float("nan"), "n": 0.0}

        # Fresh optimiser each round. Carrying Adam state across rounds means
        # each client's momentum reflects a model that no longer exists after
        # aggregation - a subtle and popular bug.
        opt = torch.optim.Adam(self.net.parameters(), lr=self.lr)
        gen = torch.Generator().manual_seed(self.seed)

        self.net.train()
        loss_val = float("nan")
        for _ in range(epochs):
            perm = torch.randperm(n, generator=gen)
            for start in range(0, n, self.batch_size):
                idx = perm[start : start + self.batch_size]
                opt.zero_grad()
                loss = self.criterion(self.net(X_t[idx]), y_t[idx])
                loss.backward()
                opt.step()
                loss_val = float(loss.item())

        return {"loss": loss_val, "n": float(n)}

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        self.net.eval()
        with torch.no_grad():
            logits = self.net(torch.tensor(np.asarray(X), dtype=torch.float32))
            return torch.sigmoid(logits).numpy()
