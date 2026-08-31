"""Models. ``LogisticReference`` is for the harness; ``MLP`` is what you report."""

from fedguard.models.base import Model
from fedguard.models.mlp import MLP
from fedguard.models.reference import LogisticReference

MODELS: dict[str, type[Model]] = {
    "reference": LogisticReference,
    "mlp": MLP,
}

__all__ = ["MLP", "MODELS", "LogisticReference", "Model"]
