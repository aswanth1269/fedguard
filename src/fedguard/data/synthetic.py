"""Synthetic transaction generator.

Exists so the entire pipeline - partitioning, training, attacks, defenses,
metrics - can be built and tested before the IEEE-CIS download finishes, and
so CI can run without shipping a dataset.

Design goals, in order:
  1. Realistic class imbalance (~3.5% fraud, matching IEEE-CIS).
  2. Attacker-controllable categorical features (merchant category, device
     type) and a continuous amount, so a realistic backdoor trigger can be
     defined over them.
  3. Genuine non-IID structure across clients - different fraud base rates and
     different feature-conditional distributions. If clients were IID the
     whole project would be pointless, and a synthetic generator that produces
     IID data would hide exactly the failure mode you are studying.

This is NOT a substitute for real data in results. Never report a number from
synthetic data in the paper.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

__all__ = ["FEATURE_COLUMNS", "generate"]

N_MERCHANT_CATEGORIES = 12
N_DEVICE_TYPES = 5

FEATURE_COLUMNS = [
    "amount",
    "hour",
    "merchant_cat",
    "device_type",
    "account_age_days",
    "txn_count_24h",
    "amount_zscore",
    "is_foreign",
]


def generate(
    n: int = 20_000,
    n_clients: int = 5,
    fraud_rate: float = 0.035,
    non_iid: float = 0.7,
    seed: int = 0,
) -> pd.DataFrame:
    """Generate a synthetic transaction table.

    Args:
        n: total rows across all clients.
        n_clients: number of simulated banks.
        fraud_rate: overall positive rate.
        non_iid: 0.0 = clients identically distributed, 1.0 = strongly skewed
            fraud rates and merchant mixes. Run your experiments at both ends;
            the gap between them is a paper figure on its own.
        seed: RNG seed. Always set it, always log it.

    Returns:
        DataFrame with FEATURE_COLUMNS plus ``is_fraud`` and ``client_id``.
    """
    rng = np.random.default_rng(seed)
    rows_per_client = n // n_clients

    # Per-client fraud rate multipliers. At non_iid=0 every client is average.
    skew = rng.lognormal(mean=0.0, sigma=non_iid, size=n_clients)
    skew = skew / skew.mean()

    frames = []
    for c in range(n_clients):
        m = rows_per_client
        client_fraud_rate = float(np.clip(fraud_rate * skew[c], 0.002, 0.30))

        y = (rng.random(m) < client_fraud_rate).astype(int)

        # Each client favours a different subset of merchant categories.
        cat_prefs = rng.dirichlet(np.ones(N_MERCHANT_CATEGORIES) * (1.0 / max(non_iid, 0.05)))
        merchant_cat = rng.choice(N_MERCHANT_CATEGORIES, size=m, p=cat_prefs)

        device_type = rng.integers(0, N_DEVICE_TYPES, size=m)

        # Fraud skews toward higher amounts and odd hours, with overlap - the
        # signal must be learnable but not trivially separable.
        base_amount = rng.lognormal(mean=3.2, sigma=1.1, size=m)
        amount = base_amount * np.where(y == 1, rng.uniform(1.2, 3.5, size=m), 1.0)

        hour = np.where(
            y == 1,
            rng.choice([0, 1, 2, 3, 4, 23], size=m),
            rng.integers(6, 23, size=m),
        )
        # Overlap: 40% of fraud occurs at ordinary hours.
        ordinary = (y == 1) & (rng.random(m) < 0.4)
        hour[ordinary] = rng.integers(6, 23, size=int(ordinary.sum()))

        account_age = rng.exponential(scale=400, size=m) * np.where(y == 1, 0.4, 1.0)
        txn_count_24h = rng.poisson(lam=np.where(y == 1, 6.0, 2.5), size=m)
        amount_z = (amount - amount.mean()) / (amount.std() + 1e-9)
        is_foreign = (rng.random(m) < np.where(y == 1, 0.25, 0.06)).astype(int)

        frames.append(
            pd.DataFrame(
                {
                    "amount": amount,
                    "hour": hour,
                    "merchant_cat": merchant_cat,
                    "device_type": device_type,
                    "account_age_days": account_age,
                    "txn_count_24h": txn_count_24h,
                    "amount_zscore": amount_z,
                    "is_foreign": is_foreign,
                    "is_fraud": y,
                    "client_id": f"bank_{c}",
                }
            )
        )

    df = pd.concat(frames, ignore_index=True)
    return df.sample(frac=1.0, random_state=seed).reset_index(drop=True)
