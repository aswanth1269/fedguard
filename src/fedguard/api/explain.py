"""Per-transaction explanations: exact Shapley values (interventional SHAP).

An interpretation layer only. The score and label come from
``PredictionService.predict`` exactly as ``/predict`` returns them; nothing
here feeds back into the score, the threshold, training or aggregation.

Method. For the model f and a transaction x with n features, the value of a
coalition S of features is

    v(S) = mean over background rows b of  f(x_S, b_rest)

- features in S take the transaction's value, the rest take the background
row's. Feature i's attribution is its Shapley value

    phi_i = sum over S not containing i of |S|!(n-|S|-1)!/n! * (v(S + i) - v(S))

This is the quantity SHAP's interventional explainers estimate. With the
synthetic schema's 8 inputs every one of the 2^8 = 256 coalitions is
enumerated, so the values are exact for this background (no sampling), and
they satisfy  sum(phi) = f(x) - mean_b f(b).  f is the model's PROBABILITY
output, so each phi is in probability units (shown as percentage points).

The background is a fixed, seeded sample of the run's own evaluation split
(``EvalData.X_test``), already in the model's scaled feature space, so the
same fitted transform is used for both the transaction and the background.

Attribution describes how the model's output moved for this input relative
to the background. It is not a statement that a feature causes fraud.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations
from math import factorial

import numpy as np

from fedguard.api.predict import PredictionError, PredictionService
from fedguard.experiment import EvalData

__all__ = [
    "BACKGROUND_SIZE",
    "MAX_EXACT_FEATURES",
    "Explanation",
    "ExplanationUnavailable",
    "explain",
]

BACKGROUND_SIZE = 100
BACKGROUND_SEED = 0
# base + sum(phi) must equal the served probability to this tolerance (float32
# model output; the batched and single-row forward passes can differ by ~1e-7).
ADDITIVE_TOLERANCE = 1e-4
# 2^n coalitions x background rows model evaluations; 2^12 * 100 is still
# well under a second on a laptop CPU. Above that, exact enumeration is not
# offered rather than silently switching to an approximation.
MAX_EXACT_FEATURES = 12


class ExplanationUnavailable(RuntimeError):
    """The loaded model's inputs cannot be explained by this method."""


@dataclass
class Explanation:
    features: list[str]
    values: list[float]
    contributions: list[float]
    base_value: float
    probability: float
    background_size: int


def _background(eval_data: EvalData) -> np.ndarray:
    X = np.asarray(eval_data.X_test, dtype=np.float32)
    if len(X) <= BACKGROUND_SIZE:
        return X
    idx = np.random.default_rng(BACKGROUND_SEED).choice(len(X), BACKGROUND_SIZE, replace=False)
    return X[np.sort(idx)]


def _coalition_values(
    service: PredictionService, x: np.ndarray, bg: np.ndarray
) -> dict[int, float]:
    """v(S) for every coalition, keyed by bitmask, from ONE batched forward pass."""
    n = x.shape[0]
    masks = np.arange(1 << n)
    keep = ((masks[:, None] >> np.arange(n)) & 1).astype(bool)  # (2^n, n)
    rows = np.where(keep[:, None, :], x[None, None, :], bg[None, :, :])  # (2^n, B, n)
    proba = np.asarray(service.model.predict_proba(rows.reshape(-1, n)), dtype=np.float64)
    values = proba.reshape(len(masks), len(bg)).mean(axis=1).tolist()
    return dict(zip(masks.tolist(), values, strict=True))


def explain(
    service: PredictionService, eval_data: EvalData, features: dict[str, float]
) -> Explanation:
    if service.input_cols != service.feature_cols:
        # e.g. IEEE-CIS: raw inputs expand into frequency/one-hot columns, so a
        # model-column attribution does not map 1:1 back onto what was typed.
        raise ExplanationUnavailable(
            "this model's raw inputs do not map one-to-one onto its feature columns"
        )
    n = len(service.feature_cols)
    if n > MAX_EXACT_FEATURES:
        raise ExplanationUnavailable(f"{n} features is too many for exact enumeration")

    # Same validation as /predict (missing/extra -> PredictionError), and the
    # score this explanation must add up to.
    scored = service.predict(features).probability
    raw = [float(features[c]) for c in service.input_cols]
    if not all(np.isfinite(raw)):
        raise PredictionError("feature values must be finite numbers")

    x = np.asarray(service.vectorise(features), dtype=np.float32)[0]
    bg = _background(eval_data)
    v = _coalition_values(service, x, bg)

    weights = [factorial(k) * factorial(n - k - 1) / factorial(n) for k in range(n)]
    phi = []
    for i in range(n):
        others = [j for j in range(n) if j != i]
        total = 0.0
        for k in range(n):
            for subset in combinations(others, k):
                s = sum(1 << j for j in subset)
                total += weights[k] * (v[s | (1 << i)] - v[s])
        phi.append(total)

    # Never return an explanation that does not add up to the served score.
    if abs(v[0] + sum(phi) - scored) > ADDITIVE_TOLERANCE:
        raise ExplanationUnavailable("contributions do not add up to the model's score")

    return Explanation(
        features=service.input_cols,
        values=raw,
        contributions=phi,
        base_value=v[0],
        probability=v[(1 << n) - 1],
        background_size=len(bg),
    )
