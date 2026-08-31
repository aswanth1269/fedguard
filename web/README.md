# FedGuard web

Two surfaces, one token system:

- `/` is the marketing page for the threat model and the results.
- `/dashboard` is the operator monitor: metrics per round, per client reputation
  or diagnostics, aggregation weights, the decision log, and SHAP attributions.

## Run it

```bash
cd web && npm install && npm run dev
```

or from the repo root, `npm run dev`.

## Where the data comes from

Nothing here is mocked, and nothing here recomputes a metric. Both pages read
JSON produced by the Python side:

```bash
fedguard run --config configs/a_fedavg_clean.yaml
fedguard run --config configs/b_fedavg_backdoor.yaml
fedguard run --config configs/c_reputation_backdoor.yaml

python scripts/export_dashboard_data.py                                    # -> public/data/runs.json
python scripts/export_explanations.py --config configs/b_fedavg_backdoor.yaml   # -> public/data/explanations.json
```

`export_dashboard_data.py` is a pure projection of `results/runs.jsonl` and is
cheap to re-run. `export_explanations.py` re-runs one config to recover the final
global model, then computes exact Shapley values over the eight raw features, so
it costs a full training run. If `explanations.json` is absent the dashboard
renders without that panel rather than failing to build.

## Conventions worth keeping

**One accent, and it is not a series colour.** The mint accent is brand chrome:
primary action, active nav, focus ring. The five categorical colours belong to
the five banks. A colour that means both "our brand" and "bank 3" means neither.

**Series colour follows the entity.** `bank_2` is the same hue in every chart on
every page, whether or not it is the malicious one that run. Filtering never
repaints the survivors.

**The palette was validated, not chosen.** The slot order comes from the
data-viz palette validator, run against both surfaces. The obvious ordering
fails: yellow beside orange measures dE 4.8 under deuteranopia, so violet
separates them. Re-run the validator before changing any series colour.

**Light mode is selected, not flipped.** Its steps were validated against the
light surface. Two of them carry a documented sub-3:1 contrast warning, and the
relief is shipped: charts with four or fewer series are direct-labelled and
every chart has a table view.

**One y axis, always.** PR-AUC, ASR and recall share a scale only because all
three are rates on the unit interval. Two measures of different scale get two
charts.

## Things that were tried and removed

**Scroll-triggered reveals.** Two implementations, both removed. A Motion
`whileInView` observer initialises after first paint, so content already on
screen sat at opacity 0 until the visitor scrolled. A CSS view-timeline version
fixed that but runs on the compositor, where painted opacity can disagree with
computed style, which breaks frame capture and print. The hero keeps a plain
mount keyframe; everything else is visible on arrival.

**A theme bootstrap script.** React 19 will not execute a `<script>` rendered
inside a component, and the resulting error takes the whole hydration pass down
with it, freezing every client component in its server-rendered state.
`next/script` renders the same tag. The default theme is decided in CSS instead,
and the toggle stamps `data-theme` on the client.
