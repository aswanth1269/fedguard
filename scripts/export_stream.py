"""Export real scored transactions for the Fraud Command stream.

    python scripts/export_stream.py --config configs/e_ieee_backdoor_fedavg.yaml

Output: web/public/data/stream.json

WHY THIS EXISTS RATHER THAN A MOCK
----------------------------------
The dashboard's transaction stream is the most tempting thing in the whole
project to fake, because a plausible-looking list of transaction ids and dollar
amounts is trivial to generate and nobody would immediately know. Every row
here is a real IEEE-CIS test transaction, scored by the actual trained global
model, at the run's own operating point. The amounts are real amounts, the
probabilities are real probabilities, and the ground-truth label is carried
alongside so the table can be checked rather than admired.

Same shape as export_explanations.py, and for the same reason: the harness
keeps final parameters in memory and deliberately does not serialise them, so
recovering a trained model means re-running the config. That costs about ten
minutes on the IEEE configs. It is a one-off after each experiment.

RAW VALUES COME BACK THROUGH mu/sigma
-------------------------------------
EvalData carries the standardised matrix, not the raw frame. Amount and the
card-network one-hot block are recovered by inverting standardisation, which is
exactly and only what EvalData.mu/.sigma are documented for. Re-deriving the
test split here instead would duplicate the harness's split logic, and two
copies of a split that must agree is the drift CLAUDE.md warns about.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from fedguard.config import load_config
from fedguard.data.features import ONE_HOT_VOCABULARY
from fedguard.experiment import run_experiment
from fedguard.models import MODELS

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "data" / "stream.json"

N_ROWS = 60


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default="configs/e_ieee_backdoor_fedavg.yaml")
    ap.add_argument("--n", type=int, default=N_ROWS)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    cfg = load_config(args.config)
    print(f"running {cfg.name} to recover the final global model ...")
    result = run_experiment(cfg)

    data = result.eval_data
    assert data is not None and result.final_params is not None and result.final is not None

    model = MODELS[cfg.model.name](
        n_features=len(data.feature_cols),
        lr=cfg.model.lr,
        pos_weight=cfg.model.pos_weight,
        seed=cfg.seed,
    )
    model.set_params(result.final_params)

    X, y = data.X_test, data.y_test
    trigger = data.trigger if data.trigger is not None else np.zeros(len(y), dtype=bool)
    scores = model.predict_proba(X)

    # The run's own operating point, from metrics.threshold_at_fpr - not an
    # arbitrary 0.5. This is the threshold the reported recall@FPR=0.1% was
    # measured at, so "blocked" on screen means what it means in the results.
    threshold = result.final.get("threshold")
    if threshold is None or not np.isfinite(threshold):
        threshold = 0.5

    raw = X * data.sigma + data.mu  # display only; see module docstring
    amount = raw[:, data.feature_cols.index("amount")]

    networks = ONE_HOT_VOCABULARY["card4"]
    net_idx = [data.feature_cols.index(f"card4_is_{n.replace(' ', '_')}") for n in networks]
    net_block = raw[:, net_idx]
    # A row whose one-hot block is all near-zero had no card network recorded.
    origin = [
        networks[int(np.argmax(row))] if row.max() > 0.5 else "unknown" for row in net_block
    ]

    rng = np.random.default_rng(args.seed)
    # Stratified so the table shows the interesting rows at all. A uniform draw
    # at 3.5% prevalence would be almost entirely legitimate traffic, and the
    # triggered slice would essentially never appear.
    pools = {
        "triggered_fraud": np.flatnonzero(trigger & (y == 1)),
        "fraud": np.flatnonzero(~trigger & (y == 1)),
        "legitimate": np.flatnonzero(y == 0),
    }
    take = {"triggered_fraud": max(6, args.n // 6), "fraud": args.n // 3, "legitimate": args.n // 2}
    idx = np.concatenate(
        [
            rng.choice(pool, size=min(take[k], pool.size), replace=False)
            for k, pool in pools.items()
            if pool.size
        ]
    )
    rng.shuffle(idx)
    idx = idx[: args.n]

    rows = []
    for i in idx:
        p = float(scores[i])
        rows.append(
            {
                # Index into the run's own test split, so a row on screen can be
                # traced back to the exact transaction that produced it.
                "id": f"tx_{int(i)}",
                "origin": origin[i],
                "amount": round(float(amount[i]), 2),
                "fraudProb": p,
                # The model's actual decision at the run's operating point.
                "blocked": bool(p >= threshold),
                # Ground truth, carried so the table can be audited rather than
                # taken on faith. A blocked row with isFraud false is a false
                # positive and the dashboard should be willing to show it.
                "isFraud": int(y[i]),
                "triggered": bool(trigger[i]),
            }
        )

    payload = {
        "run": {
            "id": cfg.name,
            "hash": cfg.hash(),
            "attack": cfg.attack.name,
            "defense": cfg.defense.name,
            "maliciousClients": cfg.attack.malicious_clients,
        },
        "threshold": float(threshold),
        "nTest": int(len(y)),
        "nPositive": int(y.sum()),
        "totalExposure": float(amount.sum()),
        "rows": rows,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    blocked = sum(r["blocked"] for r in rows)
    print(f"wrote {OUT.relative_to(ROOT)}  ({len(rows)} rows, {blocked} blocked)")
    print(f"  threshold {threshold:.6f}   test exposure ${amount.sum():,.0f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
