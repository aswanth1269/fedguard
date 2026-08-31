# FedGuard

Adversarially-robust federated learning for transaction fraud detection.

> **⚠️ THIS REPOSITORY MUST REMAIN PRIVATE.**
> A patent filing is under consideration. Any public disclosure — a public repo, a preprint, a demo, a detailed post — becomes prior art against your own application. Do not make this repository public, and do not present the mechanism publicly, until the provisional is filed or the team has decided not to file. See `docs/` for the invention disclosure.

---

## What this is

A federation of banks wants a shared fraud-detection model without sharing customer data. Federated learning solves the privacy problem but introduces a new one: a malicious or compromised participant can poison the shared model.

The specific attack we care about is not "degrade the global model." It is **typology-targeted backdoor**: an adversary makes the global model blind to *their own* fraud pattern while global performance metrics barely move. Standard model-quality monitoring never fires.

FedGuard is a coordinator that detects this using **cross-round reputation** rather than per-round outlier detection, because a patient adversary who poisons intermittently is invisible to stateless defenses.

## Research claim

| Claim | Status |
|---|---|
| Typology-targeted backdoor raises attack success rate while global PR-AUC stays flat | ⬜ unproven |
| Stateless defenses (Krum, Trimmed Mean, Median) fail against an intermittent adversary | ⬜ unproven |
| Cross-round reputation detects the intermittent adversary | ⬜ unproven |
| The defense costs little in the clean, no-attack setting | ⬜ unproven |

Update this table as results land. If a row turns out false, **say so** — a negative result honestly reported is a real contribution and is far better than a quietly dropped experiment.

---

## Quickstart

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
make install
make smoke        # end-to-end run on synthetic data, no dataset needed
make test
```

`make smoke` works before you have any data. It generates synthetic transactions so the whole pipeline — partitioning, training, attack, defense, metrics — can be exercised on day one.

## Getting the data

IEEE-CIS Fraud Detection, from Kaggle (`ieee-fraud-detection`). Place the raw CSVs at:

```
data/raw/train_transaction.csv
data/raw/train_identity.csv
```

`data/` is gitignored. Never commit it — the licence does not permit redistribution.

Then:

```bash
fedguard prepare          # feature engineering -> data/processed/
fedguard partition        # non-IID split -> data/clients/
```

---

## Who writes what

This scaffold is deliberately incomplete. The files below are **yours to implement** — they are the parts you must be able to defend under interview questioning. Each has a docstring spec and a failing test that describes correct behaviour.

| Module | Owner | Status |
|---|---|---|
| `data/features.py` | Aswanth | 🔨 stub |
| `models/mlp.py` | Aswanth | 🔨 stub |
| `fl/client.py` | Aswanth | 🔨 stub |
| `fl/strategy.py` | Aswanth | 🔨 stub |
| `attacks/label_flip.py` | Aswanth | 🔨 stub |
| `attacks/sign_flip.py` | Aswanth | 🔨 stub |
| `attacks/backdoor.py` | Aswanth | 🔨 stub — **the important one** |
| `defenses/krum.py` | Aswanth | 🔨 stub |
| `defenses/trimmed_mean.py` | Aswanth | 🔨 stub |
| `defenses/reputation.py` | Aswanth | 🔨 stub — **your contribution** |
| `metrics.py` | provided | ✅ done |
| `experiment.py` | provided | ✅ done |
| `data/partition.py` | provided | ✅ done |
| `models/baseline.py` | provided | ✅ done |
| Blockchain service | Nikunj | separate repo |
| Dashboard + SHAP | Alankrita | separate repo |

Work in this order: `features` → `mlp` → `client` → `strategy` (FedAvg) → verify clean baseline → attacks → defenses → reputation.

**Do not skip ahead to `reputation.py`.** It is the interesting part, and it is meaningless without a working clean baseline to compare against.

---

## Metrics — read this before reporting any number

**Never report accuracy.** Fraud prevalence in IEEE-CIS is ~3.5%. Predicting "never fraud" scores 96.5%. Any paper reporting 99% accuracy on this task is reporting noise.

Report instead:

- **PR-AUC (average precision)** — the headline. Correct under extreme class imbalance.
- **Recall @ fixed FPR** (default 0.1%) — how fraud teams actually operate, because false positives mean declining real customers.
- **Attack success rate (ASR)** — fraction of trigger-matching fraud the global model scores as legitimate. Your novelty metric.
- **Rounds-to-detection** — for the intermittent adversary.
- **Clean-setting cost** — PR-AUC delta of the defense with no attack present. Every robust aggregator hurts benign performance under non-IID data. Reporting this makes you credible; hiding it makes you look like you didn't check.

All of these live in `metrics.py`. Use them; don't roll your own.

---

## Experiment discipline

The experiment matrix is large enough that sloppiness will cost you a week.

- Every run writes one JSON line to `results/runs.jsonl`, including the **config hash**, git SHA, and seed.
- Runs are keyed by config hash. `fedguard matrix` skips completed runs, so it is safe to interrupt and restart.
- Never edit a config in place to "try something." Make a new config file. Otherwise you cannot reproduce your own plots.
- Use `flwr.simulation` (single process) for research runs. Reserve Docker multi-node for the demo only — it is 10× slower and tests nothing about your contribution.
- Three laptops means three parallel matrix shards. See `scripts/shard.py`.

## Layout

```
src/fedguard/
├── cli.py              entry point
├── config.py           pydantic config models, config hashing
├── experiment.py       run harness, result persistence
├── metrics.py          PR-AUC, recall@FPR, ASR
├── data/
│   ├── synthetic.py    generator - lets you build before data arrives
│   ├── loader.py       IEEE-CIS loading
│   ├── features.py     STUB
│   └── partition.py    non-IID partitioning + skew report
├── models/
│   ├── mlp.py          STUB
│   └── baseline.py     LightGBM ceiling
├── fl/
│   ├── client.py       STUB
│   ├── strategy.py     STUB
│   └── simulation.py   Flower runner
├── attacks/            base.py + STUBS
└── defenses/           base.py + STUBS
```
