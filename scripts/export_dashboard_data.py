"""Export run records for the web dashboard.

Reads results/runs.jsonl (written by `fedguard run`) and flattens it into one
JSON file the Next.js app can import statically. No training happens here - this
is a pure projection of records that already exist, so it is cheap to re-run
after every experiment.

The dashboard is a *view* of the decision log, never a source of truth. Nothing
here recomputes a metric: if a number is on the screen, `metrics.py` produced it
and the run record carries it.

    python scripts/export_dashboard_data.py
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "results" / "runs.jsonl"
OUT = ROOT / "web" / "public" / "data" / "runs.json"


def load_records(path: Path, *, include_synthetic: bool = False) -> list[dict]:
    """Last record wins per config hash - a re-run supersedes its predecessor.

    Synthetic runs are excluded by default. The generator exists so CI and the
    test suite can exercise the whole pipeline without a 700 MB download, which
    is a good reason for it to exist and a bad reason to put its numbers on a
    dashboard. data/synthetic.py says so itself: "Never report a number from
    synthetic data in the paper." A chart does not get a different rule.

    ``--include-synthetic`` is kept for debugging the harness against a run that
    takes seconds instead of ten minutes.
    """
    by_hash: dict[str, dict] = {}
    skipped = 0
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            if not include_synthetic and rec["config"]["data"]["source"] == "synthetic":
                skipped += 1
                continue
            by_hash[rec["config_hash"]] = rec
    if skipped:
        print(f"  (skipped {skipped} synthetic run record(s); pass --include-synthetic to keep)")
    return list(by_hash.values())


def split_diagnostic(key: str) -> tuple[str, str | None]:
    """`norm/bank_2` -> ("norm", "bank_2"); `fallback` -> ("fallback", None)."""
    if "/" in key:
        metric, client = key.split("/", 1)
        return metric, client
    return key, None


def project(rec: dict) -> dict:
    cfg = rec["config"]
    rounds = rec["rounds"]

    clients = sorted(
        {c for r in rounds for c in r["decision"]["accepted"] + r["decision"]["rejected"]}
    )

    series = []
    for r in rounds:
        ev, dec = r["eval"], r["decision"]
        series.append(
            {
                "round": r["round"],
                "prAuc": ev["pr_auc"],
                "rocAuc": ev["roc_auc"],
                "recallAt001": ev["recall_at_fpr"].get("0.001"),
                "recallAt01": ev["recall_at_fpr"].get("0.01"),
                "asr": ev["asr"],
                "threshold": ev["threshold"],
                "accepted": dec["accepted"],
                "rejected": dec["rejected"],
                "weights": dec["weights"],
                "reputation": dec["reputation"],
            }
        )

    # Per-client, per-metric time series pulled out of the diagnostics bag so the
    # UI does not have to know which defense wrote which key.
    diagnostics: dict[str, dict[str, list[float | None]]] = defaultdict(
        lambda: defaultdict(lambda: [None] * len(rounds))
    )
    for i, r in enumerate(rounds):
        for key, value in r["decision"]["diagnostics"].items():
            metric, client = split_diagnostic(key)
            diagnostics[metric][client or "_global"][i] = value

    return {
        "id": cfg["name"],
        "hash": rec["config_hash"],
        "label": cfg["name"],
        "rounds": cfg["rounds"],
        "seed": cfg["seed"],
        "durationS": rec["duration_s"],
        "data": {
            "source": cfg["data"]["source"],
            # n_rows is how many rows to GENERATE and is meaningless for a fixed
            # dataset, where it sits at its default and describes nothing. The
            # counts a reader actually wants are the evaluated ones, and those
            # come from the run's own eval rather than from config.
            "nRows": cfg["data"]["n_rows"],
            "maxRows": cfg["data"].get("max_rows"),
            "testFraction": cfg["data"]["test_fraction"],
            "nTest": (rec.get("final") or {}).get("n_samples"),
            "nPositive": (rec.get("final") or {}).get("n_positive"),
        },
        "partition": cfg["partition"],
        "model": cfg["model"],
        "attack": cfg["attack"],
        "defense": cfg["defense"],
        "clients": clients,
        "series": series,
        "diagnostics": {m: dict(v) for m, v in diagnostics.items()},
        "final": rec["final"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--include-synthetic",
        action="store_true",
        help="keep synthetic runs (debugging only; never for reported numbers)",
    )
    args = parser.parse_args()

    if not RUNS.exists():
        print(f"no run records at {RUNS} - run `fedguard run --config ...` first", file=sys.stderr)
        return 1

    records = load_records(RUNS, include_synthetic=args.include_synthetic)
    if not records:
        print(
            "no real-data run records found. The dashboard reads measured runs only.\n"
            "    fedguard run --config configs/d_ieee_clean.yaml",
            file=sys.stderr,
        )
        return 1

    runs = [project(rec) for rec in records]
    runs.sort(key=lambda r: r["label"])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"runs": runs}, indent=2), encoding="utf-8")

    print(f"wrote {OUT.relative_to(ROOT)}  ({len(runs)} runs)")
    for r in runs:
        final = r["final"] or {}
        asr = final.get("asr")
        asr_text = "n/a" if asr is None else f"{asr:.4f}"
        print(
            f"  {r['label']:<24} attack={r['attack']['name']:<9} "
            f"defense={r['defense']['name']:<11} "
            f"PR-AUC={final.get('pr_auc', float('nan')):.4f}  ASR={asr_text}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
