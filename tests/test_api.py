"""Tests for the FastAPI surface (src/fedguard/api/).

Uses a smoke-scale config (small n_rows, few rounds, the reference model) -
`TestClient` runs `BackgroundTasks` synchronously within the request/response
cycle, so a full-scale config here would make every test slow for no benefit;
the harness itself is already covered end to end by tests/test_experiment.py.

`_store` in fedguard.api.main is a module-level singleton - the `client`
fixture swaps in a fresh one before each test so job state never leaks
between tests, rather than relying on test execution order to keep them
apart.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

import fedguard.api.main as api_main
from fedguard.api.jobs import JobStore


def smoke_config(**overrides) -> dict:
    base = {
        "name": "api-test",
        "rounds": 2,
        "data": {"source": "synthetic", "n_rows": 4000, "seed": 0},
        "partition": {"strategy": "by_column", "column": "client_id", "n_clients": 4},
        "model": {"name": "reference", "lr": 0.3, "local_epochs": 3},
        "attack": {"name": "none"},
        "defense": {"name": "fedavg"},
    }
    base.update(overrides)
    return base


@pytest.fixture
def client(tmp_path, monkeypatch):
    api_main._store = JobStore()
    monkeypatch.setattr(api_main, "RESULTS_PATH", tmp_path / "runs.jsonl")
    # Every round anchors to LEDGER_PATH during /train - without this, every
    # test in this file would write real entries into the project's actual
    # results/ledger.jsonl.
    monkeypatch.setattr(api_main, "LEDGER_PATH", tmp_path / "ledger.jsonl")
    return TestClient(api_main.app)


def _train_and_wait(client: TestClient, cfg: dict | None = None, timeout: float = 30.0) -> str:
    resp = client.post("/train", json=cfg or smoke_config())
    assert resp.status_code == 202
    job_id = resp.json()["job_id"]

    deadline = time.time() + timeout
    while time.time() < deadline:
        status = client.get(f"/model-status/{job_id}").json()
        if status["status"] in ("complete", "failed"):
            assert status["status"] == "complete", status.get("error")
            return job_id
        time.sleep(0.2)
    raise TimeoutError(f"job {job_id} did not complete within {timeout}s")


def test_health():
    client = TestClient(api_main.app)
    assert client.get("/health").json() == {"status": "ok"}


def test_predict_before_any_job_returns_409(client):
    resp = client.post("/predict", json={"features": {}})
    assert resp.status_code == 409


def test_unknown_job_id_404s_everywhere(client):
    paths = [
        "/model-status/nope",
        "/training-round/nope",
        "/participants/nope",
        "/agent-status/nope",
        "/agent-summary/nope",
    ]
    for path in paths:
        assert client.get(path).status_code == 404


def test_train_completes_and_is_pollable(client):
    job_id = _train_and_wait(client)
    status = client.get(f"/model-status/{job_id}").json()
    assert status["status"] == "complete"
    assert status["final"]["pr_auc"] >= 0.0


def test_training_round_has_real_per_round_data(client):
    job_id = _train_and_wait(client)
    resp = client.get(f"/training-round/{job_id}")
    rounds = resp.json()["rounds"]
    assert len(rounds) == 2
    for r in rounds:
        assert r["round_state"] == "complete"
        assert r["decision"] is not None
        assert r["agent"] is not None


def test_participants_rolls_up_real_round_history(client):
    job_id = _train_and_wait(client)
    roster = client.get(f"/participants/{job_id}").json()["participants"]
    assert len(roster) == 4  # n_clients from smoke_config
    for entry in roster:
        assert entry["rounds_seen"] == 2  # both rounds, no attack, no exclusions
        assert entry["accepted"] == 2
        assert entry["rejected"] == 0


def test_agent_status_and_summary_agree_on_no_attack_run(client):
    job_id = _train_and_wait(client)
    agent_status = client.get(f"/agent-status/{job_id}").json()
    agent_summary = client.get(f"/agent-summary/{job_id}").json()

    assert agent_status["rounds_reviewed"] == 2
    assert agent_status["rounds_flagged"] == 0
    assert agent_summary["rounds_flagged"] == 0
    assert "All approved" in agent_summary["summary"]


def test_predict_after_completion_uses_the_jobs_own_threshold(client):
    job_id = _train_and_wait(client)
    features = {
        "amount": 120.0,
        "hour": 14,
        "merchant_cat": 3,
        "device_type": 1,
        "account_age_days": 400.0,
        "txn_count_24h": 3,
        "amount_zscore": 0.2,
        "is_foreign": 0,
    }
    resp = client.post("/predict", json={"features": features})
    assert resp.status_code == 200
    body = resp.json()
    assert 0.0 <= body["probability"] <= 1.0
    assert body["label"] == int(body["probability"] >= body["threshold"])
    assert body["job_id"] == job_id


def test_predict_rejects_missing_features(client):
    _train_and_wait(client)
    resp = client.post("/predict", json={"features": {"amount": 1.0}})
    assert resp.status_code == 400


def test_approve_model_records_override(client):
    job_id = _train_and_wait(client)
    resp = client.post(
        "/approve-model", json={"job_id": job_id, "round_num": 1, "note": "reviewed"}
    )
    assert resp.status_code == 200
    assert resp.json()["human_override"]["note"] == "reviewed"

    rounds = client.get(f"/training-round/{job_id}").json()["rounds"]
    assert rounds[0]["human_override"]["note"] == "reviewed"


def test_approve_model_unknown_round_404s(client):
    job_id = _train_and_wait(client)
    resp = client.post("/approve-model", json={"job_id": job_id, "round_num": 999})
    assert resp.status_code == 404


def test_approve_model_unknown_job_404s(client):
    resp = client.post("/approve-model", json={"job_id": "nope", "round_num": 1})
    assert resp.status_code == 404


def test_ledger_has_one_entry_per_round(client):
    _train_and_wait(client)
    resp = client.get("/ledger")
    body = resp.json()
    assert body["count"] == 2  # rounds from smoke_config()
    assert [e["round_num"] for e in body["entries"]] == [1, 2]


def test_ledger_filters_by_config_hash(client):
    _train_and_wait(client)
    all_entries = client.get("/ledger").json()["entries"]
    config_hash = all_entries[0]["config_hash"]

    filtered = client.get(f"/ledger?config_hash={config_hash}").json()
    assert filtered["count"] == 2

    filtered_none = client.get("/ledger?config_hash=nonexistent").json()
    assert filtered_none["count"] == 0


def test_ledger_for_job_matches_job_status(client):
    job_id = _train_and_wait(client)
    resp = client.get(f"/ledger/{job_id}")
    body = resp.json()
    assert body["job_id"] == job_id
    assert body["count"] == 2


def test_ledger_for_unknown_job_404s(client):
    assert client.get("/ledger/nope").status_code == 404


def test_verify_reports_ok_on_an_untouched_chain(client):
    _train_and_wait(client)
    body = client.get("/verify").json()
    assert body["ok"] is True
    assert body["entries_checked"] == 2
    assert body["failed_at_index"] is None


def test_verify_detects_tampering_on_disk(client):
    """The real point of the endpoint: hand-edit the ledger file the way an
    attacker with filesystem access would, and confirm /verify catches it -
    not just that the unit tests for HashChain.verify() pass in isolation."""
    import json

    _train_and_wait(client)
    ledger_path = api_main.LEDGER_PATH
    lines = ledger_path.read_text(encoding="utf-8").splitlines()
    tampered = json.loads(lines[0])
    tampered["eval"]["pr_auc"] = 0.999
    lines[0] = json.dumps(tampered)
    ledger_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    body = client.get("/verify").json()
    assert body["ok"] is False
    assert body["failed_at_index"] == 0
    assert "altered" in body["reason"]


def test_audit_summarises_a_jobs_entries(client):
    job_id = _train_and_wait(client)
    body = client.get(f"/audit/{job_id}").json()
    assert body["job_id"] == job_id
    assert len(body["entries"]) == 2
    assert "2 round(s) anchored" in body["summary"]


def test_audit_before_any_rounds_is_empty_not_an_error(client):
    # rounds=0 rather than racing a real job mid-flight: TestClient runs
    # BackgroundTasks synchronously within the request/response cycle, so by
    # the time a normal /train call returns, training has already finished -
    # there is no way to observe a genuinely in-progress job through it.
    resp = client.post("/train", json=smoke_config(rounds=0))
    job_id = resp.json()["job_id"]
    body = client.get(f"/audit/{job_id}").json()
    assert body["entries"] == []
    assert "No rounds anchored yet" in body["summary"]


def test_audit_unknown_job_404s(client):
    assert client.get("/audit/nope").status_code == 404
