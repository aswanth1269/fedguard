"""Contract tests every Defense must satisfy.

These are the spec for the defenses Aswanth implements. Currently only FedAvg
passes; the rest are expected to fail with NotImplementedError until written.
That is intentional - the failing test tells you what "done" means.

When you implement a defense, add it to IMPLEMENTED below and these tests
start guarding it.
"""

from __future__ import annotations

import numpy as np
import pytest

from fedguard.defenses import DEFENSES, FedAvg
from fedguard.types import ClientUpdate, RoundContext

IMPLEMENTED = ["fedavg", "trimmed_mean", "median", "krum", "multi_krum", "reputation"]

SKIPPED = [name for name in DEFENSES if name not in IMPLEMENTED]


def make_updates(n=5, n_params=10, seed=0):
    rng = np.random.default_rng(seed)
    return [
        ClientUpdate(
            client_id=f"bank_{i}",
            params=[rng.normal(size=n_params), np.array([rng.normal()])],
            n_samples=100 + i * 10,
            round_num=1,
        )
        for i in range(n)
    ]


def make_ctx(n_params=10):
    return RoundContext(
        round_num=1, global_params=[np.zeros(n_params), np.array([0.0])], history=[]
    )


@pytest.fixture(params=IMPLEMENTED)
def defense(request):
    return DEFENSES[request.param]()


def test_every_client_accounted_for(defense):
    updates = make_updates()
    _, decision = defense.aggregate(updates, make_ctx())

    ids = {u.client_id for u in updates}
    assert set(decision.accepted) | set(decision.rejected) == ids
    assert not (
        set(decision.accepted) & set(decision.rejected)
    ), "client both accepted and rejected"


def test_weights_sum_to_one(defense):
    _, decision = defense.aggregate(make_updates(), make_ctx())
    if decision.weights:
        assert sum(decision.weights.values()) == pytest.approx(1.0, abs=1e-6)


def test_deterministic(defense):
    """Non-determinism destroys the audit trail. This is non-negotiable."""
    updates = make_updates()
    a, _ = defense.aggregate(updates, make_ctx())
    defense.reset()
    b, _ = defense.aggregate(make_updates(), make_ctx())
    for x, y in zip(a, b, strict=True):
        assert np.allclose(x, y)


def test_does_not_mutate_inputs(defense):
    updates = make_updates()
    before = [u.params[0].copy() for u in updates]
    defense.aggregate(updates, make_ctx())
    for u, orig in zip(updates, before, strict=True):
        assert np.allclose(u.params[0], orig), "defense mutated the caller's updates"


def test_fedavg_matches_manual_weighted_mean():
    updates = make_updates(n=3)
    agg, _ = FedAvg().aggregate(updates, make_ctx())

    total = sum(u.n_samples for u in updates)
    expected = sum(u.params[0] * (u.n_samples / total) for u in updates)
    assert np.allclose(agg[0], expected)


@pytest.mark.parametrize("name", SKIPPED)
def test_unimplemented_defenses_raise_clearly(name):
    """Until implemented, defenses must fail loudly rather than silently
    returning something plausible."""
    with pytest.raises(NotImplementedError):
        DEFENSES[name]().aggregate(make_updates(), make_ctx())
