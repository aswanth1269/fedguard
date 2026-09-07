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
| Typology-targeted backdoor raises attack success rate while global PR-AUC stays flat | ✅ **supported**, IEEE-CIS, single seed |
| Stateless defenses (Krum, Trimmed Mean, Median) fail against an intermittent adversary | ⬜ not yet tested |
| Cross-round reputation detects the intermittent adversary | ⬜ not yet tested |
| The defense costs little in the clean, no-attack setting | ⚠️ **measured, and it is not free** |

### What the runs show (IEEE-CIS, 590,540 rows, 5 banks by `card4`, 20 rounds, seed 0)

| run | defense | PR-AUC | ASR | note |
|---|---|---|---|---|
| `d_ieee_clean` | fedavg | 0.5509 | 0.5292 | control: trigger slice measured, nothing poisoned |
| `e_ieee_backdoor_fedavg` | fedavg | 0.5515 | 0.5789 | mastercard poisoning |
| `f_ieee_backdoor_reputation` | reputation | 0.5139 | 0.6992 | `use_sample_counts: false` |
| `g_ieee_reputation_weighted` | reputation | 0.5489 | 0.5911 | `use_sample_counts: true` |

**Claim 1 holds.** Under attack, PR-AUC moves +0.0006 while ASR climbs 5.0 points.
That is the whole threat model: no conventional model-quality monitor fires. The
clean control is what makes this readable, and it is why `d_ieee_clean` names the
backdoor with an empty `malicious_clients` list rather than using `attack: none`.

**Claim 4 does not hold as stated, and the reason is instructive.** Act F looked
catastrophic — worse than undefended FedAvg on both axes. The decision log says
why, and it is not the reputation mechanism failing to spot anyone: with
`use_sample_counts: false` the final weights were near-uniform (~0.20 each) where
FedAvg's tracked data volume (visa 0.6512, unknown 0.0027). On the `card4`
partition the clients differ 244:1 in size, so flat weighting hands a
rounding-error client the same influence as the largest bank. Act G isolates that
one field and recovers almost all of it. The setting was inherited from the
synthetic configs, where the generator splits rows evenly and flat weighting
costs nothing.

With weighting fixed, reputation is roughly neutral against FedAvg and slightly
worse on both axes. It never rejected anyone: reputations sat 0.59–0.65 against a
0.4 threshold, and the attacker (mastercard, 0.600) scored *higher* than an honest
bank (visa, 0.590), so the mechanism is tracking size-driven divergence rather
than adversarial behaviour.

**None of D–G speak to the actual contribution.** Every one runs
`active_rounds: all`, and cross-round reputation exists for the *intermittent*
adversary. CLAUDE.md ordering rule 1 says reputation is meaningless until the
intermittent experiment has demonstrated the baselines failing, and that
experiment has not been run. Claims 2 and 3 are open.

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
