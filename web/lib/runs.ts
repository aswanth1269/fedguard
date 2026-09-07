/**
 * Run records, as produced by the Python harness.
 *
 * `public/data/runs.json` is written by `scripts/export_dashboard_data.py`,
 * which is a pure projection of `results/runs.jsonl`. Nothing in this file
 * recomputes a metric: every number on screen was produced by `metrics.py` and
 * carried through the run record. The dashboard is a view of the decision log,
 * never a second source of truth.
 */

export type RoundPoint = {
  round: number;
  prAuc: number;
  rocAuc: number;
  recallAt001: number | null;
  recallAt01: number | null;
  asr: number | null;
  threshold: number | null;
  accepted: string[];
  rejected: string[];
  weights: Record<string, number>;
  reputation: Record<string, number>;
};

export type RunRecord = {
  id: string;
  hash: string;
  label: string;
  rounds: number;
  seed: number;
  durationS: number;
  data: {
    source: string;
    /** Rows to GENERATE. Synthetic only; meaningless for a fixed dataset. */
    nRows: number;
    maxRows: number | null;
    testFraction: number;
    /** Rows actually evaluated, from the run's own eval. Use this in copy. */
    nTest: number;
    nPositive: number;
  };
  partition: {
    strategy: string;
    n_clients: number;
    column: string | null;
    alpha: number;
    non_iid: number;
  };
  model: { name: string; lr: number; pos_weight: number; local_epochs: number };
  attack: {
    name: string;
    malicious_clients: string[];
    active_rounds: string | number[];
    params: Record<string, number | string>;
  };
  defense: { name: string; params: Record<string, number | boolean> };
  clients: string[];
  series: RoundPoint[];
  /** metric -> client (or "_global") -> one value per round */
  diagnostics: Record<string, Record<string, (number | null)[]>>;
  final: {
    pr_auc: number;
    roc_auc: number;
    recall_at_fpr: Record<string, number>;
    asr: number | null;
    threshold: number | null;
    n_samples: number;
    n_positive: number;
  } | null;
};

export type RunsFile = { runs: RunRecord[] };

/** Colour follows the entity, never its rank: bank_2 is violet in every chart
 *  on every page, whether or not it is the one under suspicion. */
export const SERIES_VAR = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
] as const;

export function clientColor(clients: string[], id: string): string {
  const i = clients.indexOf(id);
  return SERIES_VAR[i >= 0 ? i % SERIES_VAR.length : 0];
}

export function isMalicious(run: RunRecord, clientId: string): boolean {
  return run.attack.malicious_clients.includes(clientId);
}

/** Short human label for a run, e.g. "backdoor 0.8 / reputation".
 *
 *  The poison fraction is part of the label because the same attack and defense
 *  pair gets run at several strengths, and a legend with two entries reading
 *  "backdoor / fedavg" identifies nothing. */
export function runSummary(run: RunRecord): string {
  if (run.attack.name === "none") return `no attack / ${run.defense.name}`;
  const fraction = run.attack.params?.poison_fraction;
  const strength = typeof fraction === "number" ? ` ${fraction}` : "";
  return `${run.attack.name}${strength} / ${run.defense.name}`;
}

export function fmt(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return value.toFixed(digits);
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

export function fmtInt(value: number): string {
  return value.toLocaleString("en-US");
}
