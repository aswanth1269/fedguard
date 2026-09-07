"""Non-IID partitioning of a transaction table across simulated banks.

THE most important methodological decision in the project.

Most student FL projects split the data randomly. That produces IID clients,
under which FedAvg trivially works, no defense is ever stressed, and there is
nothing to study. Reviewers spot a random split immediately and it invalidates
the whole result.

Partition on a semantically meaningful key instead, so clients differ the way
real banks differ.

For IEEE-CIS:
  - ``card4`` (Visa / Mastercard / Amex / Discover) - four naturally distinct
    populations. Clean, defensible, but only four clients.
  - ``addr1`` binned into regions - more clients, simulates regional banks.
  - ``ProductCD`` - product-line split.

Always report the resulting skew (``skew_report``) in the paper. Reviewers
want to see how non-IID your setting actually is, and "we partitioned by card
network" without numbers is not evidence.

Run an IID partition as an ablation. The gap between IID and non-IID
performance is a free result and a good interview story.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

__all__ = ["partition_by_column", "partition_dirichlet", "partition_iid", "skew_report"]


def partition_by_column(
    df: pd.DataFrame, column: str, min_rows: int = 500
) -> dict[str, pd.DataFrame]:
    """Partition on a categorical column. The preferred approach - semantically
    meaningful and trivial to justify.

    Groups smaller than ``min_rows`` are merged into an ``other`` client rather
    than becoming degenerate participants.
    """
    if column not in df.columns:
        raise KeyError(f"{column!r} not in dataframe; available: {list(df.columns)[:20]}")

    groups = {str(k): g.reset_index(drop=True) for k, g in df.groupby(column, dropna=False)}
    small = [k for k, g in groups.items() if len(g) < min_rows]
    if small:
        merged = pd.concat([groups.pop(k) for k in small], ignore_index=True)
        if len(merged) >= min_rows:
            groups["other"] = merged
    return groups


def partition_dirichlet(
    df: pd.DataFrame,
    n_clients: int,
    alpha: float = 0.5,
    label_col: str = "is_fraud",
    seed: int = 0,
) -> dict[str, pd.DataFrame]:
    """Label-skew partition via a Dirichlet prior - the standard synthetic
    non-IID protocol in the FL literature.

    ``alpha`` controls skew: small (0.1) = extreme, large (100) = near-IID.
    Useful as a controllable knob for an ablation sweeping IID -> extreme, and
    it lets you compare against published results that use the same protocol.

    Prefer ``partition_by_column`` for your headline results - a real key is
    more defensible than a synthetic one.
    """
    rng = np.random.default_rng(seed)
    clients: dict[str, list[pd.DataFrame]] = {f"bank_{i}": [] for i in range(n_clients)}

    for label in sorted(df[label_col].unique()):
        subset = df[df[label_col] == label].sample(frac=1.0, random_state=seed)
        proportions = rng.dirichlet(np.repeat(alpha, n_clients))
        cuts = (np.cumsum(proportions) * len(subset)).astype(int)[:-1]
        for i, part in enumerate(np.split(subset, cuts)):
            clients[f"bank_{i}"].append(part)

    return {
        k: pd.concat(v, ignore_index=True)
        .sample(frac=1.0, random_state=seed)
        .reset_index(drop=True)
        for k, v in clients.items()
    }


def partition_iid(df: pd.DataFrame, n_clients: int, seed: int = 0) -> dict[str, pd.DataFrame]:
    """Random equal split. ABLATION ONLY.

    Do not use this for your main results. It exists so you can quantify how
    much the non-IID setting costs you, which is a result worth having.
    """
    shuffled = df.sample(frac=1.0, random_state=seed).reset_index(drop=True)
    # Index-based split rather than np.array_split on the frame itself, which
    # routes through a deprecated pandas path.
    bounds = np.linspace(0, len(shuffled), n_clients + 1).astype(int)
    return {
        f"bank_{i}": shuffled.iloc[bounds[i] : bounds[i + 1]].reset_index(drop=True)
        for i in range(n_clients)
    }


def skew_report(clients: dict[str, pd.DataFrame], label_col: str = "is_fraud") -> pd.DataFrame:
    """Per-client size and fraud rate. Put this table in the paper.

    If fraud rates are nearly identical across clients, your partition is
    effectively IID and you have not built the setting you claim to study.
    Check this before running anything expensive.
    """
    rows = [
        {
            "client": name,
            "n_rows": len(g),
            "n_fraud": int(g[label_col].sum()),
            "fraud_rate": float(g[label_col].mean()),
        }
        for name, g in sorted(clients.items())
    ]
    report = pd.DataFrame(rows)
    report["fraud_rate_ratio"] = report["fraud_rate"] / report["fraud_rate"].mean()
    return report
