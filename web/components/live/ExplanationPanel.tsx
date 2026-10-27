"use client";

import { TrendDown, TrendUp } from "@phosphor-icons/react";
import {
  FEATURE_INFO,
  UNUSED_CONTROLS,
  formatProbability,
  summarize,
  type Contribution,
  type InferenceOutcome,
  type ModelFeatures,
} from "@/lib/playground";

const info = (f: string) =>
  FEATURE_INFO[f as keyof ModelFeatures] ?? { label: f, role: "fixed" as const, note: "model input" };

function formatValue(feature: string, v: number): string {
  if (feature === "amount") return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (feature === "hour") return `${v}:00`;
  if (feature === "account_age_days") return `${v} days`;
  if (feature === "txn_count_24h") return `${v} txs`;
  if (feature === "is_foreign") return v === 1 ? "yes" : "no";
  return String(Number(v.toFixed(2)));
}

/** Signed percentage points of fraud probability. */
const pp = (c: number) => `${c >= 0 ? "+" : "−"}${Math.abs(c * 100).toFixed(1)} pts`;

function FactorRow({ c, max }: { c: Contribution; max: number }) {
  const up = c.contribution >= 0;
  const i = info(c.feature);
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="text-[var(--ink-primary)]">
          {i.label} <span className="font-mono text-[var(--ink-secondary)]">= {formatValue(c.feature, c.value)}</span>
          <span className="block text-[11px] text-[var(--ink-muted)]">{i.note}</span>
        </span>
        <span className={`font-mono shrink-0 ${up ? "text-[var(--status-critical)]" : "text-[var(--status-good)]"}`}>
          {pp(c.contribution)}
        </span>
      </div>
      <div className="h-1.5 rounded bg-[var(--glass-subtle)]">
        <div
          className={`h-full rounded ${up ? "bg-[var(--status-critical)]" : "bg-[var(--status-good)]"}`}
          style={{ width: `${(Math.abs(c.contribution) / max) * 100}%` }}
        />
      </div>
    </li>
  );
}

export function ExplanationPanel({ outcome, stale }: { outcome: InferenceOutcome | null; stale: boolean }) {
  return (
    <div className="space-y-4 border-t border-[var(--glass-border)] pt-6" id="explanation">
      <h4 className="text-base font-bold text-[var(--ink-primary)]">Why this transaction received this score</h4>
      {outcome === null && (
        <p className="text-[13px] text-[var(--ink-muted)]">Run inference on a transaction first.</p>
      )}
      {outcome?.kind === "error" && (
        <p className="text-[13px] text-[var(--ink-muted)]">No explanation, because inference failed.</p>
      )}
      {outcome?.kind === "ok" && <Body outcome={outcome} stale={stale} />}
    </div>
  );
}

function Body({ outcome, stale }: { outcome: Extract<InferenceOutcome, { kind: "ok" }>; stale: boolean }) {
  const { prediction, explanation } = outcome;
  const likely = prediction.decision === "Likely Fraud";

  return (
    <div className={`space-y-4 ${stale ? "opacity-50" : ""}`}>
      <dl className="flex flex-wrap gap-x-8 gap-y-1 text-[13px]">
        <div className="flex gap-1.5">
          <dt className="text-[var(--ink-muted)]">Fraud probability:</dt>
          <dd className="font-mono font-semibold text-[var(--ink-primary)]">{formatProbability(prediction.probability)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-[var(--ink-muted)]">Playground decision:</dt>
          <dd className={`font-semibold ${likely ? "text-[var(--status-critical)]" : "text-[var(--status-good)]"}`}>
            {prediction.decision}
          </dd>
        </div>
        {explanation.kind === "ready" && (
          <div className="flex gap-1.5">
            <dt className="text-[var(--ink-muted)]">Baseline:</dt>
            <dd className="font-mono text-[var(--ink-primary)]">{formatProbability(explanation.baseValue)}</dd>
          </div>
        )}
      </dl>

      {explanation.kind === "unavailable" ? (
        <p className="text-[13px] text-[var(--status-warning)]">
          Explanation unavailable ({explanation.reason}). The score above is unaffected.
        </p>
      ) : (
        <Factors prediction={prediction} explanation={explanation} />
      )}
    </div>
  );
}

function Factors({
  prediction,
  explanation,
}: {
  prediction: Extract<InferenceOutcome, { kind: "ok" }>["prediction"];
  explanation: Extract<Extract<InferenceOutcome, { kind: "ok" }>["explanation"], { kind: "ready" }>;
}) {
  const rows = explanation.contributions;
  const max = Math.max(...rows.map((r) => Math.abs(r.contribution)), 1e-9);
  const up = rows.filter((r) => r.contribution > 0).sort((a, b) => b.contribution - a.contribution);
  const down = rows.filter((r) => r.contribution < 0).sort((a, b) => a.contribution - b.contribution);
  const rest = [...up.slice(3), ...down.slice(3), ...rows.filter((r) => r.contribution === 0)];
  const total = rows.reduce((s, r) => s + r.contribution, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--status-critical)] mb-2">
            <TrendUp size={15} weight="bold" /> Raised the score
          </div>
          {up.length ? (
            <ul className="space-y-3">{up.slice(0, 3).map((c) => <FactorRow key={c.feature} c={c} max={max} />)}</ul>
          ) : (
            <p className="text-[12px] text-[var(--ink-muted)]">Nothing raised the score above the baseline.</p>
          )}
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--status-good)] mb-2">
            <TrendDown size={15} weight="bold" /> Lowered the score
          </div>
          {down.length ? (
            <ul className="space-y-3">{down.slice(0, 3).map((c) => <FactorRow key={c.feature} c={c} max={max} />)}</ul>
          ) : (
            <p className="text-[12px] text-[var(--ink-muted)]">Nothing lowered the score below the baseline.</p>
          )}
        </div>
      </div>

      {rest.length > 0 && (
        <details className="text-[12.5px]">
          <summary className="cursor-pointer text-[var(--ink-secondary)]">Other factors ({rest.length})</summary>
          <ul className="space-y-3 mt-3 md:w-1/2">{rest.map((c) => <FactorRow key={c.feature} c={c} max={max} />)}</ul>
        </details>
      )}

      <p className="text-[13px] text-[var(--ink-secondary)] leading-relaxed">{summarize(prediction, explanation)}</p>

      <p className="text-[11.5px] text-[var(--ink-muted)] leading-relaxed">
        Contributions are in percentage points of fraud probability: baseline {formatProbability(explanation.baseValue)}{" "}
        {total >= 0 ? "+" : "−"} {Math.abs(total * 100).toFixed(1)} pts = {formatProbability(prediction.probability)}. The
        baseline is the model&apos;s average score over {explanation.backgroundSize} transactions from its evaluation data.
        They show how each input moved this model&apos;s score, not proof that the transaction is fraudulent.{" "}
        {UNUSED_CONTROLS.join(", ")} is not a model input, so it has no effect on the score.
      </p>
    </div>
  );
}
