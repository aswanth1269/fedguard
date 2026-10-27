"""Edge cases for ReputationDefense that the generic contract tests in
test_defense_contract.py do not reach: tiny federations, everyone rejected,
non-finite updates, zero reputation, client order, and reset between runs."""

from __future__ import annotations

import numpy as np
import pytest

from fedguard.config import ExperimentConfig
from fedguard.defenses.reputation import ReputationDefense
from fedguard.experiment import run_experiment
from fedguard.types import ClientUpdate, RoundContext

GLOBAL = [np.zeros(4)]


def _u(cid: str, values, n: int = 10, rnd: int = 1) -> ClientUpdate:
    return ClientUpdate(cid, [np.asarray(values, dtype=float)], n, rnd)


def _assert_contract(updates, decision):
    ids = [u.client_id for u in updates]
    assert sorted(decision.accepted + decision.rejected) == sorted(ids)
    assert not set(decision.accepted) & set(decision.rejected)
    assert sum(decision.weights.values()) == pytest.approx(1.0, abs=1e-9)
    assert set(decision.weights) == set(decision.accepted)


def test_single_client_is_accepted_with_full_weight():
    updates = [_u("solo", [1, 2, 3, 4])]
    params, decision = ReputationDefense().aggregate(updates, RoundContext(1, GLOBAL))
    _assert_contract(updates, decision)
    assert decision.weights == {"solo": 1.0}
    np.testing.assert_allclose(params[0], [1, 2, 3, 4])


def test_two_clients_satisfy_the_contract():
    # With two clients the coordinate-wise median is their mean, so opposed
    # deltas cancel to a zero median and carry no directional evidence - a
    # known limit of a median reference at n=2, recorded here rather than hidden.
    updates = [_u("a", [1, 1, 1, 1]), _u("b", [-1, -1, -1, -1])]
    _, decision = ReputationDefense().aggregate(updates, RoundContext(1, GLOBAL))
    _assert_contract(updates, decision)


def test_all_rejected_falls_back_to_one_client_and_records_it():
    updates = [_u("a", [1, 0, 0, 0]), _u("b", [0, 1, 0, 0])]
    _, decision = ReputationDefense(threshold=1.01).aggregate(updates, RoundContext(1, GLOBAL))
    _assert_contract(updates, decision)
    assert len(decision.accepted) == 1
    assert decision.diagnostics["fallback"] == 1.0


def test_non_finite_update_is_rejected_and_does_not_poison_honest_clients():
    honest = [_u("a", [1, 1, 1, 1]), _u("b", [1, 1, 1, 0.9])]
    updates = [*honest, _u("c", [np.nan, 1, 1, 1])]
    params, decision = ReputationDefense().aggregate(updates, RoundContext(1, GLOBAL))
    _assert_contract(updates, decision)
    assert "c" in decision.rejected
    assert decision.diagnostics["nonfinite/c"] == 1.0
    assert np.all(np.isfinite(params[0]))
    # The honest clients' reputation is untouched by c's NaN.
    clean = ReputationDefense()
    clean.aggregate(honest, RoundContext(1, GLOBAL))
    for cid in ("a", "b"):
        assert decision.reputation[cid] == pytest.approx(clean._reputation[cid])


def test_all_non_finite_raises_instead_of_aggregating_nan():
    with pytest.raises(ValueError, match="NaN or Inf"):
        ReputationDefense().aggregate([_u("a", [np.inf, 0, 0, 0])], RoundContext(1, GLOBAL))


def test_zero_reputation_survivors_get_uniform_weights_not_a_division_by_zero():
    updates = [_u("a", [1, 0, 0, 0]), _u("b", [-1, 0, 0, 0])]
    defense = ReputationDefense(initial_reputation=0.0, threshold=0.0)
    params, decision = defense.aggregate(updates, RoundContext(1, GLOBAL))
    _assert_contract(updates, decision)
    assert np.all(np.isfinite(params[0]))


def test_result_does_not_depend_on_client_order():
    rng = np.random.default_rng(3)
    updates = [_u(f"bank_{i}", rng.normal(size=4)) for i in range(5)]
    p1, d1 = ReputationDefense().aggregate(updates, RoundContext(1, GLOBAL))
    p2, d2 = ReputationDefense().aggregate(updates[::-1], RoundContext(1, GLOBAL))
    assert d1.to_dict() == d2.to_dict()
    np.testing.assert_allclose(p1[0], p2[0], rtol=0, atol=1e-12)


def test_penalty_is_faster_than_recovery():
    defense = ReputationDefense()
    good = [_u("a", [1, 1, 0, 0]), _u("b", [1, 1, 0, 0]), _u("c", [1, 1, 0, 0])]
    bad = [*good[:2], _u("c", [-1, -1, 0, 0])]
    defense.aggregate(bad, RoundContext(1, GLOBAL))
    dropped = 1.0 - defense._reputation["c"]
    before = defense._reputation["c"]
    defense.aggregate(good, RoundContext(2, GLOBAL))
    recovered = defense._reputation["c"] - before
    assert dropped > 0 and recovered > 0
    assert dropped > recovered


def _rep_cfg(**overrides) -> ExperimentConfig:
    base = {
        "name": "rep-reset",
        "rounds": 3,
        "data": {"source": "synthetic", "n_rows": 3000, "seed": 0},
        "partition": {"strategy": "by_column", "column": "client_id", "n_clients": 4},
        "model": {"name": "reference", "lr": 0.3, "local_epochs": 2},
        "attack": {"name": "none"},
        "defense": {"name": "reputation"},
    }
    base.update(overrides)
    return ExperimentConfig(**base)


def test_reputation_resets_between_experiments(tmp_path):
    """Two identical runs in one process must agree exactly - which they only
    do if run 2 starts from fresh reputation rather than run 1's leftovers."""
    a = run_experiment(_rep_cfg(), ledger_path=tmp_path / "a.jsonl")
    b = run_experiment(_rep_cfg(), ledger_path=tmp_path / "b.jsonl")
    assert [r["decision"] for r in a.rounds] == [r["decision"] for r in b.rounds]
    assert a.rounds[0]["decision"]["reputation"] == b.rounds[0]["decision"]["reputation"]
