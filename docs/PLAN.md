# Aswanth — AI Service Module: Role Definition and Execution Plan

**8 weeks. CPU-only laptops. Three-person team.**

---

## Part 1 — What your role actually is

Your spec describes the module accurately but flattens three things with very different risk profiles into one list. Separating them is the difference between a project that ships and one that runs out of time in week 7.

### Layer A — The ML product (low risk, must work)

Fraud model, preprocessing, `/predict`, `/model-status`. Well-trodden. If you did only this you'd have a competent-but-forgettable final-year project. **Estimated: 25% of your effort. Must be finished by week 2.**

### Layer B — The federated system (medium risk, this is the engineering story)

Bank node simulation, Flower clients, FedAvg, the coordinator service, blockchain handoff. This is what makes it an *engineering* project rather than a notebook. It's where your "I built a distributed system" interview answers come from. **Estimated: 35% of effort.**

### Layer C — The adversarial contribution (high risk, this is the paper and the patent)

**Your spec does not contain this layer at all.** It's the reason the project is worth doing, and it's completely absent from the document you wrote. **Estimated: 40% of effort.**

Your spec says the coordinator should "validate model updates" and "reject suspicious updates." Those are the right words. But there is nothing in your plan that *produces* a suspicious update. You cannot demonstrate a defense with nothing to defend against — you'd be shipping a rejection mechanism that has never rejected anything, and any examiner, reviewer or interviewer will ask "how do you know it works?" and you will have no answer.

Layer C is: implement the attacks, implement the baseline defenses, implement your reputation defense, and run the evaluation matrix that shows yours works where the baselines don't.

> **The one-sentence version of your role:** you own the AI layer, and within it you own the only part of this project that could be published.

---

## Part 2 — Conflicts in your spec that must be resolved

### ❌ Conflict 1: Accuracy — CRITICAL

Your spec lists **Accuracy** first under Evaluation Metrics, and your Success Criteria says *"Global model accuracy improves after federated rounds."*

Fraud prevalence in IEEE-CIS is ~3.5%. A model that predicts "never fraud" scores **96.5% accuracy**. Your success criterion is satisfied by a model that catches zero fraud.

Worse, accuracy will barely move across federated rounds no matter what happens, so you'd be steering the entire project by a number that carries almost no information. And the typology-targeted backdoor — the attack your research rests on — is specifically designed to leave global metrics unmoved. If accuracy is your dashboard, **your own attack is invisible to you.**

**Replace with:**

| Metric | Why |
|---|---|
| **PR-AUC (average precision)** | Headline. Correct under extreme imbalance. |
| **Recall @ FPR = 0.1%** | How fraud teams actually set operating points. Every false positive is a declined card. |
| **Attack Success Rate** | Your novelty metric. |
| **Rounds-to-detection** | For the intermittent adversary. |
| ROC-AUC | Include only because reviewers expect it. Never lead with it. |
| ~~Accuracy~~ | **Delete.** |

Revised success criterion: *"Global PR-AUC improves monotonically across federated rounds and approaches the centralised ceiling; attack success rate stays below X% under adversarial participation."*

### ❌ Conflict 2: XGBoost cannot be federated

Your stack lists "XGBoost (initial model)" and "PyTorch (optional for advanced models)." This is backwards, and the reason matters.

FedAvg averages model parameters. **You cannot average two decision trees.** XGBoost can never become your federated model, so it is not an "initial model" you later upgrade — it's a different thing entirely.

**Correct framing:**

- **XGBoost / LightGBM → centralised ceiling baseline.** One number, computed once, never federated. It tells you what you gave up for privacy.
- **PyTorch MLP → the federated model.** Not optional. It is the only model in the project that can actually be federated.

This gives you the results table that carries the whole project:

```
Centralised LightGBM   0.81 PR-AUC   ← ceiling
Centralised MLP        0.76          ← cost of model choice
FedAvg MLP (non-IID)   0.73          ← cost of federation
FedAvg under attack    0.41          ← the problem
Ours under attack      0.71          ← the contribution
```

Interview answer you now own: *"Trees beat neural nets on tabular fraud data. We used an MLP anyway because FedAvg requires parameter averaging, and we quantified exactly what that cost us rather than hiding it."*

### ❌ Conflict 3: `/predict` input schema is not implementable

```json
{"amount": 25000, "merchant": "Amazon", "location": "Delhi", "device": "Android"}
```

Three problems:

1. Your model will use ~100 engineered features. Four raw fields cannot produce them.
2. Features like `txn_count_24h` or `amount_vs_account_mean` require **account history**, which a single stateless request doesn't carry. You need either a customer/account ID the service can look up, or the caller must send precomputed features.
3. Returning `"prediction": "Fraud"` as a string discards the score. Fraud systems need the raw score to set and move thresholds; a hardcoded label makes the operating point uneditable.

Corrected contract is in Part 4.

### ⚠️ Conflict 4: Timeline says 3 weeks, you have 8

Your doc allocates Weeks 1–3 and stops. That's actually fine — Weeks 1–3 are Layers A and B. **Weeks 4–8 are Layer C**, which your doc doesn't mention. Full schedule in Part 5.

### ⚠️ Conflict 5: LangGraph in the decision path

Your spec has `agents/coordinator.py` and `agents/validator.py` as separate files — good instinct, keep it. But make the split explicit and architectural:

- `validator.py` — **deterministic**. Pure function of round inputs. No LLM. This is what accepts/rejects.
- `coordinator.py` — **deterministic state machine**. `IDLE → COLLECTING → VALIDATING → AGGREGATING → ANCHORING → PUBLISHED`.
- `summary.py` — **the only place an LLM appears**. Reads the structured decision log, writes prose. Zero authority.

You are building a system that makes security decisions about financial data. An LLM in that path is non-reproducible and non-auditable, and it breaks the "decisions are replayable from the ledger" argument that justifies the blockchain at all.

*"We deliberately kept the LLM out of the trust decision. It explains decisions; it doesn't make them."* — best interview answer in the project. Don't give it up for a LangGraph resume line.

---

## Part 3 — Merged folder structure

You now have two structures: the `fedguard` scaffold (research) and `ai-service` (serving). **Do not maintain both.** Duplicated model and feature code will drift, and you'll spend week 7 debugging why the served model scores differently from the evaluated one.

One repo, one installable package, two entry points:

```text
fedguard/
├── src/fedguard/
│   ├── types.py                 ✅ built    ClientUpdate, AggregationDecision
│   ├── metrics.py               ✅ built    PR-AUC, recall@FPR, ASR
│   ├── config.py                ✅ built    config + hashing
│   ├── experiment.py            ✅ built    research harness
│   ├── cli.py                   ✅ built
│   │
│   ├── data/
│   │   ├── synthetic.py         ✅ built    generator (dev/CI only)
│   │   ├── partition.py         ✅ built    non-IID splits + skew report
│   │   ├── loader.py            🔨 you      IEEE-CIS join
│   │   ├── features.py          🔨 you      feature engineering  ← START HERE
│   │   └── transform.py         🔨 you      frozen scaler/vocab, shared by train+serve
│   │
│   ├── models/
│   │   ├── base.py              ✅ built    Model interface
│   │   ├── reference.py         ✅ built    NumPy logreg (harness/CI)
│   │   ├── mlp.py               🔨 you      PyTorch — the federated model
│   │   └── baseline.py          🔨 you      LightGBM — the ceiling
│   │
│   ├── fl/
│   │   ├── client.py            🔨 you      Flower NumPyClient
│   │   ├── server.py            🔨 you      Flower server
│   │   └── strategy.py          🔨 you      Flower Strategy wrapping defenses/
│   │
│   ├── attacks/                             ← LAYER C (missing from your spec)
│   │   ├── base.py              ✅ built
│   │   ├── label_flip.py        🔨 you
│   │   ├── sign_flip.py         🔨 you
│   │   └── backdoor.py          🔨 you      the important one
│   │
│   ├── defenses/                            ← LAYER C
│   │   ├── base.py              ✅ built    + FedAvg
│   │   ├── krum.py              🔨 you
│   │   ├── trimmed_mean.py      🔨 you
│   │   └── reputation.py        🔨 you      YOUR CONTRIBUTION
│   │
│   ├── coordinator/                         ← your agents/
│   │   ├── state_machine.py     🔨 you      deterministic
│   │   ├── validator.py         🔨 you      deterministic — wraps defenses/
│   │   └── summary.py           🔨 you      LLM lives here and nowhere else
│   │
│   ├── clients/
│   │   └── blockchain.py        🔨 you      calls Nikunj's /store-model, /audit
│   │
│   └── api/                                 ← your app/api/
│       ├── main.py              🔨 you      FastAPI app
│       ├── prediction.py        🔨 you      POST /predict
│       ├── training.py          🔨 you      POST /train, GET /training-round
│       ├── model.py             🔨 you      GET /model-status
│       ├── agent.py             🔨 you      GET /agent-summary
│       └── mock.py              🔨 you      MOCK SERVER — build day 2
│
├── configs/          smoke.yaml ✅, matrix.yaml, attack/, defense/
├── docs/             api.yaml (OpenAPI), PLAN.md, invention-disclosure.md
├── notebooks/        EDA only. Never import from these.
├── tests/            ✅ 23 passing
├── results/          gitignored — runs.jsonl
├── saved_models/     gitignored
├── docker/           Dockerfile, docker-compose.yml
└── pyproject.toml    ✅ built
```

**Why this beats two repos:** `api/prediction.py` imports the same `data/transform.py` the training pipeline uses. Training/serving skew — where the served model gets differently-scaled features than the trained one — is the most common production ML bug in existence, and it becomes structurally impossible here.

---

## Part 4 — Corrected API contracts

Freeze these in `docs/api.yaml` **before** building behind them. Changes only by PR, and tell the other two.

### POST /predict

```jsonc
// Request
{
  "transaction_id": "txn_8891",
  "account_id": "acct_44120",        // needed for history-derived features
  "timestamp": "2026-08-19T14:32:10Z",
  "amount": 25000.0,
  "merchant_category": "5732",       // MCC code, not a brand name
  "device_type": "android",
  "location": {"country": "IN", "region": "DL"},
  "features": null                    // optional precomputed override
}

// Response
{
  "transaction_id": "txn_8891",
  "score": 0.9612,                    // raw model output — ALWAYS return this
  "decision": "review",               // "approve" | "review" | "decline"
  "risk_band": "high",
  "threshold_used": 0.83,             // which operating point produced the decision
  "model_id": "global_v5",
  "model_round": 5,
  "latency_ms": 12,
  "explanation": {                    // for Alankrita's SHAP panel
    "top_features": [
      {"feature": "amount_vs_account_mean", "contribution": 0.31},
      {"feature": "txn_count_24h",          "contribution": 0.22}
    ]
  }
}
```

Key changes from your version: raw score always returned; threshold is explicit and configurable; `model_id` and `model_round` let the dashboard show *which* model scored a transaction; explanation block is part of the contract so Alankrita isn't blocked.

### GET /model-status

```jsonc
{
  "model_id": "global_v5",
  "round": 5,
  "state": "PUBLISHED",              // coordinator state machine
  "metrics": {
    "pr_auc": 0.7312,
    "recall_at_fpr_0.001": 0.4180,
    "roc_auc": 0.9421
  },
  "participants": {"total": 5, "accepted": 4, "rejected": 1},
  "model_hash": "sha256:abc123...",
  "blockchain_tx": "0x12345",
  "updated_at": "2026-08-19T14:00:00Z"
}
```

Note `metrics` has no `accuracy` field. Deliberately.

### GET /agent-summary

```jsonc
{
  "round": 5,
  "decision_log": [                  // deterministic — the audit trail
    {"client": "bank_c", "action": "rejected", "reason": "reputation_below_threshold",
     "reputation": 0.31, "cosine_to_median": -0.42}
  ],
  "reputation": {"bank_a": 0.98, "bank_b": 0.95, "bank_c": 0.31},
  "narrative": "Round 5 excluded bank_c...",   // LLM-generated, non-authoritative
  "narrative_generated": true
}
```

`decision_log` is the truth. `narrative` is decoration. Keeping them separate in the response makes the architecture legible to anyone reading the API.

### POST /store-model → Nikunj

```jsonc
// Request
{
  "model_id": "global_v5", "round": 5,
  "model_hash": "sha256:abc123...",
  "reputation_hash": "sha256:def456...",   // ← anchor the reputation vector too
  "decision_hash": "sha256:789abc...",
  "metrics": {"pr_auc": 0.7312}
}
// Response
{"status": "success", "transaction_hash": "0x12345", "block_number": 8829}
```

**The `reputation_hash` and `decision_hash` fields are the whole reason the blockchain isn't decoration.** Anchoring only the model hash gives you nothing a checksummed S3 object wouldn't. Anchoring the *reputation state and the decisions* makes a flagged bank unable to repudiate, and makes a compromised coordinator unable to rewrite history. Tell Nikunj this — it changes his contract and it's the strongest technical-effect argument in the patent disclosure.

---

## Part 5 — The 8-week plan

### Phase 0 — Foundation (Days 1–3)

| # | Task | Done when |
|---|---|---|
| 0.1 | `git init`, push to **private** GitHub, add collaborators | Repo exists, is private |
| 0.2 | Branch protection on `main`: PR required, CI must pass | Direct push to main is blocked |
| 0.3 | Verify scaffold locally: `pip install -e ".[dev]"`, `pytest -q` | 23/23 passing on your laptop |
| 0.4 | Start IEEE-CIS download (~600MB) | CSVs in `data/raw/` |
| 0.5 | Write `docs/api.yaml` from Part 4 | Committed, both teammates have read it |
| 0.6 | **Mock server** (`api/mock.py`) — hardcoded responses, every endpoint | Alankrita can `curl` all four endpoints |

> **0.5 and 0.6 are the team's critical path, not yours.** Half a day of work that buys Alankrita and Nikunj three weeks of unblocked parallel work. Do them before touching the model.

### Phase 1 — Layer A: model and serving (Week 1 – early Week 2)

| # | Task | Done when |
|---|---|---|
| 1.1 | EDA in a notebook: fraud rate by `card4`/`addr1`, missingness, V-column redundancy | You know your partition key and it gives >1.5× fraud-rate spread |
| 1.2 | `data/loader.py` — join transaction + identity (LEFT; missingness is predictive) | Loads to a single frame |
| 1.3 | `data/features.py` — →~100 features, **schema frozen to disk** | Same input → identical vector across processes |
| 1.4 | `data/transform.py` — scaler/vocab fit on train only, persisted | Reused identically by training and serving |
| 1.5 | `models/baseline.py` — LightGBM centralised | **One number: your ceiling PR-AUC** |
| 1.6 | `models/mlp.py` — PyTorch, `get_params`/`set_params` round-trip | Round-trip test passes; `test_learning_actually_happens` passes with `model.name="mlp"` |
| 1.7 | `api/prediction.py` — real `/predict` replacing the mock | Returns real scores, p99 latency measured |

**Phase 1 gate:** you can state *"centralised LightGBM 0.XX, centralised MLP 0.XX."* Do not proceed without these two numbers.

### Phase 2 — Layer B: federated (Week 2 – Week 3)

| # | Task | Done when |
|---|---|---|
| 2.1 | Partition IEEE-CIS by your chosen key; commit `skew_report` table | Table is in `docs/` and goes in the paper |
| 2.2 | `fl/client.py` — Flower NumPyClient wrapping your MLP | One client trains locally |
| 2.3 | `fl/strategy.py` — Flower Strategy delegating to `defenses/` | Same `Defense` objects work in both harness and Flower |
| 2.4 | **Equivalence test**: direct harness vs Flower simulation, same seed | Identical PR-AUC. If not, one of them is lying to you. |
| 2.5 | Clean FedAvg baseline, 20 rounds, non-IID | PR-AUC curve rises and plateaus |
| 2.6 | IID ablation | You can quote the non-IID cost |

**Phase 2 gate:** *"Centralised 0.XX → FedAvg non-IID 0.XX."* That's the cost of federation, quantified.

### Phase 3 — Layer C: adversarial (Week 4 – Week 5) ⭐

**This is the phase your spec omits and the phase your paper depends on.**

| # | Task | Done when |
|---|---|---|
| 3.1 | `attacks/label_flip.py` | ASR moves when enabled (flip *positives*, not random rows) |
| 3.2 | `attacks/sign_flip.py` + model replacement | FedAvg visibly breaks |
| 3.3 | `attacks/backdoor.py` — trigger design | **ASR climbs while PR-AUC stays flat. This plot is your paper.** |
| 3.4 | `defenses/trimmed_mean.py`, `median.py` | Beat the loud attacks |
| 3.5 | `defenses/krum.py` | Reproduce its known non-IID weakness |
| 3.6 | **Intermittent adversary** — attacker active in a sparse round set | Baselines fail. Demonstrated, not asserted. |
| 3.7 | `defenses/reputation.py` | Detects what 3.6 showed the baselines miss |
| 3.8 | Clean-setting cost of your defense | Reported honestly even if unflattering |

**Phase 3 gate:** the five-row results table from Part 2 is filled in with real numbers.

### Phase 4 — Coordinator (Week 5 – Week 6)

| # | Task | Done when |
|---|---|---|
| 4.1 | `coordinator/state_machine.py` — deterministic FSM | Replayable from the decision log |
| 4.2 | `coordinator/validator.py` — wraps `defenses/`, no LLM | Pure function of round inputs |
| 4.3 | `clients/blockchain.py` — POST to Nikunj with all three hashes | Round anchors on-chain end-to-end |
| 4.4 | `coordinator/summary.py` — LLM narration, zero authority | Removing it changes no decision |
| 4.5 | Real `/model-status`, `/agent-summary`, `/training-round` | Mock server retired |

### Phase 5 — Experiments and integration (Week 6 – Week 7)

| # | Task | Done when |
|---|---|---|
| 5.1 | Build `configs/matrix.yaml` — attacks × defenses × 3 seeds | ~90 configs enumerated |
| 5.2 | Shard across three laptops, run overnight | `results/runs.jsonl` complete |
| 5.3 | Plots: ASR-vs-PR-AUC divergence, rounds-to-detection, clean cost | Figures ready for the paper |
| 5.4 | Integration with Alankrita + Nikunj against the real service | Full demo path works |
| 5.5 | Docker Compose: coordinator + 3 bank nodes + blockchain + frontend | `docker compose up` runs the demo |

> Use `flwr.simulation` (single process) for the matrix. Docker multi-node is for the demo only — it's ~10× slower and tests nothing about your contribution.

### Phase 6 — Write-up and buffer (Week 7 – Week 8)

Paper draft, invention disclosure `[TODO — WEEK 5]` sections filled from real results, demo rehearsal, README. **Leave week 8 genuinely free. Something will break.**

---

## Part 6 — Explicit cuts

You have 8 weeks. These are out of scope; say so out loud so nobody expects them:

- ❌ Kafka / real streaming → replay endpoint pushing historical transactions at a configurable rate. Visually identical in the demo, one day instead of two weeks.
- ❌ Differential privacy → good "future work" paragraph. Note that DP noise masks poisoned updates, which interacts interestingly with your defense.
- ❌ Secure aggregation → conflicts with inspecting updates, which your defense requires. This tension is worth one paragraph and one strong interview answer.
- ❌ Kubernetes → Docker Compose is sufficient and honest.
- ❌ Real bank data → say "simulated federation over a partitioned public dataset" plainly. Overclaiming here is the fastest way to lose credibility.

---

## Part 7 — Ordering rules

1. **Do not start `reputation.py` before Phase 3.6.** It is the interesting part and it is meaningless without a demonstrated baseline failure to point at.
2. **Do not skip the equivalence test (2.4).** Two training paths that silently disagree will cost you a week in Phase 5.
3. **Log every run from day one**, not "once experiments get serious." You'll want week-2 numbers in week 7.
4. **The API contract changes only by PR.** Silent contract drift is how three-person projects fail integration.
5. **Your first backdoor will be too loud.** PR-AUC will crater and you'll think it worked. Lower `poison_fraction` until PR-AUC moves a point or two and ASR still climbs.

---

## Part 8 — Interview questions this plan earns you

1. Why FL instead of pooling anonymized data?
2. Your MLP underperforms LightGBM — why ship it?
3. Why not accuracy?
4. What breaks first at 50 banks instead of 5?
5. How do you know a bank isn't lying about its sample count?
6. Why blockchain and not an append-only Postgres table?
7. **An update has an unusual gradient norm — attack, or just a bank with weird data?**

Question 7 separates people who built this from people who read about it. Your answer: *"Under non-IID data, benign heterogeneity and adversarial behaviour are statistically similar in any single round. That's exactly why we moved from per-round outlier detection to cross-round reputation."*
