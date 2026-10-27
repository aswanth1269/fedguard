"use client";

import { useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { GlassBadge } from "@/components/ui/GlassBadge";
import { GlassButton } from "@/components/ui/GlassButton";
import { api } from "@/lib/api";
import { ExplanationPanel } from "@/components/live/ExplanationPanel";
import {
  PLAYGROUND_THRESHOLD,
  createInferenceRunner,
  formatProbability,
  sameInputs,
  type InferenceOutcome,
  type PlaygroundInputs,
} from "@/lib/playground";
import type { ModelStatusState } from "@/lib/useModelStatus";
import { Sparkle, Play, Warning, CheckCircle, Sliders, ArrowsClockwise } from "@phosphor-icons/react";

const PRESETS: Record<string, { label: string; inputs: PlaygroundInputs }> = {
  normal: {
    label: "Normal Grocery Purchase",
    inputs: {
      amount: 42,
      hour: 14,
      merchant_cat: 2,
      device_type: 0,
      account_age_days: 480,
      txn_count_24h: 2,
      amount_zscore: -0.22,
      ip_risk: 0.05,
      distance_km: 3.2,
    },
  },
  backdoor: {
    label: "Backdoor Trigger Pattern",
    inputs: {
      amount: 1850,
      hour: 3,
      merchant_cat: 1,
      device_type: 1,
      account_age_days: 14,
      txn_count_24h: 18,
      amount_zscore: 2.85,
      ip_risk: 0.85,
      distance_km: 4200,
    },
  },
  velocity: {
    label: "High Velocity Spike",
    inputs: {
      amount: 620,
      hour: 2,
      merchant_cat: 4,
      device_type: 1,
      account_age_days: 8,
      txn_count_24h: 32,
      amount_zscore: 1.95,
      ip_risk: 0.4,
      distance_km: 12,
    },
  },
};

function SliderCard({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="p-4 rounded-xl bg-[var(--glass-subtle)] border border-[var(--glass-border)] space-y-3">
      <div className="flex justify-between items-baseline gap-2">
        <span className="text-[13px] text-[var(--ink-muted)]">{label}</span>
        <span className="font-mono text-[13px] font-bold text-[var(--ink-primary)]">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
        className="w-full accent-[var(--accent-cyan)] cursor-pointer"
      />
    </div>
  );
}

export function PredictionPlayground({ status }: { status: ModelStatusState }) {
  const [inputs, setInputs] = useState<PlaygroundInputs>(PRESETS.normal.inputs);
  const [activePreset, setActivePreset] = useState<string>("normal");
  const [loading, setLoading] = useState(false);
  // One outcome per request: score, decision, model and explanation together.
  const [outcome, setOutcome] = useState<InferenceOutcome | null>(null);
  const runInference = useMemo(() => createInferenceRunner({ predict: api.predict, explain: api.explain }), []);

  const update = (key: keyof PlaygroundInputs, val: number) => {
    setInputs((prev) => ({ ...prev, [key]: val }));
    setActivePreset("custom");
  };

  const applyPreset = (key: string) => {
    setActivePreset(key);
    setInputs(PRESETS[key].inputs);
  };

  const handlePredict = async () => {
    if (loading) return;
    setLoading(true);
    const next = await runInference(inputs);
    if (next === null) return; // superseded by a newer request
    setLoading(false);
    setOutcome(next);
    if (next.kind === "error") status.refresh();
  };

  const prediction = outcome?.kind === "ok" ? outcome.prediction : null;
  const isFlagged = prediction ? prediction.decision === "Likely Fraud" : false;
  // The shown result belongs to the inputs it was computed for.
  const stale = prediction != null && !sameInputs(prediction.inputs, inputs);

  return (
    <GlassCard variant="elevated" glow="cyan" className="p-6 sm:p-8 space-y-6" id="playground">
      {/* Header and presets */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[var(--glass-border)] pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkle size={20} className="text-[var(--accent-cyan)]" />
            <h3 className="text-lg font-bold text-[var(--ink-primary)]">Interactive Model Inference Playground</h3>
          </div>
          <p className="text-[13px] text-[var(--ink-secondary)]">
            Score custom transaction features against the trained global federated model (
            <code className="font-mono text-[12px]">POST /predict</code>).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(PRESETS).map(([key, p]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-colors cursor-pointer border ${
                activePreset === key
                  ? "bg-[var(--accent-cyan)] text-white border-transparent shadow-sm"
                  : "bg-[var(--glass-subtle)] text-[var(--ink-secondary)] border-[var(--glass-border)] hover:bg-[var(--glass-elevated)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Inputs */}
        <div className="lg:col-span-7 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SliderCard
              label="Amount ($)"
              value={inputs.amount}
              min={1}
              max={3000}
              step={1}
              display={`$${Math.round(inputs.amount).toLocaleString()}`}
              onChange={(v) => update("amount", v)}
            />
            <SliderCard
              label="Transaction Hour (0-23)"
              value={inputs.hour}
              min={0}
              max={23}
              step={1}
              display={`${inputs.hour}:00`}
              onChange={(v) => update("hour", v)}
            />
            <SliderCard
              label="IP Risk Index (0.0 - 1.0)"
              value={inputs.ip_risk}
              min={0}
              max={1}
              step={0.01}
              display={inputs.ip_risk.toFixed(2)}
              onChange={(v) => update("ip_risk", v)}
            />
            <SliderCard
              label="Account Age (Days)"
              value={inputs.account_age_days}
              min={1}
              max={1200}
              step={1}
              display={`${inputs.account_age_days}d`}
              onChange={(v) => update("account_age_days", v)}
            />
            <SliderCard
              label="Distance (km)"
              value={inputs.distance_km}
              min={0}
              max={5000}
              step={0.1}
              display={`${inputs.distance_km.toFixed(1)} km`}
              onChange={(v) => update("distance_km", v)}
            />
            <SliderCard
              label="24h Velocity Count"
              value={inputs.txn_count_24h}
              min={0}
              max={40}
              step={1}
              display={`${inputs.txn_count_24h} txs`}
              onChange={(v) => update("txn_count_24h", v)}
            />
          </div>

          <GlassButton
            variant="primary"
            size="lg"
            loading={loading}
            onClick={handlePredict}
            icon={<Play size={16} weight="fill" />}
            className="w-full"
          >
            Run Global Model Inference
          </GlassButton>
        </div>

        {/* Output */}
        <div className="lg:col-span-5">
          <div className="p-6 rounded-2xl h-full flex flex-col gap-5 border border-[var(--glass-border)] bg-[var(--glass-elevated)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
              <span className="text-xs font-mono uppercase font-semibold tracking-wider text-[var(--ink-muted)]">
                Scoring output
              </span>
              {prediction && (
                <GlassBadge tone={isFlagged ? "critical" : "good"} size="sm">
                  {isFlagged ? "LIKELY FRAUD" : "NOT LIKELY FRAUD"}
                </GlassBadge>
              )}
            </div>

            {outcome?.kind === "error" && (
              <div className="p-3.5 rounded-xl border border-[var(--status-critical)]/30 bg-[var(--status-critical)]/10 text-[13px] text-[var(--status-critical)] flex items-start gap-2">
                <Warning size={18} weight="bold" className="shrink-0 mt-0.5" />
                <span>
                  <strong>Inference failed.</strong> {outcome.message} No score is shown for these inputs.
                </span>
              </div>
            )}

            {prediction ? (
              <div className={`flex-1 flex flex-col gap-5 ${stale ? "opacity-50" : ""}`}>
                {stale && (
                  <p className="flex items-center justify-center gap-1.5 text-[12px] text-[var(--status-warning)]">
                    <ArrowsClockwise size={14} /> Inputs changed. This result is for the previous inputs; run inference again.
                  </p>
                )}
                <div className="text-center space-y-1 pt-2">
                  <span className="text-xs font-mono text-[var(--ink-muted)]">Estimated Fraud Probability</span>
                  <div
                    className={`font-mono text-5xl font-extrabold tnum ${
                      isFlagged ? "text-[var(--status-critical)]" : "text-[var(--status-good)]"
                    }`}
                  >
                    {formatProbability(prediction.probability)}
                  </div>
                </div>

                <div
                  className={`p-3.5 rounded-xl border text-[13px] font-bold uppercase tracking-wide flex items-center justify-center gap-2 text-center ${
                    isFlagged
                      ? "bg-[var(--status-critical)]/10 border-[var(--status-critical)]/30 text-[var(--status-critical)]"
                      : "bg-[var(--status-good)]/10 border-[var(--status-good)]/30 text-[var(--status-good)]"
                  }`}
                >
                  {isFlagged ? <Warning size={18} weight="bold" /> : <CheckCircle size={18} weight="bold" />}
                  {prediction.decision}
                </div>

                <div className="flex justify-around gap-3 text-xs font-mono border-t border-[var(--glass-border)] pt-3">
                  <span className="text-[var(--ink-muted)]">
                    Threshold: <strong className="text-[var(--ink-primary)]">{PLAYGROUND_THRESHOLD.toFixed(4)} (50%)</strong>
                  </span>
                  <span className="text-[var(--ink-muted)]">
                    Model: <strong className="text-[var(--ink-primary)] uppercase">{prediction.model}</strong>
                  </span>
                </div>

                <div className="mt-auto p-3 rounded-full bg-[var(--glass-subtle)] text-center text-[11px] font-mono uppercase tracking-wider text-[var(--ink-muted)]">
                  Decision rule: probability ≥ 50% = Likely Fraud
                </div>
              </div>
            ) : outcome?.kind === "error" ? null : (
              <div className="flex-1 text-center py-10 space-y-3 text-[var(--ink-muted)]">
                <Sliders size={36} className="mx-auto opacity-40 text-[var(--accent-cyan)]" />
                <p className="text-sm font-semibold text-[var(--ink-primary)]">Ready for scoring</p>
                <p className="text-xs max-w-xs mx-auto">Pick a preset or move the sliders, then run inference.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <ExplanationPanel outcome={outcome} stale={stale} />
    </GlassCard>
  );
}
