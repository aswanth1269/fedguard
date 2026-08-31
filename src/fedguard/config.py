"""Experiment configuration and config hashing.

The config hash is what makes a large experiment matrix survivable. Every run
is keyed by the hash of its config, so:

  - ``fedguard matrix`` skips runs that already completed. Interrupt it, close
    the laptop, restart tomorrow - it picks up where it stopped.
  - You can always trace a plot back to the exact config that produced it.
  - Three laptops can shard the matrix without coordination.

Rule: never edit a config in place to "just try something". Make a new file.
The hash is only useful if configs are immutable.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field

__all__ = ["ExperimentConfig", "load_config"]


class DataConfig(BaseModel):
    source: Literal["synthetic", "ieee_cis"] = "synthetic"
    n_rows: int = 20_000
    test_fraction: float = 0.2
    seed: int = 0


class PartitionConfig(BaseModel):
    strategy: Literal["by_column", "dirichlet", "iid"] = "dirichlet"
    n_clients: int = 5
    column: str | None = None
    alpha: float = 0.5
    non_iid: float = 0.7
    """Only used by the synthetic generator. 0 = IID, 1 = strongly skewed."""


class ModelConfig(BaseModel):
    name: Literal["reference", "mlp"] = "reference"
    hidden: tuple[int, ...] = (64, 32)
    lr: float = 0.1
    pos_weight: float = 10.0
    local_epochs: int = 3


class AttackConfig(BaseModel):
    name: Literal["none", "label_flip", "sign_flip", "backdoor"] = "none"
    malicious_clients: list[str] = Field(default_factory=list)
    active_rounds: str | list[int] = "all"
    """``"all"`` or an explicit list. A sparse list models the intermittent
    adversary - the case your contribution exists to handle."""
    params: dict[str, Any] = Field(default_factory=dict)


class DefenseConfig(BaseModel):
    name: Literal["fedavg", "krum", "multi_krum", "trimmed_mean", "median", "reputation"] = "fedavg"
    params: dict[str, Any] = Field(default_factory=dict)


class ExperimentConfig(BaseModel):
    name: str = "unnamed"
    rounds: int = 20
    seed: int = 0
    data: DataConfig = Field(default_factory=DataConfig)
    partition: PartitionConfig = Field(default_factory=PartitionConfig)
    model: ModelConfig = Field(default_factory=ModelConfig)
    attack: AttackConfig = Field(default_factory=AttackConfig)
    defense: DefenseConfig = Field(default_factory=DefenseConfig)

    def hash(self) -> str:
        """Stable 12-char hash of the full config.

        Sorted keys so dict ordering cannot change the hash. ``name`` is
        excluded deliberately - renaming an experiment should not invalidate
        completed runs.
        """
        payload = self.model_dump(mode="json")
        payload.pop("name", None)
        blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(blob.encode()).hexdigest()[:12]


def load_config(path: str | Path) -> ExperimentConfig:
    with open(path) as f:
        return ExperimentConfig(**yaml.safe_load(f))
