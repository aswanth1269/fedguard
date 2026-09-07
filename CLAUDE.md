# CLAUDE.md

Project context. Read this before changing anything.

## What this is

**FedGuard** — adversarially-robust federated learning for transaction fraud
detection. Final-year project, 3 people, ~8 weeks, CPU laptops only.

- **Aswanth** (this repo): AI layer — data, models, federated learning,
  attacks, defenses, coordinator, FastAPI service.
- **Nikunj**: blockchain service (Solidity, Hardhat, Web3.py) — separate repo.
- **Alankrita**: Next.js dashboard + SHAP explainability — separate repo.

Integration is over REST. The contract lives in `docs/api.yaml` and changes
**only by PR**, with both teammates notified.

> **⚠️ THIS REPO MUST STAY PRIVATE.** A patent provisional is planned for
> ~week 6. Any public disclosure — public repo, preprint, demo, detailed post —
> becomes prior art against the applicant's own filing. See
> `docs/invention-disclosure-skeleton.md`.

## Run it

```bash
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -e ".[dev]"

pytest -q                              # fast tests, must stay green
make smoke                             # end-to-end on synthetic data, no dataset needed
fedguard skew                          # partition skew report
fedguard run --config configs/smoke.yaml
```

`make smoke` works without any dataset. The synthetic generator
(`data/synthetic.py`) deliberately includes attacker-controllable features
(amount, merchant_cat, device_type) so backdoor triggers work on it. Build and
prove behaviour on synthetic, then swap `data.source: ieee_cis`.

## The research claim

The contribution is **not** "federated learning for fraud detection" — that is
published many times over. It is:

1. **A fintech-native threat model.** Published FL poisoning work is
   overwhelmingly image classification with pixel-patch triggers, scored by
   accuracy degradation. The attack that matters here is a *typology-targeted
   backdoor*: a malicious bank makes the global model blind to **its own**
   fraud pattern. Global PR-AUC barely moves while attack success rate climbs,
   so conventional monitoring never fires.

2. **Cross-round reputation.** Krum, Trimmed Mean, Median and FLTrust are
   *stateless* — each round judged independently. A patient adversary that
   poisons intermittently is invisible to them, and under non-IID data they
   cannot separate a benign odd client from an attacker anyway. Reputation
   accumulated across rounds can.

3. **Anchoring the reputation state**, not just the model hash. That is what
   makes the blockchain load-bearing rather than decorative.

The intermittent-adversary experiment is the money experiment. Everything else
supports it.

## Rules that must not be broken

**1. Never report accuracy.** Fraud prevalence is ~3.5%; predicting "never
fraud" scores 96.5%. Report PR-AUC (headline), recall@FPR=0.1%, and attack
success rate. ROC-AUC only because reviewers expect it. All of these live in
`metrics.py` — use them, don't reimplement them.

**2. Trees cannot be federated.** FedAvg averages parameters; you cannot
average decision trees. LightGBM (`models/baseline.py`) is the **centralised
ceiling**, computed once, never federated. The MLP (`models/mlp.py`) is the
federated model. The results table needs all of: centralised GBM, centralised
MLP, FedAvg, FedAvg-under-attack, defended-under-attack.

**3. The agent's decision boundary is deterministic; only its narrative uses
an LLM.** Reversed 2026-08-31 from the original "no LLM in the accept/reject
path" — the project now wants `coordinator/agent.py` to have real authority
over a round, not just narrate a decision `defenses/` made alone. What makes
this safe for an audit trail: `CoordinatorAgent` flags clients through a
plain, versioned Python function (`AGENT_BOUNDARY_VERSION` in
`coordinator/agent.py`) over two defense-agnostic signals —
`AggregationDecision.reputation` when a defense populates it, and the
agent's own rolling count of `rejected`-list membership across
`RoundContext.history` for defenses that don't. That function, not an LLM's
free text, is what gets hashed into `AgentVerdict.to_dict()` and anchored —
a real provider swapped in for `coordinator/llm_client.py`'s stub only
changes the prose attached to a verdict (`AgentVerdict.narrative`), never
the verdict itself. Two designs were rejected for reintroducing exactly the
non-reproducibility this rule originally guarded against: letting the LLM's
response drive the threshold dynamically, and parsing the LLM's structured
output as the source of truth for approve/reject. Either makes the same
inputs capable of producing a different verdict on a different day, which
is not something you can anchor. `coordinator/state_machine.py` and
`coordinator/validator.py` stay pure Python, unchanged — they gate
structural integrity before the defense ever runs, which was never a
judgment call.

**4. Defenses must be deterministic.** `Defense.aggregate` must be a pure
function of `(updates, ctx)`. No wall-clock, no unseeded RNG, no dict-order
dependence. The decision record gets hashed and anchored on-chain; if it is
not reproducible, the anchor is worthless.

**5. Triggers are defined on RAW features.** `Attack.trigger_mask` takes the
raw DataFrame, never the standardised matrix. The harness computes the mask
once per split and passes it in, so poisoning-time and evaluation-time
definitions cannot drift. That drift is silent and invalidates results.

**6. Partition non-IID on a meaningful key.** Random splits make clients IID,
under which FedAvg trivially works and no defense is ever stressed. Use
`card4` or binned `addr1` for IEEE-CIS. Always publish the `skew_report`
table. `test_partition_is_actually_non_iid` guards this.

**7. Feature pipeline must be identical across clients.** Derive the category
vocabulary once, persist it, have every client use it. If client A one-hot
encodes a category client B never sees, their parameter vectors mean different
things at the same index and averaging is meaningless. Most likely source of a
silent catastrophic bug.

## Architecture

```
data/ ──► models/ ──► fl/ ──► defenses/ ──► coordinator/ ──► api/
                        ▲                        │
                    attacks/                     ▼
                                          clients/blockchain.py
```

Layers, by risk:
- **A (25%)** ML product: model + `/predict`. Well-trodden, must work.
- **B (35%)** Federated system: Flower clients, aggregation, coordinator.
- **C (40%)** Adversarial: attacks, defenses, evaluation. **This is the paper.**

## Conventions

- Every `Defense` accounts for every client: each `client_id` appears in
  exactly one of `accepted` / `rejected`. Weights over accepted sum to 1.0.
  Enforced by `tests/test_defense_contract.py`.
- `ClientUpdate.n_samples` is *claimed*, not verified — a client can inflate it
  for aggregation weight under FedAvg. Known open problem; be able to discuss it.
- Every run writes one JSONL line with config hash, git SHA and seed.
  `fedguard matrix` skips completed hashes, so it is interruptible.
- Never edit a config in place to "try something" — make a new file, or the
  hash stops meaning anything.
- Use `flwr.simulation` (single process) for research runs. Docker multi-node
  is for the demo only: ~10× slower, tests nothing about the contribution.

## Gotchas already hit

**Accuracy as a success criterion.** The original spec had "global model
accuracy improves after federated rounds." At 3.5% prevalence this is
satisfied by a model catching zero fraud — and the typology-targeted backdoor
is specifically designed to leave global metrics flat, so accuracy makes the
project's own attack invisible. Removed everywhere.

**Label flipping must flip POSITIVES.** Flipping "10% of rows" at 3.5%
prevalence flips overwhelmingly negatives and the attack is a near no-op.
Nothing errors; the numbers just don't move.

**Model replacement scales the DELTA.** `params - global_params`, scaled, then
added back. Scaling `params` directly scales the base model too and transmits
garbage.

**Fresh optimiser each round in the MLP.** Carrying Adam state across rounds
means each client's momentum reflects a model that no longer exists after
aggregation.

**`get_params` must return copies, not views.** The harness stores parameters
across rounds; aliasing lets local training mutate the global model.

**Scaler fit on train only.** Test statistics leaking into the scaler inflates
every reported number. `test_no_test_set_leakage_in_scaler` guards it.

**The first backdoor will be too loud.** PR-AUC craters and it looks like it
worked. It didn't — the threat model depends on the attack being invisible to
standard monitoring. Lower `poison_fraction` until PR-AUC moves a point or two
while ASR still climbs.

## Status

Done: `types.py`, `metrics.py`, `config.py`, `experiment.py`, `data/synthetic.py`,
`data/partition.py`, `models/base.py`, `models/reference.py`, `models/mlp.py`,
`models/baseline.py`, `defenses/base.py` (+FedAvg, TrimmedMean, Median, Krum,
MultiKrum, ReputationDefense), `attacks/base.py`, `attacks/backdoor.py`,
`attacks/label_flip.py`, `attacks/sign_flip.py`, trigger masks wired through
`experiment.py`, the three-act synthetic experiment (clean / backdoored /
reputation-defended), `coordinator/` (state machine, validator, LLM client,
agent — see rule 3). 66 tests passing, 1 skipped.

Next: `coordinator/` is built and tested but not wired into `experiment.py`'s
round loop yet, and has no caller. Also pending, explicitly deferred and
awaiting confirmation before starting: `api/` (FastAPI),
`coordinator/blockchain_client.py` (needs `docs/api.yaml` — a cross-team
contract, not something to draft solo), and a wider auth-service /
blockchain-service split duplicating Nikunj's repo scope inside this one.
Also still open: Docker, IEEE-CIS pipeline.

`docs/PLAN.md` has the full 8-week phase plan and definitions of done.

## Ordering rules

1. Do not start `defenses/reputation.py` until the intermittent-adversary
   experiment has *demonstrated* the baselines failing. It is meaningless
   without that comparison.
2. Do not skip the harness-vs-Flower equivalence test. Two training paths that
   silently disagree cost a week later.
3. Get a clean FedAvg baseline before touching attacks.
