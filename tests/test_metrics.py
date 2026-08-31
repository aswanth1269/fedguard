"""Metrics tests. These guard the numbers your whole paper rests on."""

from __future__ import annotations

import numpy as np
import pytest

from fedguard.metrics import (
    attack_success_rate,
    evaluate,
    pr_auc,
    recall_at_fpr,
    threshold_at_fpr,
)


def test_pr_auc_perfect_and_random():
    y = np.array([0] * 95 + [1] * 5)
    perfect = y.astype(float)
    assert pr_auc(y, perfect) == pytest.approx(1.0)

    rng = np.random.default_rng(0)
    random_scores = rng.random(len(y))
    # Random ranking gives PR-AUC near the base rate, not near 0.5.
    # This is exactly why PR-AUC is the right metric under imbalance.
    assert pr_auc(y, random_scores) < 0.3


def test_pr_auc_undefined_without_positives():
    y = np.zeros(50, dtype=int)
    assert np.isnan(pr_auc(y, np.random.default_rng(0).random(50)))


def test_threshold_at_fpr_respects_budget():
    rng = np.random.default_rng(0)
    y = np.array([0] * 990 + [1] * 10)
    scores = np.concatenate([rng.normal(0, 1, 990), rng.normal(3, 1, 10)])

    thr = threshold_at_fpr(y, scores, 0.01)
    realised_fpr = (scores[y == 0] >= thr).mean()
    assert realised_fpr <= 0.01 + 1e-9


def test_recall_at_fpr_monotonic_in_budget():
    rng = np.random.default_rng(1)
    y = np.array([0] * 990 + [1] * 10)
    scores = np.concatenate([rng.normal(0, 1, 990), rng.normal(3, 1, 10)])

    tight = recall_at_fpr(y, scores, 0.001)
    loose = recall_at_fpr(y, scores, 0.05)
    assert loose >= tight


def test_attack_success_rate_bounds():
    y = np.array([1, 1, 1, 1, 0, 0])
    trigger = np.array([True, True, False, False, True, False])

    # All triggered fraud scored well below threshold -> attack fully succeeded.
    scores = np.array([0.0, 0.0, 0.9, 0.9, 0.0, 0.0])
    assert attack_success_rate(y, scores, trigger, threshold=0.5) == pytest.approx(1.0)

    # All triggered fraud scored above threshold -> attack failed.
    scores = np.array([0.9, 0.9, 0.9, 0.9, 0.0, 0.0])
    assert attack_success_rate(y, scores, trigger, threshold=0.5) == pytest.approx(0.0)


def test_attack_success_rate_nan_without_targets():
    y = np.array([0, 0, 1])
    trigger = np.array([True, True, False])  # no triggered fraud
    assert np.isnan(attack_success_rate(y, np.array([0.1, 0.2, 0.9]), trigger, 0.5))


def test_evaluate_shape():
    rng = np.random.default_rng(2)
    y = (rng.random(500) < 0.04).astype(int)
    scores = rng.random(500)

    ev = evaluate(y, scores)
    assert ev.n_samples == 500
    assert ev.n_positive == int(y.sum())
    assert set(ev.recall_at_fpr) == {"0.001", "0.01"}
    assert ev.asr is None  # no trigger mask supplied
    assert "pr_auc" in ev.to_dict()
