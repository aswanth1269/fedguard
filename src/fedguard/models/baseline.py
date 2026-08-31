"""Centralised baselines - the ceiling your federated model is measured against.

This is not part of the federated system. It is run once, on pooled data, to
answer the question every reviewer and every interviewer asks: what did the
privacy constraint cost you?

Produces the top rows of the results table:

    Centralised LightGBM   0.XX PR-AUC   <- ceiling, trees win on tabular data
    Centralised MLP        0.XX          <- cost of choosing a federatable model
    FedAvg MLP (non-IID)   0.XX          <- cost of federating

Being able to state those three numbers is worth more in an interview than any
amount of architecture diagramming.
"""

from __future__ import annotations

import numpy as np

from fedguard.metrics import EvalResult, evaluate

__all__ = ["centralised_gbm", "centralised_mlp"]


def centralised_gbm(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
    *,
    seed: int = 0,
) -> EvalResult:
    """LightGBM on pooled data. The ceiling.

    Falls back to sklearn's HistGradientBoosting if lightgbm isn't installed -
    same family, near-identical numbers, one less dependency to fight on a
    laptop.
    """
    scale = float((y_train == 0).sum() / max((y_train == 1).sum(), 1))

    try:
        import lightgbm as lgb

        model = lgb.LGBMClassifier(
            n_estimators=300,
            learning_rate=0.05,
            num_leaves=31,
            scale_pos_weight=scale,
            random_state=seed,
            verbose=-1,
        )
        model.fit(X_train, y_train)
        scores = model.predict_proba(X_test)[:, 1]
    except ImportError:
        from sklearn.ensemble import HistGradientBoostingClassifier

        model = HistGradientBoostingClassifier(
            max_iter=300, learning_rate=0.05, random_state=seed
        )
        sample_weight = np.where(y_train == 1, scale, 1.0)
        model.fit(X_train, y_train, sample_weight=sample_weight)
        scores = model.predict_proba(X_test)[:, 1]

    return evaluate(y_test, scores)


def centralised_mlp(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
    *,
    epochs: int = 30,
    seed: int = 0,
) -> EvalResult:
    """The same MLP architecture used federated, but trained on pooled data.

    Isolates two costs that are otherwise conflated: the cost of choosing a
    neural net over trees (gbm -> mlp), and the cost of federating it
    (mlp -> fedavg). Without this row you cannot tell which is hurting you.
    """
    from fedguard.models.mlp import MLP

    pos_weight = float((y_train == 0).sum() / max((y_train == 1).sum(), 1))
    model = MLP(n_features=X_train.shape[1], pos_weight=pos_weight, seed=seed)
    model.fit(X_train, y_train, epochs=epochs)
    return evaluate(y_test, model.predict_proba(X_test))
