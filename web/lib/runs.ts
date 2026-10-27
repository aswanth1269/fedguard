/**
 * Run records data structures and utilities for FedGuard.
 * Provides typed access to experimental data exported from the Python harness.
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
    nRows: number;
    maxRows: number | null;
    testFraction: number;
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
  model: {
    name: string;
    hidden?: number[];
    lr: number;
    pos_weight: number;
    local_epochs: number;
  };
  attack: {
    name: string;
    malicious_clients: string[];
    active_rounds: string | number[];
    params: Record<string, number | string>;
  };
  defense: {
    name: string;
    params: Record<string, number | boolean>;
  };
  clients: string[];
  series: RoundPoint[];
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

export type RunsFile = {
  runs: RunRecord[];
};

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

export function runSummary(run: RunRecord): string {
  if (run.attack.name === "none") return `Clean Baseline / ${run.defense.name.toUpperCase()}`;
  const fraction = run.attack.params?.poison_fraction;
  const strength = typeof fraction === "number" ? ` (${(fraction * 100).toFixed(0)}% poison)` : "";
  return `${run.attack.name.toUpperCase()}${strength} / ${run.defense.name.toUpperCase()}`;
}

export function fmt(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US");
}

export function fmtCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "$0.00";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
}
