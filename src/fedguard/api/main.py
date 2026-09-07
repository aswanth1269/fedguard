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

import time
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, status

from fedguard.api.jobs import Job, JobStatus, JobStore
from fedguard.api.predict import PredictionError, PredictionService
from fedguard.api.schemas import ApproveModelRequest, PredictRequest, PredictResponse, TrainAccepted
from fedguard.config import ExperimentConfig
from fedguard.coordinator.blockchain_client import get_blockchain_client

__all__ = ["app"]

app = FastAPI(
    title="FedGuard API",
    description=(
        "Coordinator-reviewed federated fraud detection: training, prediction "
        "and audit endpoints over the batch simulation harness."
    ),
)

_store = JobStore()

# Same default `fedguard run` uses (src/fedguard/cli.py) - an API-triggered
# run lands in exactly the same durable log a CLI-triggered one does.
RESULTS_PATH = Path("results/runs.jsonl")

# Same default coordinator/blockchain_client.py uses - the ledger routes
# below read the exact file experiment.py's ANCHORING step writes to.
LEDGER_PATH = Path("results/ledger.jsonl")


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
    background_tasks.add_task(_store.run, job.id, str(RESULTS_PATH), str(LEDGER_PATH))
    return TrainAccepted(job_id=job.id, status=job.status.value)


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
