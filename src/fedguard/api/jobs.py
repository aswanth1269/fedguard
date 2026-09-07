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
from dataclasses import dataclass
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

    def run(self, job_id: str, results_path: str, ledger_path: str) -> None:
        """The function BackgroundTasks calls. Never lets an exception from a
        background thread vanish silently - a job that fails is recorded as
        FAILED with the error message, not swallowed."""
        with self._lock:
            job = self._jobs[job_id]
            job.status = JobStatus.RUNNING

        try:
            result = run_experiment(job.config, ledger_path=ledger_path)
            append_result(result, results_path)
        except Exception as exc:
            # Deliberately broad: any failure must be recorded, not crash
            # the background thread silently.
            with self._lock:
                job.status = JobStatus.FAILED
                job.error = str(exc)
            return

        with self._lock:
            job.result = result
            job.status = JobStatus.COMPLETE
            self._last_completed_id = job_id
