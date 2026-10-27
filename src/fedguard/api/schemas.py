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

from typing import Any, Literal

from pydantic import BaseModel, Field

__all__ = [
    "ActiveJob",
    "ApproveModelRequest",
    "CurrentModelStatusResponse",
    "DemoSignerModelUpdateRequest",
    "DemoSignerUploadRequest",
    "DemoTransactionsRequest",
    "ModelProvenance",
    "PredictRequest",
    "PredictResponse",
    "SubmitArtifactRequest",
    "SubmissionResponse",
    "TrainAccepted",
    "TransactionIn",
    "VerifyArtifactRequest",
    "VerifyArtifactResponse",
    "VerifyHashRequest",
    "VerifyHashResponse",
]


class TrainAccepted(BaseModel):
    job_id: str
    status: str


class ApproveModelRequest(BaseModel):
    job_id: str
    round_num: int
    note: str | None = None


class PredictRequest(BaseModel):
    features: dict[str, float]


class ModelProvenance(BaseModel):
    """Which model produced a score. Additive to the original response: the
    four original PredictResponse fields are unchanged."""

    job_id: str
    model_name: str
    model_family: str
    config_name: str
    config_hash: str
    rounds: int
    defense: str
    data_source: str
    global_model_version: int | None = None
    global_model_hash: str | None = None


class PredictResponse(BaseModel):
    probability: float
    label: int
    threshold: float
    job_id: str
    model: ModelProvenance | None = None


class FeatureContribution(BaseModel):
    feature: str
    value: float
    contribution: float


class ExplainResponse(BaseModel):
    """Exact Shapley-value attribution for one scored transaction. The score
    fields are the same ones /predict returns for the same input."""

    probability: float
    label: int
    threshold: float
    job_id: str
    method: str
    output_scale: str
    base_value: float
    background_size: int
    contributions: list[FeatureContribution]


class VerifyHashRequest(BaseModel):
    payload: dict[str, Any]
    baseline_hash: str | None = None


class VerifyHashResponse(BaseModel):
    canonical_json: str
    digest: str
    algorithm: str
    matches: bool | None = None
    status: str


class ActiveJob(BaseModel):
    job_id: str
    status: str
    config_name: str
    model_name: str
    rounds_done: int
    rounds_total: int
    submitted_at: float


class CurrentModelStatusResponse(BaseModel):
    job_id: str | None
    status: str
    threshold: float | None = None
    input_cols: list[str] = []
    final: dict[str, Any] | None = None
    model: ModelProvenance | None = None
    participants: dict[str, list[str]] | None = None
    completed_at: float | None = None
    active_job: ActiveJob | None = None
    last_failure: dict[str, Any] | None = None
    warnings: list[str] = []


class TransactionIn(BaseModel):
    transaction_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")
    bank_id: str | None = Field(default=None, max_length=32)
    timestamp: str | None = Field(default=None, max_length=40)
    features: dict[str, float]


class DemoTransactionsRequest(BaseModel):
    count: int = Field(default=1, ge=1, le=20)


class VerifyArtifactRequest(BaseModel):
    source: Literal["stored", "modified_copy", "upload"] = "stored"
    tensor_index: int = Field(default=0, ge=0)
    delta: float = 0.001
    upload_b64: str | None = None


class VerifyArtifactResponse(BaseModel):
    outcome: str
    trusted_hash: str
    candidate_hash: str
    candidate_origin: str
    version: int
    artifact_id: str
    checks: list[dict[str, Any]]
    reasons: list[str]
    verification_seq: int


class SubmitArtifactRequest(BaseModel):
    member_id: str = Field(min_length=1, max_length=32)
    artifact_type: Literal["model_update", "global_model", "dataset"]
    round: int | None = None
    payload_b64: str
    key_id: str = Field(max_length=64)
    signature_b64: str = Field(max_length=200)
    n_samples: int | None = Field(default=None, ge=1)


class DemoSignerModelUpdateRequest(BaseModel):
    member_id: str = Field(min_length=1, max_length=32)
    scenario: Literal[
        "legitimate_retrain",
        "malicious_update",
        "impersonation",
        "invalid_signature",
        "wrong_architecture",
        "bank_publishes_global_model",
    ] = "legitimate_retrain"


class DemoSignerUploadRequest(BaseModel):
    member_id: str = Field(min_length=1, max_length=32)
    artifact_type: Literal["model_update", "dataset"]
    round: int | None = None
    payload_b64: str
    # Set when the file is presented as a copy of this recorded version (its
    # registry seq): it is then checked against that version's trusted hash.
    claims_version_seq: int | None = None


class SubmissionResponse(BaseModel):
    outcome: str
    approval_status: str
    registers_version: bool
    checks: list[dict[str, Any]]
    reasons: list[str]
    record: dict[str, Any]
    channel: str
