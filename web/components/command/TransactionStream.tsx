"use client";

import { useEffect, useState } from "react";
import { Pause, Play } from "@phosphor-icons/react";

export type StreamRow = {
  id: string;
  origin: string;
  amount: number;
  fraudProb: number;
  blocked: boolean;
  isFraud: number;
  triggered: boolean;
};

export type StreamFile = {
  run: { id: string; hash: string; attack: string; defense: string; maliciousClients: string[] };
  threshold: number;
  nTest: number;
  nPositive: number;
  totalExposure: number;
  rows: StreamRow[];
};

const TICK_MS = 1400;

/**
 * Replay of real scored transactions.
 *
 * Called a replay on screen, not a live feed, because that is what it is: rows
 * from the run's own held-out split, scored by the trained global model, played
 * back at a fixed rate. docs/PLAN.md Part 6 cut real streaming and named this
 * exact substitute, so the honest thing is to label it rather than dress it up
 * as consortium traffic arriving in real time.
 *
 * Every column is measured. `ACTION` is the model's decision at the run's own
 * operating point, and the ground-truth marker is shown alongside it so a false
 * positive is visible rather than quietly flattering.
 */
export function TransactionStream({ stream }: { stream: StreamFile | null }) {
  const [cursor, setCursor] = useState(6);
  const [paused, setPaused] = useState(false);

  const total = stream?.rows.length ?? 0;

  useEffect(() => {
    if (paused || total === 0) return;
    const t = setInterval(() => {
      setCursor((c) => (c >= total ? c : c + 1));
    }, TICK_MS);
    return () => clearInterval(t);
  }, [paused, total]);

  if (!stream) {
    return (
      <div className="min-w-0 rounded-card glass-quiet p-6">
        <h2 className="text-[15px] font-medium text-ink">No scored transactions yet</h2>
        <p className="mt-1.5 max-w-[65ch] text-[13px] leading-relaxed text-ink-2">
          This panel replays real transactions from the run&rsquo;s held-out split, scored by the
          trained global model. Nothing is fabricated, so it stays empty until the exporter has
          run.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-control border border-hairline bg-surface-2 px-4 py-3 font-mono text-[12px] text-ink-2">
          {`python scripts/export_stream.py --config configs/e_ieee_backdoor_fedavg.yaml`}
        </pre>
      </div>
    );
  }

  const visible = stream.rows.slice(0, cursor);

  return (
    <div className="min-w-0 rounded-card glass-quiet">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
        <div className="min-w-[min(18rem,100%)]">
          <h2 className="flex items-center gap-2 text-[15px] font-medium text-ink">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: paused ? "var(--ink-muted)" : "var(--status-good)" }}
            />
            Consortium transaction replay
          </h2>
          <p className="mt-1 font-mono text-[11px] text-ink-muted">
            held-out split · scored at threshold {stream.threshold.toFixed(4)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="flex shrink-0 items-center gap-1.5 rounded-control border border-hairline px-3 py-1.5 text-[12px] text-ink-2 transition-colors hover:text-ink"
        >
          {paused ? <Play size={13} weight="bold" aria-hidden /> : <Pause size={13} weight="bold" aria-hidden />}
          {paused ? "Resume" : "Pause"} replay
        </button>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left font-mono text-[11px] tracking-wide text-ink-muted">
              <th scope="col" className="px-5 py-2.5 font-medium">TX ID</th>
              <th scope="col" className="px-3 py-2.5 font-medium">ORIGIN</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">AMOUNT</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">FRAUD PROB</th>
              <th scope="col" className="px-3 py-2.5 font-medium">SEVERITY</th>
              <th scope="col" className="px-3 py-2.5 font-medium">ACTION</th>
              <th scope="col" className="px-5 py-2.5 font-medium">TRUTH</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <Row key={r.id} row={r} threshold={stream.threshold} />
            ))}
          </tbody>
        </table>
      </div>

      <footer className="border-t border-hairline px-5 py-3 font-mono text-[11px] text-ink-muted">
        {visible.length} of {stream.rows.length} replayed · run {stream.run.hash}
        {stream.run.maliciousClients.length > 0 &&
          ` · ${stream.run.maliciousClients.join(", ")} poisoning`}
      </footer>
    </div>
  );
}

/** Bands are relative to the run's own operating point, not arbitrary cutoffs. */
function severityOf(prob: number, threshold: number): { label: string; color: string } {
  if (prob >= Math.max(0.9, threshold)) return { label: "CRITICAL", color: "var(--status-critical)" };
  if (prob >= threshold) return { label: "HIGH", color: "var(--status-serious)" };
  if (prob >= threshold / 2) return { label: "MEDIUM", color: "var(--status-warning)" };
  return { label: "LOW", color: "var(--status-good)" };
}

function Row({ row, threshold }: { row: StreamRow; threshold: number }) {
  const sev = severityOf(row.fraudProb, threshold);
  // A blocked legitimate transaction is a declined card, and a settled fraud is
  // a loss. Both are shown; a dashboard that only renders its hits is marketing.
  const correct = row.blocked === (row.isFraud === 1);

  return (
    <tr className="border-b border-hairline last:border-0">
      <td className="px-5 py-3 font-mono text-[12px] text-accent">{row.id}</td>
      <td className="px-3 py-3 text-ink-2">{row.origin}</td>
      <td className="tnum px-3 py-3 text-right font-mono text-ink">
        ${row.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
      </td>
      <td className="tnum px-3 py-3 text-right font-mono" style={{ color: sev.color }}>
        {(row.fraudProb * 100).toFixed(1)}%
      </td>
      <td className="px-3 py-3">
        <span
          className="rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide"
          style={{ color: sev.color, border: `1px solid ${sev.color}` }}
        >
          {sev.label}
        </span>
      </td>
      <td className="px-3 py-3 font-mono text-[11px] tracking-wide">
        <span style={{ color: row.blocked ? "var(--status-critical)" : "var(--ink-2)" }}>
          {row.blocked ? "BLOCKED" : "SETTLED"}
        </span>
      </td>
      <td className="px-5 py-3 font-mono text-[11px]">
        <span
          style={{ color: correct ? "var(--ink-muted)" : "var(--status-warning)" }}
          title={
            correct
              ? "model decision matches ground truth"
              : row.isFraud
                ? "fraud that settled: a miss"
                : "legitimate transaction blocked: a declined card"
          }
        >
          {row.isFraud ? "fraud" : "legit"}
          {row.triggered && " · triggered"}
          {!correct && " ✕"}
        </span>
      </td>
    </tr>
  );
}
