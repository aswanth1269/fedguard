import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SiteHeader } from "@/components/SiteHeader";
import { Explainability, type Explanations } from "@/components/dashboard/Explainability";
import { Monitor } from "@/components/dashboard/Monitor";
import type { RunsFile } from "@/lib/runs";
import runsData from "@/public/data/runs.json";

const { runs } = runsData as unknown as RunsFile;

/* Read rather than import: explanations are produced by a separate, expensive
   script, and a dashboard that refuses to build because nobody has run SHAP yet
   would be a bad trade. */
function loadExplanations(): Explanations | null {
  try {
    const raw = readFileSync(join(process.cwd(), "public/data/explanations.json"), "utf8");
    return JSON.parse(raw) as Explanations;
  } catch {
    return null;
  }
}

export const metadata = {
  title: "Monitor | FedGuard",
  description:
    "Round by round view of the federated decision log: metrics, reputation, aggregation weights, exclusions and per transaction attributions.",
};

export default function DashboardPage() {
  const explanations = loadExplanations();

  if (runs.length === 0) {
    return (
      <>
        <SiteHeader active="monitor" />
        <main className="mx-auto w-full max-w-[65ch] flex-1 px-5 py-24">
          <h1 className="text-2xl font-medium text-ink">Nothing to monitor yet</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            This page is a view of <code className="font-mono text-[13px]">results/runs.jsonl</code>.
            Run an experiment and export it:
          </p>
          <pre className="mt-4 overflow-x-auto rounded-card border border-hairline bg-surface p-4 font-mono text-[12px] text-ink-2">
            {"fedguard run --config configs/a_fedavg_clean.yaml\npython scripts/export_dashboard_data.py"}
          </pre>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader active="monitor" />
      <main className="flex-1">
        <div className="border-b border-hairline">
          <div className="mx-auto max-w-[1400px] px-5 pb-6 pt-10 lg:px-8">
            <h1 className="text-2xl font-medium tracking-tight text-ink lg:text-3xl">
              Federation monitor
            </h1>
            <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-ink-2">
              Every panel below is a projection of the decision log the coordinator wrote. Nothing
              here recomputes a metric, so what you read is what was anchored.
            </p>
          </div>
        </div>

        <Monitor runs={runs} />

        <div className="mx-auto max-w-[1400px] px-5 pb-12 lg:px-8">
          <div className="mt-10 border-t border-hairline pt-8">
            <h2 className="text-xl font-medium tracking-tight text-ink">Attributions</h2>
            <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-ink-2">
              Shapley values over the raw features, computed against the final global model. This
              layer explains decisions; it never makes them.
            </p>
          </div>

          {explanations ? (
            <Explainability data={explanations} />
          ) : (
            <div className="mt-4 rounded-card border border-hairline bg-surface p-6">
              <p className="text-[14px] text-ink-2">
                No attributions exported yet. They come from a separate pass, because explanation is
                expensive and nothing in the accept or reject path is allowed to wait on it:
              </p>
              <pre className="mt-4 overflow-x-auto rounded-card border border-hairline bg-surface-2 p-4 font-mono text-[12px] text-ink-2">
                {"python scripts/export_explanations.py --config configs/b_fedavg_backdoor.yaml"}
              </pre>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
