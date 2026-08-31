"""Model interface.

The federated machinery only needs four operations from a model: read
parameters, write parameters, train locally, and score. Keeping the interface
this small means the harness never depends on PyTorch, so tests and CI stay
fast and the reference model can stand in for the real one.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np

from fedguard.types import Params

__all__ = ["Model"]


class Model(ABC):
    @abstractmethod
    def get_params(self) -> Params:
        """Return parameters as a list of arrays. Must be a copy, not a view -
        the harness stores these across rounds and aliasing will corrupt the
        global model in ways that are extremely annoying to debug."""

    @abstractmethod
    def set_params(self, params: Params) -> None:
        ...

    @abstractmethod
    def fit(self, X: np.ndarray, y: np.ndarray, epochs: int = 1) -> dict[str, float]:
        """Train locally. Returns metrics for logging."""

    @abstractmethod
    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """Return P(fraud) as a 1-D array."""
