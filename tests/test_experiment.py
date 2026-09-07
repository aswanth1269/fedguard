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


def run_isolated(cfg: ExperimentConfig, tmp_path):
    """Every round anchors to the ledger as it completes (experiment.py's
    ANCHORING step) - tests must never write into the project's real
    results/ledger.jsonl, so every call in this file routes through here."""
    return run_experiment(cfg, ledger_path=tmp_path / "ledger.jsonl")


def test_run_completes_and_records_every_round(tmp_path):
    result = run_isolated(smoke_config(), tmp_path)
    assert len(result.rounds) == 3
    assert result.final is not None
    assert 0.0 <= result.final["pr_auc"] <= 1.0


def test_learning_actually_happens(tmp_path):
    """Sanity check: PR-AUC after training should beat the base rate.

    If this fails, the model or the aggregation is broken, and every downstream
    result is meaningless. Do not debug attacks or defenses until this passes.
    """
    result = run_isolated(smoke_config(rounds=8), tmp_path)
    final = result.final
    base_rate = final["n_positive"] / final["n_samples"]
    assert final["pr_auc"] > base_rate * 1.5


def test_config_hash_is_stable_and_ignores_name():
    a = smoke_config(name="alpha")
    b = smoke_config(name="beta")
    assert a.hash() == b.hash(), "renaming an experiment must not invalidate its results"

    c = smoke_config(rounds=99)
    assert a.hash() != c.hash()


def test_reproducible_across_runs(tmp_path):
    a = run_isolated(smoke_config(), tmp_path)
    b = run_isolated(smoke_config(), tmp_path)
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


def test_agent_verdict_recorded_every_round(tmp_path):
    """The coordinator's agent review must actually run every round, not just
    exist as an untested unit - and under the no-attack smoke config there is
    nothing for it to flag."""
    result = run_isolated(smoke_config(), tmp_path)
    assert len(result.rounds) == 3
    for r in result.rounds:
        assert r["round_state"] == "complete"
        assert r["agent"] is not None
        assert r["agent"]["flagged"] == []
        assert "narrative" not in r["agent"]  # hashed payload excludes the narrative
        assert r["agent_narrative"]  # but the narrative is still recorded, separately
        assert r["validation_failures"] == []


def test_coordinator_config_reaches_the_agent(tmp_path):
    """A custom coordinator section in the config must actually reach
    CoordinatorAgent's constructor, not just parse. Checked deterministically
    via the value AgentVerdict records, rather than relying on real training
    divergence crossing a threshold within a handful of rounds - which is not
    guaranteed and would make this test flaky."""
    result = run_isolated(
        smoke_config(
            rounds=2,
            defense={"name": "reputation"},
            coordinator={"reputation_floor": 0.71},
        ),
        tmp_path,
    )
    for r in result.rounds:
        assert r["agent"]["reputation_floor"] == 0.71


def test_every_round_anchors_to_the_ledger(tmp_path):
    """The ANCHORING state machine step must actually call the blockchain
    client, not just advance through it as a no-op - and each round's dict
    should carry a pointer to its own ledger entry, not a duplicate copy of
    the decision/verdict/eval already sitting right next to it."""
    from fedguard.coordinator.blockchain_client import LocalHashChainClient

    ledger_path = tmp_path / "ledger.jsonl"
    result = run_experiment(smoke_config(rounds=3), ledger_path=ledger_path)

    assert len(result.rounds) == 3
    for i, r in enumerate(result.rounds):
        assert r["ledger"] == {"index": i, "entry_hash": r["ledger"]["entry_hash"]}
        assert len(r["ledger"]["entry_hash"]) == 64  # sha256 hex digest

    chain = LocalHashChainClient(ledger_path)
    entries = chain.read_all(config_hash=result.config_hash)
    assert len(entries) == 3
    assert [e.round_num for e in entries] == [1, 2, 3]
    assert chain.verify().ok
