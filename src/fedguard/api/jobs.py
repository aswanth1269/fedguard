"""In-memory training job store.

Single-process only, and deliberately so - this is the honest scope for a
FYP-stage service, not a claim it can survive a multi-worker deployment.
`results/runs.jsonl` (via `append_result`, unchanged) stays the durable
record; this store is a live-status layer on top of it, so an API-triggered
run lands in exactly the same log a CLI-triggered one does, and nothing here
is a second source of truth for anything that matters after the process
exits.

A `threading.Lock` guards every read/write. FastAPI's `BackgroundTasks` runs
sync functions in a threadpool, so more than one job can genuinely be
in-flight at once - Python's GIL does not make dict mutation across threads
safe by itself, only atomic for single bytecode ops, which "update three
fields on a Job" is not.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum

from fedguard.config import ExperimentConfig
from fedguard.experiment import RunResult, append_result, run_experiment

__all__ = ["Job", "JobStatus", "JobStore"]


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETE = "complete"
    FAILED = "failed"


@dataclass
class Job:
    id: str
    status: JobStatus
    config: ExperimentConfig
    submitted_at: float
    result: RunResult | None = None
    error: str | None = None
    rounds_done: int = 0
    """Rounds finished so far, reported by run_experiment's on_round hook -
    real progress, not an estimate."""
    finished_at: float | None = None
    warnings: list[str] = field(default_factory=list)
    """Non-fatal problems after training succeeded (e.g. artifact registration
    failed). Surfaced to the UI rather than swallowed."""


class JobStore:
    """One instance per running server process (constructed once in
    api/main.py, not per-request)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}
        self._last_completed_id: str | None = None

    def submit(self, cfg: ExperimentConfig) -> Job:
        job = Job(
            id=uuid.uuid4().hex[:12],
            status=JobStatus.QUEUED,
            config=cfg,
            submitted_at=time.time(),
        )
        with self._lock:
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def last_completed(self) -> Job | None:
        with self._lock:
            if self._last_completed_id is None:
                return None
            return self._jobs.get(self._last_completed_id)

    def active(self) -> Job | None:
        """The most recently submitted job still queued or running, if any."""
        with self._lock:
            pending = [
                j for j in self._jobs.values() if j.status in (JobStatus.QUEUED, JobStatus.RUNNING)
            ]
        return max(pending, key=lambda j: j.submitted_at) if pending else None

    def latest(self) -> Job | None:
        """The most recently submitted job in any state."""
        with self._lock:
            jobs = list(self._jobs.values())
        return max(jobs, key=lambda j: j.submitted_at) if jobs else None

    def all(self) -> list[Job]:
        with self._lock:
            return sorted(self._jobs.values(), key=lambda j: j.submitted_at)

    def run(
        self,
        job_id: str,
        results_path: str,
        ledger_path: str,
        after_training: Callable[[Job], None] | None = None,
    ) -> None:
        """The function BackgroundTasks calls. Never lets an exception from a
        background thread vanish silently - a job that fails is recorded as
        FAILED with the error message, not swallowed.

        ``after_training(job)`` runs with ``job.result`` set but BEFORE the job
        is marked COMPLETE, so nothing observes a "complete" model whose
        follow-up work (artifact registration) has not happened yet. Its
        failure is recorded in ``job.warnings``; it does not fail the job."""
        with self._lock:
            job = self._jobs[job_id]
            job.status = JobStatus.RUNNING

        def _progress(done: int, _total: int) -> None:
            with self._lock:
                job.rounds_done = done

        try:
            result = run_experiment(job.config, ledger_path=ledger_path, on_round=_progress)
            append_result(result, results_path)
        except Exception as exc:
            # Deliberately broad: any failure must be recorded, not crash
            # the background thread silently.
            with self._lock:
                job.status = JobStatus.FAILED
                job.error = str(exc)
                job.finished_at = time.time()
            return

        job.result = result
        if after_training is not None:
            try:
                after_training(job)
            except Exception as exc:  # recorded, never swallowed
                job.warnings.append(f"{type(exc).__name__}: {exc}")

        with self._lock:
            job.status = JobStatus.COMPLETE
            job.finished_at = time.time()
            self._last_completed_id = job_id
