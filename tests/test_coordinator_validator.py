"""Tests for deterministic update validation - the pre-flight checks that run
before the agent ever sees an update."""

from __future__ import annotations

import numpy as np

from fedguard.coordinator.validator import validate_update
from fedguard.types import ClientUpdate


def reference():
    return [np.zeros(5), np.zeros(1)]


def make_update(**overrides):
    defaults = dict(
        client_id="bank_0",
        params=[np.ones(5), np.ones(1)],
        n_samples=100,
        round_num=1,
    )
    defaults.update(overrides)
    return ClientUpdate(**defaults)


def test_well_formed_update_passes():
    result = validate_update(make_update(), reference())
    assert result.passed
    assert result.failures == []


def test_shape_mismatch_fails():
    bad = make_update(params=[np.ones(3), np.ones(1)])
    result = validate_update(bad, reference())
    assert not result.passed
    assert any("shape" in f for f in result.failures)


def test_layer_count_mismatch_fails():
    bad = make_update(params=[np.ones(5)])
    result = validate_update(bad, reference())
    assert not result.passed
    assert any("layers" in f for f in result.failures)


def test_nan_fails():
    params = [np.ones(5), np.ones(1)]
    params[0][2] = np.nan
    bad = make_update(params=params)
    result = validate_update(bad, reference())
    assert not result.passed
    assert any("NaN" in f for f in result.failures)


def test_inf_fails():
    params = [np.ones(5), np.ones(1)]
    params[0][0] = np.inf
    bad = make_update(params=params)
    result = validate_update(bad, reference())
    assert not result.passed


def test_zero_samples_fails():
    bad = make_update(n_samples=0)
    result = validate_update(bad, reference())
    assert not result.passed
    assert any("n_samples" in f for f in result.failures)


def test_exploded_norm_fails():
    bad = make_update(params=[np.full(5, 1e5), np.ones(1)])
    result = validate_update(bad, reference(), max_norm=1000.0)
    assert not result.passed
    assert any("ceiling" in f for f in result.failures)


def test_wrong_round_number_fails_when_checked():
    update = make_update(round_num=3)
    result = validate_update(update, reference(), round_num=5)
    assert not result.passed
    assert any("round_num" in f for f in result.failures)


def test_round_number_unchecked_by_default():
    update = make_update(round_num=3)
    result = validate_update(update, reference())
    assert result.passed


def test_report_format():
    ok = validate_update(make_update(), reference())
    assert ok.report() == "bank_0: OK"
    bad = validate_update(make_update(n_samples=0), reference())
    assert bad.report().startswith("bank_0: FAILED")
