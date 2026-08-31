"""Reference logistic regression in pure NumPy.

Purpose: make the harness runnable and testable on day one, independently of
the real model. `make smoke` uses this, CI uses this, and every harness test
uses this - so a broken MLP never masquerades as a broken aggregator, and a
broken aggregator never hides behind a plausible-looking MLP.

It is deliberately simple and deliberately not the model you report. Use it to
verify that FedAvg converges, that attacks move the numbers, and that defenses
do what you think - then swap in the real MLP and expect the same qualitative
behaviour.

Class imbalance is handled by positive-class weighting rather than resampling,
because resampling inside a federated client changes the effective sample count
each client reports, which interacts badly with sample-count-weighted
aggregation. That interaction is worth understanding before you touch it.
"""

from __future__ import annotations

import numpy as np

from fedguard.models.base import Model
from fedguard.types import Params

__all__ = ["LogisticReference"]


def _sigmoid(z: np.ndarray) -> np.ndarray:
    # Numerically stable: avoids overflow warnings on large |z|.
    out = np.empty_like(z)
    pos = z >= 0
    out[pos] = 1.0 / (1.0 + np.exp(-z[pos]))
    ez = np.exp(z[~pos])
    out[~pos] = ez / (1.0 + ez)
    return out


class LogisticReference(Model):
    def __init__(
        self,
        n_features: int,
        *,
        lr: float = 0.1,
        l2: float = 1e-4,
        pos_weight: float = 10.0,
        seed: int = 0,
    ) -> None:
        rng = np.random.default_rng(seed)
        self.w = rng.normal(scale=0.01, size=n_features)
        self.b = 0.0
        self.lr = lr
        self.l2 = l2
        self.pos_weight = pos_weight

    def get_params(self) -> Params:
        return [self.w.copy(), np.array([self.b])]

    def set_params(self, params: Params) -> None:
        self.w = np.asarray(params[0], dtype=float).copy()
        self.b = float(np.asarray(params[1]).ravel()[0])

    def fit(self, X: np.ndarray, y: np.ndarray, epochs: int = 1) -> dict[str, float]:
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float).ravel()
        n = len(y)
        if n == 0:
            return {"loss": float("nan"), "n": 0}

        sample_w = np.where(y == 1, self.pos_weight, 1.0)
        loss = float("nan")

        for _ in range(epochs):
            p = _sigmoid(X @ self.w + self.b)
            err = (p - y) * sample_w
            grad_w = X.T @ err / n + self.l2 * self.w
            grad_b = err.mean()
            self.w -= self.lr * grad_w
            self.b -= self.lr * grad_b

            eps = 1e-12
            loss = float(
                -np.mean(sample_w * (y * np.log(p + eps) + (1 - y) * np.log(1 - p + eps)))
            )

        return {"loss": loss, "n": float(n)}

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        return _sigmoid(np.asarray(X, dtype=float) @ self.w + self.b)
