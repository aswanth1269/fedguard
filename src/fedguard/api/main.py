"""FastAPI surface over the coordinator-wired harness.

Every route delegates to jobs.py/predict.py or reads straight off a Job's
already-computed ``RunResult`` - nothing here recomputes a metric or a
verdict, matching the same "the API is a view, not a second source of truth"
discipline the web dashboard follows over runs.jsonl.

Federated endpoints (`/training-round`, `/participants`) are read-only views
over a batch job's history, not live per-round control. fedguard's harness
runs all N rounds of a job in one `run_experiment` call by design (see
experiment.py's module docstring - "a plain loop rather than Flower"), so
there is no `/start-round` here: it would either duplicate `/train` or
require restructuring the simulation core into something externally
steppable, which is its own, separately-scoped task.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from fedguard.api.explain import ExplanationUnavailable, explain
from fedguard.api.feed import DuplicateTransaction, TransactionFeed
from fedguard.api.jobs import Job, JobStatus, JobStore
from fedguard.api.predict import PredictionError, PredictionService
from fedguard.api.schemas import (
    ActiveJob,
    ApproveModelRequest,
    CurrentModelStatusResponse,
    DemoSignerModelUpdateRequest,
    DemoSignerUploadRequest,
    DemoTransactionsRequest,
    ExplainResponse,
    FeatureContribution,
    ModelProvenance,
    PredictRequest,
    PredictResponse,
    SubmissionResponse,
    SubmitArtifactRequest,
    TrainAccepted,
    TransactionIn,
    VerifyArtifactRequest,
    VerifyArtifactResponse,
    VerifyHashRequest,
    VerifyHashResponse,
)
from fedguard.artifacts import ArtifactRegistry, IntegrityService, KeyRing, ModelContext
from fedguard.artifacts.hashing import ArtifactFormatError, hash_named_params
from fedguard.artifacts.service import COORDINATOR_ID, display_name_for
from fedguard.artifacts.signing import KeyRingError
from fedguard.config import ExperimentConfig, load_config
from fedguard.coordinator.blockchain_client import get_blockchain_client
from fedguard.data import synthetic
from fedguard.ledger.chain import _canonical_bytes

__all__ = ["app"]

app = FastAPI(
    title="FedGuard API",
    description=(
        "Coordinator-reviewed federated fraud detection: training, prediction "
        "and audit endpoints over the batch simulation harness."
    ),
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
# Without this, no browser can call this API at all. A fetch from the dashboard
# gets a 200 in the server log and a blocked response in the browser, so the
# failure looks like the API is down while the access log insists it is fine.
# It went unnoticed because until the dashboard's audit view there was no
# browser-based caller - tests use TestClient, which never enforces CORS.
#
# An allowlist, not "*": these endpoints are read-only but not public, and
# /train starts real work. FEDGUARD_CORS_ORIGINS overrides for a deployed
# dashboard, comma-separated. Credentials stay off, so a stray origin cannot
# ride along on a browser session.
_DEFAULT_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
_origins = [
    o.strip()
    for o in os.environ.get("FEDGUARD_CORS_ORIGINS", _DEFAULT_ORIGINS).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

_store = JobStore()

# Same default `fedguard run` uses (src/fedguard/cli.py) - an API-triggered
# run lands in exactly the same durable log a CLI-triggered one does.
RESULTS_PATH = Path("results/runs.jsonl")

# Same default coordinator/blockchain_client.py uses - the ledger routes
# below read the exact file experiment.py's ANCHORING step writes to.
LEDGER_PATH = Path("results/ledger.jsonl")

# Artifact version history (fedguard/artifacts/registry.py) and its
# content-addressed store. Both gitignored, both local to this machine.
ARTIFACT_REGISTRY_PATH = Path("results/artifact_registry.jsonl")
ARTIFACT_STORE_DIR = Path("artifacts/store")

# Trusted public keys plus the SIMULATED banks' private keys. Gitignored;
# no route ever returns or writes a private key. See artifacts/signing.py.
KEYS_DIR = Path("keys")

# The demo model's config lives in a file, not in code, so the exact run the
# dashboard triggers can be reproduced with `fedguard run -c` and its hash
# traced back. src/fedguard/api/main.py -> repo root is parents[3].
DEMO_CONFIG_PATH = Path(__file__).resolve().parents[3] / "configs" / "demo_mlp.yaml"

_feed = TransactionFeed()

MODEL_FAMILIES = {
    "mlp": "PyTorch MLP (federated model)",
    "reference": "NumPy logistic regression (harness reference model)",
}


def _demo_signer_enabled() -> bool:
    return os.environ.get("FEDGUARD_DEMO_SIGNER", "1") != "0"


def _service() -> IntegrityService:
    return IntegrityService(
        ArtifactRegistry(ARTIFACT_REGISTRY_PATH, ARTIFACT_STORE_DIR), KeyRing(KEYS_DIR)
    )


def _model_context(job: Job) -> ModelContext | None:
    r = job.result
    if r is None or not r.rounds or r.final_params is None or r.param_names is None:
        return None
    return ModelContext(
        job_id=job.id,
        config_hash=job.config.hash(),
        model_name=job.config.model.name,
        defense_name=job.config.defense.name,
        round_num=r.rounds[-1]["round"],
        param_names=r.param_names,
        global_params=r.final_params,
        base_params=r.final_round_base_params or r.final_params,
    )


def _global_model_record(job: Job) -> dict | None:
    """The registry version holding exactly this job's final parameters,
    found by content hash - so a deterministic re-run that produced identical
    weights resolves to the version already on record."""
    ctx = _model_context(job)
    if ctx is None:
        return None
    digest = hash_named_params(ctx.param_names, ctx.global_params)
    matches = [
        rec
        for rec in _service().registry.versions(f"{COORDINATOR_ID}/global_model")
        if rec["content_hash"] == digest
    ]
    return matches[-1] if matches else None


def _provenance(job: Job) -> ModelProvenance:
    rec = _global_model_record(job)
    return ModelProvenance(
        job_id=job.id,
        model_name=job.config.model.name,
        model_family=MODEL_FAMILIES.get(job.config.model.name, job.config.model.name),
        config_name=job.config.name,
        config_hash=job.config.hash(),
        rounds=len(job.result.rounds) if job.result else 0,
        defense=job.config.defense.name,
        data_source=job.config.data.source,
        global_model_version=rec["version"] if rec else None,
        global_model_hash=rec["content_hash"] if rec else None,
    )


def _register_job_artifacts(job: Job) -> None:
    ctx = _model_context(job)
    if ctx is None or not job.result or not job.result.final_updates:
        return
    last = job.result.rounds[-1]
    ledger_entry = None
    if last.get("ledger"):
        index = last["ledger"]["index"]
        for e in get_blockchain_client(ledger_path=LEDGER_PATH).read_all(job.config.hash()):
            if e.index == index:
                ledger_entry = e.to_dict()
    _service().register_run(
        ctx=ctx,
        updates=job.result.final_updates,
        decision=last.get("decision"),
        verdict=last.get("agent"),
        ledger_entry=ledger_entry,
    )


def _run_job(job_id: str) -> None:
    """Train, then register the run's artifacts before the job is marked
    complete. Registration failing does not un-train the model; it is
    recorded in job.warnings, never swallowed."""

    def register(job: Job) -> None:
        try:
            _register_job_artifacts(job)
        except Exception as exc:
            raise RuntimeError(f"artifact registration failed: {exc}") from exc

    _store.run(job_id, str(RESULTS_PATH), str(LEDGER_PATH), after_training=register)


def _get_job_or_404(job_id: str) -> Job:
    job = _store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"no job {job_id!r}")
    return job


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/train", response_model=TrainAccepted, status_code=status.HTTP_202_ACCEPTED)
def train(cfg: ExperimentConfig, background_tasks: BackgroundTasks) -> TrainAccepted:
    """Starts a full N-round run in the background and returns immediately.

    A run takes minutes, not milliseconds - pairing this with a separate
    GET /model-status only makes sense if this endpoint does not block for
    the run's duration. Poll /model-status/{job_id} for completion; because
    run_experiment is one monolithic call internally, status jumps straight
    from "running" to "complete"/"failed" - there is no partial-round
    progress to report without the same core-loop restructuring the
    Federated endpoints below also avoid.
    """
    job = _store.submit(cfg)
    background_tasks.add_task(_run_job, job.id)
    return TrainAccepted(job_id=job.id, status=job.status.value)


@app.get("/model-status", response_model=CurrentModelStatusResponse)
def current_model_status() -> CurrentModelStatusResponse:
    """Returns the latest completed training job's metadata and expected features,
    or status='no_job' if none has run yet."""
    active = _store.active()
    active_job = (
        ActiveJob(
            job_id=active.id,
            status=active.status.value,
            config_name=active.config.name,
            model_name=active.config.model.name,
            rounds_done=active.rounds_done,
            rounds_total=active.config.rounds,
            submitted_at=active.submitted_at,
        )
        if active
        else None
    )
    latest = _store.latest()
    last_failure = (
        {"job_id": latest.id, "error": latest.error, "config_name": latest.config.name}
        if latest is not None and latest.status is JobStatus.FAILED
        else None
    )

    job = _store.last_completed()
    if job is None or job.result is None:
        return CurrentModelStatusResponse(
            job_id=None,
            status="no_job",
            threshold=0.5,
            input_cols=[],
            active_job=active_job,
            last_failure=last_failure,
        )

    input_cols = job.result.eval_data.input_cols if job.result.eval_data else []
    threshold = job.result.final.get("threshold", 0.5) if job.result.final else 0.5
    last_decision = job.result.rounds[-1].get("decision") if job.result.rounds else None
    last_agent = job.result.rounds[-1].get("agent") if job.result.rounds else None
    participants = (
        {
            "accepted": last_decision["accepted"],
            "rejected": last_decision["rejected"],
            "agent_flagged": (last_agent or {}).get("flagged", []),
        }
        if last_decision
        else None
    )
    return CurrentModelStatusResponse(
        job_id=job.id,
        status=job.status.value,
        threshold=threshold,
        input_cols=input_cols,
        final=job.result.final,
        model=_provenance(job),
        participants=participants,
        completed_at=job.finished_at,
        active_job=active_job,
        last_failure=last_failure,
        warnings=list(job.warnings),
    )


@app.post("/demo/warmup", response_model=TrainAccepted, status_code=status.HTTP_202_ACCEPTED)
def demo_warmup(background_tasks: BackgroundTasks, force: bool = False) -> TrainAccepted:
    """Trains the demo model from configs/demo_mlp.yaml (PyTorch MLP, three
    simulated banks, reputation defense, synthetic data).

    Returns an already queued/running job instead of starting a second one,
    and returns the last completed job unless ``force=true`` asks for a new
    training run."""
    active = _store.active()
    if active is not None:
        return TrainAccepted(job_id=active.id, status=active.status.value)
    existing = _store.last_completed()
    if existing is not None and not force:
        return TrainAccepted(job_id=existing.id, status=existing.status.value)

    try:
        cfg = load_config(DEMO_CONFIG_PATH)
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail="demo config configs/demo_mlp.yaml is missing"
        ) from exc
    job = _store.submit(cfg)
    background_tasks.add_task(_run_job, job.id)
    return TrainAccepted(job_id=job.id, status=job.status.value)


@app.post("/verify-transaction-hash", response_model=VerifyHashResponse)
def verify_transaction_hash(req: VerifyHashRequest) -> VerifyHashResponse:
    """Computes the canonical SHA-256 digest of arbitrary payload using the exact
    canonical serialization (keys sorted, no whitespace) used by the ledger and
    blockchain commitments, and optionally verifies against a baseline reference."""
    raw_bytes = _canonical_bytes(req.payload)
    digest = hashlib.sha256(raw_bytes).hexdigest()
    canonical_str = raw_bytes.decode("utf-8")

    matches = None
    if req.baseline_hash is not None:
        matches = digest.lower() == req.baseline_hash.lower()
        status_text = "VERIFIED" if matches else "HASH MISMATCH"
    else:
        status_text = "DIGEST COMPUTED"

    return VerifyHashResponse(
        canonical_json=canonical_str,
        digest=digest,
        algorithm="SHA-256",
        matches=matches,
        status=status_text,
    )


@app.get("/model-status/{job_id}")
def model_status(job_id: str) -> dict:
    job = _get_job_or_404(job_id)
    payload: dict = {"job_id": job.id, "status": job.status.value}
    if job.status is JobStatus.COMPLETE and job.result is not None:
        payload["final"] = job.result.final
    if job.status is JobStatus.FAILED:
        payload["error"] = job.error
    return payload


@app.get("/training-round/{job_id}")
def training_round(job_id: str) -> dict:
    """That job's `result.rounds` so far - eval metrics, the defense's
    AggregationDecision, the agent's verdict and narrative, per round.
    Empty while the job is still queued/running, not an error."""
    job = _get_job_or_404(job_id)
    rounds = job.result.rounds if job.result is not None else []
    return {"job_id": job.id, "status": job.status.value, "rounds": rounds}


@app.get("/participants/{job_id}")
def participants(job_id: str) -> dict:
    """Client roster rolled up from every round completed so far - not
    fabricated, and not a re-run of the partition step: `accepted`/`rejected`
    on each round's AggregationDecision already names every client that took
    part, per the contract every Defense subclass is required to satisfy."""
    job = _get_job_or_404(job_id)
    malicious = set(job.config.attack.malicious_clients)
    rounds = job.result.rounds if job.result is not None else []

    tally: dict[str, dict[str, int]] = {}

    def _entry(cid: str) -> dict[str, int]:
        return tally.setdefault(
            cid, {"rounds_seen": 0, "accepted": 0, "rejected": 0, "agent_flagged": 0}
        )

    for r in rounds:
        decision = r.get("decision")
        if decision is None:  # a round that failed validation before aggregation
            continue
        flagged = set((r.get("agent") or {}).get("flagged", []))

        for cid in decision["accepted"]:
            e = _entry(cid)
            e["rounds_seen"] += 1
            e["accepted"] += 1
            if cid in flagged:
                e["agent_flagged"] += 1

        for cid in decision["rejected"]:
            e = _entry(cid)
            e["rounds_seen"] += 1
            e["rejected"] += 1
            # agent.flagged is, by design, always disjoint from
            # decision.rejected - coordinator/agent.py excludes clients the
            # defense already rejected from its own flagging, so a client
            # here is never also counted as agent-flagged.

    roster = [
        {"client_id": cid, "malicious": cid in malicious, **counts}
        for cid, counts in sorted(tally.items())
    ]
    return {"job_id": job.id, "status": job.status.value, "participants": roster}


@app.get("/agent-status/{job_id}")
def agent_status(job_id: str) -> dict:
    job = _get_job_or_404(job_id)
    rounds = job.result.rounds if job.result is not None else []
    reviewed = [r for r in rounds if r.get("agent") is not None]
    flagged_rounds = [r for r in reviewed if r["agent"]["flagged"]]
    return {
        "job_id": job.id,
        "status": job.status.value,
        "rounds_reviewed": len(reviewed),
        "rounds_flagged": len(flagged_rounds),
        "latest_verdict": reviewed[-1]["agent"] if reviewed else None,
    }


@app.get("/agent-summary/{job_id}")
def agent_summary(job_id: str) -> dict:
    """A readable rollup, built deterministically from already-recorded
    verdicts - not a second LLM call. The agent's narrative already ran once
    per round inside CoordinatorAgent.review(); this just summarises the
    facts, the same discipline agent.py itself applies to what an LLM is
    trusted to add."""
    job = _get_job_or_404(job_id)
    rounds = job.result.rounds if job.result is not None else []
    reviewed = [r for r in rounds if r.get("agent") is not None]
    flagged_rounds = [r for r in reviewed if r["agent"]["flagged"]]

    if not reviewed:
        summary = "No rounds reviewed yet."
    elif not flagged_rounds:
        summary = f"Reviewed {len(reviewed)} round(s). All approved, nothing flagged."
    else:
        detail = "; ".join(
            f"round {r['round']} flagged {r['agent']['flagged']}" for r in flagged_rounds
        )
        summary = f"Reviewed {len(reviewed)} round(s). {len(flagged_rounds)} flagged: {detail}."

    return {
        "job_id": job.id,
        "status": job.status.value,
        "rounds_reviewed": len(reviewed),
        "rounds_flagged": len(flagged_rounds),
        "summary": summary,
    }


@app.post("/approve-model")
def approve_model(req: ApproveModelRequest) -> dict:
    """Records a human override on one round - "a person reviewed this
    agent flag and confirms it's fine." Every round is already anchored to
    the ledger regardless of the agent's verdict (see experiment.py's
    ANCHORING step - a flagged round is content that belongs on the chain,
    not a reason to skip writing it), so this override does not gate
    anchoring the way it might sound like it should. It also does NOT touch
    the already-anchored ledger entry: mutating anchored content would
    silently break the chain's own tamper-evidence, exactly the property
    the ledger exists to provide. This stays a separate, out-of-band note.

    In-memory only, like the rest of the job store: this mutates the round's
    stored dict in the job store, but that round's lines in
    results/runs.jsonl and results/ledger.jsonl were already written by the
    time a job reaches COMPLETE. A server restart loses this note, same as
    every other in-flight job-store state.
    """
    job = _get_job_or_404(req.job_id)
    if job.result is None:
        raise HTTPException(status_code=404, detail=f"job {req.job_id!r} has no rounds yet")

    for r in job.result.rounds:
        if r["round"] == req.round_num:
            r["human_override"] = {"approved": True, "note": req.note, "at": time.time()}
            return {"job_id": job.id, "round": req.round_num, "human_override": r["human_override"]}

    raise HTTPException(
        status_code=404, detail=f"round {req.round_num} not found for job {req.job_id!r}"
    )


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    """Scores against the last completed job's final model - fedguard has
    no persisted "current production model" to fall back on otherwise."""
    job = _store.last_completed()
    if job is None:
        raise HTTPException(
            status_code=409, detail="no completed training job yet - POST /train first"
        )

    service = PredictionService.from_job(job)
    try:
        result = service.predict(req.features)
    except PredictionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return PredictResponse(
        probability=result.probability,
        label=result.label,
        threshold=result.threshold,
        job_id=job.id,
        model=_provenance(job),
    )


@app.post("/explain", response_model=ExplainResponse)
def explain_prediction(req: PredictRequest) -> ExplainResponse:
    """Why the model scored this input as it did: exact Shapley values over the
    raw inputs (see api/explain.py). Separate from /predict on purpose, so an
    explanation failure can never block or alter a score."""
    job = _store.last_completed()
    if job is None:
        raise HTTPException(
            status_code=409, detail="no completed training job yet - POST /train first"
        )
    service = PredictionService.from_job(job)
    try:
        result = service.predict(req.features)
        exp = explain(service, job.result.eval_data, req.features)
    except PredictionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ExplanationUnavailable as exc:
        raise HTTPException(status_code=422, detail=f"explanation unavailable: {exc}") from exc
    return ExplainResponse(
        probability=result.probability,
        label=result.label,
        threshold=result.threshold,
        job_id=job.id,
        method="exact_shapley_interventional",
        output_scale="probability",
        base_value=exp.base_value,
        background_size=exp.background_size,
        contributions=[
            FeatureContribution(feature=f, value=val, contribution=c)
            for f, val, c in zip(exp.features, exp.values, exp.contributions, strict=True)
        ],
    )


@app.get("/ledger")
def ledger(config_hash: str | None = None) -> dict:
    """The full chain, or one run's slice via `?config_hash=`. No public
    write path exists - see experiment.py's ANCHORING step and
    coordinator/blockchain_client.py's module docstring for why: a public
    POST here would let anyone construct a self-consistent fabricated chain
    that still "verifies," which is worse than no ledger at all."""
    client = get_blockchain_client(ledger_path=LEDGER_PATH)
    entries = client.read_all(config_hash=config_hash)
    return {"count": len(entries), "entries": [e.to_dict() for e in entries]}


@app.get("/ledger/{job_id}")
def ledger_for_job(job_id: str) -> dict:
    job = _get_job_or_404(job_id)
    client = get_blockchain_client(ledger_path=LEDGER_PATH)
    entries = client.read_all(config_hash=job.config.hash())
    return {"job_id": job.id, "count": len(entries), "entries": [e.to_dict() for e in entries]}


@app.get("/verify")
def verify() -> dict:
    """Walks the whole chain and reports exactly which entry failed and why,
    the first time something disagrees - see ledger/chain.py's
    VerificationResult. This is the actual tamper-evidence check; /audit
    below is a readable summary, not a substitute for this."""
    client = get_blockchain_client(ledger_path=LEDGER_PATH)
    result = client.verify()
    return {
        "ok": result.ok,
        "entries_checked": result.entries_checked,
        "failed_at_index": result.failed_at_index,
        "failed_round": result.failed_round,
        "reason": result.reason,
    }


@app.get("/audit/{job_id}")
def audit(job_id: str) -> dict:
    """Human-readable rollup of one job's ledger entries. Not an integrity
    check on its own - the ledger is one shared chain across every job
    submitted to this server, so "verify just this job's slice" is not a
    well-formed operation; GET /verify covers the whole chain."""
    job = _get_job_or_404(job_id)
    client = get_blockchain_client(ledger_path=LEDGER_PATH)
    entries = client.read_all(config_hash=job.config.hash())

    if not entries:
        summary = "No rounds anchored yet."
    else:
        rounds = [e.round_num for e in entries]
        summary = (
            f"{len(entries)} round(s) anchored (rounds {min(rounds)}-{max(rounds)}), "
            f"ledger indices {entries[0].index}-{entries[-1].index}. "
            "Run GET /verify to check the full chain's integrity."
        )

    return {
        "job_id": job.id,
        "status": job.status.value,
        "entries": [e.to_dict() for e in entries],
        "summary": summary,
    }


# ===========================================================================
# Live transaction feed
# ===========================================================================
# Seed for the held-out synthetic pool the demo feed walks through. Differs
# from every training seed in configs/, so demo rows are fresh draws from the
# generator, not rows the model trained on. One block, not tiny batches:
# synthetic.generate computes amount_zscore per call, so generating three rows
# at a time would zero that feature and score off-distribution inputs.
DEMO_POOL_SEED = 7919
DEMO_POOL_ROWS = 3000
_demo_pools: dict[tuple[int, float], list[dict]] = {}


def _require_model() -> Job:
    job = _store.last_completed()
    if job is None or job.result is None:
        raise HTTPException(
            status_code=409,
            detail="no trained global model is loaded - initialize or train one first",
        )
    return job


def _score_event(
    service: PredictionService,
    job: Job,
    provenance: ModelProvenance,
    *,
    transaction_id: str,
    bank_id: str | None,
    event_time: str,
    features: dict[str, float],
    source: str,
    synthetic_label: int | None = None,
) -> dict:
    result = service.predict(features)
    return {
        "transaction_id": transaction_id,
        "bank_id": bank_id,
        "bank_display": display_name_for(bank_id) if bank_id else None,
        "event_time": event_time,
        "received_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "features": features,
        "probability": result.probability,
        "label": result.label,
        "threshold": result.threshold,
        "classification": "alert" if result.label == 1 else "lower_risk",
        "synthetic_label": synthetic_label,
        "explanation": None,
        "model": provenance.model_dump(),
    }


@app.post("/transactions", status_code=status.HTTP_201_CREATED)
def ingest_transaction(req: TransactionIn) -> dict:
    """Scores one transaction with the current global model and appends it to
    the feed. ``transaction_id`` is deduplicated (409 on a repeat)."""
    job = _require_model()
    if _feed.contains(req.transaction_id):
        raise HTTPException(
            status_code=409, detail=f"duplicate transaction_id {req.transaction_id!r}"
        )
    event_time = req.timestamp or datetime.now(timezone.utc).isoformat()
    try:
        datetime.fromisoformat(event_time.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="timestamp must be ISO-8601") from exc
    service = PredictionService.from_job(job)
    try:
        event = _score_event(
            service,
            job,
            _provenance(job),
            transaction_id=req.transaction_id,
            bank_id=req.bank_id,
            event_time=event_time,
            features=req.features,
            source="api",
        )
        return _feed.add(event)
    except PredictionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DuplicateTransaction as exc:
        raise HTTPException(status_code=409, detail=f"duplicate transaction_id {exc}") from exc


@app.get("/transactions")
def list_transactions(after: int = 0, limit: int = 100) -> dict:
    """Events with ``seq > after``, oldest first. Poll with the returned
    ``latest_seq`` as the next ``after`` to receive each event exactly once."""
    events, latest = _feed.after(after, limit=max(1, min(limit, 200)))
    return {"events": events, "latest_seq": latest}


@app.post("/demo/transactions", status_code=status.HTTP_201_CREATED)
def demo_transactions(req: DemoTransactionsRequest) -> dict:
    """SYNTHETIC demonstration traffic. Draws the next rows from a held-out
    synthetic block, scores each with the real model, and labels every event
    ``source: "synthetic_demo"``. This is not a bank feed."""
    job = _require_model()
    feature_cols = list(synthetic.FEATURE_COLUMNS)
    if job.result.eval_data is None or job.result.eval_data.input_cols != feature_cols:
        raise HTTPException(
            status_code=409,
            detail="the synthetic demo feed needs a model trained on the synthetic schema",
        )
    key = (job.config.partition.n_clients, job.config.partition.non_iid)
    if key not in _demo_pools:
        df = synthetic.generate(
            n=DEMO_POOL_ROWS, n_clients=key[0], non_iid=key[1], seed=DEMO_POOL_SEED
        )
        _demo_pools[key] = df.to_dict(orient="records")
    pool = _demo_pools[key]
    # At ~4% prevalence a sequential walk is almost all legitimate rows, so
    # every 3rd demo row is drawn from rows the GENERATOR labelled fraud. This
    # selects inputs only: the model still scores each one at its own
    # threshold, and many generator-fraud rows still come back lower risk.
    fraud_pool = [r for r in pool if int(r["is_fraud"]) == 1] or pool

    service = PredictionService.from_job(job)
    provenance = _provenance(job)
    added = []
    for idx in _feed.take_demo_indices(req.count):
        row = fraud_pool[(idx // 3) % len(fraud_pool)] if idx % 3 == 2 else pool[idx % len(pool)]
        added.append(
            _feed.add(
                _score_event(
                    service,
                    job,
                    provenance,
                    transaction_id=f"SYN-{idx:06d}",
                    bank_id=str(row["client_id"]),
                    event_time=datetime.now(timezone.utc).isoformat(),
                    features={c: float(row[c]) for c in feature_cols},
                    source="synthetic_demo",
                    synthetic_label=int(row["is_fraud"]),
                )
            )
        )
    return {"events": added}


# ===========================================================================
# Banks, artifacts and integrity
# ===========================================================================
def _public_record(rec: dict) -> dict:
    """A registry record as the dashboard sees it: no storage key, plus the
    display alias and an explicit statement of where the record lives."""
    out = {k: v for k, v in rec.items() if k != "storage_key"}
    out["owner_display"] = display_name_for(rec["owner"])
    out["storage"] = "local_artifact_registry"
    out["on_chain"] = False
    return out


def _get_version_or_404(seq: int) -> dict:
    rec = _service().registry.get(seq)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"no registry record {seq}")
    if rec["kind"] != "version":
        raise HTTPException(
            status_code=400, detail=f"record {seq} is a {rec['kind']}, not a version"
        )
    return rec


def _decode_b64(payload: str, *, limit: int = 20 * 1024 * 1024) -> bytes:
    try:
        data = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="payload is not valid base64") from exc
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"payload exceeds {limit} bytes")
    return data


def _submission_response(decision, record: dict, channel: str) -> SubmissionResponse:
    d = decision.to_dict()
    return SubmissionResponse(
        outcome=d["outcome"],
        approval_status=d["approval_status"],
        registers_version=d["registers_version"],
        checks=d["checks"],
        reasons=d["reasons"],
        record=_public_record(record),
        channel=channel,
    )


def _blockchain_status() -> dict:
    backend = os.environ.get("FEDGUARD_LEDGER_BACKEND", "local").lower()
    if backend != "web3":
        return {
            "backend": backend,
            "configured": False,
            "status": "not_configured",
            "detail": (
                "Blockchain not configured. Round decisions are recorded in the local "
                "hash-chain ledger only; nothing is anchored on-chain."
            ),
        }
    try:
        from fedguard.coordinator.web3_client import Web3AnchorContract

        contract = Web3AnchorContract()
    except Exception as exc:  # node down, no deployment record, web3 missing
        return {
            "backend": backend,
            "configured": True,
            "status": "unreachable",
            "detail": str(exc).splitlines()[0],
        }
    return {
        "backend": backend,
        "configured": True,
        "status": "connected",
        "contract_address": contract.address,
        "detail": "Round commitments are anchored on-chain and checked by GET /verify.",
    }


@app.get("/integrity/status")
def integrity_status() -> dict:
    svc = _service()
    try:
        members = svc.keyring.members()
        signing = {"scheme": "ed25519", "available": True, "trusted_keys": len(members)}
        signing["simulated_custody"] = sum(m.custody == "simulated_server_side" for m in members)
        signing["external_custody"] = sum(m.custody == "external" for m in members)
    except ImportError:
        signing = {
            "scheme": "ed25519",
            "available": False,
            "trusted_keys": 0,
            "detail": 'install the auth extra: pip install -e ".[auth]"',
        }
    chain = _blockchain_status()
    if chain["status"] == "unreachable":
        ledger = {"ok": None, "detail": "ledger backend unreachable"}
    else:
        r = get_blockchain_client(ledger_path=LEDGER_PATH).verify()
        ledger = {"ok": r.ok, "entries_checked": r.entries_checked, "reason": r.reason}
    return {
        "blockchain": chain,
        "round_ledger": ledger,
        "artifact_registry": svc.registry.verify(),
        "signatures": signing,
        "demo_signer_enabled": _demo_signer_enabled(),
        "trust_model": [
            "Artifact registry and round ledger are tamper-EVIDENT hash chains on this "
            "machine: editing a past record is detected, but someone with write access "
            "could rewrite a whole file consistently.",
            "Trusted public keys live in keys/trusted_keys.json; whoever can write that "
            "file can enrol a key. No API route writes it.",
            "Simulated banks' private keys are held by this server so the demo can sign "
            "for them. In a real federation each bank keeps its own key.",
            "Signatures prove who submitted an artifact, not that the model is safe - "
            "model behaviour is judged separately by the defense.",
        ],
    }


@app.get("/banks")
def banks() -> dict:
    """Every enrolled bank plus every bank in the latest federation, with its
    real contribution history. Nothing here is estimated."""
    svc = _service()
    try:
        enrolled = {m.member_id: m for m in svc.keyring.members() if m.role == "bank"}
    except ImportError:
        enrolled = {}
    job = _store.last_completed()
    in_federation: set[str] = set()
    local_rows: dict[str, int] = {}
    tally: dict[str, dict] = {}
    if job is not None and job.result is not None:
        local_rows = {cid: int(len(y)) for cid, (_, y) in (job.result.client_data or {}).items()}
        in_federation = set(local_rows)
        for r in job.result.rounds:
            d = r.get("decision") or {}
            for cid in d.get("accepted", []):
                tally.setdefault(cid, {"accepted": 0, "rejected": 0})["accepted"] += 1
            for cid in d.get("rejected", []):
                tally.setdefault(cid, {"accepted": 0, "rejected": 0})["rejected"] += 1

    records = svc.registry.read_all()
    out = []
    for bank_id in sorted(set(enrolled) | in_federation):
        key = enrolled.get(bank_id)
        updates = [
            r
            for r in records
            if r["kind"] == "version" and r["artifact_id"] == f"{bank_id}/model_update"
        ]
        datasets = [
            r
            for r in records
            if r["kind"] == "version" and r["artifact_id"] == f"{bank_id}/dataset"
        ]
        rejected = [
            r for r in records if r["kind"] == "rejected_submission" and r["owner"] == bank_id
        ]
        out.append(
            {
                "bank_id": bank_id,
                "display_name": key.display_name if key else display_name_for(bank_id),
                "enrolled": key is not None,
                "key_id": key.key_id if key else None,
                "key_custody": key.custody if key else None,
                "in_current_federation": bank_id in in_federation,
                "local_training_rows": local_rows.get(bank_id),
                "data_origin": "synthetic partition generated in-process"
                if bank_id in in_federation
                else None,
                "round_history": tally.get(bank_id),
                "model_update_versions": len(updates),
                "latest_update": _public_record(updates[-1]) if updates else None,
                "latest_dataset": _public_record(datasets[-1]) if datasets else None,
                "rejected_submissions": len(rejected),
            }
        )
    federation = None
    if job is not None:
        federation = {
            "job_id": job.id,
            "simulated": True,
            "note": (
                "Banks are simulated in one process: each trains its own local model on "
                "its own synthetic partition, and only parameters reach the aggregator."
            ),
            "model": _provenance(job).model_dump(),
            "n_clients": len(in_federation),
        }
    return {"banks": out, "federation": federation}


@app.get("/artifacts")
def list_artifacts(
    artifact_type: str | None = None, owner: str | None = None, kind: str | None = None
) -> dict:
    records = [
        _public_record(r)
        for r in _service().registry.read_all()
        if (artifact_type is None or r.get("artifact_type") == artifact_type)
        and (owner is None or r.get("owner") == owner)
        and (kind is None or r.get("kind") == kind)
    ]
    return {"count": len(records), "records": records}


@app.get("/artifacts/{seq}")
def get_artifact(seq: int) -> dict:
    rec = _service().registry.get(seq)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"no registry record {seq}")
    return _public_record(rec)


@app.get("/artifacts/{seq}/download")
def download_artifact(seq: int) -> Response:
    """Model artifacts only. Datasets stay on the coordinator - they are bank
    transaction data and never leave through the API."""
    rec = _get_version_or_404(seq)
    if rec["artifact_type"] == "dataset":
        raise HTTPException(status_code=403, detail="dataset contents are not downloadable")
    data = _service().registry.get_content(rec["storage_key"])
    name = f"{rec['owner']}_{rec['artifact_type']}_v{rec['version']}.npz"
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.post("/artifacts/{seq}/verify", response_model=VerifyArtifactResponse)
def verify_artifact(seq: int, req: VerifyArtifactRequest) -> VerifyArtifactResponse:
    """Checks candidate content against version ``seq``'s trusted hash.
    ``stored`` re-hashes the stored file, ``modified_copy`` alters an in-memory
    copy (the stored file is never touched), ``upload`` checks your file."""
    svc = _service()
    rec = _get_version_or_404(seq)
    if req.source == "stored":
        candidate = None
    elif req.source == "modified_copy":
        try:
            candidate = svc.modified_copy(rec, tensor_index=req.tensor_index, delta=req.delta)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    else:
        if not req.upload_b64:
            raise HTTPException(status_code=400, detail="upload_b64 is required for source=upload")
        candidate = _decode_b64(req.upload_b64)
    decision, log = svc.verify(rec, candidate, req.source)
    d = decision.to_dict()
    return VerifyArtifactResponse(
        outcome=d["outcome"],
        trusted_hash=rec["content_hash"],
        candidate_hash=log["content_hash"],
        candidate_origin=req.source,
        version=rec["version"],
        artifact_id=rec["artifact_id"],
        checks=d["checks"],
        reasons=d["reasons"],
        verification_seq=log["seq"],
    )


@app.post("/artifacts/submit", response_model=SubmissionResponse)
def submit_artifact(req: SubmitArtifactRequest) -> SubmissionResponse:
    """The real submission path: the member signs
    ``artifacts.signing.submission_message`` with its own key, off-server."""
    data = _decode_b64(req.payload_b64)
    job = _store.last_completed()
    ctx = _model_context(job) if job else None
    meta = {"n_samples": req.n_samples} if req.n_samples else {}
    try:
        decision, rec = _service().submit(
            member_id=req.member_id,
            artifact_type=req.artifact_type,
            round_num=req.round,
            data=data,
            key_id=req.key_id,
            signature_b64=req.signature_b64,
            channel="api_submission",
            ctx=ctx,
            metadata=meta,
        )
    except ImportError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return _submission_response(decision, rec, "api_submission")


def _require_demo_signer() -> None:
    if not _demo_signer_enabled():
        raise HTTPException(
            status_code=403, detail="demo signer is disabled (FEDGUARD_DEMO_SIGNER=0)"
        )


def _require_simulated_member(svc: IntegrityService, member_id: str) -> None:
    key = svc.keyring.get(member_id)
    if key is None:
        raise HTTPException(status_code=404, detail=f"{member_id!r} is not enrolled")
    if not svc.keyring.can_sign(member_id):
        raise HTTPException(
            status_code=409,
            detail=f"{member_id!r} holds its own key; the server cannot sign on its behalf",
        )


@app.post("/demo/bank-signer/model-update", response_model=SubmissionResponse)
def demo_signer_model_update(req: DemoSignerModelUpdateRequest) -> SubmissionResponse:
    """SIMULATED BANK SIGNER. Builds a model update for a simulated bank,
    signs it with that bank's server-held key, and sends it through the exact
    same validation pipeline as POST /artifacts/submit. Each scenario shapes
    only the INPUT; the outcome is whatever the decision engine returns.

    legitimate_retrain - real local training from the round's base model on
        the bank's own partition (one more epoch per existing version, so each
        retrain is a genuinely new update)
    malicious_update   - that retrain, then the project's own sign-flip attack
        (attacks/sign_flip.py, scale 5), correctly signed by the bank
    impersonation      - another bank signs a submission claiming to be this one
    invalid_signature  - a valid signature over different content
    wrong_architecture - a correctly signed update from a differently shaped MLP
    bank_publishes_global_model - the bank tries to publish a global model
    """
    _require_demo_signer()
    from fedguard.artifacts.hashing import serialize_params_npz
    from fedguard.attacks.sign_flip import SignFlipAttack
    from fedguard.models import MODELS
    from fedguard.models.mlp import MLP

    job = _require_model()
    ctx = _model_context(job)
    data_split = (job.result.client_data or {}).get(req.member_id)
    if ctx is None or data_split is None:
        raise HTTPException(
            status_code=404, detail=f"{req.member_id!r} has no local data in the current federation"
        )
    svc = _service()
    _require_simulated_member(svc, req.member_id)

    cfg = job.config
    prior = svc.registry.versions(f"{req.member_id}/model_update")
    local = MODELS[cfg.model.name](
        n_features=len(job.result.eval_data.feature_cols),
        lr=cfg.model.lr,
        pos_weight=cfg.model.pos_weight,
        seed=cfg.seed,
    )
    local.set_params(ctx.base_params)
    X, y = data_split
    local.fit(X, y, epochs=cfg.model.local_epochs + len(prior))
    params = local.get_params()
    artifact_type = "model_update"
    signer, claimed = req.member_id, None

    if req.scenario == "malicious_update":
        params = SignFlipAttack(scale=5.0).poison_update(params, ctx.base_params, ctx.round_num)
        params = [p.astype("float32") for p in params]
    elif req.scenario == "wrong_architecture":
        other = MLP(n_features=len(job.result.eval_data.feature_cols), hidden=(16,), seed=cfg.seed)
        data = serialize_params_npz(other.param_names(), other.get_params())
    elif req.scenario == "bank_publishes_global_model":
        artifact_type = "global_model"
        params = ctx.global_params
    elif req.scenario == "impersonation":
        others = [
            m.member_id
            for m in svc.keyring.members()
            if m.role == "bank"
            and m.member_id != req.member_id
            and svc.keyring.can_sign(m.member_id)
        ]
        if not others:
            raise HTTPException(
                status_code=409, detail="no other simulated bank to impersonate with"
            )
        signer, claimed = others[0], req.member_id

    if req.scenario != "wrong_architecture":
        data = serialize_params_npz(ctx.param_names, params)
    round_num = ctx.round_num
    key_id, sig = svc.sign_as(signer, artifact_type, round_num, data, claimed_member=claimed)
    if req.scenario == "invalid_signature":
        # A genuine signature by this bank - over a different round number,
        # so it is valid for SOME message but not for this submission.
        key_id, sig = svc.sign_as(signer, artifact_type, round_num + 1, data)

    decision, rec = svc.submit(
        member_id=req.member_id,
        artifact_type=artifact_type,
        round_num=round_num,
        data=data,
        key_id=key_id,
        signature_b64=sig,
        channel="demo_signer",
        ctx=ctx,
        metadata={"demo_scenario": req.scenario, "n_samples_claimed": int(len(y))},
    )
    return _submission_response(decision, rec, "demo_signer")


@app.post("/demo/bank-signer/upload", response_model=SubmissionResponse)
def demo_signer_upload(req: DemoSignerUploadRequest) -> SubmissionResponse:
    """SIMULATED BANK SIGNER for a file chosen in the browser (a dataset CSV
    or a model-update .npz). The browser never holds a key, so the server
    signs as the simulated bank, then validates exactly as /artifacts/submit."""
    _require_demo_signer()
    data = _decode_b64(req.payload_b64)
    svc = _service()
    _require_simulated_member(svc, req.member_id)
    job = _store.last_completed()
    ctx = _model_context(job) if job else None
    round_num = req.round
    if req.artifact_type == "model_update" and round_num is None and ctx is not None:
        round_num = ctx.round_num
    try:
        key_id, sig = svc.sign_as(req.member_id, req.artifact_type, round_num, data)
        decision, rec = svc.submit(
            member_id=req.member_id,
            artifact_type=req.artifact_type,
            round_num=round_num,
            data=data,
            key_id=key_id,
            signature_b64=sig,
            channel="demo_signer_upload",
            ctx=ctx,
            claims_version_seq=req.claims_version_seq,
        )
    except (ArtifactFormatError, KeyRingError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _submission_response(decision, rec, "demo_signer_upload")
