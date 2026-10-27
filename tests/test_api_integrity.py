"""API tests for the live monitor, banks, and integrity & audit surfaces.

One demo model (configs/demo_mlp.yaml - the PyTorch MLP) is trained per
module, against isolated paths, and shared: `TestClient` runs background
tasks synchronously, so a single warmup call returns with the model loaded.
Tests that register new versions assert on outcomes and on relative version
numbers, never on absolute counts that another test could have moved.
"""

from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

import fedguard.api.main as api_main
from fedguard.api.feed import TransactionFeed
from fedguard.api.jobs import JobStore

FEATURES = {
    "amount": 120.0,
    "hour": 14,
    "merchant_cat": 3,
    "device_type": 1,
    "account_age_days": 400.0,
    "txn_count_24h": 3,
    "amount_zscore": 0.2,
    "is_foreign": 0,
}


def _isolate(mp: pytest.MonkeyPatch, root) -> None:
    mp.setattr(api_main, "_store", JobStore())
    mp.setattr(api_main, "_feed", TransactionFeed())
    mp.setattr(api_main, "RESULTS_PATH", root / "runs.jsonl")
    mp.setattr(api_main, "LEDGER_PATH", root / "ledger.jsonl")
    mp.setattr(api_main, "ARTIFACT_REGISTRY_PATH", root / "artifact_registry.jsonl")
    mp.setattr(api_main, "ARTIFACT_STORE_DIR", root / "store")
    mp.setattr(api_main, "KEYS_DIR", root / "keys")
    mp.delenv("FEDGUARD_LEDGER_BACKEND", raising=False)
    mp.delenv("FEDGUARD_DEMO_SIGNER", raising=False)


@pytest.fixture
def empty_client(tmp_path, monkeypatch):
    _isolate(monkeypatch, tmp_path)
    return TestClient(api_main.app)


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    mp = pytest.MonkeyPatch()
    _isolate(mp, tmp_path_factory.mktemp("integrity"))
    client = TestClient(api_main.app)
    resp = client.post("/demo/warmup")
    assert resp.status_code == 202
    status = client.get(f"/model-status/{resp.json()['job_id']}").json()
    assert status["status"] == "complete", status.get("error")
    yield client
    mp.undo()


def _bank_update(client, bank_id: str) -> dict:
    recs = client.get(
        "/artifacts", params={"owner": bank_id, "artifact_type": "model_update", "kind": "version"}
    ).json()["records"]
    return recs[0]


# -- live inference ------------------------------------------------------------
def test_model_unavailable_state_is_accurate(empty_client):
    status = empty_client.get("/model-status").json()
    assert status["status"] == "no_job"
    assert status["model"] is None and status["active_job"] is None
    assert empty_client.post("/predict", json={"features": FEATURES}).status_code == 409
    assert empty_client.post("/demo/transactions", json={"count": 1}).status_code == 409
    assert empty_client.get("/transactions").json() == {"events": [], "latest_seq": 0}


def test_warmup_trains_the_pytorch_mlp_and_reports_it(trained):
    status = trained.get("/model-status").json()
    assert status["status"] == "complete"
    assert status["model"]["model_name"] == "mlp"
    assert status["model"]["defense"] == "reputation"
    assert status["model"]["rounds"] == 5
    assert status["model"]["global_model_version"] >= 1
    assert len(status["model"]["global_model_hash"]) == 64
    assert sorted(status["participants"]["accepted"] + status["participants"]["rejected"]) == [
        "bank_0",
        "bank_1",
        "bank_2",
    ]
    assert status["warnings"] == []


def test_prediction_comes_from_the_backend_with_provenance(trained):
    body = trained.post("/predict", json={"features": FEATURES}).json()
    assert 0.0 <= body["probability"] <= 1.0
    assert body["label"] == int(body["probability"] >= body["threshold"])
    assert body["model"]["model_name"] == "mlp"
    # Same input, same model -> same score: nothing random is added in serving.
    again = trained.post("/predict", json={"features": FEATURES}).json()
    assert again["probability"] == body["probability"]


def test_invalid_prediction_input_is_rejected(trained):
    assert trained.post("/predict", json={"features": {"amount": 1.0}}).status_code == 400
    bad = {**FEATURES, "made_up_feature": 1.0}
    assert trained.post("/predict", json={"features": bad}).status_code == 400
    assert trained.post("/predict", json={"features": {"amount": "lots"}}).status_code == 422


# -- transaction feed ----------------------------------------------------------
def test_feed_ingest_dedupes_and_polls_exactly_once(trained):
    cursor = trained.get("/transactions").json()["latest_seq"]
    tx = {"transaction_id": "TXN-T-1", "bank_id": "bank_1", "features": FEATURES}
    first = trained.post("/transactions", json=tx)
    assert first.status_code == 201
    event = first.json()
    assert event["source"] == "api" and event["classification"] in ("alert", "lower_risk")
    assert event["model"]["model_name"] == "mlp"
    assert trained.post("/transactions", json=tx).status_code == 409

    page = trained.get("/transactions", params={"after": cursor}).json()
    assert [e["transaction_id"] for e in page["events"]] == ["TXN-T-1"]
    assert trained.get("/transactions", params={"after": page["latest_seq"]}).json()["events"] == []


def test_feed_rejects_bad_input(trained):
    bad_ts = {"transaction_id": "TXN-T-2", "timestamp": "yesterday", "features": FEATURES}
    assert trained.post("/transactions", json=bad_ts).status_code == 400
    bad_id = {"transaction_id": "has spaces", "features": FEATURES}
    assert trained.post("/transactions", json=bad_id).status_code == 422
    missing = {"transaction_id": "TXN-T-3", "features": {"amount": 1.0}}
    assert trained.post("/transactions", json=missing).status_code == 400


def test_synthetic_demo_feed_is_labelled_and_scored_by_the_real_model(trained):
    events = trained.post("/demo/transactions", json={"count": 3}).json()["events"]
    assert len(events) == 3
    assert len({e["transaction_id"] for e in events}) == 3
    for e in events:
        assert e["source"] == "synthetic_demo"
        assert e["bank_id"] in ("bank_0", "bank_1", "bank_2")
        direct = trained.post("/predict", json={"features": e["features"]}).json()
        assert direct["probability"] == pytest.approx(e["probability"])


# -- banks ---------------------------------------------------------------------
def test_banks_come_from_real_backend_state(trained):
    body = trained.get("/banks").json()
    ids = [b["bank_id"] for b in body["banks"]]
    assert ids == ["bank_0", "bank_1", "bank_2"]
    assert body["federation"]["simulated"] is True
    for b in body["banks"]:
        assert b["enrolled"] and b["key_custody"] == "simulated_server_side"
        assert b["local_training_rows"] > 0
        assert b["latest_update"]["round"] == 5
        assert b["round_history"]["accepted"] + b["round_history"]["rejected"] == 5
    assert [b["display_name"] for b in body["banks"]] == ["Bank A", "Bank B", "Bank C"]


def test_dataset_upload_is_validated_and_registered_not_trained_on(trained):
    good = ",".join([*FEATURES, "is_fraud"]) + "\n"
    good += "".join(f"{10 + i},{i % 24},1,0,300,2,0.1,0,{int(i == 3)}\n" for i in range(20))
    payload = base64.b64encode(good.encode()).decode()
    resp = trained.post(
        "/demo/bank-signer/upload",
        json={"member_id": "bank_0", "artifact_type": "dataset", "payload_b64": payload},
    ).json()
    assert resp["outcome"] == "AUTHORIZED_NEW_VERSION"
    assert resp["record"]["metadata"]["rows"] == 20
    assert resp["record"]["metadata"]["used_for_training"] is False
    assert resp["record"]["hash_scheme"] == "file-sha256-v1"
    assert trained.get(f"/artifacts/{resp['record']['seq']}/download").status_code == 403

    bad = base64.b64encode(b"amount,hour\n1,2\n").decode()
    resp = trained.post(
        "/demo/bank-signer/upload",
        json={"member_id": "bank_0", "artifact_type": "dataset", "payload_b64": bad},
    ).json()
    assert resp["outcome"] == "VALIDATION_FAILED"
    assert any("missing column" in r for r in resp["reasons"])


def test_uploaded_copy_of_a_recorded_version_is_checked_against_it(trained):
    import numpy as np

    from fedguard.artifacts.hashing import load_params_npz, serialize_params_npz

    original = _bank_update(trained, "bank_1")
    data = trained.get(f"/artifacts/{original['seq']}/download").content
    names, params = load_params_npz(data)
    params[0] = params[0].copy()
    params[0].flat[0] += np.float32(0.001)  # exactly one value
    modified = serialize_params_npz(names, params)

    def upload(payload: bytes, claims=None) -> dict:
        return trained.post(
            "/demo/bank-signer/upload",
            json={
                "member_id": "bank_1",
                "artifact_type": "model_update",
                "payload_b64": base64.b64encode(payload).decode(),
                "claims_version_seq": claims,
            },
        ).json()

    same = upload(data, original["seq"])
    assert same["outcome"] == "INTEGRITY_VERIFIED"
    assert same["record"]["content_hash"] == original["content_hash"]

    bad = upload(modified, original["seq"])
    assert bad["outcome"] == "INTEGRITY_FAILURE" and bad["registers_version"] is False
    assert {c["name"]: c["status"] for c in bad["checks"]}["integrity"] == "fail"
    assert bad["record"]["trusted_hash"] == original["content_hash"]
    assert bad["record"]["content_hash"] != original["content_hash"]
    assert bad["record"]["kind"] == "rejected_submission"
    # trusted original unchanged
    assert trained.get(f"/artifacts/{original['seq']}/download").content == data
    ok = trained.post(f"/artifacts/{original['seq']}/verify", json={"source": "stored"}).json()
    assert ok["outcome"] == "INTEGRITY_VERIFIED"

    # the same changed file, NOT presented as a copy, follows the new-version path
    new = upload(modified)
    assert new["outcome"] != "INTEGRITY_FAILURE" and new["registers_version"] is True
    assert new["record"]["version"] > original["version"]


# -- integrity & audit: the panel demo -----------------------------------------
def test_full_integrity_demo_flow(trained):
    original = _bank_update(trained, "bank_2")
    seq = original["seq"]
    assert len(original["content_hash"]) == 64
    assert original["signature"]["status"] == "verified"
    assert original["on_chain"] is False

    # 3. unchanged artifact verifies
    ok = trained.post(f"/artifacts/{seq}/verify", json={"source": "stored"}).json()
    assert ok["outcome"] == "INTEGRITY_VERIFIED"
    assert ok["trusted_hash"] == ok["candidate_hash"] == original["content_hash"]

    # 4-7. modified copy fails against the ORIGINAL's trusted hash
    bad = trained.post(
        f"/artifacts/{seq}/verify", json={"source": "modified_copy", "delta": 0.001}
    ).json()
    assert bad["outcome"] == "INTEGRITY_FAILURE"
    assert bad["trusted_hash"] == original["content_hash"] != bad["candidate_hash"]

    # Uploading the downloaded file verifies; uploading a modified one fails.
    blob = trained.get(f"/artifacts/{seq}/download").content
    up = trained.post(
        f"/artifacts/{seq}/verify",
        json={"source": "upload", "upload_b64": base64.b64encode(blob).decode()},
    ).json()
    assert up["outcome"] == "INTEGRITY_VERIFIED"

    # 8-9. a legitimate new version is recorded separately
    new = trained.post(
        "/demo/bank-signer/model-update",
        json={"member_id": "bank_2", "scenario": "legitimate_retrain"},
    ).json()
    assert new["outcome"] == "AUTHORIZED_NEW_VERSION", new["checks"]
    rec = new["record"]
    assert rec["version"] > original["version"]
    assert rec["previous_version_ref"]["seq"] >= seq
    assert rec["content_hash"] != original["content_hash"]
    # ...and the original record is untouched and still verifies.
    assert trained.get(f"/artifacts/{seq}").json()["content_hash"] == original["content_hash"]
    assert (
        trained.post(f"/artifacts/{seq}/verify", json={"source": "stored"}).json()["outcome"]
        == "INTEGRITY_VERIFIED"
    )


@pytest.mark.parametrize(
    ("scenario", "outcome"),
    [
        ("impersonation", "UNAUTHORIZED_SUBMISSION"),
        ("invalid_signature", "SIGNATURE_INVALID"),
        ("wrong_architecture", "VALIDATION_FAILED"),
        ("bank_publishes_global_model", "UNAUTHORIZED_SUBMISSION"),
        ("malicious_update", "SUSPICIOUS_UPDATE"),
    ],
)
def test_negative_submission_scenarios(trained, scenario, outcome):
    resp = trained.post(
        "/demo/bank-signer/model-update", json={"member_id": "bank_2", "scenario": scenario}
    ).json()
    assert resp["outcome"] == outcome, resp["checks"]
    if outcome == "SUSPICIOUS_UPDATE":
        # Authorized and intact, but quarantined by the behaviour check.
        assert resp["approval_status"] == "quarantined"
        statuses = {c["name"]: c["status"] for c in resp["checks"]}
        assert statuses["signature"] == statuses["authorization"] == "pass"
        assert statuses["defense"] == "fail"
    else:
        assert resp["record"]["kind"] == "rejected_submission"
        assert resp["record"]["version"] is None


def test_unknown_key_on_the_real_submit_path_is_unauthorized(trained):
    blob = trained.get(f"/artifacts/{_bank_update(trained, 'bank_1')['seq']}/download").content
    resp = trained.post(
        "/artifacts/submit",
        json={
            "member_id": "bank_1",
            "artifact_type": "model_update",
            "round": 5,
            "payload_b64": base64.b64encode(blob).decode(),
            "key_id": "ed25519:0000000000000000",
            "signature_b64": base64.b64encode(b"x" * 64).decode(),
        },
    ).json()
    assert resp["outcome"] == "UNAUTHORIZED_SUBMISSION"


def test_externally_signed_submission_is_accepted(trained):
    """A member holding its own key: the server only ever sees the public key."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from fedguard.artifacts import KeyRing
    from fedguard.artifacts.hashing import hash_named_params, load_params_npz
    from fedguard.artifacts.signing import submission_message

    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    key = KeyRing(api_main.KEYS_DIR).enrol(
        "bank_ext", display_name="Bank X", public_key_b64=base64.b64encode(pub).decode()
    )

    blob = trained.get(f"/artifacts/{_bank_update(trained, 'bank_0')['seq']}/download").content
    names, params = load_params_npz(blob)
    msg = submission_message(
        member_id="bank_ext",
        artifact_type="model_update",
        round_num=5,
        content_hash=hash_named_params(names, params),
        hash_scheme="fedguard-params-v1",
    )
    resp = trained.post(
        "/artifacts/submit",
        json={
            "member_id": "bank_ext",
            "artifact_type": "model_update",
            "round": 5,
            "payload_b64": base64.b64encode(blob).decode(),
            "key_id": key.key_id,
            "signature_b64": base64.b64encode(priv.sign(msg)).decode(),
        },
    ).json()
    assert resp["outcome"] == "AUTHORIZED_NEW_VERSION", resp["checks"]
    statuses = {c["name"]: c["status"] for c in resp["checks"]}
    assert statuses["identity"] == statuses["signature"] == statuses["authorization"] == "pass"
    assert resp["record"]["signature"]["custody"] == "external"
    # The server cannot sign for an externally held key.
    r = trained.post("/demo/bank-signer/model-update", json={"member_id": "bank_ext"})
    assert r.status_code in (404, 409)


def test_integrity_status_reports_blockchain_not_configured(trained):
    body = trained.get("/integrity/status").json()
    assert body["blockchain"]["configured"] is False
    assert body["blockchain"]["status"] == "not_configured"
    assert body["round_ledger"]["ok"] is True
    assert body["artifact_registry"]["ok"] is True
    assert body["signatures"]["available"] is True
    assert body["demo_signer_enabled"] is True
    # Every registry record states it is local-only.
    assert all(r["on_chain"] is False for r in trained.get("/artifacts").json()["records"])


def test_global_model_record_links_to_the_round_ledger(trained):
    rec = trained.get(
        "/artifacts", params={"artifact_type": "global_model", "kind": "version"}
    ).json()["records"][0]
    ref = rec["ledger_ref"]
    assert ref["legacy_hash_matches"] is True
    ledger = trained.get("/ledger").json()["entries"]
    entry = next(e for e in ledger if e["index"] == ref["ledger_index"])
    assert entry["entry_hash"] == ref["entry_hash"]


def test_demo_signer_can_be_disabled(trained, monkeypatch):
    monkeypatch.setenv("FEDGUARD_DEMO_SIGNER", "0")
    r = trained.post("/demo/bank-signer/model-update", json={"member_id": "bank_2"})
    assert r.status_code == 403
    assert trained.get("/integrity/status").json()["demo_signer_enabled"] is False


def test_job_is_not_complete_until_artifacts_are_registered(tmp_path):
    """A real server runs training in a thread; the UI must never see a
    "complete" model whose global-model version is not registered yet."""
    from fedguard.api.jobs import JobStatus
    from fedguard.config import load_config

    store = JobStore()
    job = store.submit(load_config(api_main.DEMO_CONFIG_PATH).model_copy(update={"rounds": 1}))
    seen = {}

    def hook(j):
        seen["status"] = j.status
        seen["last_completed"] = store.last_completed()

    store.run(job.id, str(tmp_path / "r.jsonl"), str(tmp_path / "l.jsonl"), after_training=hook)
    assert seen == {"status": JobStatus.RUNNING, "last_completed": None}
    assert store.get(job.id).status is JobStatus.COMPLETE


def test_registration_failure_is_reported_not_swallowed(tmp_path):
    store = JobStore()
    job = store.submit(
        api_main.load_config(api_main.DEMO_CONFIG_PATH).model_copy(update={"rounds": 1})
    )

    def boom(_j):
        raise OSError("disk full")

    store.run(job.id, str(tmp_path / "r.jsonl"), str(tmp_path / "l.jsonl"), after_training=boom)
    assert store.get(job.id).status.value == "complete"
    assert any("disk full" in w for w in store.get(job.id).warnings)
