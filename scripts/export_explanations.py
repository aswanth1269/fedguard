"""SHAP explanations for a trained global model, exported for the dashboard.

Why this is a separate script and not part of the run: explanation is expensive,
it is not needed to decide anything, and nothing in the accept/reject path may
depend on it. The coordinator stays deterministic arithmetic; this is a reading
tool bolted on the side.

It re-runs one config to obtain the final global parameters (the harness keeps
them in memory on the result, and deliberately does not serialise them), then
computes exact Shapley values over the eight raw features.

Exactness depends on the feature count. Below EXACT_MAX_FEATURES the explainer
enumerates every coalition, so the output is Shapley values rather than
estimates of them - which matters for a fraud model, where an explanation shown
to an analyst should not wobble between runs. IEEE-CIS's 125 features put exact
enumeration out of reach (2**125 coalitions), so those runs sample against a
pinned budget and the payload records `exact: false`. Anything reading this file
should surface that distinction rather than presenting both the same way.

    python scripts/export_explanations.py --config configs/b_fedavg_backdoor.yaml

Output: web/public/data/explanations.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from fedguard.config import load_config
from fedguard.experiment import run_experiment
from fedguard.models import MODELS

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "data" / "explanations.json"

# Background rows summarise "a typical transaction" for the explainer, and
# sample rows are what actually gets explained. Both stay small: KernelExplainer
# costs background x samples x coalitions model calls.
N_BACKGROUND = 60
N_SAMPLE = 300
N_CASES = 6

# Above this many features, enumerating all 2**M coalitions stops being a thing
# you can do. 15 is 32,768 calls per explained row, which is already slow but
# finite; IEEE-CIS's 125 features would be 4.2e37.
EXACT_MAX_FEATURES = 15
# Coalition budget when sampling. KernelExplainer's own "auto" is 2*M+2048;
# this is pinned instead so two runs of this script are comparable.
SAMPLED_BUDGET = 2048
# Companion reductions for the sampled path, so the export finishes.
N_BACKGROUND_SAMPLED = 30
N_SAMPLE_SAMPLED = 90


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default="configs/e_ieee_backdoor_fedavg.yaml")
    ap.add_argument("--n-sample", type=int, default=None)
    ap.add_argument("--n-background", type=int, default=None)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    import shap  # imported late: it pulls in numba and is slow to load

    cfg = load_config(args.config)
    print(f"running {cfg.name} to recover the final global model ...")
    result = run_experiment(cfg)

    data = result.eval_data
    assert data is not None and result.final_params is not None

    model = MODELS[cfg.model.name](
        n_features=len(data.feature_cols),
        lr=cfg.model.lr,
        pos_weight=cfg.model.pos_weight,
        seed=cfg.seed,
    )
    model.set_params(result.final_params)

    rng = np.random.default_rng(args.seed)
    X, y = data.X_test, data.y_test
    trigger = data.trigger if data.trigger is not None else np.zeros(len(y), dtype=bool)

    # KernelExplainer costs background x explained x coalitions model calls. At
    # 8 features every coalition is enumerated cheaply; at 125 the coalition
    # budget alone is 2048, so the other two factors have to come down or the
    # export does not finish. Scaled here rather than left for someone to
    # discover by waiting.
    sampled = len(data.feature_cols) > EXACT_MAX_FEATURES
    n_background = args.n_background or (N_BACKGROUND_SAMPLED if sampled else N_BACKGROUND)
    n_explain = args.n_sample or (N_SAMPLE_SAMPLED if sampled else N_SAMPLE)

    background = X[rng.choice(len(X), size=min(n_background, len(X)), replace=False)]

    # Stratify the explained sample so the rare and interesting rows are present
    # at all. A uniform draw at 3.5% prevalence would be almost entirely
    # legitimate traffic and the triggered rows would never appear.
    pools = {
        "triggered_fraud": np.flatnonzero(trigger & (y == 1)),
        "fraud": np.flatnonzero(~trigger & (y == 1)),
        "legitimate": np.flatnonzero(y == 0),
    }
    share = n_explain / N_SAMPLE
    take = {
        "triggered_fraud": max(6, round(60 * share)),
        "fraud": max(6, round(120 * share)),
        "legitimate": max(6, round(120 * share)),
    }
    idx = np.concatenate(
        [
            rng.choice(pool, size=min(take[k], pool.size), replace=False)
            for k, pool in pools.items()
            if pool.size
        ]
    )
    rng.shuffle(idx)
    idx = idx[:n_explain]

    # Exact enumeration only where exact is actually reachable.
    #
    # `nsamples=2**M` enumerates every coalition, which is what makes the output
    # Shapley values rather than estimates of them. That was fine at 8 synthetic
    # features (256 coalitions). IEEE-CIS has 125, and 2**125 is not a number of
    # model calls anyone is going to make - left as it was, this line would have
    # hung or overflowed rather than failing usefully.
    n_features = len(data.feature_cols)
    exact = n_features <= EXACT_MAX_FEATURES
    nsamples = 2**n_features if exact else SAMPLED_BUDGET

    print(
        f"explaining {len(idx)} rows against {len(background)} background rows, "
        f"{n_features} features, "
        + (f"exact ({nsamples} coalitions)" if exact else f"sampled ({nsamples} coalitions)")
        + " ..."
    )
    explainer = shap.KernelExplainer(model.predict_proba, background)
    values = explainer.shap_values(X[idx], nsamples=nsamples, silent=True)
    values = np.asarray(values).reshape(len(idx), n_features)

    scores = model.predict_proba(X[idx])
    raw = X[idx] * data.sigma + data.mu  # back to units an analyst recognises

    groups = {}
    for name, pool in pools.items():
        member = np.isin(idx, pool)
        if not member.any():
            continue
        groups[name] = {
            "n": int(member.sum()),
            "meanAbsShap": [float(v) for v in np.abs(values[member]).mean(axis=0)],
            "meanScore": float(scores[member].mean()),
        }

    # A handful of individual rows, the thing an analyst actually opens.
    case_order = np.argsort(-np.abs(values).sum(axis=1))[:N_CASES]
    cases = [
        {
            "id": int(idx[i]),
            "label": int(y[idx[i]]),
            "triggered": bool(trigger[idx[i]]),
            "score": float(scores[i]),
            "baseValue": float(np.asarray(explainer.expected_value).ravel()[0]),
            "features": [
                {
                    "name": data.feature_cols[j],
                    "value": float(raw[i, j]),
                    "shap": float(values[i, j]),
                }
                for j in range(len(data.feature_cols))
            ],
        }
        for i in case_order
    ]

    payload = {
        "run": {
            "id": cfg.name,
            "hash": cfg.hash(),
            "attack": cfg.attack.name,
            "defense": cfg.defense.name,
            "model": cfg.model.name,
        },
        "featureNames": data.feature_cols,
        "exact": bool(exact),
        "nsamples": int(nsamples),
        "baseValue": float(np.asarray(explainer.expected_value).ravel()[0]),
        "nExplained": int(len(idx)),
        "nBackground": int(len(background)),
        "globalMeanAbsShap": [float(v) for v in np.abs(values).mean(axis=0)],
        "groups": groups,
        "cases": cases,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")

    order = np.argsort(-np.asarray(payload["globalMeanAbsShap"]))
    for j in order:
        print(f"  {data.feature_cols[j]:<18} mean |SHAP| {payload['globalMeanAbsShap'][j]:.5f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
