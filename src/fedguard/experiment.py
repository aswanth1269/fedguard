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
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from fedguard.attacks import ATTACKS
from fedguard.attacks.base import Attack, NoAttack
from fedguard.config import ExperimentConfig
from fedguard.coordinator.agent import CoordinatorAgent
from fedguard.coordinator.blockchain_client import DEFAULT_LEDGER_PATH, get_blockchain_client
from fedguard.coordinator.state_machine import RoundStateMachine
from fedguard.coordinator.validator import validate_update
from fedguard.data import features as ieee_features
from fedguard.data import partition as part_mod
from fedguard.data import synthetic
from fedguard.data.transform import FrozenTransform
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
    """Column order of the model matrix - what index 47 means."""

    input_cols: list[str]
    """Columns a caller must supply to ``vectorise``.

    Identical to ``feature_cols`` for synthetic data, where the raw columns are
    already the model inputs. For IEEE-CIS they differ: the caller supplies raw
    columns like ``card1`` and ``ProductCD``, and the transform derives
    ``card1_freq`` and the one-hot block from them. Serving validates against
    this list, not ``feature_cols``, or it would demand fitted quantities the
    caller has no way to compute.
    """

    X_test: np.ndarray
    y_test: np.ndarray
    trigger: np.ndarray | None

    vectorise: Callable[[pd.DataFrame], np.ndarray]
    """The run's fitted raw-frame -> matrix mapping.

    Carried rather than a bare mu/sigma pair so that ``api/predict.py`` applies
    the exact arithmetic training used, including imputation and encoding.
    Reconstructing that at serving time is how training-serving skew gets in.
    """

    mu: np.ndarray
    sigma: np.ndarray
    """Standardisation statistics, for INVERTING the matrix back to readable units.

    Offline presentation only - ``scripts/export_explanations.py`` uses them to
    show an analyst an amount in currency rather than a z-score. Never score
    through these: ``X * sigma + mu`` inverts standardisation but not
    imputation or encoding, so it is a display aid, not the inverse of
    ``vectorise``. Anything that needs to turn inputs into a prediction must go
    through ``vectorise``, which is the only path that matches training.
    """


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


def _labels(df: pd.DataFrame) -> np.ndarray:
    return df["is_fraud"].to_numpy(dtype=int)


@dataclass
class _Vectoriser:
    """The fitted raw-frame -> matrix mapping, plus what callers need alongside it.

    A small object rather than a widening tuple: this already carries four
    things that must stay together, and a fifth would make every call site
    unpack positionally and get it subtly wrong.
    """

    transform: Callable[[pd.DataFrame], np.ndarray]
    input_cols: list[str]
    mu: np.ndarray
    sigma: np.ndarray


def _fit_vectoriser(
    cfg: ExperimentConfig, train_df: pd.DataFrame, feature_cols: list[str]
) -> _Vectoriser:
    """Fit the raw-frame -> model-matrix mapping on the training split.

    Holds a closure rather than a matrix, so that the test split and each client
    partition all go through the identical fitted arithmetic. Every caller
    shares one instance, which is what makes CLAUDE.md rule 7 - an identical
    feature pipeline across clients - structural instead of a convention
    someone has to remember.

    The two data sources genuinely need different preprocessing, and the split
    is drawn where it actually falls:

    - **synthetic** is already numeric with no missing values and no
      categoricals, so standardisation is the whole of it.
    - **ieee_cis** needs imputation, frequency encoding and one-hot blocks
      before it can be standardised, all of them fitted. That is
      ``FrozenTransform``, which is also what ``api/predict.py`` loads at
      serving time - one implementation, so training-serving skew has nowhere
      to enter.
    """
    if cfg.data.source == "ieee_cis":
        transform = FrozenTransform().fit(train_df)
        # Persisted keyed by config hash so a served model can be paired with
        # the exact transform it was trained against. Two runs differing only
        # in defense share a hash prefix but not a hash, so their transforms
        # never overwrite each other.
        try:
            transform.save(Path("artifacts") / f"transform_{cfg.hash()}.json")
        except OSError as exc:
            # Losing the artifact costs the serving path, not the experiment.
            print(f"  (transform not persisted: {exc})")
        input_cols = [
            *ieee_features.STATELESS_COLUMNS,
            *ieee_features.FREQUENCY_ENCODED,
            *ieee_features.ONE_HOT_VOCABULARY,
        ]
        assert transform.mu is not None and transform.sigma is not None  # just fitted
        return _Vectoriser(
            transform=transform.transform,
            input_cols=list(dict.fromkeys(input_cols)),
            mu=transform.mu,
            sigma=transform.sigma,
        )

    mu = train_df[feature_cols].to_numpy(dtype=float).mean(axis=0)
    sigma = train_df[feature_cols].to_numpy(dtype=float).std(axis=0) + 1e-9

    def vectorise(df: pd.DataFrame) -> np.ndarray:
        return (df[feature_cols].to_numpy(dtype=float) - mu) / sigma

    return _Vectoriser(
        transform=vectorise, input_cols=list(feature_cols), mu=mu, sigma=sigma
    )


def run_experiment(
    cfg: ExperimentConfig, *, ledger_path: str | Path = DEFAULT_LEDGER_PATH
) -> RunResult:
    """Run the full federated experiment described by ``cfg``.

    ``ledger_path`` is not part of ``ExperimentConfig`` deliberately - it is
    where to write output, not a parameter of the science, and baking a
    filesystem path into the hashed config would make two runs with
    identical settings hash differently just because they were pointed at
    different output locations. Every round is anchored to it as it
    completes (see the ANCHORING step below), so tests that call this
    function need their own isolated path or they will write real entries
    into the actual project ledger.
    """
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
        default_partition_column = "client_id"
    elif cfg.data.source == "ieee_cis":
        df = ieee_features.prepare(cfg.data.raw_dir)
        if cfg.data.max_rows is not None and cfg.data.max_rows < len(df):
            # Stratified on the label. A plain sample would vary the fraud rate
            # run to run at 3.5% prevalence, so a subsampled config would not be
            # comparable to the full-data one it is meant to approximate.
            df = (
                df.groupby("is_fraud", group_keys=False)
                .apply(
                    lambda g: g.sample(
                        n=max(1, round(cfg.data.max_rows * len(g) / len(df))),
                        random_state=cfg.data.seed,
                    ),
                    include_groups=True,
                )
                .reset_index(drop=True)
            )
        feature_cols = list(ieee_features.FEATURE_COLUMNS)
        default_partition_column = ieee_features.PARTITION_KEY
    else:
        raise ValueError(f"unknown data source: {cfg.data.source!r}")

    # Built here rather than below because the trigger mask has to be computed
    # on the RAW frames, before standardisation. The attack carries its own RNG
    # seeded from cfg.seed and never touches ``rng``, so moving it does not
    # perturb the split or the partition.
    attack = _build_attack(cfg)

    test_mask = rng.random(len(df)) < cfg.data.test_fraction
    test_df, train_df = df[test_mask], df[~test_mask]

    # One trigger definition, applied per split by the harness, so the
    # poisoning-time and evaluation-time notions of "triggered" cannot drift.
    # ``None`` for attacks with no trigger concept - evaluate() then reports no
    # ASR, and poison_data() ignores it.
    test_trigger = attack.trigger_mask(test_df)

    # Fit the vectoriser on the TRAINING SPLIT ONLY. Leaking test statistics
    # into a scaler or a category vocabulary is a classic silent bug that
    # inflates every number you report.
    vec = _fit_vectoriser(cfg, train_df, feature_cols)
    vectorise = vec.transform
    X_test, y_test = vectorise(test_df), _labels(test_df)

    # ---- partition -------------------------------------------------------
    if cfg.partition.strategy == "by_column":
        clients = part_mod.partition_by_column(
            train_df, cfg.partition.column or default_partition_column
        )
    elif cfg.partition.strategy == "iid":
        clients = part_mod.partition_iid(train_df, cfg.partition.n_clients, seed=cfg.seed)
    else:
        clients = part_mod.partition_dirichlet(
            train_df, cfg.partition.n_clients, alpha=cfg.partition.alpha, seed=cfg.seed
        )

    client_data = {}
    client_triggers: dict[str, np.ndarray | None] = {}
    for name, cdf in clients.items():
        client_data[name] = (vectorise(cdf), _labels(cdf))
        # Positionally aligned with the vectorised matrix: the partitioners
        # reset the index and trigger_mask reads through .to_numpy().
        client_triggers[name] = attack.trigger_mask(cdf)

    # ---- model / defense -------------------------------------------------
    model_cls = MODELS[cfg.model.name]
    model = model_cls(
        n_features=len(feature_cols),
        lr=cfg.model.lr,
        pos_weight=cfg.model.pos_weight,
        seed=cfg.seed,
    )
    global_params = model.get_params()

    malicious = set(cfg.attack.malicious_clients)

    defense = DEFENSES[cfg.defense.name](**cfg.defense.params)
    defense.reset()

    # Unlike Defense, the agent carries no mutable per-round state - it reads
    # `history` fresh on every call rather than accumulating anything on
    # `self` - so one instance safely serves every round of the run.
    agent = CoordinatorAgent(**cfg.coordinator.model_dump())

    # Same story as the agent - HashChain's state lives on disk, not on the
    # instance, so one client safely anchors every round of the run.
    blockchain_client = get_blockchain_client(ledger_path=ledger_path)
    config_hash = cfg.hash()

    history: list[AggregationDecision] = []
    result = RunResult(
        config_hash=config_hash, config=cfg.model_dump(mode="json"), git_sha=_git_sha()
    )

    # ---- federated rounds ------------------------------------------------
    for rnd in range(1, cfg.rounds + 1):
        # One state machine per round (see coordinator/state_machine.py) - it
        # is not the source of any FL math, only a replayable record of what
        # stage this round reached and why. advance()/fail() raise on an
        # illegal transition, so a bug that skips a stage fails loudly here
        # rather than producing a round with a hole in its audit trail.
        sm = RoundStateMachine(rnd)
        sm.advance("clients selected for this round")  # -> COLLECTING

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

        sm.advance(f"{len(updates)} updates collected")  # -> VALIDATING

        # Structural checks before anything statistical - shape, NaN/Inf, a
        # non-positive sample count. Not a fraud judgment; see
        # coordinator/validator.py. A defense should never have to reason
        # about whether a payload deserialised correctly.
        validations = [validate_update(u, global_params, round_num=rnd) for u in updates]
        valid_updates = [u for u, v in zip(updates, validations, strict=True) if v.passed]
        invalid = [v for v in validations if not v.passed]

        if not valid_updates:
            # Unreachable today - real local training always produces
            # well-formed float arrays - but a round with nothing left to
            # aggregate is a real failure mode worth handling correctly
            # rather than crashing the whole run. The global model simply
            # does not update this round; it is still evaluated so the
            # metrics time series has no gap at this round index.
            sm.fail(
                f"all {len(updates)} update(s) failed validation: "
                f"{[v.client_id for v in invalid]}"
            )
            model.set_params(global_params)
            ev: EvalResult = evaluate(
                y_test, model.predict_proba(X_test), trigger_mask=test_trigger
            )
            result.rounds.append(
                {
                    "round": rnd,
                    "eval": ev.to_dict(),
                    "decision": None,
                    "agent": None,
                    "agent_narrative": "",
                    "validation_failures": [v.report() for v in invalid],
                    "round_state": sm.state.value,
                    # Nothing to anchor - aggregation never ran, so there is
                    # no model update this round to record on the ledger.
                    "ledger": None,
                }
            )
            continue

        reason = (
            "all updates passed validation"
            if not invalid
            else f"dropped {len(invalid)} invalid update(s): {[v.client_id for v in invalid]}"
        )
        sm.advance(reason)  # -> AGGREGATING

        ctx = RoundContext(round_num=rnd, global_params=global_params, history=history)
        global_params, decision = defense.aggregate(valid_updates, ctx)

        sm.advance("aggregation complete")  # -> REVIEWING

        # `history` here is prior rounds only - decision for THIS round is
        # appended after review, matching exactly the call pattern
        # coordinator/agent.py's rejection-frequency window was built for.
        verdict = agent.review(decision, history)
        history.append(decision)

        sm.advance(
            "agent approved" if verdict.approved else f"agent flagged {verdict.flagged}"
        )  # -> ANCHORING

        model.set_params(global_params)
        ev: EvalResult = evaluate(y_test, model.predict_proba(X_test), trigger_mask=test_trigger)

        # Every round anchored, flagged or not - a flagged verdict is content
        # that belongs ON the ledger, not a reason to skip writing to it.
        # Only the coordinator's own review reaches this call; nothing in
        # api/ exposes a public write path, so the ledger's integrity comes
        # from being coordinator-controlled, not caller-controlled.
        entry = blockchain_client.store_model(
            config_hash=config_hash,
            round_num=rnd,
            params=global_params,
            decision=decision.to_dict(),
            verdict=verdict.to_dict(),
            eval=ev.to_dict(),
        )
        sm.advance(f"anchored as ledger entry {entry.index}")  # -> COMPLETE

        result.rounds.append(
            {
                "round": rnd,
                "eval": ev.to_dict(),
                "decision": decision.to_dict(),
                "agent": verdict.to_dict(),
                "agent_narrative": verdict.narrative,
                "validation_failures": [v.report() for v in invalid],
                "round_state": sm.state.value,
                # A pointer, not a copy: the full entry (decision/verdict/eval
                # again, self-contained on purpose) already lives in
                # ledger.jsonl, where it needs to be for independent
                # verification. Repeating it here too would just be drift risk.
                "ledger": {"index": entry.index, "entry_hash": entry.entry_hash},
            }
        )

    result.final = result.rounds[-1]["eval"] if result.rounds else None
    result.final_params = global_params
    result.eval_data = EvalData(
        feature_cols=feature_cols,
        input_cols=vec.input_cols,
        X_test=X_test,
        y_test=y_test,
        trigger=test_trigger,
        vectorise=vectorise,
        mu=vec.mu,
        sigma=vec.sigma,
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
