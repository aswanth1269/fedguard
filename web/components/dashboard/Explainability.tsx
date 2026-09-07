"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";

export type Explanations = {
  run: { id: string; hash: string; attack: string; defense: string; model: string };
  featureNames: string[];
  baseValue: number;
  nExplained: number;
  nBackground: number;
  globalMeanAbsShap: number[];
  groups: Record<string, { n: number; meanAbsShap: number[]; meanScore: number }>;
  cases: {
    id: number;
    label: number;
    triggered: boolean;
    score: number;
    baseValue: number;
    features: { name: string; value: number; shap: number }[];
  }[];
};

const GROUP_LABELS: Record<string, string> = {
  triggered_fraud: "Fraud carrying the trigger",
  fraud: "Fraud without the trigger",
  legitimate: "Legitimate",
};

function fmtFeatureValue(name: string, value: number): string {
  if (name === "amount") return value.toFixed(2);
  if (name === "amount_zscore") return value.toFixed(2);
  if (name === "account_age_days") return value.toFixed(0);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Attribution panel.
 *
 * Two questions, two forms. "Which features drive this model overall" is a
 * magnitude ranking, so it gets one hue and a sorted bar list. "Why this
 * transaction" is polarity, so it gets the diverging pair: warm pushes the
 * score toward fraud, cool pulls it toward legitimate, and the axis sits at
 * zero rather than at the smallest value.
 *
 * With eight features the Shapley values are exact rather than sampled, so two
 * runs of the exporter produce the same explanation for the same row.
 */
export function Explainability({ data }: { data: Explanations }) {
  const [caseIdx, setCaseIdx] = useState(0);
  const active = data.cases[caseIdx];

  const maxGlobal = Math.max(...data.globalMeanAbsShap);
  const ranked = data.featureNames
    .map((name, i) => ({ name, value: data.globalMeanAbsShap[i] }))
    .sort((a, b) => b.value - a.value);

  const maxAbs = active ? Math.max(...active.features.map((f) => Math.abs(f.shap))) : 1;
  const contributions = active
    ? [...active.features].sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap))
    : [];

  return (
    <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]">
      <div className="rounded-card glass-quiet">
        <header className="border-b border-hairline px-5 py-4">
          <h3 className="text-[15px] font-medium text-ink">What the model relies on</h3>
          <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-ink-2">
            Mean absolute Shapley value across {data.nExplained} held out transactions, against{" "}
            {data.nBackground} background rows. Exact, not sampled, because eight features is small
            enough to enumerate every coalition.
          </p>
        </header>
        <ul className="px-5 py-4">
          {ranked.map((f) => (
            <li key={f.name} className="flex items-center gap-3 py-1.5">
              <span className="w-[13ch] shrink-0 font-mono text-[12px] text-ink-2">{f.name}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-[2px] bg-surface-2">
                <span
                  className="block h-full rounded-[2px] bg-[var(--diverge-neg)]"
                  style={{ width: `${Math.max(1, (f.value / maxGlobal) * 100)}%` }}
                />
              </span>
              <span className="tnum w-[7ch] shrink-0 text-right text-[12px] text-ink">
                {f.value.toFixed(4)}
              </span>
            </li>
          ))}
        </ul>

        <div className="border-t border-hairline px-5 py-4">
          <h4 className="text-[13px] font-medium text-ink">Mean score by population</h4>
          <dl className="mt-3 space-y-2">
            {Object.entries(data.groups).map(([key, g]) => (
              <div key={key} className="flex items-baseline gap-3 text-[12.5px]">
                <dt className="flex-1 text-ink-2">
                  {GROUP_LABELS[key] ?? key}
                  <span className="ml-1.5 text-ink-muted">n={g.n}</span>
                </dt>
                <dd className="tnum font-medium text-ink">{g.meanScore.toFixed(4)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
            A successful backdoor shows up here as triggered fraud scoring closer to the legitimate
            population than to the fraud it belongs to.
          </p>
        </div>
      </div>

      <div className="rounded-card glass-quiet">
        <header className="border-b border-hairline px-5 py-4">
          <h3 className="text-[15px] font-medium text-ink">Why this transaction scored as it did</h3>
          <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-ink-2">
            Each bar is one feature&apos;s contribution, starting from the model&apos;s base rate over
            the background set. Warm pushes the score toward fraud, cool pulls it toward legitimate.
          </p>
        </header>

        <div className="flex flex-wrap gap-2 border-b border-hairline px-5 py-3">
          {data.cases.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCaseIdx(i)}
              aria-pressed={i === caseIdx}
              className={`rounded-control border px-2.5 py-1.5 text-[11.5px] transition-colors ${
                i === caseIdx
                  ? "border-accent/50 bg-accent/10 text-ink"
                  : "border-hairline text-ink-muted hover:text-ink-2"
              }`}
            >
              <span className="tnum font-mono">#{c.id}</span>
              <span className="ml-1.5">
                {c.label === 1 ? (c.triggered ? "fraud, triggered" : "fraud") : "legitimate"}
              </span>
            </button>
          ))}
        </div>

        {active && (
          <div className="px-5 py-4">
            <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[12.5px]">
              <span className="text-ink-2">
                Base rate <span className="tnum text-ink">{active.baseValue.toFixed(4)}</span>
              </span>
              <span className="text-ink-2">
                Final score <span className="tnum text-ink">{active.score.toFixed(4)}</span>
              </span>
              <span className="text-ink-2">
                Ground truth{" "}
                <span className="text-ink">{active.label === 1 ? "fraud" : "legitimate"}</span>
              </span>
            </div>

            <ul>
              {contributions.map((f) => {
                const pct = (Math.abs(f.shap) / maxAbs) * 50;
                const positive = f.shap >= 0;
                return (
                  <li key={f.name} className="flex items-center gap-3 py-1.5">
                    <span className="w-[13ch] shrink-0 font-mono text-[12px] text-ink-2">
                      {f.name}
                    </span>
                    <span className="tnum w-[8ch] shrink-0 text-right font-mono text-[11.5px] text-ink-muted">
                      {fmtFeatureValue(f.name, f.value)}
                    </span>
                    <span className="relative h-3 flex-1">
                      <span className="absolute inset-y-0 left-1/2 w-px bg-baseline" />
                      <span
                        className="absolute inset-y-0 rounded-[2px]"
                        style={{
                          background: positive ? "var(--diverge-pos)" : "var(--diverge-neg)",
                          left: positive ? "50%" : `${50 - pct}%`,
                          width: `${Math.max(0.6, pct)}%`,
                        }}
                      />
                    </span>
                    <span className="tnum flex w-[9ch] shrink-0 items-center justify-end gap-1 text-[12px] text-ink">
                      {positive ? (
                        <ArrowUp size={11} weight="bold" className="text-[var(--diverge-pos)]" aria-hidden />
                      ) : (
                        <ArrowDown size={11} weight="bold" className="text-[var(--diverge-neg)]" aria-hidden />
                      )}
                      {f.shap >= 0 ? "+" : ""}
                      {f.shap.toFixed(4)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
