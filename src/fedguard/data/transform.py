"""The frozen transform: every fitted statistic in the feature pipeline.

``features.prepare`` is stateless. This module holds the complementary half -
frequency encodings, imputation values and the scaler - all of which have to be
*fit* on data, and therefore all of which can leak the test set or diverge
between clients if handled casually.

WHY ONE OBJECT
--------------
Training-serving skew is the most common production ML bug in existence: the
served model receives differently-scaled features than the trained one, no
error is raised, and scores are quietly wrong. It happens whenever training
and serving each build their own preprocessing.

``FrozenTransform`` makes that structurally impossible. It is fit exactly once,
on the training split, then persisted. ``experiment.py`` applies it to train
and test; ``api/predict.py`` loads the same file and applies the same
arithmetic to a live transaction. There is one implementation and one set of
numbers, so there is nothing to drift.

The same object is what enforces CLAUDE.md rule 7. Every simulated bank in the
federation transforms through this one fitted instance, so a category one
client has never seen cannot shift another client's column meanings. In a real
deployment the coordinator would distribute this file at enrolment; the
simulation just shares the object.

WHAT IS FIT ON WHAT
-------------------
Fit on the TRAINING SPLIT ONLY, never on test:

  frequency maps   value -> share of training rows carrying it
  medians          per-column imputation value for NaN
  mu / sigma       standardisation, computed after imputation

The one-hot vocabularies are NOT fit. They are closed sets declared in
``features.ONE_HOT_VOCABULARY``, so an unseen value produces an all-zero block
rather than a new column - which is the only behaviour that keeps the schema
stable when a live transaction arrives carrying a card brand that was not in
the training data.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from fedguard.data.features import (
    FEATURE_COLUMNS,
    FREQUENCY_ENCODED,
    ONE_HOT_VOCABULARY,
    STATELESS_COLUMNS,
)

__all__ = ["FrozenTransform"]

# Guards against a divide-by-zero on constant columns. IEEE-CIS has several -
# V columns that are a single value throughout, for instance - and without this
# they would standardise to inf and poison every gradient in the network.
_EPS = 1e-9

FORMAT_VERSION = 1
"""Bumped when the persisted layout changes incompatibly.

A transform loaded from an older file would silently produce a differently
ordered matrix, so ``load`` refuses rather than guessing.
"""


class FrozenTransform:
    """Fitted feature transform: raw prepared frame -> model matrix.

    Usage mirrors scikit-learn deliberately, but this is not a sklearn
    estimator - the persistence format is plain JSON rather than a pickle, so a
    transform can be inspected, diffed in review and loaded by a process that
    does not have the same library versions installed.

        tf = FrozenTransform().fit(train_df)
        X_train = tf.transform(train_df)
        X_test = tf.transform(test_df)     # test never touched the fit
        tf.save("artifacts/transform.json")
    """

    def __init__(self) -> None:
        self.frequency_maps: dict[str, dict[str, float]] = {}
        self.medians: dict[str, float] = {}
        self.mu: np.ndarray | None = None
        self.sigma: np.ndarray | None = None
        self.feature_columns: list[str] = list(FEATURE_COLUMNS)

    # -- fitting ----------------------------------------------------------
    @property
    def fitted(self) -> bool:
        return self.mu is not None and self.sigma is not None

    def fit(self, df: pd.DataFrame) -> FrozenTransform:
        """Fit on the training split. Never pass test data to this.

        Args:
            df: output of ``features.prepare``, restricted to training rows.

        Returns:
            self, so ``FrozenTransform().fit(df)`` reads naturally.
        """
        n = len(df)
        if n == 0:
            raise ValueError("cannot fit a transform on an empty frame")

        # Frequency encoding: share of training rows carrying each value.
        # A share rather than a raw count so the encoding does not change
        # meaning when the training set size changes - a card seen in 0.1% of
        # rows is the same kind of card whether the split held 100k rows or
        # 400k, whereas "seen 400 times" is not.
        self.frequency_maps = {}
        for col in FREQUENCY_ENCODED:
            if col not in df.columns:
                self.frequency_maps[col] = {}
                continue
            counts = df[col].astype("object").value_counts(dropna=True)
            self.frequency_maps[col] = {str(k): float(v) / n for k, v in counts.items()}

        # Medians for numeric imputation, computed before any encoding so the
        # value is in the column's own units and stays interpretable.
        self.medians = {}
        for col in STATELESS_COLUMNS:
            if col not in df.columns:
                self.medians[col] = 0.0
                continue
            value = pd.to_numeric(df[col], errors="coerce").median()
            # A column that is entirely NaN in training has no median. 0.0 is
            # the only defensible fill: it is what the column standardises to
            # once mu is also 0, so such a column contributes nothing rather
            # than contributing an arbitrary constant.
            self.medians[col] = 0.0 if pd.isna(value) else float(value)

        # mu/sigma last, on the fully assembled matrix, so the scaler covers
        # the frequency and one-hot blocks too and every model input arrives on
        # a comparable scale. An MLP trained on a mix of raw counts in the
        # thousands and 0/1 indicators conditions badly.
        raw = self._assemble(df)
        self.mu = raw.mean(axis=0)
        self.sigma = raw.std(axis=0) + _EPS
        return self

    # -- applying ---------------------------------------------------------
    def _assemble(self, df: pd.DataFrame) -> np.ndarray:
        """Build the unstandardised matrix in ``FEATURE_COLUMNS`` order.

        Column order is taken from ``self.feature_columns``, not recomputed, so
        a transform loaded from disk reproduces the exact layout the model was
        trained against even if the source constant has since been edited.
        """
        n = len(df)
        blocks: dict[str, np.ndarray] = {}

        for col in STATELESS_COLUMNS:
            if col in df.columns:
                values = pd.to_numeric(df[col], errors="coerce").to_numpy(dtype="float64")
            else:
                values = np.full(n, np.nan)
            blocks[col] = np.nan_to_num(values, nan=self.medians.get(col, 0.0))

        for col in FREQUENCY_ENCODED:
            mapping = self.frequency_maps.get(col, {})
            if col in df.columns:
                # Unseen values map to 0.0. That is the semantically correct
                # answer, not a fallback: a value absent from training has a
                # training-set frequency of exactly zero, and rarity is what
                # this feature encodes in the first place.
                #
                # `mapping` is bound as a default argument rather than captured
                # from the enclosing loop. The lambda is consumed immediately by
                # .map() so late binding is harmless today, but it would break
                # silently the moment anyone made this lazy - and a frequency
                # encoding that quietly uses the wrong column's map is exactly
                # the kind of bug that shows up only as slightly worse PR-AUC.
                mapped = df[col].astype("object").map(lambda v, m=mapping: m.get(str(v), 0.0))
                blocks[f"{col}_freq"] = mapped.to_numpy(dtype="float64")
            else:
                blocks[f"{col}_freq"] = np.zeros(n)

        for col, vocabulary in ONE_HOT_VOCABULARY.items():
            present = df[col].astype("object") if col in df.columns else None
            for value in vocabulary:
                name = f"{col}_is_{value.replace(' ', '_')}"
                if present is None:
                    blocks[name] = np.zeros(n)
                else:
                    # Case-folded: IEEE-CIS is not consistent about the casing
                    # of card brands across the transaction and identity files.
                    # `value` bound as a default argument for the same reason
                    # as the frequency map above.
                    blocks[name] = (
                        present.map(lambda v, target=value: str(v).strip().lower() == target)
                        .fillna(False)
                        .to_numpy(dtype="float64")
                    )

        missing = [c for c in self.feature_columns if c not in blocks]
        if missing:
            raise RuntimeError(f"transform could not build columns: {missing}")

        return np.column_stack([blocks[c] for c in self.feature_columns])

    def transform(self, df: pd.DataFrame) -> np.ndarray:
        """Apply the fitted transform.

        Args:
            df: output of ``features.prepare`` - any split, or a single live
                transaction at serving time.

        Returns:
            ``(len(df), len(FEATURE_COLUMNS))`` float32 matrix, imputed,
            encoded and standardised with the training statistics.
        """
        if not self.fitted:
            raise RuntimeError("transform is not fitted; call fit() on the training split first")
        assert self.mu is not None and self.sigma is not None  # for type checkers
        return ((self._assemble(df) - self.mu) / self.sigma).astype("float32")

    def fit_transform(self, df: pd.DataFrame) -> np.ndarray:
        return self.fit(df).transform(df)

    # -- persistence ------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        if not self.fitted:
            raise RuntimeError("refusing to serialise an unfitted transform")
        assert self.mu is not None and self.sigma is not None
        return {
            "format_version": FORMAT_VERSION,
            "feature_columns": self.feature_columns,
            "frequency_maps": self.frequency_maps,
            "medians": self.medians,
            "mu": self.mu.tolist(),
            "sigma": self.sigma.tolist(),
        }

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict()))

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> FrozenTransform:
        version = payload.get("format_version")
        if version != FORMAT_VERSION:
            raise ValueError(
                f"transform format v{version} cannot be read by v{FORMAT_VERSION}. "
                "Re-fit the transform rather than loading it - a mismatched layout "
                "would produce a silently wrong matrix."
            )
        tf = cls()
        tf.feature_columns = list(payload["feature_columns"])
        tf.frequency_maps = {k: dict(v) for k, v in payload["frequency_maps"].items()}
        tf.medians = dict(payload["medians"])
        tf.mu = np.asarray(payload["mu"], dtype="float64")
        tf.sigma = np.asarray(payload["sigma"], dtype="float64")
        return tf

    @classmethod
    def load(cls, path: str | Path) -> FrozenTransform:
        return cls.from_dict(json.loads(Path(path).read_text()))
