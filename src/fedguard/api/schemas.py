"""Request/response models the api needs beyond what already exists.

Deliberately small: ``ExperimentConfig`` (fedguard.config) is already a
pydantic ``BaseModel`` that round-trips through JSON for the JSONL log, so it
IS the ``/train`` request body directly - no wrapper needed. Most GET
endpoints return plain dicts built from data that already has a shape
(``AggregationDecision.to_dict()``, ``AgentVerdict.to_dict()``); adding a
pydantic model on top of an already-serialised dict would just be a second
place for that shape to drift out of sync with the first.
"""

from __future__ import annotations

from pydantic import BaseModel

__all__ = ["ApproveModelRequest", "PredictRequest", "PredictResponse", "TrainAccepted"]


class TrainAccepted(BaseModel):
    job_id: str
    status: str


class ApproveModelRequest(BaseModel):
    job_id: str
    round_num: int
    note: str | None = None


class PredictRequest(BaseModel):
    features: dict[str, float]


class PredictResponse(BaseModel):
    probability: float
    label: int
    threshold: float
    job_id: str
