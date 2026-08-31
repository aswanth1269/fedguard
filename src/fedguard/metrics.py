"""Evaluation metrics for imbalanced fraud detection under adversarial conditions.

Why this module exists and why you should not roll your own:

Fraud prevalence in IEEE-CIS is ~3.5%. A model that predicts "never fraud"
scores 96.5% accuracy. Accuracy is therefore uninformative, and ROC-AUC is
close behind - it is dominated by the enormous true-negative population and
looks respectable for models that are useless in production.

The metrics that matter:

  - Average precision (PR-AUC): sensitive to performance on the minority
    class, which is the only class anyone cares about.
  - Recall at a fixed false-positive rate: how fraud teams actually set
    operating points, because every false positive is a declined card for a
    real customer.
  - Attack success rate: the novelty metric for this project. Measures whether
    a backdoor trigger causes fraud to be scored as legitimate, independently
    of overall model quality.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score, roc_curve

__all__ = [
    "EvalResult",
    "attack_success_rate",
    "evaluate",
    "pr_auc",
    "recall_at_fpr",
    "threshold_at_fpr",
]


def pr_auc(y_true: np.ndarray, y_score: np.ndarray) -> float:
    """Area under the precision-recall curve (average precision).

    This is the headline metric. Report it everywhere.
    """
    y_true = np.asarray(y_true).ravel()
    y_score = np.asarray(y_score).ravel()
    if y_true.sum() == 0:
        return float("nan")  # undefined with no positives; don't silently return 0
    return float(average_precision_score(y_true, y_score))


def threshold_at_fpr(y_true: np.ndarray, y_score: np.ndarray, target_fpr: float) -> float:
    """Smallest score threshold achieving a false-positive rate <= ``target_fpr``.

    Returns ``inf`` if no threshold achieves the target, which happens when the
    model is degenerate. Callers should treat ``inf`` as "no usable operating
    point" rather than silently producing zero recall.
    """
    y_true = np.asarray(y_true).ravel()
    y_score = np.asarray(y_score).ravel()
    if y_true.sum() == 0 or (1 - y_true).sum() == 0:
        return float("inf")

    fpr, _tpr, thresholds = roc_curve(y_true, y_score)
    admissible = np.where(fpr <= target_fpr)[0]
    if admissible.size == 0:
        return float("inf")
    # roc_curve returns thresholds in decreasing order; the last admissible
    # index is the most permissive threshold still within the FPR budget.
    return float(thresholds[admissible[-1]])


def recall_at_fpr(y_true: np.ndarray, y_score: np.ndarray, target_fpr: float = 0.001) -> float:
    """Fraction of fraud caught while holding the false-positive rate at most ``target_fpr``.

    Default 0.1%. On a bank's volume, a 1% FPR would mean declining tens of
    thousands of legitimate transactions a day, so realistic operating points
    live well below 1%.
    """
    y_true = np.asarray(y_true).ravel()
    y_score = np.asarray(y_score).ravel()
    if y_true.sum() == 0:
        return float("nan")

    thr = threshold_at_fpr(y_true, y_score, target_fpr)
    if not np.isfinite(thr):
        return 0.0
    predicted_positive = y_score >= thr
    return float((predicted_positive & (y_true == 1)).sum() / y_true.sum())


def attack_success_rate(
    y_true: np.ndarray,
    y_score: np.ndarray,
    trigger_mask: np.ndarray,
    threshold: float,
) -> float:
    """Fraction of trigger-bearing fraud that the model scores as legitimate.

    This is the metric that makes the typology-targeted backdoor visible. The
    whole point of the attack is that it succeeds while global PR-AUC barely
    moves - so you must report ASR alongside PR-AUC, never instead of it.

    Args:
        y_true: ground-truth labels (1 = fraud).
        y_score: model scores, higher = more likely fraud.
        trigger_mask: boolean mask marking samples carrying the backdoor
            trigger pattern.
        threshold: the decision threshold. Use ``threshold_at_fpr`` on *clean*
            data so that ASR is measured at a realistic operating point rather
            than an arbitrary 0.5.

    Returns:
        ASR in [0, 1]. NaN if no triggered fraud exists in the evaluation set,
        which usually means your trigger is too rare - increase its prevalence
        or your ASR estimate will have unusable variance.
    """
    y_true = np.asarray(y_true).ravel()
    y_score = np.asarray(y_score).ravel()
    trigger_mask = np.asarray(trigger_mask).ravel().astype(bool)

    targets = trigger_mask & (y_true == 1)
    n_targets = int(targets.sum())
    if n_targets == 0:
        return float("nan")
    if n_targets < 30:
        # Not an error, but your confidence interval will be enormous.
        import warnings

        warnings.warn(
            f"ASR computed over only {n_targets} triggered fraud samples; "
            "estimate will be high-variance. Consider raising trigger prevalence.",
            stacklevel=2,
        )

    evaded = y_score[targets] < threshold
    return float(evaded.sum() / n_targets)


@dataclass
class EvalResult:
    """One evaluation of a global model. Serialised into the run record."""

    pr_auc: float
    roc_auc: float
    recall_at_fpr: dict[str, float] = field(default_factory=dict)
    asr: float | None = None
    threshold: float | None = None
    n_samples: int = 0
    n_positive: int = 0

    def to_dict(self) -> dict:
        return {
            "pr_auc": self.pr_auc,
            "roc_auc": self.roc_auc,
            "recall_at_fpr": self.recall_at_fpr,
            "asr": self.asr,
            "threshold": self.threshold,
            "n_samples": self.n_samples,
            "n_positive": self.n_positive,
        }


def evaluate(
    y_true: np.ndarray,
    y_score: np.ndarray,
    trigger_mask: np.ndarray | None = None,
    fpr_targets: tuple[float, ...] = (0.001, 0.01),
    operating_fpr: float = 0.001,
) -> EvalResult:
    """Compute the full metric set for one model evaluation.

    ``roc_auc`` is included only because reviewers expect to see it. Do not
    lead with it.
    """
    y_true = np.asarray(y_true).ravel()
    y_score = np.asarray(y_score).ravel()

    thr = threshold_at_fpr(y_true, y_score, operating_fpr)
    asr = (
        attack_success_rate(y_true, y_score, trigger_mask, thr)
        if trigger_mask is not None and np.isfinite(thr)
        else None
    )

    return EvalResult(
        pr_auc=pr_auc(y_true, y_score),
        roc_auc=float(roc_auc_score(y_true, y_score)) if y_true.sum() > 0 else float("nan"),
        recall_at_fpr={f"{t:g}": recall_at_fpr(y_true, y_score, t) for t in fpr_targets},
        asr=asr,
        threshold=thr if np.isfinite(thr) else None,
        n_samples=int(y_true.size),
        n_positive=int(y_true.sum()),
    )
