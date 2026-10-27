"""Deterministic decision engine for artifact submissions and verifications.

The point of this module is to keep separate questions separate. A single
"hash valid" boolean conflates at least seven things, and the dangerous
conflation is the last one: an authenticated, authorised bank can still
submit a poisoned update. Hashes and signatures say who sent what; only the
defense says anything about whether the model behaves.

    1. identity    - is the presented key enrolled in the trusted registry?
    2. signature   - does the signature verify under that key?
    3. authorised  - may that member submit this artifact type, for itself?
    4. schema      - does the payload parse, and match the global model's
                     architecture (names, shapes, dtypes)?
    5. integrity   - against the previous version of this artifact: same hash
                     (a duplicate, not a new version) or different (new)?
    6. defense     - does the update pass the model-behaviour check?
    7. decision    - accepted / rejected / quarantined / pending_review.

Every function here is a pure function of its arguments - no I/O, no clock,
no randomness - so the same evidence always produces the same outcome. No
LLM is involved anywhere in this path.

A different hash is NOT tampering. A legitimate new version has a new hash by
construction. Tampering is only meaningful as "this artifact claims to be
version N but does not match version N's trusted hash" - which is
``verify_against_record``, a different question from ``decide_submission``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from fedguard.defenses.reputation import delta_divergence

__all__ = [
    "OUTCOMES",
    "Check",
    "Decision",
    "DefenseEvidence",
    "decide_submission",
    "screen_update",
    "verify_against_record",
]

AUTHORIZED_NEW_VERSION = "AUTHORIZED_NEW_VERSION"
INTEGRITY_VERIFIED = "INTEGRITY_VERIFIED"
INTEGRITY_FAILURE = "INTEGRITY_FAILURE"
UNAUTHORIZED_SUBMISSION = "UNAUTHORIZED_SUBMISSION"
SIGNATURE_INVALID = "SIGNATURE_INVALID"
VALIDATION_FAILED = "VALIDATION_FAILED"
SUSPICIOUS_UPDATE = "SUSPICIOUS_UPDATE"
PENDING_REVIEW = "PENDING_REVIEW"

OUTCOMES = (
    AUTHORIZED_NEW_VERSION,
    INTEGRITY_VERIFIED,
    INTEGRITY_FAILURE,
    UNAUTHORIZED_SUBMISSION,
    SIGNATURE_INVALID,
    VALIDATION_FAILED,
    SUSPICIOUS_UPDATE,
    PENDING_REVIEW,
)

# Divergence is (1 - cos) / 2. Above 0.5 the update's delta points AWAY from
# the peer consensus (cos < 0). That is a screening threshold for updates that
# arrive outside an aggregation round - not the defense's own round decision,
# which stays with defenses/ and is recorded as-is for harness updates.
SCREEN_DIVERGENCE_LIMIT = 0.5
SCREEN_MIN_PEERS = 2


@dataclass(frozen=True)
class Check:
    name: str
    status: str  # "pass" | "fail" | "skipped" | "not_applicable"
    detail: str

    def to_dict(self) -> dict:
        return {"name": self.name, "status": self.status, "detail": self.detail}


@dataclass(frozen=True)
class DefenseEvidence:
    """What the model-behaviour check concluded, and from where.

    ``source`` is ``"aggregation_round"`` when the configured defense actually
    ruled on this update inside a training round, or ``"screening"`` for the
    out-of-round peer-divergence screen. ``verdict`` is pass | fail |
    insufficient | not_applicable."""

    source: str
    verdict: str
    detail: str
    metrics: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class Decision:
    outcome: str
    approval_status: str  # accepted | rejected | quarantined | pending_review | n/a
    checks: tuple[Check, ...]
    reasons: tuple[str, ...]
    registers_version: bool

    def to_dict(self) -> dict:
        return {
            "outcome": self.outcome,
            "approval_status": self.approval_status,
            "registers_version": self.registers_version,
            "checks": [c.to_dict() for c in self.checks],
            "reasons": list(self.reasons),
        }


def screen_update(
    candidate: list[np.ndarray], base: list[np.ndarray], peers: list[list[np.ndarray]]
) -> DefenseEvidence:
    """Out-of-round screen: the reputation defense's own divergence statistic,
    computed on DELTAS from the round's base model against the coordinate-wise
    median of the peers' deltas from that same base. Fewer than
    SCREEN_MIN_PEERS peers is too little evidence to call either way."""
    if len(peers) < SCREEN_MIN_PEERS:
        return DefenseEvidence(
            source="screening",
            verdict="insufficient",
            detail=(
                f"{len(peers)} peer update(s) from the same base model; at least "
                f"{SCREEN_MIN_PEERS} are needed to compare against a consensus"
            ),
        )
    base_flat = np.concatenate([np.asarray(p, dtype=float).ravel() for p in base])
    flat = np.concatenate([np.asarray(p, dtype=float).ravel() for p in candidate]) - base_flat
    peer_deltas = np.stack(
        [np.concatenate([np.asarray(p, dtype=float).ravel() for p in u]) - base_flat for u in peers]
    )
    median = np.median(peer_deltas, axis=0)
    div = delta_divergence(flat, median)
    norm_ratio = float(np.linalg.norm(flat) / (np.linalg.norm(median) + 1e-12))
    metrics = {"divergence": round(div, 6), "norm_ratio_to_median": round(norm_ratio, 6)}
    if div > SCREEN_DIVERGENCE_LIMIT:
        return DefenseEvidence(
            source="screening",
            verdict="fail",
            detail=(
                f"update direction diverges from the {len(peers)}-peer consensus "
                f"(divergence {div:.3f} > {SCREEN_DIVERGENCE_LIMIT})"
            ),
            metrics=metrics,
        )
    return DefenseEvidence(
        source="screening",
        verdict="pass",
        detail=(
            f"aligned with the {len(peers)}-peer consensus "
            f"(divergence {div:.3f} <= {SCREEN_DIVERGENCE_LIMIT})"
        ),
        metrics=metrics,
    )


def decide_submission(
    *,
    claimed_member: str,
    artifact_type: str,
    key_enrolled: bool,
    key_owner: str | None,
    key_permissions: frozenset[str] | set[str],
    signature_valid: bool | None,
    schema_failures: list[str],
    previous_hash: str | None,
    previous_version: int | None,
    content_hash: str,
    defense: DefenseEvidence,
    claimed_hash: str | None = None,
    claimed_version: int | None = None,
) -> Decision:
    """Run the seven questions in order. The first hard failure decides the
    outcome, but every question is still reported, so the UI can show which
    checks were reached and why the rest were skipped.

    ``claimed_hash`` is set when the submission says it IS an existing recorded
    version (``claimed_version``). Integrity is then that version's trusted
    hash against this content - never a new version, whatever the outcome."""
    checks: list[Check] = []
    reasons: list[str] = []

    def done(outcome: str, approval: str, registers: bool) -> Decision:
        return Decision(outcome, approval, tuple(checks), tuple(reasons), registers)

    # 1. identity
    if not key_enrolled:
        checks.append(Check("identity", "fail", "presented key is not in the trusted key registry"))
        for name in ("signature", "authorization", "schema", "integrity", "defense"):
            checks.append(Check(name, "skipped", "identity not established"))
        reasons.append("submitter could not be identified")
        return done(UNAUTHORIZED_SUBMISSION, "rejected", False)
    checks.append(Check("identity", "pass", f"key enrolled to {key_owner!r}"))

    # 2. signature
    if not signature_valid:
        checks.append(
            Check("signature", "fail", "Ed25519 signature does not verify for this content")
        )
        for name in ("authorization", "schema", "integrity", "defense"):
            checks.append(Check(name, "skipped", "signature invalid"))
        reasons.append("signature over (member, type, round, content hash) is invalid")
        return done(SIGNATURE_INVALID, "rejected", False)
    checks.append(Check("signature", "pass", "Ed25519 signature verified with the enrolled key"))

    # 3. authorisation
    if key_owner != claimed_member:
        checks.append(
            Check(
                "authorization",
                "fail",
                f"key belongs to {key_owner!r} but the submission claims {claimed_member!r}",
            )
        )
        for name in ("schema", "integrity", "defense"):
            checks.append(Check(name, "skipped", "not authorized"))
        reasons.append("a member may only submit artifacts for itself")
        return done(UNAUTHORIZED_SUBMISSION, "rejected", False)
    if artifact_type not in key_permissions:
        checks.append(
            Check(
                "authorization",
                "fail",
                f"{key_owner!r} is not permitted to submit {artifact_type!r}",
            )
        )
        for name in ("schema", "integrity", "defense"):
            checks.append(Check(name, "skipped", "not authorized"))
        reasons.append(f"role does not permit {artifact_type!r}")
        return done(UNAUTHORIZED_SUBMISSION, "rejected", False)
    checks.append(Check("authorization", "pass", f"{key_owner!r} may submit {artifact_type!r}"))

    # 4. schema / architecture
    if schema_failures:
        checks.append(Check("schema", "fail", "; ".join(schema_failures)))
        for name in ("integrity", "defense"):
            checks.append(Check(name, "skipped", "schema invalid"))
        reasons.extend(schema_failures)
        return done(VALIDATION_FAILED, "rejected", False)
    checks.append(Check("schema", "pass", "format and architecture match"))

    # 5. integrity: against the claimed version, else relative to the previous one
    if claimed_hash is not None:
        claim = verify_against_record(
            trusted_hash=claimed_hash, candidate_hash=content_hash, version=claimed_version or 0
        )
        checks.extend(claim.checks)
        checks.append(Check("defense", "skipped", "presented as an existing version"))
        reasons.extend(claim.reasons)
        if claim.outcome == INTEGRITY_VERIFIED:
            reasons.append(f"content matches recorded version {claimed_version} exactly")
            return done(INTEGRITY_VERIFIED, "n/a", False)
        return done(claim.outcome, "rejected", False)
    if previous_hash is not None and previous_hash == content_hash:
        checks.append(
            Check(
                "integrity",
                "pass",
                f"identical to version {previous_version} - no new version registered",
            )
        )
        checks.append(Check("defense", "skipped", "duplicate of an existing version"))
        reasons.append("content matches the latest recorded version exactly")
        return done(INTEGRITY_VERIFIED, "n/a", False)
    checks.append(
        Check(
            "integrity",
            "pass",
            "first version of this artifact"
            if previous_hash is None
            else f"differs from version {previous_version}: a NEW version, not tampering",
        )
    )

    # 6. model behaviour
    if defense.verdict == "not_applicable":
        checks.append(Check("defense", "not_applicable", defense.detail))
    elif defense.verdict == "fail":
        checks.append(Check("defense", "fail", defense.detail))
        reasons.append("authorized and intact, but the model-behaviour check flagged it")
        return done(SUSPICIOUS_UPDATE, "quarantined", True)
    elif defense.verdict == "insufficient":
        checks.append(Check("defense", "skipped", defense.detail))
        reasons.append("not enough evidence to accept or reject the update's behaviour")
        return done(PENDING_REVIEW, "pending_review", True)
    else:
        checks.append(Check("defense", "pass", defense.detail))

    return done(AUTHORIZED_NEW_VERSION, "accepted", True)


def verify_against_record(*, trusted_hash: str, candidate_hash: str, version: int) -> Decision:
    """Integrity of one artifact against ONE specific recorded version. Full
    64-char comparison; display truncation never reaches here."""
    if len(trusted_hash) != 64 or len(candidate_hash) != 64:
        check = Check("integrity", "fail", "hashes must be full 64-character SHA-256 digests")
        return Decision(VALIDATION_FAILED, "n/a", (check,), ("malformed hash",), False)
    if trusted_hash.lower() == candidate_hash.lower():
        check = Check("integrity", "pass", f"matches the trusted hash of version {version}")
        return Decision(INTEGRITY_VERIFIED, "n/a", (check,), (), False)
    check = Check("integrity", "fail", f"does not match the trusted hash of version {version}")
    return Decision(
        INTEGRITY_FAILURE,
        "n/a",
        (check,),
        (
            f"content differs from trusted version {version}. If this is a legitimate "
            "retrain it must be submitted as a new signed version, not substituted",
        ),
        False,
    )
