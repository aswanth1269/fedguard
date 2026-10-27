"""Submission, registration and verification workflows over the registry.

Framework-free: api/main.py maps these onto routes, tests drive them
directly. Every accept/reject goes through ``validation.decide_submission``;
nothing here decides anything on its own.
"""

from __future__ import annotations

import base64
import io
import re
from dataclasses import dataclass

import numpy as np
import pandas as pd

from fedguard.artifacts import validation as v
from fedguard.artifacts.hashing import (
    FILE_HASH_SCHEME,
    PARAMS_HASH_SCHEME,
    ArtifactFormatError,
    describe_params,
    hash_bytes,
    hash_named_params,
    load_params_npz,
    serialize_params_npz,
)
from fedguard.artifacts.registry import ArtifactRegistry
from fedguard.artifacts.signing import ROLE_PERMISSIONS, KeyRing, submission_message
from fedguard.coordinator.validator import validate_update
from fedguard.data.synthetic import FEATURE_COLUMNS
from fedguard.ledger.chain import hash_model_params
from fedguard.types import ClientUpdate, Params

__all__ = [
    "ARTIFACT_TYPES",
    "COORDINATOR_ID",
    "IntegrityService",
    "ModelContext",
    "display_name_for",
]

ARTIFACT_TYPES = ("model_update", "global_model", "dataset")
COORDINATOR_ID = "coordinator"
DATASET_COLUMNS = (*FEATURE_COLUMNS, "is_fraud")
MAX_DATASET_BYTES = 10 * 1024 * 1024
MIN_DATASET_ROWS = 10

_BANK_N = re.compile(r"^bank_(\d+)$")


def display_name_for(member_id: str) -> str:
    """bank_0 -> "Bank A". A presentation alias only - the id is what every
    record, signature and decision refers to."""
    m = _BANK_N.match(member_id)
    if m and int(m.group(1)) < 26:
        return f"Bank {chr(65 + int(m.group(1)))}"
    if member_id == COORDINATOR_ID:
        return "Coordinator"
    return member_id.replace("_", " ").title()


def artifact_id(owner: str, artifact_type: str) -> str:
    return f"{owner}/{artifact_type}"


@dataclass
class ModelContext:
    """The current global model, as everything else is validated against it."""

    job_id: str
    config_hash: str
    model_name: str
    defense_name: str
    round_num: int
    param_names: list[str]
    global_params: Params
    base_params: Params

    @property
    def base_hash(self) -> str:
        return hash_named_params(self.param_names, self.base_params)


def _arch_failures(names: list[str], params: Params, ctx: ModelContext) -> list[str]:
    expected = describe_params(ctx.param_names, ctx.global_params)
    try:
        got = describe_params(names, params)
    except ArtifactFormatError as exc:
        return [str(exc)]
    if len(got) != len(expected):
        return [f"expected {len(expected)} tensors ({ctx.model_name}), got {len(got)}"]
    failures = []
    for g, e in zip(got, expected, strict=True):
        if g["name"] != e["name"]:
            failures.append(f"tensor {e['name']!r}: got name {g['name']!r}")
        elif g["shape"] != e["shape"]:
            failures.append(f"tensor {e['name']!r}: expected shape {e['shape']}, got {g['shape']}")
        elif not g["dtype"].startswith("f"):
            # Names and shapes must match exactly. Precision may differ: the
            # MLP emits float32 while defenses aggregate in float64, and
            # set_params casts either. An integer or complex tensor cannot be.
            failures.append(f"tensor {e['name']!r}: expected a float dtype, got {g['dtype']}")
    return failures


def _dataset_summary(data: bytes) -> tuple[dict, list[str]]:
    if len(data) > MAX_DATASET_BYTES:
        return {}, [f"file is {len(data)} bytes; limit is {MAX_DATASET_BYTES}"]
    try:
        df = pd.read_csv(io.BytesIO(data))
    except Exception as exc:
        return {}, [f"not a readable CSV ({type(exc).__name__})"]
    cols = list(df.columns)
    missing = [c for c in DATASET_COLUMNS if c not in cols]
    extra = [c for c in cols if c not in DATASET_COLUMNS]
    failures = []
    if missing:
        failures.append(f"missing column(s): {missing}")
    if extra:
        failures.append(f"unexpected column(s): {extra}")
    if failures:
        return {}, failures
    if len(df) < MIN_DATASET_ROWS:
        failures.append(f"{len(df)} rows; at least {MIN_DATASET_ROWS} required")
    non_numeric = [c for c in DATASET_COLUMNS if not pd.api.types.is_numeric_dtype(df[c])]
    if non_numeric:
        failures.append(f"non-numeric column(s): {non_numeric}")
    elif df[list(DATASET_COLUMNS)].isna().any().any():
        failures.append("contains missing values")
    elif not df["is_fraud"].isin([0, 1]).all():
        failures.append("is_fraud must be 0 or 1")
    if failures:
        return {}, failures
    return {
        "rows": int(len(df)),
        "columns": cols,
        "fraud_rate": round(float(df["is_fraud"].mean()), 6),
    }, []


class IntegrityService:
    def __init__(self, registry: ArtifactRegistry, keyring: KeyRing) -> None:
        self.registry = registry
        self.keyring = keyring

    # -- hashing -----------------------------------------------------------
    @staticmethod
    def content_hash(artifact_type: str, data: bytes) -> tuple[str, str]:
        """(hash, scheme) of what a member signs. Model artifacts hash their
        parameters; anything unparseable falls back to the raw bytes, so a
        corrupt upload still has a stable identity in the rejection log."""
        if artifact_type in ("model_update", "global_model"):
            try:
                names, params = load_params_npz(data)
                return hash_named_params(names, params), PARAMS_HASH_SCHEME
            except ArtifactFormatError:
                pass
        return hash_bytes(data), FILE_HASH_SCHEME

    def sign_as(
        self,
        member_id: str,
        artifact_type: str,
        round_num: int | None,
        data: bytes,
        *,
        claimed_member: str | None = None,
    ) -> tuple[str, str]:
        """Simulated custody only: (key_id, signature_b64). ``claimed_member``
        lets one member sign a submission that claims to be another - a
        genuine signature over a false claim, which authorisation must catch."""
        key = self.keyring.get(member_id)
        if key is None:
            raise KeyError(member_id)
        h, scheme = self.content_hash(artifact_type, data)
        msg = submission_message(
            member_id=claimed_member or member_id,
            artifact_type=artifact_type,
            round_num=round_num,
            content_hash=h,
            hash_scheme=scheme,
        )
        return key.key_id, self.keyring.sign(member_id, msg)

    # -- the one submission pipeline ---------------------------------------
    def submit(
        self,
        *,
        member_id: str,
        artifact_type: str,
        round_num: int | None,
        data: bytes,
        key_id: str,
        signature_b64: str,
        channel: str,
        ctx: ModelContext | None,
        defense_override: v.DefenseEvidence | None = None,
        metadata: dict | None = None,
        ledger_ref: dict | None = None,
        claims_version_seq: int | None = None,
    ) -> tuple[v.Decision, dict]:
        if artifact_type not in ARTIFACT_TYPES:
            raise ValueError(f"unknown artifact type {artifact_type!r}")
        content_hash, scheme = self.content_hash(artifact_type, data)

        # A submission presented as a copy of an existing recorded version is
        # checked against THAT version's trusted hash, not taken as a new one.
        claimed = None
        if claims_version_seq is not None:
            claimed = self.registry.get(claims_version_seq)
            if (
                claimed is None
                or claimed["kind"] != "version"
                or claimed["artifact_id"] != artifact_id(member_id, artifact_type)
            ):
                raise ValueError(
                    f"record {claims_version_seq} is not a recorded version of "
                    f"{artifact_id(member_id, artifact_type)}"
                )

        key = self.keyring.by_key_id(key_id)
        sig_ok: bool | None = None
        if key is not None:
            msg = submission_message(
                member_id=member_id,
                artifact_type=artifact_type,
                round_num=round_num,
                content_hash=content_hash,
                hash_scheme=scheme,
            )
            sig_ok = self.keyring.verify(key, msg, signature_b64)

        meta = dict(metadata or {})
        schema: dict = {}
        schema_failures: list[str] = []
        params: Params | None = None
        ext = "bin"

        if artifact_type in ("model_update", "global_model"):
            ext = "npz"
            if scheme != PARAMS_HASH_SCHEME:
                schema_failures.append("payload is not a readable fedguard .npz parameter file")
            elif ctx is None:
                schema_failures.append(
                    "no global model is loaded to validate the architecture against"
                )
            else:
                names, params = load_params_npz(data)
                schema = {"tensors": describe_params(names, params)}
                schema_failures += _arch_failures(names, params, ctx)
                if artifact_type == "model_update":
                    if round_num != ctx.round_num:
                        schema_failures.append(
                            f"round {round_num} is not the current round {ctx.round_num}"
                        )
                    if not schema_failures:
                        structural = validate_update(
                            ClientUpdate(
                                member_id,
                                params,
                                max(1, int(meta.get("n_samples", 1))),
                                round_num or 0,
                            ),
                            ctx.base_params,
                        )
                        schema_failures += structural.failures
                    meta.setdefault("base_model_hash", ctx.base_hash)
                meta.setdefault("job_id", ctx.job_id)
                meta.setdefault("config_hash", ctx.config_hash)
                meta.setdefault("model_name", ctx.model_name)
        else:  # dataset
            ext = "csv"
            summary, schema_failures = _dataset_summary(data)
            schema = {"columns": list(DATASET_COLUMNS)} if summary else {}
            meta.update(summary)
            meta["used_for_training"] = False

        aid = artifact_id(member_id, artifact_type)
        previous = self.registry.latest_version(aid)

        if defense_override is not None:
            defense = defense_override
        elif artifact_type == "dataset":
            defense = v.DefenseEvidence(
                "not_applicable",
                "not_applicable",
                "datasets are registered for provenance only and are not trained on",
            )
        elif artifact_type == "global_model":
            defense = v.DefenseEvidence(
                "not_applicable",
                "not_applicable",
                "aggregation output; its quality is the round's evaluation metrics",
            )
        elif params is not None and ctx is not None and not schema_failures:
            peers = self._peer_updates(member_id, meta.get("base_model_hash"))
            defense = v.screen_update(params, ctx.base_params, peers)
        else:
            defense = v.DefenseEvidence("screening", "insufficient", "not evaluated")

        decision = v.decide_submission(
            claimed_member=member_id,
            artifact_type=artifact_type,
            key_enrolled=key is not None,
            key_owner=key.member_id if key else None,
            key_permissions=ROLE_PERMISSIONS.get(key.role, frozenset()) if key else frozenset(),
            signature_valid=sig_ok,
            schema_failures=schema_failures,
            previous_hash=previous["content_hash"] if previous else None,
            previous_version=previous["version"] if previous else None,
            content_hash=content_hash,
            defense=defense,
            claimed_hash=claimed["content_hash"] if claimed else None,
            claimed_version=claimed["version"] if claimed else None,
        )

        signature = {
            "scheme": "ed25519",
            "key_id": key_id or None,
            "status": "unknown_key" if key is None else ("verified" if sig_ok else "invalid"),
            "custody": key.custody if key else None,
            "signature_b64": signature_b64 or None,
        }
        base = {
            "artifact_id": aid,
            "artifact_type": artifact_type,
            "owner": member_id,
            "round": round_num,
            "content_hash": content_hash,
            "hash_scheme": scheme,
            "schema": schema,
            "metadata": meta,
            "submitted_by": key.member_id if key else None,
            "channel": channel,
            "signature": signature,
            "decision": decision.to_dict(),
            "approval_status": decision.approval_status,
            "defense_evidence": {
                "source": defense.source,
                "verdict": defense.verdict,
                "detail": defense.detail,
                "metrics": defense.metrics,
            },
            "ledger_ref": ledger_ref,
            "chain_anchor": None,
        }
        if claimed is not None:
            base["claimed_seq"] = claimed["seq"]
            base["claimed_version"] = claimed["version"]
            base["trusted_hash"] = claimed["content_hash"]
            if decision.outcome == v.INTEGRITY_VERIFIED:
                return decision, claimed

        if decision.registers_version:
            base["storage_key"] = self.registry.put_content(content_hash, data, ext)
            return decision, self.registry.append({**base, "kind": "version"})
        if decision.outcome == v.INTEGRITY_VERIFIED and previous is not None:
            # A byte-identical resubmission: nothing new to record as a version.
            return decision, previous
        return decision, self.registry.append({**base, "kind": "rejected_submission"})

    def _peer_updates(self, member_id: str, base_hash: str | None) -> list[Params]:
        peers = []
        for rec in self.registry.versions():
            if rec["artifact_type"] != "model_update" or rec["owner"] == member_id:
                continue
            if rec["metadata"].get("base_model_hash") != base_hash:
                continue
            latest = self.registry.latest_version(rec["artifact_id"], accepted_only=True)
            if latest is None or latest["seq"] != rec["seq"]:
                continue
            _, params = load_params_npz(self.registry.get_content(rec["storage_key"]))
            peers.append(params)
        return peers

    # -- coordinator registration of an in-process training run -----------
    def register_run(
        self,
        *,
        ctx: ModelContext,
        updates: list[ClientUpdate],
        decision: dict | None,
        verdict: dict | None,
        ledger_entry: dict | None,
    ) -> list[dict]:
        """Register the last round's per-bank updates and the resulting global
        model. The banks here are simulated by this process, so they are
        signed with simulated server-side keys (``channel`` says so), and the
        defense verdict recorded is the configured defense's ACTUAL decision in
        that round - not a re-screen."""
        out = []
        self.keyring.ensure_simulated(
            COORDINATOR_ID, display_name="Coordinator", role="coordinator"
        )
        accepted = set((decision or {}).get("accepted", []))
        rejected = set((decision or {}).get("rejected", []))
        flagged = set((verdict or {}).get("flagged", []))
        weights = (decision or {}).get("weights", {})
        reputation = (decision or {}).get("reputation", {})

        for u in sorted(updates, key=lambda x: x.client_id):
            self.keyring.ensure_simulated(u.client_id, display_name=display_name_for(u.client_id))
            data = serialize_params_npz(ctx.param_names, u.params)
            key_id, sig = self.sign_as(u.client_id, "model_update", u.round_num, data)
            if u.client_id in rejected:
                ev = v.DefenseEvidence(
                    "aggregation_round",
                    "fail",
                    f"rejected by the {ctx.defense_name} defense in round {u.round_num}",
                )
            elif u.client_id in flagged:
                ev = v.DefenseEvidence(
                    "aggregation_round",
                    "fail",
                    f"aggregated by {ctx.defense_name} but flagged by the coordinator agent "
                    f"in round {u.round_num}",
                )
            elif u.client_id in accepted:
                ev = v.DefenseEvidence(
                    "aggregation_round",
                    "pass",
                    f"accepted by the {ctx.defense_name} defense in round {u.round_num} "
                    f"(aggregation weight {weights.get(u.client_id, 0.0):.4f})",
                )
            else:
                ev = v.DefenseEvidence(
                    "aggregation_round",
                    "insufficient",
                    "failed structural validation before aggregation",
                )
            meta = {
                "n_samples_claimed": u.n_samples,
                "aggregation_weight": weights.get(u.client_id),
            }
            if u.client_id in reputation:
                meta["reputation"] = reputation[u.client_id]
            _, rec = self.submit(
                member_id=u.client_id,
                artifact_type="model_update",
                round_num=u.round_num,
                data=data,
                key_id=key_id,
                signature_b64=sig,
                channel="in_process_simulation",
                ctx=ctx,
                defense_override=ev,
                metadata=meta,
            )
            out.append(rec)

        data = serialize_params_npz(ctx.param_names, ctx.global_params)
        key_id, sig = self.sign_as(COORDINATOR_ID, "global_model", ctx.round_num, data)
        meta = {
            "defense": ctx.defense_name,
            "accepted_clients": sorted(accepted),
            "rejected_clients": sorted(rejected),
            "agent_flagged": sorted(flagged),
        }
        ledger_ref = None
        if ledger_entry is not None:
            ledger_ref = {
                "ledger_index": ledger_entry["index"],
                "entry_hash": ledger_entry["entry_hash"],
                "legacy_model_hash": ledger_entry["model_hash"],
                # The round ledger hashes raw bytes only (ledger/chain.py);
                # confirming the two agree ties this artifact to that entry.
                "legacy_hash_matches": hash_model_params(ctx.global_params)
                == ledger_entry["model_hash"],
            }
        _, rec = self.submit(
            member_id=COORDINATOR_ID,
            artifact_type="global_model",
            round_num=ctx.round_num,
            data=data,
            key_id=key_id,
            signature_b64=sig,
            channel="in_process_simulation",
            ctx=ctx,
            metadata=meta,
            ledger_ref=ledger_ref,
        )
        out.append(rec)
        return out

    # -- verification ------------------------------------------------------
    def load_record_params(self, rec: dict) -> tuple[list[str], Params]:
        return load_params_npz(self.registry.get_content(rec["storage_key"]))

    def modified_copy(self, rec: dict, *, tensor_index: int = 0, delta: float = 1e-3) -> bytes:
        """A deliberately altered COPY of a stored artifact. The stored file is
        never touched - the copy exists only in memory for the check."""
        if rec["artifact_type"] == "dataset":
            df = pd.read_csv(io.BytesIO(self.registry.get_content(rec["storage_key"])))
            df.loc[0, "amount"] = float(df.loc[0, "amount"]) + 1.0
            return df.to_csv(index=False).encode()
        names, params = self.load_record_params(rec)
        if not 0 <= tensor_index < len(params):
            raise ValueError(f"tensor_index must be in [0, {len(params) - 1}]")
        params = [np.array(p, copy=True) for p in params]
        flat = params[tensor_index].reshape(-1)
        flat[0] = flat[0] + np.asarray(delta, dtype=flat.dtype)
        return serialize_params_npz(names, params)

    def verify(self, rec: dict, candidate: bytes | None, origin: str) -> tuple[v.Decision, dict]:
        if rec.get("kind") != "version":
            raise ValueError("only stored versions can be verified")
        data = candidate if candidate is not None else self.registry.get_content(rec["storage_key"])
        cand_hash, scheme = self.content_hash(rec["artifact_type"], data)
        if scheme != rec["hash_scheme"]:
            decision = v.Decision(
                v.VALIDATION_FAILED,
                "n/a",
                (
                    v.Check(
                        "integrity", "fail", f"candidate is not a {rec['hash_scheme']} artifact"
                    ),
                ),
                ("format mismatch",),
                False,
            )
        else:
            decision = v.verify_against_record(
                trusted_hash=rec["content_hash"], candidate_hash=cand_hash, version=rec["version"]
            )
        log = self.registry.append(
            {
                "kind": "verification",
                "artifact_id": rec["artifact_id"],
                "artifact_type": rec["artifact_type"],
                "owner": rec["owner"],
                "round": rec["round"],
                "verified_seq": rec["seq"],
                "verified_version": rec["version"],
                "trusted_hash": rec["content_hash"],
                "content_hash": cand_hash,
                "candidate_origin": origin,
                "decision": decision.to_dict(),
            }
        )
        return decision, log

    @staticmethod
    def b64(data: bytes) -> str:
        return base64.b64encode(data).decode()
