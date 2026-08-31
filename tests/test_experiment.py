"""End-to-end harness tests on synthetic data."""

from __future__ import annotations

import numpy as np

from fedguard.config import ExperimentConfig
from fedguard.data import partition as part_mod
from fedguard.data import synthetic
from fedguard.experiment import run_experiment


def smoke_config(**overrides) -> ExperimentConfig:
    base = {
        "name": "test",
        "rounds": 3,
        "data": {"source": "synthetic", "n_rows": 4000, "seed": 0},
        "partition": {"strategy": "by_column", "column": "client_id", "n_clients": 4},
        "model": {"name": "reference", "lr": 0.3, "local_epochs": 3},
        "attack": {"name": "none"},
        "defense": {"name": "fedavg"},
    }
    base.update(overrides)
    return ExperimentConfig(**base)


def test_run_completes_and_records_every_round():
    result = run_experiment(smoke_config())
    assert len(result.rounds) == 3
    assert result.final is not None
    assert 0.0 <= result.final["pr_auc"] <= 1.0


def test_learning_actually_happens():
    """Sanity check: PR-AUC after training should beat the base rate.

    If this fails, the model or the aggregation is broken, and every downstream
    result is meaningless. Do not debug attacks or defenses until this passes.
    """
    result = run_experiment(smoke_config(rounds=8))
    final = result.final
    base_rate = final["n_positive"] / final["n_samples"]
    assert final["pr_auc"] > base_rate * 1.5


def test_config_hash_is_stable_and_ignores_name():
    a = smoke_config(name="alpha")
    b = smoke_config(name="beta")
    assert a.hash() == b.hash(), "renaming an experiment must not invalidate its results"

    c = smoke_config(rounds=99)
    assert a.hash() != c.hash()


def test_reproducible_across_runs():
    a = run_experiment(smoke_config())
    b = run_experiment(smoke_config())
    assert a.final["pr_auc"] == b.final["pr_auc"]


def test_partition_is_actually_non_iid():
    """Guards the single most important methodological decision.

    If client fraud rates are near-identical, the partition is effectively IID
    and nothing about the federated setting is being tested.
    """
    df = synthetic.generate(n=20_000, n_clients=5, non_iid=0.7, seed=0)
    clients = part_mod.partition_by_column(df, "client_id", min_rows=1)
    report = part_mod.skew_report(clients)

    spread = report["fraud_rate"].max() / report["fraud_rate"].min()
    assert spread > 1.5, f"partition looks IID (fraud-rate spread {spread:.2f})"


def test_iid_partition_is_actually_iid():
    """Control for the test above - the IID ablation should show little skew."""
    df = synthetic.generate(n=20_000, n_clients=5, non_iid=0.0, seed=0)
    clients = part_mod.partition_iid(df, 5, seed=0)
    report = part_mod.skew_report(clients)

    spread = report["fraud_rate"].max() / report["fraud_rate"].min()
    assert spread < 1.6


def test_no_test_set_leakage_in_scaler():
    """Scaling must use train statistics only. Regression guard for a bug that
    silently inflates every reported number."""
    df = synthetic.generate(n=2000, n_clients=3, seed=0)
    X = df[synthetic.FEATURE_COLUMNS].to_numpy(float)
    train, test = X[:1500], X[1500:]

    mu, sigma = train.mean(axis=0), train.std(axis=0) + 1e-9
    scaled_test = (test - mu) / sigma
    # Test set standardised with train stats should NOT be exactly zero-mean.
    assert not np.allclose(scaled_test.mean(axis=0), 0.0, atol=1e-6)
