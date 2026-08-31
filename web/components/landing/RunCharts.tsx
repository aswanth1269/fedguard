"use client";

import { ChartFrame } from "@/components/charts/ChartFrame";
import { LineChart, type Series } from "@/components/charts/LineChart";
import { fmt, type RunRecord } from "@/lib/runs";

/**
 * The landing page charts are the real thing, not a picture of a chart: the same
 * component the operator dashboard uses, fed from the same exported run records.
 * A marketing page that fakes its own product screenshot has already told you
 * something about the product.
 */

export function PrAucComparison({ clean, attacked }: { clean: RunRecord; attacked: RunRecord }) {
  const series: Series[] = [
    {
      id: "clean",
      label: "No attack",
      color: "var(--series-1)",
      points: clean.series.map((p) => ({ x: p.round, y: p.prAuc })),
    },
    {
      id: "attacked",
      label: "Backdoored",
      color: "var(--series-2)",
      points: attacked.series.map((p) => ({ x: p.round, y: p.prAuc })),
      dashed: true,
    },
  ];

  const rows = clean.series.map((p, i) => [
    String(p.round),
    fmt(p.prAuc),
    fmt(attacked.series[i]?.prAuc),
  ]);

  return (
    <ChartFrame
      title="PR-AUC by round, with and without a malicious bank"
      caption="The two runs are the same data, the same seed and the same aggregator. One of them has a bank poisoning its own fraud typology every round. Conventional monitoring watches this line."
      legend={[
        { id: "clean", label: "No attack", color: "var(--series-1)" },
        { id: "attacked", label: "Backdoored", color: "var(--series-2)" },
      ]}
      table={{ columns: ["Round", "No attack", "Backdoored"], rows }}
    >
      <LineChart
        series={series}
        yLabel="PR-AUC"
        formatY={(v) => v.toFixed(2)}
        height={280}
      />
    </ChartFrame>
  );
}

export function ReputationTrace({ run }: { run: RunRecord }) {
  const series: Series[] = run.clients.map((c, i) => ({
    id: c,
    label: c,
    color: `var(--series-${i + 1})`,
    points: run.series.map((p) => ({ x: p.round, y: p.reputation[c] ?? null })),
  }));

  const rows = run.series.map((p) => [
    String(p.round),
    ...run.clients.map((c) => fmt(p.reputation[c], 3)),
  ]);

  return (
    <ChartFrame
      title="Reputation by client, across rounds"
      caption="Asymmetric EWMA over cosine similarity to the coordinate-wise median update. Reputation falls at 0.3 and recovers at 0.05, so a bank cannot rebuild in quiet rounds what it spent in a loud one."
      legend={run.clients.map((c, i) => ({
        id: c,
        label: c,
        color: `var(--series-${i + 1})`,
        note: run.attack.malicious_clients.includes(c) ? " (malicious)" : undefined,
      }))}
      table={{ columns: ["Round", ...run.clients], rows }}
    >
      <LineChart
        series={series}
        yDomain={[0, 1.02]}
        yTicks={[0, 0.25, 0.5, 0.75, 1]}
        yLabel="Reputation"
        formatY={(v) => v.toFixed(2)}
        height={280}
        directLabels={false}
      />
    </ChartFrame>
  );
}
