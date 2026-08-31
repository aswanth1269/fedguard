"""Aggregation rules. FedAvg is the undefended baseline."""

from fedguard.defenses.base import Defense, FedAvg
from fedguard.defenses.krum import Krum, MultiKrum
from fedguard.defenses.reputation import ReputationDefense
from fedguard.defenses.trimmed_mean import Median, TrimmedMean

DEFENSES: dict[str, type[Defense]] = {
    "fedavg": FedAvg,
    "krum": Krum,
    "multi_krum": MultiKrum,
    "trimmed_mean": TrimmedMean,
    "median": Median,
    "reputation": ReputationDefense,
}

__all__ = [
    "DEFENSES",
    "Defense",
    "FedAvg",
    "Krum",
    "Median",
    "MultiKrum",
    "ReputationDefense",
    "TrimmedMean",
]
