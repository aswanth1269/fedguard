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
adversary. DESIGN.md ordering rule 1 says reputation is meaningless until the
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

## Running the dashboard demo

```bash
pip install -e ".[dev,serve,auth]"                       # from the repo root
python -m uvicorn fedguard.api.main:app --port 8000      # terminal 1: API
cd web && npm install && npm run dev                     # terminal 2: http://localhost:3000
```

Open the dashboard and click **Initialize model**. This trains `configs/demo_mlp.yaml`
(PyTorch MLP, 3 simulated banks, reputation defense, synthetic data) in about 10
seconds. The model lives in server memory, so restart the API and you must initialize
again. Every value the live pages show comes from the API; nothing is computed or
invented in the browser.

> **Note:** each training run started from the dashboard (Initialize / Retrain) is
> recorded like any other run: one line in `results/runs.jsonl` and one ledger entry
> per round in `results/ledger.jsonl`.

### Live Fraud Monitor (`/`)

- **Model status**: which trained model is loaded, its rounds, defense and the
  model's operating threshold (the score at which only 0.1% of legitimate
  transactions are flagged).
- **Transaction feed**: *Start live transaction feed* sends demonstration
  transactions (generated, not from a real bank) to the backend, which scores each
  one with the loaded model. A row is an alert when its score reaches the model's
  operating threshold.
- **Inference playground**: six sliders (amount, hour, IP risk index, account age,
  distance, 24h velocity) and three presets. *Run Global Model Inference* sends the
  current values to `POST /predict`.
  - **Decision rule**: the playground labels a score **Likely Fraud** at 50% or
    more and **Not Likely Fraud** below that. This rule is for the playground only;
    the feed keeps the model's own threshold.
  - **Inputs**: distance becomes the model's cross-border flag (500 km or more).
    IP risk index is *not* a model input, so it does not change the score.
  - **Results**: a failed request shows an error, never an old or estimated score.
    Changing an input after a result marks that result as belonging to the
    previous inputs.
- **Explainable AI**: "Why this transaction received this score" explains each real
  score with **exact Shapley values (SHAP)** of the model's probability output.
  - **Calculation**: all 2^8 combinations of the 8 model inputs are evaluated
    against 100 fixed background transactions from the run's evaluation data
    (`src/fedguard/api/explain.py`). The results match the `shap` library's exact
    explainer (see `tests/test_explain.py`).
  - **Units**: contributions are percentage points of fraud probability and add up
    to the score minus the baseline. The page shows the top factors that raised and
    lowered the score.
  - **Meaning**: they describe how the model's score moved, not what causes fraud.

### Banks & Federated Training (`/banks`)

- **Bank cards**: identity key, local training rows, accepted/rejected rounds,
  latest model-update version and hash.
- **Submit a bank contribution**: retrain locally, upload a model-update `.npz`, or
  register a dataset `.csv`. The server signs as the selected simulated bank (the
  browser never holds a key), then every submission goes through the same checks:
  1. **Identity**: is the key enrolled?
  2. **Signature**: does the Ed25519 signature verify?
  3. **Authorization**: may this bank submit this type, for itself?
  4. **Format and architecture**: names, shapes and dtypes match the global model,
     and there are no NaN/Inf values.
  5. **Integrity**: is this a new version, or a duplicate of the previous one?
  6. **Model behaviour**: the update's direction is screened against the other
     banks' updates.
- **CLI**: enrol another bank with
  `python -m fedguard.cli bank add bank_3 --name "Bank D"`.

### Integrity & Audit (`/integrity`)

- **Version history**: every bank update, global model and registered dataset is
  stored with its full SHA-256 hash, signer, version and decision. Old versions are
  never overwritten, and the registry is hash-linked, so editing a past record is
  detected.
- **Check an artifact**: *Select Artifact*, then *Test Integrity* (change a value in
  a temporary copy on the server) or *Check my file* (upload a `.npz`/`.csv`). The
  page shows the trusted and recalculated hashes side by side: Integrity Verified or
  Integrity Failure. The stored artifact is never modified.
- **Round ledger**: the local hash-chain ledger of training rounds. Blockchain
  anchoring is off unless `FEDGUARD_LEDGER_BACKEND=web3` is set and a node is
  running (`blockchain/README.md`); the page says so rather than claiming
  on-chain status.

### Research (`/research`)

Recorded IEEE-CIS experiment results (the table above), a round-by-round explorer
(PR-AUC, recall, ASR, reputation and aggregation weights) and a replay of the
mastercard backdoor run. These are historical results exported to
`web/public/data/` and do not change when you use the live demo.

### Where integrity data is kept

`results/artifact_registry.jsonl`, `artifacts/store/` and `keys/` are all gitignored.
`keys/` holds the trusted public keys **and the simulated banks' private keys**:
never commit it.

### API

The full contract is `docs/api.yaml` (a test fails if it drifts from the app). Main routes:

| Route | Purpose |
|---|---|
| `GET /health`, `GET /model-status` | API and loaded-model status |
| `POST /demo/warmup`, `POST /train` | train the demo model / a given config |
| `POST /predict` | score one transaction with the loaded model |
| `POST /explain` | exact Shapley-value explanation of that score |
| `POST /demo/transactions`, `GET /transactions` | demonstration transaction feed |
| `GET /banks` | bank status |
| `POST /demo/bank-signer/model-update`, `POST /demo/bank-signer/upload` | simulated-bank submissions |
| `POST /artifacts/submit` | externally signed submission |
| `GET /artifacts`, `POST /artifacts/{seq}/verify`, `GET /artifacts/{seq}/download` | registry, integrity check, download |
| `GET /integrity/status`, `GET /ledger`, `GET /verify` | registry/ledger status and verification |

### Tests

```bash
pytest                        # backend (uses temp folders; never touches results/)
cd web && npm run lint && npm test && npm run build
```

`npm test` runs the playground's unit tests (`web/tests/playground.test.mjs`) with
Node's built-in test runner. It needs Node 22.18 or newer, and no extra packages.

### Known limitations

- **Synthetic demo**: the live demo uses synthetic data and simulated banks whose
  keys the server holds. It is not connected to any real banking system.
- **Explanations**: only for models whose inputs map one-to-one onto model columns
  (the synthetic demo model). Values are relative to the chosen background sample.
- **Reputation defense**: in the recorded runs it did **not** reduce the backdoor's
  success rate and never rejected the attacker (see the results above).
- **Statistics**: every recorded result is a single seed.

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

## What is implemented

| Area | Modules |
|---|---|
| Data | `data/synthetic.py`, `loader.py`, `features.py`, `transform.py`, `partition.py` |
| Models | `models/mlp.py` (PyTorch MLP), `reference.py`, `baseline.py` (LightGBM ceiling) |
| Attacks | `attacks/backdoor.py` (typology-targeted), `label_flip.py`, `sign_flip.py` |
| Defenses | `defenses/reputation.py` (cross-round), `krum.py`, `trimmed_mean.py` |
| Coordinator | `coordinator/validator.py`, `agent.py`, `state_machine.py`, ledger/blockchain clients |
| Integrity | `artifacts/hashing.py`, `signing.py` (Ed25519), `registry.py`, `validation.py`, `service.py` |
| Serving | `api/main.py`, `predict.py`, `explain.py` (SHAP), `feed.py`, `jobs.py` |
| Dashboard | `web/` (Next.js 16, React 19) |

Still open on the research side: the intermittent-adversary experiment (claims 2 and 3).

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
├── cli.py              entry point (run, matrix, bank add/list, ...)
├── config.py           pydantic config models, config hashing
├── experiment.py       run harness, result persistence
├── metrics.py          PR-AUC, recall@FPR, ASR
├── data/               synthetic generator, IEEE-CIS loading, features, partitioning
├── models/             mlp.py, reference.py, baseline.py
├── attacks/            backdoor, label flip, sign flip
├── defenses/           reputation, krum, trimmed mean
├── coordinator/        validator, agent, state machine, ledger/web3 clients
├── ledger/             hash-chain ledger
├── artifacts/          hashing, Ed25519 signing, versioned registry, decision engine
└── api/                FastAPI app, prediction, SHAP explanations, demo feed
web/                    Next.js dashboard (Live Fraud Monitor, Banks, Integrity, Research)
blockchain/             optional Solidity anchor contract (Hardhat)
configs/                experiment configs, including demo_mlp.yaml
docs/api.yaml           API contract
```
