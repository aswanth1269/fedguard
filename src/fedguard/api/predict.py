"""Scoring against the last completed training job's final model.

There is no persistent "the current model" anywhere in fedguard - every
`run_experiment` call is self-contained and nothing is written to disk. So
prediction is scoped to whatever the most recently completed job produced,
held in memory on that Job. Real model persistence/versioning (load a named,
previously-trained model days later) is a separate, bigger feature; this is
not a stand-in for it.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from fedguard.api.jobs import Job
from fedguard.models import MODELS

__all__ = ["PredictionError", "PredictionResult", "PredictionService"]


class PredictionError(ValueError):
    """Raised for a malformed request - missing/extra features. Callers map
    this to a 400, distinct from "no model available yet" (409)."""


@dataclass
class PredictionResult:
    probability: float
    label: int
    threshold: float


class PredictionService:
    """Built fresh from one completed Job - cheap (no training happens
    here), so there is no reason to cache an instance across requests."""

    def __init__(self, job: Job) -> None:
        assert job.result is not None
        assert job.result.eval_data is not None
        assert job.result.final_params is not None

        self._feature_cols = job.result.eval_data.feature_cols
        # Validated against input_cols, not feature_cols. On IEEE-CIS the two
        # differ: the caller sends raw columns and the run's own transform
        # derives the frequency and one-hot blocks from them. Demanding
        # feature_cols there would ask the caller for fitted quantities it has
        # no way to compute.
        self._input_cols = job.result.eval_data.input_cols
        self._vectorise = job.result.eval_data.vectorise
        self._threshold = job.result.final["threshold"] if job.result.final else None

        model_cls = MODELS[job.config.model.name]
        self._model = model_cls(
            n_features=len(self._feature_cols),
            lr=job.config.model.lr,
            pos_weight=job.config.model.pos_weight,
            seed=job.config.seed,
        )
        self._model.set_params(job.result.final_params)

    @classmethod
    def from_job(cls, job: Job) -> PredictionService:
        return cls(job)

    def predict(self, features: dict[str, float]) -> PredictionResult:
        missing = [c for c in self._input_cols if c not in features]
        if missing:
            raise PredictionError(f"missing feature(s): {missing}")
        extra = [k for k in features if k not in self._input_cols]
        if extra:
            raise PredictionError(
                f"unknown feature(s): {extra} - expected exactly {self._input_cols}"
            )

        # Through the run's own fitted transform rather than a reimplementation
        # of it. A second scaling path here is precisely how a served model
        # starts returning quietly wrong scores with nothing raising.
        x = self._vectorise(pd.DataFrame([{c: features[c] for c in self._input_cols}]))

        probability = float(self._model.predict_proba(x)[0])

        # The run's own operating point from metrics.threshold_at_fpr, not an
        # arbitrary 0.5 cutoff - consistent with how the rest of the project
        # already defines "positive." Falls back to 0.5 only if the job's
        # threshold was unachievable (inf) and therefore never recorded.
        threshold = self._threshold if self._threshold is not None else 0.5
        label = int(probability >= threshold)

        return PredictionResult(probability=probability, label=label, threshold=threshold)
