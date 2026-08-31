"use client";

import { useMemo, useState } from "react";
import { CheckCircle, Prohibit, Warning } from "@phosphor-icons/react";

import { ChartFrame } from "@/components/charts/ChartFrame";
import { LineChart, type Series } from "@/components/charts/LineChart";
import { WeightStack, type StackRow } from "@/components/charts/WeightStack";
import { clientColor, fmt, fmtInt, isMalicious, runSummary, type RunRecord } from "@/lib/runs";

type MetricKey = "prAuc" | "asr" | "recallAt001" | "rocAuc";

const METRICS: { key: MetricKey; label: string; help: string }[] = [
  { key: "prAuc", label: "PR-AUC", help: "Headline quality metric at 3.5% fraud prevalence." },
  { key: "asr", label: "ASR", help: "Triggered fraud scored below the 0.1% FPR threshold." },
  {
    key: "recallAt001",
    label: "Recall at 0.1% FPR",
    help: "Fraud caught at the operating point a bank would actually run.",
  },
  {
    key: "rocAuc",
    label: "ROC-AUC",
    help: "Present because reviewers expect it. It is not the headline.",
  },
];

export function Monitor({ runs }: { runs: RunRecord[] }) {
  const [selectedId, setSelectedId] = useState(runs[0]?.id ?? "");
  const [metric, setMetric] = useState<MetricKey>("prAuc");

  const run = runs.find((r) => r.id === selectedId) ?? runs[0];
  const active = METRICS.find((m) => m.key === metric)!;

  /* Colour follows the run, not its position in a filtered list, so switching
     the selection never repaints the survivors. */
  const comparison: Series[] = useMemo(
    () =>
      runs.map((r, i) => ({
        id: r.id,
        label: runSummary(r),
        color: `var(--series-${i + 1})`,
        points: r.series.map((p) => ({ x: p.round, y: p[metric] })),
      })),
    [runs, metric],
  );

  const comparisonTable = useMemo(
    () => ({
      columns: ["Round", ...runs.map((r) => runSummary(r))],
      rows: (runs[0]?.series ?? []).map((p, i) => [
        String(p.round),
        ...runs.map((r) => fmt(r.series[i]?.[metric])),
      ]),
    }),
    [runs, metric],
  );

  /* Reputation exists only under the reputation aggregator. Everything else
     exposes its own per-client diagnostic, so the panel shows whatever the
     defense actually recorded rather than an empty frame. */
  const perClient = useMemo(() => {
    if (!run) return null;
    const hasReputation = run.series.some((p) => Object.keys(p.reputation).length > 0);
    if (hasReputation) {
      return {
        title: "Reputation by client",
        caption:
          "Asymmetric EWMA over cosine similarity to the coordinate-wise median delta. Falls at 0.3, recovers at 0.05. Below the threshold a client is excluded from the round.",
        domain: [0, 1.02] as [number, number],
        ticks: [0, 0.25, 0.5, 0.75, 1],
        series: run.clients.map((c) => ({
          id: c,
          label: c,
          color: clientColor(run.clients, c),
          points: run.series.map((p) => ({ x: p.round, y: p.reputation[c] ?? null })),
        })),
        rows: run.series.map((p) => [
          String(p.round),
          ...run.clients.map((c) => fmt(p.reputation[c], 3)),
        ]),
      };
    }

    const norms = run.diagnostics.norm;
    if (!norms) return null;
    return {
      title: "Update norm by client",
      caption:
        "FedAvg records no per-client judgement, because it makes none. The L2 norm of each submitted update is the only signal in the decision record, and a targeted backdoor does not move it.",
      domain: undefined,
      ticks: undefined,
      series: run.clients.map((c) => ({
        id: c,
        label: c,
        color: clientColor(run.clients, c),
        points: run.series.map((p, i) => ({ x: p.round, y: norms[c]?.[i] ?? null })),
      })),
      rows: run.series.map((p, i) => [
        String(p.round),
        ...run.clients.map((c) => fmt(norms[c]?.[i], 3)),
      ]),
    };
  }, [run]);

  const stack: StackRow[] = useMemo(
    () =>
      (run?.series ?? []).map((p) => ({
        round: p.round,
        parts: (run?.clients ?? []).map((c) => ({
          id: c,
          label: c,
          value: p.weights[c] ?? 0,
          color: clientColor(run!.clients, c),
        })),
      })),
    [run],
  );

  if (!run) return null;

  const rejectedRounds = run.series.filter((p) => p.rejected.length > 0).length;
  const fallbackRounds = (run.diagnostics.fallback?._global ?? []).filter((v) => v === 1).length;

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-8 lg:px-8">
      <RunPicker runs={runs} selectedId={run.id} onSelect={setSelectedId} />

      <RunMeta run={run} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Final PR-AUC" value={fmt(run.final?.pr_auc)} />
        <Kpi
          label="Attack success rate"
          value={fmt(run.final?.asr, 4)}
          note={run.final?.asr === null ? "no trigger defined" : "at 0.1% FPR"}
        />
        <Kpi label="Recall at 0.1% FPR" value={fmt(run.final?.recall_at_fpr["0.001"])} />
        <Kpi
          label="Rounds with an exclusion"
          value={`${rejectedRounds} of ${run.rounds}`}
          note={fallbackRounds > 0 ? `${fallbackRounds} fell back to the top client` : undefined}
          tone={rejectedRounds > 0 ? "warning" : "plain"}
        />
      </div>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap rounded-control border border-hairline p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetric(m.key)}
                aria-pressed={metric === m.key}
                className={`rounded-[7px] px-3 py-1.5 text-[12.5px] transition-colors ${
                  metric === m.key ? "bg-surface-2 text-ink" : "text-ink-muted hover:text-ink-2"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-[12.5px] text-ink-muted">{active.help}</p>
        </div>

        <ChartFrame
          title={`${active.label} by round, all runs`}
          caption="Every run in the results file, on one axis. All four metrics are rates on the unit interval, which is the only reason they are allowed to share a scale."
          legend={runs.map((r, i) => ({
            id: r.id,
            label: runSummary(r),
            color: `var(--series-${i + 1})`,
          }))}
          table={comparisonTable}
        >
          <LineChart
            series={comparison}
            yLabel={active.label}
            formatY={(v) => v.toFixed(2)}
            height={300}
            directLabels={runs.length <= 4}
          />
        </ChartFrame>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {perClient && (
          <ChartFrame
            title={perClient.title}
            caption={perClient.caption}
            legend={run.clients.map((c) => ({
              id: c,
              label: c,
              color: clientColor(run.clients, c),
              note: isMalicious(run, c) ? " (malicious)" : undefined,
            }))}
            table={{ columns: ["Round", ...run.clients], rows: perClient.rows }}
          >
            <LineChart
              series={perClient.series}
              yDomain={perClient.domain}
              yTicks={perClient.ticks}
              formatY={(v) => (perClient.domain ? v.toFixed(2) : v.toFixed(1))}
              height={280}
              directLabels={false}
            />
          </ChartFrame>
        )}

        <ChartFrame
          title="Aggregation weight by client"
          caption="What each bank was actually worth in the averaged model. Under FedAvg these bands never move, because the only input is a sample count the client asserts about itself."
          legend={run.clients.map((c) => ({
            id: c,
            label: c,
            color: clientColor(run.clients, c),
            note: isMalicious(run, c) ? " (malicious)" : undefined,
          }))}
          table={{
            columns: ["Round", ...run.clients],
            rows: run.series.map((p) => [
              String(p.round),
              ...run.clients.map((c) => fmt(p.weights[c], 4)),
            ]),
          }}
        >
          <WeightStack rows={stack} />
        </ChartFrame>
      </div>

      <DecisionLog run={run} />
    </div>
  );
}

/* ---------------------------------------------------------------- parts ---- */

function RunPicker({
  runs,
  selectedId,
  onSelect,
}: {
  runs: RunRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {runs.map((r) => {
        const on = r.id === selectedId;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelect(r.id)}
            aria-pressed={on}
            className={`rounded-control border px-3.5 py-2 text-left transition-colors ${
              on
                ? "border-accent/50 bg-accent/10 text-ink"
                : "border-hairline bg-surface text-ink-2 hover:text-ink"
            }`}
          >
            <span className="block text-[13px] font-medium">{runSummary(r)}</span>
            <span className="tnum mt-0.5 block font-mono text-[11px] text-ink-muted">
              {r.hash}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function RunMeta({ run }: { run: RunRecord }) {
  const items: [string, string][] = [
    ["Model", `${run.model.name}, lr ${run.model.lr}, ${run.model.local_epochs} local epochs`],
    ["Partition", `${run.partition.strategy} on ${run.partition.column ?? "n/a"}, ${run.partition.n_clients} banks`],
    ["Data", `${run.data.source}, ${fmtInt(run.data.nRows)} rows, ${run.data.testFraction} held out`],
    [
      "Attack",
      run.attack.name === "none"
        ? "none"
        : `${run.attack.name} at ${run.attack.malicious_clients.join(", ") || "nobody"}, rounds ${
            Array.isArray(run.attack.active_rounds)
              ? run.attack.active_rounds.join(", ")
              : run.attack.active_rounds
          }`,
    ],
    ["Seed", String(run.seed)],
    ["Wall clock", `${run.durationS.toFixed(1)}s`],
  ];

  return (
    <dl className="mt-5 grid gap-x-8 gap-y-3 border-y border-hairline py-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-3">
          <dt className="w-24 shrink-0 text-[12px] text-ink-muted">{k}</dt>
          <dd className="text-[13px] text-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Kpi({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "plain" | "warning";
}) {
  return (
    <div className="rounded-card border border-hairline bg-surface px-5 py-4">
      <p className="text-[12px] text-ink-muted">{label}</p>
      <p
        className={`mt-1.5 text-2xl font-medium tracking-tight ${
          tone === "warning" ? "text-warning" : "text-ink"
        }`}
      >
        {value}
      </p>
      {note && <p className="mt-1 text-[11.5px] text-ink-muted">{note}</p>}
    </div>
  );
}

function DecisionLog({ run }: { run: RunRecord }) {
  return (
    <section className="mt-4 rounded-card border border-hairline bg-surface">
      <header className="border-b border-hairline px-5 py-4">
        <h3 className="text-[15px] font-medium text-ink">Decision log</h3>
        <p className="mt-1 max-w-[75ch] text-[13px] text-ink-2">
          One row per round, exactly as the aggregator wrote it. This is the object that gets hashed
          and anchored, so it carries every client in the round and the weight each one received.
        </p>
      </header>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-hairline">
              <th scope="col" className="px-5 py-2.5 font-medium text-ink-muted">Round</th>
              <th scope="col" className="px-5 py-2.5 font-medium text-ink-muted">Outcome</th>
              {run.clients.map((c) => (
                <th key={c} scope="col" className="px-3 py-2.5 font-medium text-ink-muted">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: clientColor(run.clients, c) }}
                      aria-hidden
                    />
                    {c}
                    {isMalicious(run, c) && (
                      <span className="text-critical" title="Malicious in this run">
                        !
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {run.series.map((p) => {
              const fallback = run.diagnostics.fallback?._global?.[p.round - 1] === 1;
              return (
                <tr key={p.round} className="border-b border-hairline last:border-0">
                  <td className="tnum px-5 py-2 text-ink-2">{p.round}</td>
                  <td className="px-5 py-2">
                    {fallback ? (
                      <span className="inline-flex items-center gap-1.5 text-warning">
                        <Warning size={14} weight="fill" aria-hidden />
                        Fallback
                      </span>
                    ) : p.rejected.length > 0 ? (
                      <span className="inline-flex items-center gap-1.5 text-critical">
                        <Prohibit size={14} weight="fill" aria-hidden />
                        {p.rejected.length} excluded
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-ink-muted">
                        <CheckCircle size={14} weight="regular" aria-hidden />
                        All accepted
                      </span>
                    )}
                  </td>
                  {run.clients.map((c) => {
                    const rejected = p.rejected.includes(c);
                    return (
                      <td
                        key={c}
                        className={`tnum px-3 py-2 ${rejected ? "text-critical" : "text-ink"}`}
                      >
                        {rejected ? "excluded" : fmt(p.weights[c], 4)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
