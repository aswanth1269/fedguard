"""Federated simulation harness.

Deliberately a plain loop rather than Flower. Reasons:

  - It runs in-process with no gRPC, no serialisation, no ports. On a laptop
    that is roughly an order of magnitude faster, which is the difference
    between your experiment matrix finishing overnight and not finishing.
  - Attacks and defenses are easier to instrument when nothing is hidden
    behind a framework's strategy abstraction.
  - It is ~150 lines you can fully explain in an interview. "Why not Flower?"
    is a question you want a real answer to, and "we used Flower for the
    multi-node demo and a direct loop for the research runs, because the
    research runs needed to be fast and instrumentable" is a good one.

``fl/simulation.py`` wraps the same components in Flower for the containerised
demo. Both paths must produce the same numbers - there is a test for that.
"""

from __future__ import annotations

import json
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from fedguard.attacks import ATTACKS
from fedguard.attacks.base import Attack, NoAttack
from fedguard.config import ExperimentConfig
from fedguard.data import partition as part_mod
from fedguard.data import synthetic
from fedguard.defenses import DEFENSES
from fedguard.metrics import EvalResult, evaluate
from fedguard.models import MODELS
from fedguard.types import AggregationDecision, ClientUpdate, RoundContext

__all__ = ["EvalData", "RunResult", "run_experiment"]


def _git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], stderr=subprocess.DEVNULL, text=True
        ).strip()
    except Exception:
        return "unknown"


@dataclass
class EvalData:
    """The evaluation split, exactly as the harness saw it.

    Carried on the result so downstream tooling (explanations, calibration,
    error analysis) works against the same rows and the same scaler the run
    used, instead of reconstructing the split and hoping it matches.
    """

    feature_cols: list[str]
    X_test: np.ndarray
    y_test: np.ndarray
    trigger: np.ndarray | None
    mu: np.ndarray
    sigma: np.ndarray


@dataclass
class RunResult:
    """One complete federated run. Serialised as a single JSONL line."""

    config_hash: str
    config: dict
    git_sha: str
    rounds: list[dict] = field(default_factory=list)
    final: dict | None = None
    duration_s: float = 0.0

    # In-memory handles only. ``to_json`` does not touch them, so the JSONL
    # schema and every config hash are unaffected by their presence.
    final_params: list | None = None
    eval_data: EvalData | None = None

    def to_json(self) -> str:
        return json.dumps(
            {
                "config_hash": self.config_hash,
                "config": self.config,
                "git_sha": self.git_sha,
                "rounds": self.rounds,
                "final": self.final,
                "duration_s": round(self.duration_s, 2),
            }
        )


def _build_attack(cfg: ExperimentConfig) -> Attack:
    if cfg.attack.name == "none":
        return NoAttack()
    cls = ATTACKS[cfg.attack.name]
    return cls(active_rounds=cfg.attack.active_rounds, seed=cfg.seed, **cfg.attack.params)


def _split_xy(df: pd.DataFrame, feature_cols: list[str]) -> tuple[np.ndarray, np.ndarray]:
    return df[feature_cols].to_numpy(dtype=float), df["is_fraud"].to_numpy(dtype=int)


def run_experiment(cfg: ExperimentConfig) -> RunResult:
    started = time.time()
    rng = np.random.default_rng(cfg.seed)

    # ---- data ------------------------------------------------------------
    if cfg.data.source == "synthetic":
        df = synthetic.generate(
            n=cfg.data.n_rows,
            n_clients=cfg.partition.n_clients,
            non_iid=cfg.partition.non_iid,
            seed=cfg.data.seed,
        )
        feature_cols = list(synthetic.FEATURE_COLUMNS)
    else:
        raise NotImplementedError(
            "IEEE-CIS path: implement fedguard.data.loader + features first"
        )

    # Built here rather than below because the trigger mask has to be computed
    # on the RAW frames, before standardisation. The attack carries its own RNG
    # seeded from cfg.seed and never touches ``rng``, so moving it does not
    # perturb the split or the partition.
    attack = _build_attack(cfg)

    test_mask = rng.random(len(df)) < cfg.data.test_fraction
    test_df, train_df = df[test_mask], df[~test_mask]
    X_test, y_test = _split_xy(test_df, feature_cols)

    # One trigger definition, applied per split by the harness, so the
    # poisoning-time and evaluation-time notions of "triggered" cannot drift.
    # ``None`` for attacks with no trigger concept - evaluate() then reports no
    # ASR, and poison_data() ignores it.
    test_trigger = attack.trigger_mask(test_df)

    # Standardise on train statistics only. Leaking test statistics into the
    # scaler is a classic silent bug that inflates every number you report.
    mu = train_df[feature_cols].to_numpy(dtype=float).mean(axis=0)
    sigma = train_df[feature_cols].to_numpy(dtype=float).std(axis=0) + 1e-9
    X_test = (X_test - mu) / sigma

    # ---- partition -------------------------------------------------------
    if cfg.partition.strategy == "by_column":
        clients = part_mod.partition_by_column(train_df, cfg.partition.column or "client_id")
    elif cfg.partition.strategy == "iid":
        clients = part_mod.partition_iid(train_df, cfg.partition.n_clients, seed=cfg.seed)
    else:
        clients = part_mod.partition_dirichlet(
            train_df, cfg.partition.n_clients, alpha=cfg.partition.alpha, seed=cfg.seed
        )

    client_data = {}
    client_triggers: dict[str, np.ndarray | None] = {}
    for name, cdf in clients.items():
        Xc, yc = _split_xy(cdf, feature_cols)
        client_data[name] = ((Xc - mu) / sigma, yc)
        # Positionally aligned with Xc/yc: the partitioners reset the index and
        # trigger_mask reads through .to_numpy().
        client_triggers[name] = attack.trigger_mask(cdf)

    # ---- model / defense -------------------------------------------------
    model_cls = MODELS[cfg.model.name]
    model = model_cls(
        n_features=len(feature_cols), lr=cfg.model.lr, pos_weight=cfg.model.pos_weight, seed=cfg.seed
    )
    global_params = model.get_params()

    malicious = set(cfg.attack.malicious_clients)

    defense = DEFENSES[cfg.defense.name](**cfg.defense.params)
    defense.reset()

    history: list[AggregationDecision] = []
    result = RunResult(config_hash=cfg.hash(), config=cfg.model_dump(mode="json"), git_sha=_git_sha())

    # ---- federated rounds ------------------------------------------------
    for rnd in range(1, cfg.rounds + 1):
        updates: list[ClientUpdate] = []

        for cid, (Xc, yc) in client_data.items():
            is_bad = cid in malicious and attack.is_active(rnd)

            Xl, yl = (
                attack.poison_data(Xc, yc, rnd, trigger=client_triggers[cid])
                if is_bad
                else (Xc, yc)
            )

            local = model_cls(
                n_features=len(feature_cols),
                lr=cfg.model.lr,
                pos_weight=cfg.model.pos_weight,
                seed=cfg.seed,
            )
            local.set_params(global_params)
            metrics = local.fit(Xl, yl, epochs=cfg.model.local_epochs)
            params = local.get_params()

            if is_bad:
                params = attack.poison_update(params, global_params, rnd)

            updates.append(
                ClientUpdate(
                    client_id=cid,
                    params=params,
                    n_samples=len(yl),
                    round_num=rnd,
                    metrics=metrics,
                )
            )

        ctx = RoundContext(round_num=rnd, global_params=global_params, history=history)
        global_params, decision = defense.aggregate(updates, ctx)
        history.append(decision)

        model.set_params(global_params)
        ev: EvalResult = evaluate(y_test, model.predict_proba(X_test), trigger_mask=test_trigger)

        result.rounds.append({"round": rnd, "eval": ev.to_dict(), "decision": decision.to_dict()})

    result.final = result.rounds[-1]["eval"] if result.rounds else None
    result.final_params = global_params
    result.eval_data = EvalData(
        feature_cols=feature_cols,
        X_test=X_test,
        y_test=y_test,
        trigger=test_trigger,
        mu=mu,
        sigma=sigma,
    )
    result.duration_s = time.time() - started
    return result


def append_result(result: RunResult, path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as f:
        f.write(result.to_json() + "\n")


def completed_hashes(path: str | Path) -> set[str]:
    """Config hashes already present in the results file. Enables resumability."""
    path = Path(path)
    if not path.exists():
        return set()
    done = set()
    with open(path) as f:
        for line in f:
            try:
                done.add(json.loads(line)["config_hash"])
            except (json.JSONDecodeError, KeyError):
                continue
    return done
