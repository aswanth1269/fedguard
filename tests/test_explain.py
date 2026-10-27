"""Tests for the XAI layer (api/explain.py and POST /explain).

Unit tests use a model whose Shapley values are known in closed form; the API
tests run the real demo MLP against isolated paths, like test_api_integrity.
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

import fedguard.api.main as api_main
from fedguard.api.explain import ExplanationUnavailable, explain
from fedguard.api.feed import TransactionFeed
from fedguard.api.jobs import JobStore
from fedguard.api.predict import PredictionError

FEATURES = {
    "amount": 1850.0,
    "hour": 3,
    "merchant_cat": 1,
    "device_type": 1,
    "account_age_days": 14.0,
    "txn_count_24h": 18,
    "amount_zscore": 2.85,
    "is_foreign": 1,
}


# -- unit: a linear model has known Shapley values -----------------------------
class _LinearModel:
    def __init__(self, w):
        self.w = np.asarray(w, dtype=np.float64)

    def predict_proba(self, X):
        return np.asarray(X, dtype=np.float64) @ self.w


class _FakeService:
    def __init__(self, w, cols, *, feature_cols=None):
        self.model = _LinearModel(w)
        self.input_cols = cols
        self.feature_cols = feature_cols or cols

    def predict(self, features):
        missing = [c for c in self.input_cols if c not in features]
        if missing:
            raise PredictionError(f"missing feature(s): {missing}")
        return SimpleNamespace(
            probability=float(self.model.predict_proba(self.vectorise(features))[0])
        )

    def vectorise(self, features):
        return np.asarray([[features[c] for c in self.input_cols]], dtype=np.float32)


class _Eval:
    def __init__(self, X):
        self.X_test = X


def test_linear_model_gets_closed_form_shapley_values_with_correct_signs():
    cols = ["a", "b", "c"]
    w = [2.0, -1.0, 0.5]
    bg = np.random.default_rng(1).normal(size=(50, 3)).astype(np.float32)
    x = {"a": 1.5, "b": 2.0, "c": -1.0}
    exp = explain(_FakeService(w, cols), _Eval(bg), x)
    expected = [w[i] * (x[c] - bg[:, i].mean()) for i, c in enumerate(cols)]
    np.testing.assert_allclose(exp.contributions, expected, atol=1e-5)
    assert exp.contributions[0] > 0 and exp.contributions[1] < 0 and exp.contributions[2] < 0
    assert exp.features == cols
    assert sum(exp.contributions) == pytest.approx(exp.probability - exp.base_value, abs=1e-5)


def test_invalid_input_is_rejected_not_explained():
    svc = _FakeService([1.0, 1.0], ["a", "b"])
    bg = np.zeros((5, 2), np.float32)
    with pytest.raises(PredictionError):
        explain(svc, _Eval(bg), {"a": 1.0})
    with pytest.raises(PredictionError):
        explain(svc, _Eval(bg), {"a": 1.0, "b": float("nan")})


def test_explanation_that_does_not_add_up_is_refused():
    class _Drifting(_FakeService):
        def predict(self, features):
            out = super().predict(features)
            return SimpleNamespace(probability=out.probability + 0.01)  # served score != explained

    bg = np.zeros((5, 2), np.float32)
    with pytest.raises(ExplanationUnavailable):
        explain(_Drifting([1.0, 1.0], ["a", "b"]), _Eval(bg), {"a": 0.2, "b": 0.3})


def test_models_whose_inputs_are_transformed_are_not_explained():
    svc = _FakeService([1.0], ["card1"], feature_cols=["card1_freq"])
    with pytest.raises(ExplanationUnavailable):
        explain(svc, _Eval(np.zeros((5, 1), np.float32)), {"card1": 1.0})


# -- API: the real demo MLP ----------------------------------------------------
@pytest.fixture(scope="module")
def client(tmp_path_factory):
    root = tmp_path_factory.mktemp("explain")
    mp = pytest.MonkeyPatch()
    mp.setattr(api_main, "_store", JobStore())
    mp.setattr(api_main, "_feed", TransactionFeed())
    mp.setattr(api_main, "RESULTS_PATH", root / "runs.jsonl")
    mp.setattr(api_main, "LEDGER_PATH", root / "ledger.jsonl")
    mp.setattr(api_main, "ARTIFACT_REGISTRY_PATH", root / "artifact_registry.jsonl")
    mp.setattr(api_main, "ARTIFACT_STORE_DIR", root / "store")
    mp.setattr(api_main, "KEYS_DIR", root / "keys")
    mp.delenv("FEDGUARD_LEDGER_BACKEND", raising=False)
    c = TestClient(api_main.app)
    job_id = c.post("/demo/warmup").json()["job_id"]
    assert c.get(f"/model-status/{job_id}").json()["status"] == "complete"
    yield c
    mp.undo()


def test_explanation_does_not_change_the_prediction(client):
    before = client.post("/predict", json={"features": FEATURES}).json()
    exp = client.post("/explain", json={"features": FEATURES}).json()
    after = client.post("/predict", json={"features": FEATURES}).json()
    assert before == after
    for k in ("probability", "label", "threshold", "job_id"):
        assert exp[k] == before[k]


def test_explanation_uses_the_real_model_inputs_and_adds_up(client):
    status = client.get("/model-status").json()
    exp = client.post("/explain", json={"features": FEATURES}).json()
    assert [c["feature"] for c in exp["contributions"]] == status["input_cols"]
    assert [c["value"] for c in exp["contributions"]] == [
        float(FEATURES[f]) for f in status["input_cols"]
    ]
    assert exp["output_scale"] == "probability" and exp["background_size"] > 0
    total = sum(c["contribution"] for c in exp["contributions"])
    assert total == pytest.approx(exp["probability"] - exp["base_value"], abs=1e-4)


def test_explanation_depends_on_the_transaction(client):
    other = {**FEATURES, "amount": 20.0, "hour": 14, "txn_count_24h": 1, "is_foreign": 0}
    a = client.post("/explain", json={"features": FEATURES}).json()["contributions"]
    b = client.post("/explain", json={"features": other}).json()["contributions"]
    assert [c["contribution"] for c in a] != [c["contribution"] for c in b]


def test_matches_the_shap_library_on_the_same_model_and_background(client):
    shap = pytest.importorskip("shap")
    from fedguard.api.explain import _background
    from fedguard.api.predict import PredictionService

    job = api_main._store.last_completed()
    svc = PredictionService.from_job(job)
    x = np.asarray(svc.vectorise(FEATURES), dtype=np.float32)
    bg = _background(job.result.eval_data)
    ref = shap.explainers.Exact(
        lambda X: svc.model.predict_proba(np.asarray(X, dtype=np.float32)),
        shap.maskers.Independent(bg, max_samples=len(bg)),
    )(x).values[0]
    ours = client.post("/explain", json={"features": FEATURES}).json()["contributions"]
    np.testing.assert_allclose([c["contribution"] for c in ours], ref, atol=1e-4)


def test_invalid_input_is_a_400(client):
    missing = {k: v for k, v in FEATURES.items() if k != "hour"}
    assert client.post("/explain", json={"features": missing}).status_code == 400
    assert client.post("/explain", json={"features": {**FEATURES, "ip": 1}}).status_code == 400


def test_explanation_failure_does_not_break_scoring(client, monkeypatch):
    def boom(*_a, **_k):
        raise ExplanationUnavailable("forced for test")

    monkeypatch.setattr(api_main, "explain", boom)
    resp = client.post("/explain", json={"features": FEATURES})
    assert resp.status_code == 422 and "explanation unavailable" in resp.json()["detail"]
    scored = client.post("/predict", json={"features": FEATURES})
    assert scored.status_code == 200 and 0.0 <= scored.json()["probability"] <= 1.0


def test_no_model_is_a_409(tmp_path, monkeypatch):
    monkeypatch.setattr(api_main, "_store", JobStore())
    assert TestClient(api_main.app).post("/explain", json={"features": FEATURES}).status_code == 409
