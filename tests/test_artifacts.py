"""Unit tests for fedguard.artifacts - hashing, signing, the registry and the
decision engine - without the API in the way."""

from __future__ import annotations

import base64
import json

import numpy as np
import pytest

from fedguard.artifacts import (
    ArtifactRegistry,
    IntegrityService,
    KeyRing,
    KeyRingError,
    ModelContext,
)
from fedguard.artifacts import validation as v
from fedguard.artifacts.hashing import (
    ArtifactFormatError,
    hash_named_params,
    load_params_npz,
    serialize_params_npz,
)
from fedguard.artifacts.signing import submission_message

NAMES = ["w", "b"]


def _params(seed: int = 0, dtype=np.float32):
    rng = np.random.default_rng(seed)
    return [rng.normal(size=(3, 2)).astype(dtype), rng.normal(size=(3,)).astype(dtype)]


# -- hashing -------------------------------------------------------------------
def test_hash_is_reproducible_for_unchanged_content():
    assert hash_named_params(NAMES, _params()) == hash_named_params(NAMES, _params())


def test_hash_changes_when_any_value_changes():
    p = _params()
    q = [x.copy() for x in p]
    q[1][2] += np.float32(1e-6)
    assert hash_named_params(NAMES, p) != hash_named_params(NAMES, q)


def test_hash_commits_to_names_shapes_and_dtypes_not_just_bytes():
    p = _params()
    base = hash_named_params(NAMES, p)
    assert hash_named_params(["w2", "b"], p) != base
    assert hash_named_params(NAMES, [p[0].reshape(2, 3), p[1]]) != base
    as_f64 = [x.astype(np.float64) for x in p]
    assert hash_named_params(NAMES, as_f64) != base


def test_npz_roundtrip_preserves_hash():
    p = _params()
    names, loaded = load_params_npz(serialize_params_npz(NAMES, p))
    assert names == NAMES
    assert hash_named_params(names, loaded) == hash_named_params(NAMES, p)


def test_npz_loader_rejects_garbage_and_pickles():
    with pytest.raises(ArtifactFormatError):
        load_params_npz(b"definitely not a zip")
    import io

    buf = io.BytesIO()
    np.savez(buf, **{"0000__obj": np.array([{"x": 1}], dtype=object)})
    with pytest.raises(ArtifactFormatError):
        load_params_npz(buf.getvalue())


# -- signing -------------------------------------------------------------------
def test_signature_verifies_and_rejects_any_change(tmp_path):
    ring = KeyRing(tmp_path)
    key = ring.enrol("bank_2", display_name="Bank C")
    msg = submission_message(
        member_id="bank_2",
        artifact_type="model_update",
        round_num=5,
        content_hash="a" * 64,
        hash_scheme="fedguard-params-v1",
    )
    sig = ring.sign("bank_2", msg)
    assert ring.verify(key, msg, sig)
    tampered = msg.replace(b'"round":5', b'"round":6')
    assert not ring.verify(key, tampered, sig)
    assert not ring.verify(key, msg, "not-base64!!")


def test_enrolled_keys_are_never_replaced(tmp_path):
    ring = KeyRing(tmp_path)
    first = ring.enrol("bank_3", display_name="Bank D")
    with pytest.raises(KeyRingError, match="never replaced"):
        ring.enrol("bank_3", display_name="Bank D")
    assert ring.get("bank_3").key_id == first.key_id


def test_enrolment_validates_member_ids_and_external_keys(tmp_path):
    ring = KeyRing(tmp_path)
    with pytest.raises(KeyRingError):
        ring.enrol("Bank D!", display_name="Bank D")
    with pytest.raises(KeyRingError):
        ring.enrol("bank_9", display_name="X", public_key_b64=base64.b64encode(b"short").decode())


def test_external_custody_cannot_be_signed_for_by_the_server(tmp_path):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    ring = KeyRing(tmp_path)
    key = ring.enrol("bank_7", display_name="Bank H", public_key_b64=base64.b64encode(pub).decode())
    assert key.custody == "external"
    assert not ring.can_sign("bank_7")
    with pytest.raises(KeyRingError):
        ring.sign("bank_7", b"x")
    # No private key material is written for an external member.
    assert not (tmp_path / "private" / "bank_7.pem").exists()
    assert "PRIVATE" not in (tmp_path / "trusted_keys.json").read_text()


# -- decision engine -----------------------------------------------------------
def _decide(**overrides):
    base = dict(
        claimed_member="bank_2",
        artifact_type="model_update",
        key_enrolled=True,
        key_owner="bank_2",
        key_permissions={"model_update", "dataset"},
        signature_valid=True,
        schema_failures=[],
        previous_hash="1" * 64,
        previous_version=1,
        content_hash="2" * 64,
        defense=v.DefenseEvidence("screening", "pass", "aligned"),
    )
    base.update(overrides)
    return v.decide_submission(**base)


@pytest.mark.parametrize(
    ("overrides", "outcome", "approval"),
    [
        ({}, v.AUTHORIZED_NEW_VERSION, "accepted"),
        ({"key_enrolled": False, "key_owner": None}, v.UNAUTHORIZED_SUBMISSION, "rejected"),
        ({"signature_valid": False}, v.SIGNATURE_INVALID, "rejected"),
        ({"key_owner": "bank_1"}, v.UNAUTHORIZED_SUBMISSION, "rejected"),
        ({"artifact_type": "global_model"}, v.UNAUTHORIZED_SUBMISSION, "rejected"),
        ({"schema_failures": ["bad shape"]}, v.VALIDATION_FAILED, "rejected"),
        ({"content_hash": "1" * 64}, v.INTEGRITY_VERIFIED, "n/a"),
        (
            {"defense": v.DefenseEvidence("screening", "fail", "x")},
            v.SUSPICIOUS_UPDATE,
            "quarantined",
        ),
        (
            {"defense": v.DefenseEvidence("screening", "insufficient", "x")},
            v.PENDING_REVIEW,
            "pending_review",
        ),
    ],
)
def test_decision_engine_outcomes(overrides, outcome, approval):
    d = _decide(**overrides)
    assert d.outcome == outcome
    assert d.approval_status == approval
    # Every question is reported, even when an earlier one decided the outcome.
    assert [c.name for c in d.checks] == [
        "identity",
        "signature",
        "authorization",
        "schema",
        "integrity",
        "defense",
    ]


def test_a_new_hash_is_a_new_version_not_tampering():
    d = _decide()
    integrity = next(c for c in d.checks if c.name == "integrity")
    assert integrity.status == "pass"
    assert "not tampering" in integrity.detail


def test_decision_engine_is_deterministic():
    assert _decide().to_dict() == _decide().to_dict()


def test_verify_against_record_requires_full_hashes():
    assert (
        v.verify_against_record(trusted_hash="a" * 64, candidate_hash="a" * 64, version=1).outcome
        == v.INTEGRITY_VERIFIED
    )
    assert (
        v.verify_against_record(trusted_hash="a" * 64, candidate_hash="b" * 64, version=1).outcome
        == v.INTEGRITY_FAILURE
    )
    # A truncated display hash is never accepted as evidence.
    assert (
        v.verify_against_record(trusted_hash="a" * 64, candidate_hash="a" * 12, version=1).outcome
        == v.VALIDATION_FAILED
    )


# -- registry and service ------------------------------------------------------
@pytest.fixture
def svc(tmp_path):
    return IntegrityService(
        ArtifactRegistry(tmp_path / "reg.jsonl", tmp_path / "store"), KeyRing(tmp_path / "keys")
    )


def _ctx(base, final):
    return ModelContext(
        job_id="j1",
        config_hash="c" * 12,
        model_name="mlp",
        defense_name="reputation",
        round_num=3,
        param_names=NAMES,
        global_params=final,
        base_params=base,
    )


def _submit(svc, member, params, ctx, *, signer=None, defense=None, claims=None, bad_sig=False):
    data = serialize_params_npz(NAMES, params)
    key_id, sig = svc.sign_as(
        signer or member, "model_update", ctx.round_num, data, claimed_member=member
    )
    if bad_sig:
        key_id, sig = svc.sign_as(member, "model_update", ctx.round_num + 1, data)
    return svc.submit(
        member_id=member,
        artifact_type="model_update",
        round_num=ctx.round_num,
        data=data,
        key_id=key_id,
        signature_b64=sig,
        channel="test",
        ctx=ctx,
        defense_override=defense,
        claims_version_seq=claims,
    )


ROUND_ACCEPTED = v.DefenseEvidence("aggregation_round", "pass", "accepted in round 3")


def test_first_out_of_round_update_without_peers_is_pending_review(svc):
    base = _params()
    svc.keyring.ensure_simulated("bank_0", display_name="Bank A")
    d, rec = _submit(svc, "bank_0", _params(1), _ctx(base, base))
    assert d.outcome == v.PENDING_REVIEW
    assert rec["kind"] == "version" and rec["approval_status"] == "pending_review"


def test_new_version_never_overwrites_the_old_one(svc):
    base = [np.zeros((3, 2), np.float32), np.zeros(3, np.float32)]
    ctx = _ctx(base, base)
    for b in ("bank_0", "bank_1", "bank_2"):
        svc.keyring.ensure_simulated(b, display_name=b)
    rng = np.random.default_rng(0)
    common = [rng.normal(size=(3, 2)).astype(np.float32), rng.normal(size=3).astype(np.float32)]
    for b in ("bank_0", "bank_1"):  # peers, as registered from a training round
        noisy = [c + 0.01 * rng.normal(size=c.shape).astype(np.float32) for c in common]
        _submit(svc, b, noisy, ctx, defense=ROUND_ACCEPTED)
    d1, v1 = _submit(svc, "bank_2", common, ctx)
    d2, v2 = _submit(svc, "bank_2", [c * 1.1 for c in common], ctx)
    assert d1.outcome == d2.outcome == v.AUTHORIZED_NEW_VERSION
    assert (v1["version"], v2["version"]) == (1, 2)
    assert v2["previous_version_ref"]["content_hash"] == v1["content_hash"]
    assert v1["content_hash"] != v2["content_hash"]
    # v1 is still on record and still verifies against its own trusted hash.
    assert (
        svc.verify(svc.registry.get(v1["seq"]), None, "stored")[0].outcome == v.INTEGRITY_VERIFIED
    )
    # Checking v2's content against v1's trusted hash is an integrity failure.
    v2_bytes = svc.registry.get_content(v2["storage_key"])
    assert (
        svc.verify(svc.registry.get(v1["seq"]), v2_bytes, "upload")[0].outcome
        == v.INTEGRITY_FAILURE
    )


def test_incompatible_architecture_is_rejected_and_not_stored(svc, tmp_path):
    base = _params()
    ctx = _ctx(base, base)
    svc.keyring.ensure_simulated("bank_0", display_name="Bank A")
    wrong = [np.zeros((4, 2), np.float32), np.zeros(3, np.float32)]
    d, rec = _submit(svc, "bank_0", wrong, ctx)
    assert d.outcome == v.VALIDATION_FAILED
    assert rec["kind"] == "rejected_submission" and rec["version"] is None
    assert not list((tmp_path / "store").glob("*")) if (tmp_path / "store").exists() else True


def test_impersonation_is_unauthorized(svc):
    base = _params()
    ctx = _ctx(base, base)
    svc.keyring.ensure_simulated("bank_1", display_name="Bank B")
    svc.keyring.ensure_simulated("bank_2", display_name="Bank C")
    d, rec = _submit(svc, "bank_2", _params(1), ctx, signer="bank_1")
    assert d.outcome == v.UNAUTHORIZED_SUBMISSION
    assert rec["kind"] == "rejected_submission"


def _one_value_changed(params):
    changed = [p.copy() for p in params]
    changed[0].flat[0] += np.float32(0.001)
    return changed


def test_copy_claiming_an_existing_version_is_checked_against_its_trusted_hash(svc):
    base = _params()
    ctx = _ctx(base, base)
    svc.keyring.ensure_simulated("bank_0", display_name="Bank A")
    original = _params(1)
    _, trusted = _submit(svc, "bank_0", original, ctx, defense=ROUND_ACCEPTED)
    stored = svc.registry.get_content(trusted["storage_key"])
    n_records = len(svc.registry.read_all())

    # unchanged copy -> verified, nothing new recorded
    d, rec = _submit(svc, "bank_0", original, ctx, claims=trusted["seq"])
    assert d.outcome == v.INTEGRITY_VERIFIED and not d.registers_version
    assert rec["seq"] == trusted["seq"]
    assert len(svc.registry.read_all()) == n_records

    # one changed value, presented as that version -> integrity failure
    d, rec = _submit(svc, "bank_0", _one_value_changed(original), ctx, claims=trusted["seq"])
    assert d.outcome == v.INTEGRITY_FAILURE and not d.registers_version
    checks = {c.name: c.status for c in d.checks}
    assert checks["signature"] == "pass" and checks["integrity"] == "fail"
    assert rec["kind"] == "rejected_submission" and rec["version"] is None
    assert rec["trusted_hash"] == trusted["content_hash"] != rec["content_hash"]
    assert rec["claimed_version"] == trusted["version"]
    # the trusted original is untouched and is still the latest version
    assert svc.registry.get_content(trusted["storage_key"]) == stored
    assert svc.registry.latest_version("bank_0/model_update")["seq"] == trusted["seq"]
    assert (
        svc.verify(svc.registry.get(trusted["seq"]), None, "stored")[0].outcome
        == v.INTEGRITY_VERIFIED
    )


def test_same_changed_file_without_a_claim_is_still_a_new_version(svc):
    base = _params()
    ctx = _ctx(base, base)
    svc.keyring.ensure_simulated("bank_0", display_name="Bank A")
    original = _params(1)
    _, v1 = _submit(svc, "bank_0", original, ctx, defense=ROUND_ACCEPTED)
    d, v2 = _submit(svc, "bank_0", _one_value_changed(original), ctx, defense=ROUND_ACCEPTED)
    assert d.outcome == v.AUTHORIZED_NEW_VERSION
    assert (v1["version"], v2["version"]) == (1, 2)
    assert "trusted_hash" not in v2


def test_signature_is_checked_independently_of_a_version_claim(svc):
    base = _params()
    ctx = _ctx(base, base)
    svc.keyring.ensure_simulated("bank_0", display_name="Bank A")
    svc.keyring.ensure_simulated("bank_1", display_name="Bank B")
    original = _params(1)
    _, trusted = _submit(svc, "bank_0", original, ctx, defense=ROUND_ACCEPTED)
    # bad signature over the unchanged content: a matching hash does not rescue it
    d, _ = _submit(svc, "bank_0", original, ctx, claims=trusted["seq"], bad_sig=True)
    assert d.outcome == v.SIGNATURE_INVALID
    # a claim may only name a recorded version of the submitter's own artifact
    with pytest.raises(ValueError):
        _submit(svc, "bank_1", original, ctx, claims=trusted["seq"])


def test_registry_detects_an_edited_past_record(svc):
    base = _params()
    ctx = _ctx(base, base)
    svc.keyring.ensure_simulated("bank_0", display_name="Bank A")
    _submit(svc, "bank_0", _params(1), ctx)
    _submit(svc, "bank_0", _params(2), ctx)
    assert svc.registry.verify()["ok"]

    lines = svc.registry.path.read_text(encoding="utf-8").splitlines()
    first = json.loads(lines[0])
    first["content_hash"] = "f" * 64  # try to swap in a different "trusted" hash
    lines[0] = json.dumps(first, sort_keys=True)
    svc.registry.path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    result = svc.registry.verify()
    assert not result["ok"] and result["failed_at_seq"] == 0
